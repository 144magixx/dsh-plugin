import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEventListeners } from 'node:events';
import {
  NATIVE_RETRY_COMPATIBILITY, parseRetryAfter, classifyFailure, computeBackoffMs,
  abortableWait, nativeExhausted, registerRetryMiddleware,
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

test('normal native early exits do not authorize guardian retry before budget exhaustion', async t => {
  const host = await createHost(t);
  const session = host.session();
  const tooLong = payloadFor(session, { failure: failure({ providerRetryAfterMs: 600_000 }) });
  assert.equal(await host.dispatch(tooLong), undefined);
  assert.equal(nativeExhausted(host.ctx, tooLong), false);
  const excludedCode = payloadFor(session, { failure: failure({ code: 'HTTP_503' }) });
  assert.equal(await host.dispatch(excludedCode), undefined);
  assert.equal(host.scheduled.length, 0);
  assert.equal(host.waited.length, 0);
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
