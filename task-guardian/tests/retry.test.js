import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEventListeners } from 'node:events';
import {
  NATIVE_RETRY_COMPATIBILITY, parseRetryAfter, classifyFailure, computeBackoffMs,
  abortableWait, nativeExhausted, nativeRetryDisposition, registerRetryMiddleware,
} from '../lib/retry.js';

// Use the installed app's extracted packages; never install packages or access
// a live profile. The existing extraction scripts can prepare either runtime.
const root = fileURLToPath(new URL('../../', import.meta.url));
const runtimeCandidates = [
  process.env.DSH_TEST_RUNTIME,
  path.join(root, 'task-guardian/scripts/.runtime'),
  path.join(root, 'session-summary/scripts/.runtime'),
  path.join(root, 'side-branch/scripts/.runtime'),
].filter(Boolean);
let runtimeRequire;
for (const candidate of runtimeCandidates) {
  if (!fs.existsSync(path.join(candidate, 'package.json'))) continue;
  const require = createRequire(path.join(candidate, 'package.json'));
  try {
    for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm-retry', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection']) require.resolve(name);
    runtimeRequire = require;
    break;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
}
if (!runtimeRequire) throw new Error('Extract installed Cordis, dsh-llm-retry, dsh-session and dsh-session-projection into scripts/.runtime, or set DSH_TEST_RUNTIME to that isolated runtime.');
const runtimeImport = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const [{ Context }, native, { Session }, { SessionProjectionRegistry }] = await Promise.all([
  runtimeImport('@deepseek-ai/cordis'), runtimeImport('@deepseek-ai/dsh-llm-retry'),
  runtimeImport('@deepseek-ai/dsh-session'), runtimeImport('@deepseek-ai/dsh-session-projection'),
]);

const policy = (overrides = {}) => ({
  mode: 'normal', maxRetries: 2,
  retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
  initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0, ...overrides,
});
const failure = (overrides = {}) => ({ code: 'SERVER', message: 'Temporary provider error', status: 503, ...overrides });
const payloadFor = (session, overrides = {}) => ({
  agent: { session }, turn: 1, step: 1, provider: 'test-provider',
  failure: failure(), retryPolicy: policy(), signal: new AbortController().signal, ...overrides,
});
const deferred = () => Promise.withResolvers();

async function createHost(t, options = {}) {
  const ctx = new Context();
  new SessionProjectionRegistry(ctx);
  ctx.provide('agents', {});
  const fiber = ctx.plugin({
    name: 'test-native-llm-retry', inject: native.inject,
    apply(ctx) { native.apply(ctx, {}, { random: () => 0.5 }); },
  });
  await fiber.await();
  assert.equal(fiber.state, 2, `Native retry plugin must activate: ${String(fiber.error ?? fiber._error)}`);
  const scheduled = [], blocked = [], resets = [], waited = [];
  const middleware = registerRetryMiddleware(ctx, {
    isEnabled: () => true,
    random: () => 0.5,
    now: () => 1000,
    wait: async (milliseconds, signal) => { waited.push({ milliseconds, signal }); return !signal.aborted; },
    onSchedule: entry => { scheduled.push(entry); },
    onBlocked: entry => { blocked.push(entry); },
    onReset: entry => { resets.push(entry); },
    ...options,
  });
  t.after(async () => { await middleware.dispose(); await ctx.fiber.dispose(); });
  return {
    ctx, middleware, scheduled, blocked, resets, waited,
    dispatch: (payload, next = () => Promise.resolve(undefined)) => ctx.waterfall('agent/request-error', payload, next),
    session: (id = 'session-a') => Session.create(id),
  };
}

// Unit behavior also constrains the fallback independently of the host plugin.
test('Retry-After accepts seconds and HTTP dates and rejects ambiguous or invalid values', () => {
  const nowMs = Date.parse('Sun, 06 Nov 1994 08:49:37 GMT');
  assert.equal(parseRetryAfter(' 600 '), 600_000);
  assert.equal(parseRetryAfter(1.25), 1250);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter('0.0001'), 1);
  assert.equal(parseRetryAfter('Sun, 06 Nov 1994 08:59:37 GMT', { nowMs }), 600_000);
  assert.equal(parseRetryAfter('Sunday, 06-Nov-94 08:59:37 GMT', { nowMs }), 600_000);
  assert.equal(parseRetryAfter('Sun Nov  6 08:59:37 1994', { nowMs }), 600_000);
  assert.equal(parseRetryAfter('Sun, 06 Nov 1994 08:39:37 GMT', { nowMs }), 0);
  for (const value of [null, undefined, {}, [], '', 'later', '-1', '+1', '1e3', Infinity, NaN, '999999999999999999999']) {
    assert.equal(parseRetryAfter(value, { nowMs }), undefined, `Reject ${String(value)}`);
  }
});

test('classification recognizes concrete transient evidence and permanent configuration errors', () => {
  for (const code of ['SERVER', 'TIMEOUT', 'EMPTY_RESPONSE', 'STREAM_CLOSED', 'ECONNRESET', 'EAI_AGAIN']) {
    assert.equal(classifyFailure({ code }).kind, 'transient', code);
  }
  for (const status of [408, 500, 502, 503, 504, 599]) {
    assert.equal(classifyFailure({ code: 'OTHER', status }).kind, 'transient', String(status));
    assert.equal(classifyFailure({ code: `HTTP_${status}` }).kind, 'transient');
  }
  for (const code of ['AUTH', 'QUOTA', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'UNKNOWN_MODEL', 'MODEL_UNSUPPORTED', 'INVALID_API_KEY', 'INSUFFICIENT_QUOTA', 'CONTEXT_LENGTH_EXCEEDED', 'UNSUPPORTED_CONTENT', 'REQUEST_EXTENSION', 'EINVAL', 'ENOTFOUND', 'CERT_HAS_EXPIRED']) {
    assert.equal(classifyFailure({ code }).kind, 'permanent', code);
  }
  for (const status of [400, 401, 402, 403, 404, 413, 422]) {
    assert.equal(classifyFailure({ code: 'TRANSPORT', status }).kind, 'permanent');
  }
  assert.equal(classifyFailure({ code: 'QUOTA', status: 429 }).kind, 'permanent');
  assert.equal(classifyFailure({ code: 'SERVER', status: 418 }).kind, 'unknown');
  for (const value of [null, 'network error', {}, { code: 'UNRECOGNIZED' }, { message: 'retry after 5 seconds' }, { code: 'ABORTED' }]) {
    assert.equal(classifyFailure(value).kind, 'unknown');
  }
});

test('429 needs explicit temporary rate/concurrency evidence or a retained Retry-After delay', () => {
  assert.deepEqual(classifyFailure({ code: 'RATE_LIMIT', providerRetryAfterMs: 700_000 }), { kind: 'transient', reason: 'rate-limit', retryAfterMs: 700_000 });
  for (const code of ['HTTP_429', 'RATE_LIMIT', 'SERVER']) {
    for (const message of ['', 'Provider rejected the request', 'Too many requests']) {
      assert.equal(classifyFailure({ code, status: 429, message }).kind, 'unknown');
    }
  }
  for (const message of ['Rate limit exceeded', 'Temporary rate limit, try again later', 'Too many concurrent requests', 'concurrency_limit reached', '请求并发数超过限制']) {
    assert.equal(classifyFailure({ code: 'RATE_LIMIT', status: 429, message }).kind, 'transient', message);
  }
  assert.equal(classifyFailure({ code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 0 }).kind, 'unknown');
  assert.equal(classifyFailure({ code: 'RATE_LIMIT', providerRetryAfterMs: -1, headers: { 'Retry-After': '600' } }).kind, 'unknown');
  assert.equal(classifyFailure({ code: 'OTHER', providerRetryAfterMs: 600_000 }).kind, 'unknown');
  assert.equal(classifyFailure({ code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 600_000, message: 'Quota limit reached' }).kind, 'unknown');
});

test('embedded permanent provider details outrank transient codes and HTTP 503/429', () => {
  const details = [
    ['insufficient_quota', 'quota'],
    [JSON.stringify({ error: { data: { error: { code: 'insufficient_quota', message: 'Quota exhausted' } } } }), 'quota'],
    [JSON.stringify({ error: { type: 'invalid_model', message: 'Model unavailable' } }), 'model-unavailable'],
    ['Provider replied: ' + JSON.stringify({ error: { message: JSON.stringify({ code: 'invalid_api_key' }) } }), 'authentication'],
    ['The credit balance is too low', 'quota'],
    ['模型不存在', 'model-unavailable'],
    ['context_length_exceeded', 'context-window'],
    ['Invalid URL in provider configuration', 'endpoint-configuration'],
    ['Invalid baseURL in provider configuration', 'request-configuration'],
    ['Invalid provider configuration', 'request-configuration'],
  ];
  for (const status of [503, 429]) {
    for (const [message, reason] of details) {
      const actual = classifyFailure({ code: 'SERVER', status, message, providerRetryAfterMs: 60_000 });
      assert.equal(actual.kind, 'permanent', message);
      assert.equal(actual.reason, reason, message);
    }
  }
  assert.equal(classifyFailure({ code: 'SERVER', message: 'x'.repeat(65_537) }).kind, 'unknown');
});

test('generic transport failures stop while concrete reset and stream idle timeout can recover', () => {
  for (const value of [
    { code: 'TRANSPORT', message: 'Network request failed' },
    { code: 'NETWORK_ERROR', message: 'fetch failed' },
    { code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }, { code: 'EHOSTUNREACH' },
    { code: 'TRANSPORT', message: 'fetch failed', cause: { code: 'ETIMEDOUT' } },
  ]) assert.equal(classifyFailure(value).kind, 'unknown', value.code);
  for (const message of ['connect ECONNREFUSED 127.0.0.1:8080', 'connection refused at http://localhost:3000', 'Invalid URL', 'certificate has expired', 'self signed certificate']) {
    assert.equal(classifyFailure({ code: 'TRANSPORT', message }).kind, 'permanent', message);
  }
  for (const message of ['DeepSeek Messages stream idle timeout', 'request timed out', 'connection reset by peer', 'socket hang up']) {
    assert.equal(classifyFailure({ code: 'TRANSPORT', message }).kind, 'transient', message);
  }
});

test('generic PI failures accept only explicit provider overload evidence with permanent precedence', () => {
  const exact = 'server_error: Our servers are currently overloaded. Please try again later.';
  const accepted = [exact,
    'server_error: Our servers are temporarily overloaded. Please try again later.',
    'server_error: Our server is currently overloaded. Please try again later.',
    'server_error: The service is temporarily overloaded. Please try again later.',
    'server_error: temporarily overloaded. Please try again later.',
    JSON.stringify({ error: { type: 'overloaded_error', message: 'Provider capacity exhausted' } }),
    'Provider replied: ' + JSON.stringify({ error: { detail: { code: 'overloaded_error' } } }),
  ];
  for (const message of accepted) {
    const result = classifyFailure({ code: 'PI_AI_ERROR', message });
    assert.equal(result.kind, 'transient', message);
    assert.equal(result.reason, 'server-overloaded', message);
  }
  for (const message of ['PI_AI_ERROR something went wrong', 'something went wrong',
    'server_error: Something went wrong', 'server_error', 'internal_error',
    'internal_error: Our servers are currently overloaded. Please try again later.',
    'Our servers are currently overloaded. Please try again later.',
    'server_error: Our servers are not overloaded.', 'server_error: temporarily unavailable.',
    'server_error: overload protection is disabled.']) {
    for (const status of [undefined, 503]) assert.equal(classifyFailure({ code: 'PI_AI_ERROR', message, status }).kind, 'unknown', message);
  }
  for (const [message, reason] of [
    ['server_error: invalid api key', 'authentication'],
    ['server_error: insufficient_quota', 'quota'],
    [exact + ' Invalid API key.', 'authentication'],
    [JSON.stringify({ error: { type: 'overloaded_error', inner: { code: 'insufficient_quota' } } }), 'quota'],
  ]) {
    const result = classifyFailure({ code: 'PI_AI_ERROR', message, status: 503 });
    assert.equal(result.kind, 'permanent', message); assert.equal(result.reason, reason, message);
  }
  assert.equal(classifyFailure({ code: 'PI_AI_ERROR', message: exact, status: 401 }).kind, 'permanent');
  assert.equal(classifyFailure({ code: 'PI_AI_ERROR', message: exact, status: 418 }).kind, 'unknown');
  assert.equal(classifyFailure({ code: 'SERVER', message: 'Generic server error' }).kind, 'transient');
});

test('explicit content restrictions outrank PI overload and HTTP 503 without treating generic policy text as permanent', async t => {
  const overload = 'server_error: Our servers are currently overloaded. Please try again later.';
  const codes = ['CONTENT_FILTER', 'CONTENT_POLICY_VIOLATION', 'CONTENT_POLICY_ERROR', 'POLICY_VIOLATION', 'SAFETY_REFUSAL', 'SAFETY_VIOLATION', 'PROHIBITED_CONTENT'];
  for (const code of codes) {
    const result = classifyFailure({ code, message: overload, status: 503 });
    assert.deepEqual(result, { kind: 'permanent', reason: 'content-restriction' }, code);
  }
  const explicitText = ['Content policy violation', 'Blocked by content filter', 'Safety policy violation',
    'Request blocked by content policy', 'Request rejected due to content policy',
    'Request refused under the content policy', 'Request blocked due to our content policy',
    'content_policy_error', 'safety_refusal', 'Request contains prohibited content',
    '内容审核拦截了本次请求', '请求未通过内容审核，内容审核拒绝', '内容安全策略拒绝此次请求', '请求包含违规内容'];
  for (const message of explicitText) {
    for (const code of ['SERVER', 'PI_AI_ERROR']) {
      const result = classifyFailure({ code, status: 503, message: overload + ' ' + message });
      assert.equal(result.kind, 'permanent', message); assert.equal(result.reason, 'content-restriction', message);
    }
  }
  const policyBlocked = 'server_error: Our servers are currently overloaded. Request blocked by content policy.';
  assert.deepEqual(classifyFailure({ code: 'PI_AI_ERROR', message: policyBlocked }), { kind: 'permanent', reason: 'content-restriction' });
  const mixed = overload + ' ' + JSON.stringify({ error: { code: 'content_filter', detail: { type: 'overloaded_error' } } });
  assert.deepEqual(classifyFailure({ code: 'PI_AI_ERROR', message: mixed, status: 503 }), { kind: 'permanent', reason: 'content-restriction' });
  for (const message of ['The policy changed', 'Retry policy budget is exhausted', 'Request blocked by retry policy', 'Request rejected due to retry policy', 'Content filter settings were loaded', 'Content policy documentation is unavailable', '内容审核服务暂时不可用']) {
    const result = classifyFailure({ code: 'PI_AI_ERROR', message });
    assert.equal(result.kind, 'unknown', message); assert.notEqual(result.reason, 'content-restriction', message);
  }
  const host = await createHost(t);
  for (const [index, failure] of [
    { code: 'PI_AI_ERROR', message: mixed, status: 503 },
    { code: 'PI_AI_ERROR', message: policyBlocked },
    { code: 'SERVER', message: 'Content policy violation', status: 503 },
  ].entries()) {
    assert.equal(await host.dispatch(payloadFor(host.session(`content-restriction-${index}`), { failure, retryPolicy: policy({ maxRetries: 0 }) })), undefined);
    assert.equal(host.blocked.at(-1).kind, 'permanent'); assert.equal(host.blocked.at(-1).reason, 'content-restriction');
  }
  assert.equal(host.scheduled.length, 0); assert.equal(host.waited.length, 0);
});

test('backoff follows 30/60/120/240/300 seconds and keeps jitter under five minutes', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 50].map(attempt => computeBackoffMs(attempt, { random: () => 0.5 })), [30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  assert.equal(computeBackoffMs(1, { random: () => 0 }), 27_000);
  assert.equal(computeBackoffMs(1, { random: () => 1 }), 33_000);
  for (const attempt of [1, 2, 3, 4, 5, 99]) {
    for (const value of [-10, 0, 0.5, 1, 10, NaN]) assert.ok(computeBackoffMs(attempt, { random: () => value }) <= 300_000);
  }
  assert.equal(computeBackoffMs(1, { random: () => 0.5, retryAfterMs: 600_000 }), 600_000);
  assert.equal(computeBackoffMs(4, { random: () => 0.5, retryAfterMs: 1000 }), 240_000);
  assert.equal(computeBackoffMs(1, { random: () => 0.5, retryAfterMs: Infinity }), 30_000);
  for (const attempt of [0, -1, 1.1, Infinity, NaN]) assert.throws(() => computeBackoffMs(attempt), RangeError);
});

test('abortable wait removes its abort listener after both completion and cancellation', async () => {
  const controller = new AbortController();
  assert.equal(await abortableWait(1, controller.signal), true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const pending = abortableWait(30_000, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(await abortableWait(1000, controller.signal), false);
});

test('abortable wait splits provider waits beyond the maximum Node timer duration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const pending = abortableWait(2_147_483_647 + 100).then(result => { settled = true; return result; });
  t.mock.timers.tick(2_147_483_647);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(100);
  assert.equal(await pending, true);
});

test('real native retry runs first; guardian only takes over after the normal budget is exhausted', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session());
  assert.equal(nativeExhausted(host.ctx, payload), false);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
    assert.equal(host.scheduled.length, 0);
  }
  assert.equal(nativeExhausted(host.ctx, payload), true);
  assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
  assert.equal(host.scheduled.length, 1);
  assert.equal(host.scheduled[0].attempt, 1);
  assert.equal(host.scheduled[0].delayMs, 30_000);
  assert.equal(host.scheduled[0].retryAt, 31_000);
  assert.equal(host.waited.length, 1);
});

test('native exhaustion matches exact provider and sorted resolved policy keys', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session());
  await host.dispatch(payload);
  await host.dispatch(payload);
  assert.equal(nativeExhausted(host.ctx, payload), true);
  const reversed = { ...payload, retryPolicy: { ...payload.retryPolicy, retryableCodes: [...payload.retryPolicy.retryableCodes].reverse() } };
  assert.equal(nativeExhausted(host.ctx, reversed), true);
  assert.equal(nativeExhausted(host.ctx, { ...payload, provider: 'another-provider' }), false);
  assert.equal(nativeExhausted(host.ctx, { ...payload, retryPolicy: policy({ initialDelayMs: 0.5 }) }), false);
  assert.equal(nativeExhausted(host.ctx, { ...payload, retryPolicy: policy({ maxRetries: 1 }) }), false);
  assert.equal(nativeExhausted(host.ctx, payloadFor(host.session('session-b'))), false);
  assert.match(NATIVE_RETRY_COMPATIBILITY, /0\.2\.1-rc\.3;llmRetry@1/u);
  assert.equal(runtimeRequire('@deepseek-ai/dsh-llm-retry/package.json').version, '0.2.1-rc.3');
});

test('PI overload delegated by native code filtering starts a fresh 30-second guardian chain at native count zero', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session('pi-overload'), { failure: { code: 'PI_AI_ERROR', message: 'server_error: Our servers are currently overloaded. Please try again later.' } });
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
    assert.equal(nativeExhausted(host.ctx, payload), false);
    assert.equal(nativeRetryDisposition(host.ctx, payload).nativeRetryCount, 0);
  }
  assert.deepEqual(host.scheduled.map(entry => entry.delayMs), [30_000, 60_000, 120_000]);
  assert.deepEqual(host.scheduled.map(entry => entry.attempt), [1, 2, 3]);
  assert.ok(host.scheduled.every(entry => entry.handoff === 'native-code-not-retryable' && entry.nativeRetryCount === 0 && entry.maxRetries === 2 && entry.reason === 'server-overloaded'));
  assert.equal(host.blocked.length, 0);
});

test('PI overload still exhausts native retries first when the provider explicitly includes its code', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session('native-pi'), {
    retryPolicy: policy({ retryableCodes: ['PI_AI_ERROR'] }),
    failure: { code: 'PI_AI_ERROR', message: 'server_error: Our servers are currently overloaded. Please try again later.' },
  });
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
    assert.equal(host.scheduled.length, 0); assert.equal(host.blocked.length, 0);
  }
  assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
  assert.equal(host.scheduled[0].handoff, 'native-budget-exhausted');
  assert.equal(host.scheduled[0].nativeRetryCount, 2); assert.equal(host.scheduled[0].maxRetries, 2);
});

test('native code delegation never permits AUTH, QUOTA or unclassified PI/UNKNOWN errors', async t => {
  const host = await createHost(t);
  const cases = [
    [{ code: 'AUTH', message: 'invalid api key' }, 'permanent'],
    [{ code: 'QUOTA', message: 'insufficient_quota' }, 'permanent'],
    [{ code: 'UNKNOWN', message: 'something went wrong' }, 'unknown'],
    [{ code: 'PI_AI_ERROR', message: 'server_error: Something went wrong' }, 'unknown'],
    [{ code: 'PI_AI_ERROR', message: 'server_error: invalid api key' }, 'permanent'],
    [{ code: 'PI_AI_ERROR', message: 'server_error: insufficient_quota' }, 'permanent'],
  ];
  for (const [index, [failure, kind]] of cases.entries()) {
    const payload = payloadFor(host.session(`excluded-permanent-${index}`), { failure });
    assert.equal(await host.dispatch(payload), undefined);
    assert.equal(host.blocked.at(-1).kind, kind);
    assert.equal(host.blocked.at(-1).handoff, 'native-code-not-retryable');
    assert.equal(host.blocked.at(-1).nativeRetryCount, 0);
  }
  assert.equal(host.scheduled.length, 0); assert.equal(host.waited.length, 0);
});

test('normal native explicit early delegation permits guardian recovery without claiming exhaustion', async t => {
  const host = await createHost(t);
  const session = host.session();
  const tooLong = payloadFor(session, { failure: failure({ providerRetryAfterMs: 600_000 }) });
  assert.deepEqual(await host.dispatch(tooLong), { kind: 'retry' });
  assert.equal(nativeExhausted(host.ctx, tooLong), false);
  assert.deepEqual(nativeRetryDisposition(host.ctx, tooLong), { eligible: true, reason: 'native-retry-after-delegated', nativeRetryCount: 0, maxRetries: 2 });
  assert.equal(host.scheduled[0].handoff, 'native-retry-after-delegated');
  assert.equal(host.scheduled[0].nativeRetryCount, 0);
  assert.equal(host.scheduled[0].maxRetries, 2);
  assert.equal(host.scheduled[0].delayMs, 600_000);
  const excludedCode = payloadFor(host.session('excluded'), { failure: failure({ code: 'HTTP_503' }) });
  assert.deepEqual(await host.dispatch(excludedCode), { kind: 'retry' });
  assert.equal(nativeExhausted(host.ctx, excludedCode), false);
  assert.deepEqual(nativeRetryDisposition(host.ctx, excludedCode), { eligible: true, reason: 'native-code-not-retryable', nativeRetryCount: 0, maxRetries: 2 });
  assert.equal(host.scheduled[1].handoff, 'native-code-not-retryable');
  assert.equal(host.scheduled[1].delayMs, 30_000);
  assert.equal(host.waited.length, 2);
});

test('disabled guardian and an absent native policy preserve downstream behavior', async t => {
  const host = await createHost(t, { isEnabled: () => false });
  const exhausted = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  assert.equal(await host.dispatch(exhausted), undefined);
  assert.equal(host.scheduled.length, 0);
  const enabledHost = await createHost(t);
  assert.equal(await enabledHost.dispatch(payloadFor(enabledHost.session('no-policy'), { retryPolicy: undefined })), undefined);
  assert.equal(enabledHost.scheduled.length, 0);
});

test('zero native retries is an exhausted normal budget and long Retry-After is respected', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }), failure: failure({ providerRetryAfterMs: 600_000 }) });
  assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
  assert.equal(host.scheduled[0].delayMs, 600_000);
  assert.equal(host.waited[0].milliseconds, 600_000);
});

test('always policy remains entirely native even for permanent failures', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session(), { retryPolicy: { mode: 'always', initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }, failure: failure({ code: 'AUTH', status: 401 }) });
  assert.deepEqual(await host.dispatch(payload), { kind: 'retry' });
  assert.equal(nativeExhausted(host.ctx, payload), false);
  assert.equal(host.scheduled.length, 0);
  assert.equal(host.blocked.length, 0);
});

test('permanent and unknown failures are reported and never retried by guardian', async t => {
  const host = await createHost(t);
  for (const [id, code, kind] of [['permanent', 'AUTH', 'permanent'], ['unknown', 'NEW_FAILURE_CODE', 'unknown']]) {
    const payload = payloadFor(host.session(id), { retryPolicy: policy({ maxRetries: 0 }), failure: { code, message: code } });
    assert.equal(await host.dispatch(payload), undefined);
    assert.equal(host.blocked.at(-1).sessionId, id);
    assert.equal(host.blocked.at(-1).kind, kind);
  }
  assert.equal(host.scheduled.length, 0);
  assert.equal(host.waited.length, 0);
});

test('real recovery blocks ambiguous/permanent provider details and only retries explicit temporary evidence', async t => {
  const host = await createHost(t);
  const cases = [
    [{ code: 'SERVER', status: 503, message: JSON.stringify({ error: { code: 'insufficient_quota' } }) }, 'permanent'],
    [{ code: 'SERVER', status: 503, message: JSON.stringify({ error: { inner: { type: 'invalid_model' } } }) }, 'permanent'],
    [{ code: 'RATE_LIMIT', status: 429, message: '' }, 'unknown'],
    [{ code: 'TRANSPORT', message: 'Provider transport failed' }, 'unknown'],
    [{ code: 'TRANSPORT', message: 'connect ECONNREFUSED 127.0.0.1:3000' }, 'permanent'],
    [{ code: 'RATE_LIMIT', status: 429, message: 'Temporary concurrency limit: too many concurrent requests' }, 'transient'],
    [{ code: 'TRANSPORT', message: 'DeepSeek Messages stream idle timeout' }, 'transient'],
  ];
  for (const [index, [failure, kind]] of cases.entries()) {
    const beforeScheduled = host.scheduled.length, beforeBlocked = host.blocked.length;
    const payload = payloadFor(host.session(`evidence-${index}`), { failure, retryPolicy: policy({ maxRetries: 0 }) });
    const result = await host.dispatch(payload);
    if (kind === 'transient') {
      assert.deepEqual(result, { kind: 'retry' });
      assert.equal(host.scheduled.length, beforeScheduled + 1);
      assert.equal(host.blocked.length, beforeBlocked);
    } else {
      assert.equal(result, undefined);
      assert.equal(host.scheduled.length, beforeScheduled);
      assert.equal(host.blocked.at(-1).kind, kind);
    }
  }
});

test('middleware preserves downstream retry identity, other decisions and thrown errors', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  const retry = { kind: 'retry', source: 'downstream' };
  assert.equal(await host.dispatch(payload, async () => retry), retry);
  const other = { kind: 'stop' };
  assert.equal(await host.dispatch(payload, async () => other), other);
  const error = new Error('Downstream failure');
  await assert.rejects(host.dispatch(payload, async () => { throw error; }), actual => actual === error);
  assert.equal(host.scheduled.length, 0);
});

test('same-session successful reset restarts the guardian attempt chain at one', async t => {
  const host = await createHost(t);
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  await host.dispatch(payload);
  await host.dispatch(payload);
  await host.middleware.reset(payload.agent.session.id);
  await host.dispatch(payload);
  assert.deepEqual(host.scheduled.map(entry => entry.attempt), [1, 2, 1]);
  assert.deepEqual(host.scheduled.map(entry => entry.delayMs), [30_000, 60_000, 30_000]);
  assert.deepEqual(host.resets, [{ sessionId: 'session-a' }]);
});

test('attempts and native budgets are independent across sessions', async t => {
  const host = await createHost(t);
  const a = payloadFor(host.session('a'), { retryPolicy: policy({ maxRetries: 0 }) });
  const b = payloadFor(host.session('b'), { retryPolicy: policy({ maxRetries: 0 }) });
  await Promise.all([host.dispatch(a), host.dispatch(b)]);
  await host.dispatch(a);
  await host.middleware.reset('b');
  await host.dispatch(b);
  assert.deepEqual(host.scheduled.map(entry => [entry.sessionId, entry.attempt]), [['a', 1], ['b', 1], ['a', 2], ['b', 1]]);
});

test('schedule persistence completes before the cancellable wait starts', async t => {
  const entered = deferred(), persisted = deferred();
  const calls = [];
  const host = await createHost(t, {
    onSchedule: async () => { calls.push('schedule'); entered.resolve(); await persisted.promise; calls.push('persisted'); },
    wait: async () => { calls.push('wait'); return true; },
  });
  const result = host.dispatch(payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) }), async () => { calls.push('next'); });
  await entered.promise;
  assert.deepEqual(calls, ['next', 'schedule']);
  persisted.resolve();
  assert.deepEqual(await result, { kind: 'retry' });
  assert.deepEqual(calls, ['next', 'schedule', 'persisted', 'wait']);
});

test('failed schedule persistence propagates without waiting or returning retry', async t => {
  const persistenceError = new Error('Durable schedule append failed');
  let waits = 0;
  const host = await createHost(t, {
    onSchedule: async () => { throw persistenceError; },
    wait: async () => { waits++; return true; },
  });
  const result = host.dispatch(payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) }));
  await assert.rejects(result, error => error === persistenceError);
  assert.equal(waits, 0);
});

test('session cancel aborts a pending wait without affecting another session', async t => {
  const enteredA = deferred(), enteredB = deferred(), releaseB = deferred();
  const host = await createHost(t, {
    wait: (milliseconds, signal) => {
      const index = enteredA.done ? 'b' : 'a';
      if (index === 'a') { enteredA.done = true; enteredA.resolve(signal); return abortableWait(milliseconds, signal); }
      enteredB.resolve(signal);
      return releaseB.promise;
    },
  });
  const a = host.dispatch(payloadFor(host.session('a'), { retryPolicy: policy({ maxRetries: 0 }) }));
  const aSignal = await enteredA.promise;
  const b = host.dispatch(payloadFor(host.session('b'), { retryPolicy: policy({ maxRetries: 0 }) }));
  const bSignal = await enteredB.promise;
  assert.equal(host.middleware.cancel('a'), true);
  assert.equal(await a, undefined);
  assert.equal(aSignal.aborted, true);
  assert.equal(bSignal.aborted, false);
  releaseB.resolve(true);
  assert.deepEqual(await b, { kind: 'retry' });
  assert.equal(host.middleware.cancel('missing'), false);
});

test('new same-session recovery supersedes a pending guardian wait', async t => {
  const entered = deferred(), release = deferred();
  let waits = 0;
  const host = await createHost(t, {
    wait: (milliseconds, signal) => {
      if (++waits === 1) { entered.resolve(); return abortableWait(milliseconds, signal); }
      return release.promise;
    },
  });
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  const first = host.dispatch(payload);
  await entered.promise;
  const second = host.dispatch(payload);
  assert.equal(await first, undefined);
  release.resolve(true);
  assert.deepEqual(await second, { kind: 'retry' });
  assert.deepEqual(host.scheduled.map(entry => entry.attempt), [1, 2]);
});

test('payload abort, lifetime abort and disposal all prevent a scheduled retry', async t => {
  for (const cause of ['payload', 'lifetime', 'dispose']) {
    const entered = deferred();
    const source = new AbortController(), lifetime = new AbortController();
    const host = await createHost(t, {
      lifetimeSignal: lifetime.signal,
      wait: (milliseconds, signal) => { entered.resolve(signal); return abortableWait(milliseconds, signal); },
    });
    const result = host.dispatch(payloadFor(host.session(cause), { retryPolicy: policy({ maxRetries: 0 }), signal: source.signal }));
    const waitSignal = await entered.promise;
    if (cause === 'payload') source.abort();
    else if (cause === 'lifetime') lifetime.abort();
    else await host.middleware.dispose();
    assert.equal(await result, undefined, cause);
    assert.equal(waitSignal.aborted, true);
  }
});

test('disable/cancel during schedule persistence invalidates work even if immediately re-enabled', async t => {
  const entered = deferred(), persistence = deferred();
  let enabled = true, waits = 0, scheduleSignal;
  const host = await createHost(t, {
    isEnabled: () => enabled,
    onSchedule: ({ signal }) => { scheduleSignal = signal; entered.resolve(); return persistence.promise; },
    wait: async () => { waits++; return true; },
  });
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  const result = host.dispatch(payload);
  await entered.promise;
  enabled = false;
  host.middleware.cancel(payload.agent.session.id);
  enabled = true;
  assert.equal(scheduleSignal.aborted, true);
  assert.equal(await result, undefined);
  persistence.resolve();
  await Promise.resolve();
  assert.equal(waits, 0);
});

test('cancel during downstream recovery prevents later guardian takeover', async t => {
  const downstream = deferred(), entered = deferred();
  const host = await createHost(t);
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  const result = host.dispatch(payload, () => { entered.resolve(); return downstream.promise; });
  await entered.promise;
  host.middleware.cancel(payload.agent.session.id);
  downstream.resolve(undefined);
  assert.equal(await result, undefined);
  assert.equal(host.scheduled.length, 0);
});

test('enabled state is rechecked after waiting and reset cancels stale work', async t => {
  const entered = deferred(), release = deferred();
  let enabled = true;
  const host = await createHost(t, {
    isEnabled: () => enabled,
    wait: () => { entered.resolve(); return release.promise; },
  });
  const payload = payloadFor(host.session(), { retryPolicy: policy({ maxRetries: 0 }) });
  const result = host.dispatch(payload);
  await entered.promise;
  enabled = false;
  release.resolve(true);
  assert.equal(await result, undefined);
  enabled = true;
  const stale = host.dispatch(payload);
  await Promise.resolve();
  await host.middleware.reset(payload.agent.session.id);
  assert.equal(await stale, undefined);
});

test('native disposition keeps exhaustion strict and rejects missing or malformed current-version evidence', () => {
  const payload = payloadFor({ id: 'native-state' });
  const policyKey = JSON.stringify(['normal', 2, [...payload.retryPolicy.retryableCodes].sort(), 1, 1, 0]);
  const key = JSON.stringify([payload.provider, policyKey]);
  const context = state => ({ sessionProjections: { stateOf: () => state } });
  assert.deepEqual(nativeRetryDisposition(context({}), payload), { eligible: false, reason: 'native-budget-remaining', nativeRetryCount: 0, maxRetries: 2 });
  assert.deepEqual(nativeRetryDisposition(context({ [key]: { retry: 1, retryId: 'first' } }), payload), { eligible: false, reason: 'native-budget-remaining', nativeRetryCount: 1, maxRetries: 2 });
  const exhausted = context({ [key]: { retry: 2, retryId: 'first' } });
  assert.equal(nativeExhausted(exhausted, payload), true);
  assert.deepEqual(nativeRetryDisposition(exhausted, payload), { eligible: true, reason: 'native-budget-exhausted', nativeRetryCount: 2, maxRetries: 2 });
  for (const state of [undefined, null, [], new Map(), { version: 2 },
    { [key]: { retry: 2 } }, { [key]: { retry: 2, retryId: 7 } },
    { [key]: { retry: -1, retryId: 'bad' } }, { [key]: { retry: 2.1, retryId: 'bad' } },
    { [key]: { retry: 2, retryId: 'future', version: 2 } }]) {
    assert.equal(nativeExhausted(context(state), payload), false);
    assert.deepEqual(nativeRetryDisposition(context(state), payload), { eligible: false, reason: 'native-state-unavailable', nativeRetryCount: null, maxRetries: 2 });
  }
  const unhandledCode = { ...payload, failure: { code: 'PI_AI_ERROR', message: 'server_error: Our servers are currently overloaded. Please try again later.' } };
  assert.deepEqual(nativeRetryDisposition(context({}), unhandledCode), { eligible: true, reason: 'native-code-not-retryable', nativeRetryCount: 0, maxRetries: 2 });
  assert.equal(nativeExhausted(context({}), unhandledCode), false);
  assert.equal(nativeRetryDisposition({}, unhandledCode).reason, 'native-state-unavailable');
  assert.equal(nativeRetryDisposition(context({}), { ...payload, retryPolicy: undefined }).reason, 'native-policy-missing');
  assert.equal(nativeRetryDisposition(context({}), { ...payload, retryPolicy: { mode: 'always', initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }).reason, 'native-policy-unsupported');
  for (const retryPolicy of [policy({ initialDelayMs: 0 }), policy({ maxDelayMs: 0 }), policy({ jitterRatio: 2 }), policy({ retryableCodes: [] }), policy({ retryableCodes: ['SERVER', 'SERVER'] })]) {
    assert.equal(nativeRetryDisposition(context({}), { ...payload, retryPolicy }).reason, 'native-policy-invalid');
  }
});

test('unhandled native boundaries are observed without stealing a remaining native budget', async t => {
  const ctx = new Context(), scheduled = [], blocked = [];
  let state = {}, enabled = true, nextCalls = 0;
  ctx.provide('sessionProjections', { stateOf: () => state });
  const middleware = registerRetryMiddleware(ctx, {
    isEnabled: () => enabled, onSchedule: entry => scheduled.push(entry), onBlocked: async entry => blocked.push(entry),
    wait: async () => { throw Error('Cannot wait before a native handoff'); },
  });
  t.after(async () => { await middleware.dispose(); await ctx.fiber.dispose(); });
  const payload = payloadFor({ id: 'observation' });
  const dispatch = nextPayload => ctx.waterfall('agent/request-error', nextPayload, async () => { nextCalls++; return undefined; });
  assert.equal(await dispatch(payload), undefined);
  assert.equal(blocked.at(-1).kind, 'not-handled'); assert.equal(blocked.at(-1).reason, 'native-budget-remaining');
  assert.equal(blocked.at(-1).nativeRetryCount, 0); assert.equal(blocked.at(-1).maxRetries, 2);
  assert.equal(await dispatch({ ...payload, retryPolicy: undefined }), undefined);
  assert.equal(blocked.at(-1).reason, 'native-policy-missing');
  state = undefined;
  assert.equal(await dispatch(payload), undefined); assert.equal(blocked.at(-1).reason, 'native-state-unavailable');
  state = { incompatible: { retry: 1 } };
  assert.equal(await dispatch(payload), undefined); assert.equal(blocked.at(-1).reason, 'native-state-unavailable');
  assert.equal(await dispatch({ ...payload, retryPolicy: { mode: 'always' } }), undefined);
  assert.equal(blocked.at(-1).reason, 'native-policy-unsupported');
  const observations = blocked.length;
  enabled = false; assert.equal(await dispatch(payload), undefined); assert.equal(blocked.length, observations);
  enabled = true; const controller = new AbortController(); controller.abort();
  assert.equal(await dispatch({ ...payload, signal: controller.signal }), undefined); assert.equal(blocked.length, observations);
  const decision = { kind: 'retry', owner: 'downstream' };
  assert.equal(await ctx.waterfall('agent/request-error', payload, async () => decision), decision);
  assert.equal(blocked.length, observations); assert.equal(scheduled.length, 0); assert.equal(nextCalls, 7);
});

test('failed or cancelled skip observation never schedules a retry', async t => {
  const entered = deferred(), persisted = deferred();
  let observerSignal, schedules = 0;
  const host = await createHost(t, {
    onBlocked: async ({ signal }) => { observerSignal = signal; entered.resolve(); await persisted.promise; },
    onSchedule: async () => { schedules++; },
  });
  const payload = payloadFor(host.session('missing-policy'), { retryPolicy: undefined });
  const operation = host.dispatch(payload);
  await entered.promise; host.middleware.cancel('missing-policy');
  assert.equal(await operation, undefined); assert.equal(observerSignal.aborted, true);
  persisted.resolve(); await Promise.resolve(); assert.equal(schedules, 0);
  const error = new Error('Could not persist skip reason');
  const failing = await createHost(t, { onBlocked: async () => { throw error; } });
  await assert.rejects(failing.dispatch(payloadFor(failing.session(), { retryPolicy: undefined })), actual => actual === error);
  assert.equal(failing.scheduled.length, 0); assert.equal(failing.waited.length, 0);
});

test('unsupported or missing native projection state is not treated as exhaustion', () => {
  const payload = payloadFor({ id: 'session-a' }, { retryPolicy: policy({ maxRetries: 0 }) });
  assert.equal(nativeExhausted({}, payload), false);
  assert.equal(nativeExhausted({ sessionProjections: { stateOf: () => undefined } }, payload), false);
  assert.equal(nativeExhausted({ sessionProjections: { stateOf: () => new Map() } }, payload), false);
  assert.equal(nativeExhausted({ sessionProjections: { stateOf: () => [] } }, payload), false);
  assert.equal(nativeExhausted({ sessionProjections: { stateOf: () => { throw new Error('No projection'); } } }, payload), false);
  assert.equal(nativeExhausted({ sessionProjections: { stateOf: () => ({}) } }, payload), true);
  assert.equal(nativeExhausted({ sessionProjections: { stateOf: () => ({}) } }, { ...payload, retryPolicy: { mode: 'normal', maxRetries: 0 } }), false);
});
