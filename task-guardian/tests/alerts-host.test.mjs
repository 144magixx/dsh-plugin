import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeDir } from '../../session-summary/scripts/extract-test-runtime.mjs';
import * as plugin from '../lib/index.js';
import { ALERT_PROJECTION, RETRY_NOTICE_DELAY_MS } from '../lib/alerts.js';
import { sessionKey } from '../lib/store.js';

// The normal integration pretest extracts these actual installed packages.
// Only transport registration/Agent lookup are test boundaries; SessionStore
// publications, projections, SessionQuery and disk-backed storage are native.
const require = createRequire(path.join(runtimeDir, 'package.json'));
const native = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
const [{ Context }, { Storage }, json, domain, { SessionStore }, { SessionQueryEngine }, { SessionProjectionRegistry }, retry] = await Promise.all(
  ['cordis', 'dsh-storage', 'dsh-storage-json', 'dsh-storage-domain', 'dsh-session', 'dsh-session-query', 'dsh-session-projection', 'dsh-llm-retry'].map(native),
);
const A = 'alerts-session-a', B = 'alerts-session-b';
const failReason = code => ({ kind: 'error', error: { code, message: 'Synthetic upstream failure; no provider request was made.' } });

async function eventually(read, accepts, explanation, timeoutMs = 2500) {
  const deadline = performance.now() + timeoutMs;
  let result;
  do {
    result = await read();
    if (accepts(result)) return result;
    await delay(5);
  } while (performance.now() < deadline);
  assert.fail(`${explanation}: ${JSON.stringify(result)}`);
}

async function host(t, { root: existingRoot, seeds = new Map(), sessionIds = [A, B], mountNativeRetry = true } = {}) {
  const root = existingRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-alerts-host-'));
  const ctx = new Context(), routes = new Map(), tools = new Map(), agents = new Map(), diagnostics = [];
  ctx.logger.exporter({ export: entry => { if (entry.type === 'error') diagnostics.push(entry.args.map(String)); } });
  const oldHome = process.env.DSH_HOME;
  let fiber, closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try { await ctx.fiber.dispose(); }
    finally { if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; }
  }
  t.after(close);
  async function mount(module, config) {
    const mounted = ctx.plugin(module, config);
    await mounted.await();
    assert.equal(mounted.state, 2, `${String(mounted.error ?? mounted._error)} ${JSON.stringify(diagnostics)}`);
    return mounted;
  }
  try {
    new Storage(ctx);
    await mount(json, { root: path.join(root, 'storage') });
    await mount(domain, { backend: 'json' });
    new SessionStore(ctx);
    new SessionProjectionRegistry(ctx);
    new SessionQueryEngine(ctx);
    ctx.provide('agents', { get: id => agents.get(id), list: () => [...agents.values()] });
    ctx.provide('connection', { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } });
    ctx.provide('tools', { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } });
    const sessions = new Map();
    for (const id of sessionIds) {
      const session = ctx.sessions.create(id, { seed: seeds.get(id), meta: { cwd: root } });
      sessions.set(id, session);
      agents.set(id, { id, session, status: 'idle' });
    }
    if (mountNativeRetry) await mount(retry);
    const observedListeners = [];
    process.env.DSH_HOME = root; // Isolated per-test OS lease; never the user's profile.
    fiber = await mount({ ...plugin, apply: context => plugin.apply(new Proxy(context, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === 'on') return (name, ...args) => { observedListeners.push(name); return value.call(target, name, ...args); };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })) });
    const call = async (action, body = {}) => {
      const route = routes.get(`/api/task-guardian/${action}`);
      assert.ok(route, `missing route ${action}`);
      const response = await route.fetch(new Request(`http://offline.invalid/api/task-guardian/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    };
    const initial = await call('alerts');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.fault, null, JSON.stringify(initial.body));
    assert.equal(initial.body.mode, 'alerts-only');
    assert.equal(Object.hasOwn(initial.body, 'compatibility'), false);
    return { ctx, root, fiber, routes, tools, agents, sessions, diagnostics, observedListeners, call, close,
      alerts: async () => (await call('alerts')).body,
      record: id => structuredClone(ctx.storageDomain.get('task_guardian')?.table('sessions').get(sessionKey(id))),
      seeds: () => new Map([...sessions].map(([id, session]) => [id, session.snapshotEvents()])),
    };
  } catch (error) { await close(); throw error; }
}

function start(h, id, turn = 1) {
  const session = h.sessions.get(id);
  session.append('turn/start', { turn });
  session.append('step/start', { turn, step: 1 });
  return session;
}
function end(h, id, reason, turn = 1) {
  const session = h.sessions.get(id);
  session.append('step/end', { turn, step: 1 });
  return session.append('turn/end', { turn, reason });
}
function fail(h, id = A, turn = 1, code = 'PI_AI_ERROR') {
  start(h, id, turn);
  return end(h, id, failReason(code), turn);
}
function nativeRetry(h, id = A, turn = 1) {
  return h.sessions.get(id).append('llm/retry', {
    retryId: `${id}-retry-${turn}`, turn, step: 1, provider: 'test-provider', mode: 'normal',
    policyKey: JSON.stringify(['normal', 5, ['SERVER'], 1000, 30000, 0]),
    retry: 1, maxRetries: 5, delayMs: 30000, failure: { code: 'SERVER', message: 'Synthetic transient service failure.' },
  });
}
const hasOneA = value => value.total === 1 && value.alerts[0]?.sessionId === A;
const noticeStored = value => value?.notification != null;

test('global alerts observe A failure while only B is viewed, and HTTP/tool actions share one durable acknowledgement', { timeout: 15000 }, async t => {
  const h = await host(t);
  await h.record(B); // No snapshot/read of A may be needed to discover its failure.
  const ending = fail(h);
  const http = await eventually(h.alerts, hasOneA, 'A failure must be globally visible without selecting A');
  assert.equal(http.alerts[0].state, 'failed');
  assert.equal(http.alerts[0].code, 'PI_AI_ERROR');
  assert.ok(http.alerts[0].id.endsWith(`:end:${ending.seq}`));
  const tool = h.tools.get('task_guardian_alerts');
  assert.ok(tool);
  assert.equal(tool.isConcurrencySafe({ action: 'list' }), true);
  assert.equal(tool.isConcurrencySafe({ action: 'acknowledge' }), false);
  const execution = { agent: h.agents.get(B), signal: new AbortController().signal };
  const byTool = await tool.execute({ action: 'list' }, execution);
  assert.deepEqual(byTool.alerts, http.alerts);
  const first = http.alerts[0];
  assert.deepEqual(await tool.execute({ action: 'acknowledge', sessionId: A, alertId: first.id }, execution), { ok: true });
  assert.equal((await h.alerts()).total, 0);
  await h.record(B);
  assert.equal((await tool.execute({ action: 'list' }, execution)).total, 0, 'refreshing does not resurrect the acknowledged notice');
  fail(h, A, 2, 'AUTH');
  const second = (await eventually(h.alerts, hasOneA, 'later failure must be a new unread incident')).alerts[0];
  assert.notEqual(second.id, first.id);
  const stale = await h.call('acknowledge', { sessionId: A, alertId: first.id });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'alert_changed_reload');
  assert.equal((await h.alerts()).alerts[0].id, second.id);
  const acknowledged = await h.call('acknowledge', { sessionId: A, alertId: second.id });
  assert.equal(acknowledged.status, 200);
  assert.equal((await tool.execute({ action: 'list' }, execution)).total, 0, 'HTTP acknowledgement is reflected by the same tool business operation');
});

test('bulk acknowledgement reads the full snapshot behind a one-item page and is idempotent across HTTP/tool calls', { timeout: 15000 }, async t => {
  const h = await host(t);
  fail(h, A); fail(h, B);
  await eventually(h.alerts, value => value.total === 2, 'both sessions must be globally unread');
  const page = (await h.call('alerts', { limit: 1 })).body;
  assert.equal(page.alerts.length, 1);
  assert.equal(page.total, 2);
  assert.equal(page.hasMore, true);
  assert.equal(typeof page.readToken, 'string');
  const result = await h.call('acknowledgeAll', { readToken: page.readToken });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, acknowledged: 2 });
  const tool = h.tools.get('task_guardian_alerts');
  assert.equal(tool.isConcurrencySafe({ action: 'acknowledge_all' }), false);
  assert.deepEqual(await tool.execute({ action: 'acknowledge_all', readToken: page.readToken }), { ok: true, acknowledged: 0 });
  assert.equal((await tool.execute({ action: 'list' })).total, 0);
  for (const id of [A, B]) assert.equal((await h.record(id)).notification.acknowledged, true);
});

test('bulk acknowledgement skips A new failure while still acknowledging B from the displayed snapshot', { timeout: 15000 }, async t => {
  const h = await host(t);
  fail(h, A); fail(h, B);
  await eventually(h.alerts, value => value.total === 2, 'both old failures must be unread');
  const tool = h.tools.get('task_guardian_alerts');
  const batch = await tool.execute({ action: 'list', limit: 1 });
  fail(h, A, 2, 'AUTH');
  const newer = (await h.alerts()).alerts.find(item => item.sessionId === A);
  assert.equal(newer.code, 'AUTH');
  const result = await tool.execute({ action: 'acknowledge_all', readToken: batch.readToken });
  assert.deepEqual(result, { ok: true, acknowledged: 1 });
  const remaining = await h.alerts();
  assert.equal(remaining.total, 1);
  assert.equal(remaining.alerts[0].id, newer.id, 'the bulk click cannot mark a newly arrived failure as read');
  assert.equal((await h.record(B)).notification.acknowledged, true);
});

test('unknown and evicted bulk read tokens return 409 without acknowledging visible alerts', { timeout: 15000 }, async t => {
  const h = await host(t);
  fail(h);
  const original = await eventually(h.alerts, hasOneA, 'failure must be visible before token validation');
  const invalid = await h.call('acknowledgeAll', { readToken: 'not-a-issued-snapshot' });
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error, 'alerts_changed_reload');
  // The production cache bounds snapshots to its most recent 32 reads.
  for (let index = 0; index < 32; index++) await h.alerts();
  const expired = await h.call('acknowledgeAll', { readToken: original.readToken });
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error, 'alerts_changed_reload');
  const current = await h.alerts();
  assert.equal(current.total, 1);
  assert.equal(current.alerts[0].id, original.alerts[0].id);
});

test('bulk read tokens from a previous Host cannot acknowledge alerts after restart', { timeout: 15000 }, async t => {
  const first = await host(t);
  fail(first);
  const before = await eventually(first.alerts, hasOneA, 'failure must exist in the first Host');
  const root = first.root, seeds = first.seeds();
  await first.close();
  const second = await host(t, { root, seeds });
  const result = await second.call('acknowledgeAll', { readToken: before.readToken });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'alerts_changed_reload');
  assert.equal((await second.alerts()).alerts[0].id, before.alerts[0].id);
});

test('alerts-only plugin mounts without a native retry provider or package-version lookup service', { timeout: 15000 }, async t => {
  const h = await host(t, { mountNativeRetry: false });
  fail(h);
  const alerts = await eventually(h.alerts, hasOneA, 'notifications must have no native retry compatibility dependency');
  assert.equal(alerts.mode, 'alerts-only');
  assert.equal(Object.hasOwn(alerts, 'compatibility'), false);
  assert.equal(alerts.alerts[0].state, 'failed');
  assert.equal(h.ctx.sessionProjections.stateOf(h.sessions.get(A), 'taskGuardianLifecycle'), undefined);
  assert.equal(h.ctx.sessionProjections.stateOf(h.sessions.get(A), 'taskGuardianQuestions'), undefined);
  assert.ok(h.ctx.sessionProjections.stateOf(h.sessions.get(A), ALERT_PROJECTION));
});

test('native unhandled request errors remain unhandled and no automatic request, status, answer or recovery hook is registered', { timeout: 15000 }, async t => {
  const h = await host(t);
  assert.deepEqual(h.observedListeners.filter(name => /^(agent\/|user-questions\/|approval\/)/.test(name)), []);
  const agent = h.agents.get(A), session = agent.session;
  const before = session.seq;
  let downstream = 0;
  const controller = new AbortController();
  const policy = { mode: 'normal', maxRetries: 0, retryableCodes: ['SERVER'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 };
  const result = await Promise.race([
    h.ctx.waterfall('agent/request-error', { agent, turn: 1, step: 1, provider: 'test-provider', signal: controller.signal,
      failure: { code: 'SERVER', message: 'Temporary upstream 503', status: 503 }, retryPolicy: policy }, async () => { downstream++; return undefined; }),
    delay(250, undefined, { signal: controller.signal }).then(() => { throw Error('alerts-only plugin must not wait or retry a failed request'); }),
  ]).finally(() => controller.abort());
  assert.equal(result, undefined); assert.equal(downstream, 1); assert.equal(session.seq, before);
  const config = { provider: 'test', model: 'unchanged' };
  assert.equal(await h.ctx.waterfall('agent/request', { agent, signal: new AbortController().signal }, async () => config), config);
  const answer = { synthetic: 'human-only' };
  assert.equal(await h.ctx.waterfall('user-questions/request', { agent }, async () => answer), answer);
  assert.equal(await h.ctx.waterfall('approval/request', { agent }, async () => answer), answer);
  assert.equal(session.seq, before, 'observing an error must not append messages, answers, tools or a new task');
  assert.equal(h.agents.size, 2, 'the plugin must not activate any additional Agent');
});

test('acknowledgement survives native storage reload and session-log replay after Host restart', { timeout: 15000 }, async t => {
  const first = await host(t);
  fail(first);
  const alert = (await eventually(first.alerts, hasOneA, 'initial failure must appear')).alerts[0];
  assert.equal((await first.call('acknowledge', { sessionId: A, alertId: alert.id })).status, 200);
  const seeds = first.seeds(), root = first.root;
  await first.close();
  const second = await host(t, { root, seeds });
  assert.equal((await second.alerts()).total, 0);
  const persisted = await second.record(A);
  assert.equal(persisted.notification.id, alert.id);
  assert.equal(persisted.notification.acknowledged, true);
  fail(second, A, 2, 'QUOTA');
  const newer = (await eventually(second.alerts, hasOneA, 'new failure after restart must remain unread')).alerts[0];
  assert.notEqual(newer.id, alert.id);
  const tool = second.tools.get('task_guardian_alerts');
  await assert.rejects(tool.execute({ action: 'acknowledge', sessionId: A, alertId: alert.id }), error => error.code === 'alert_changed_reload' && error.status === 409);
  assert.equal((await second.alerts()).alerts[0].id, newer.id);
});

test('native disk-backed legacy guardian records migrate in place without losing their read notice or cursor', { timeout: 15000 }, async t => {
  const first = await host(t);
  fail(first);
  const original = (await eventually(first.alerts, hasOneA, 'first failure must reach disk')).alerts[0];
  await first.call('acknowledge', { sessionId: A, alertId: original.id });
  const before = first.record(A), root = first.root, seeds = first.seeds();
  await first.close();
  // Only rewrite the owned fixture created by this test, preserving the native
  // storage envelope; no user profile or Session log is modified.
  const fixturePath = path.join(root, 'storage', 'task_guardian', 'sessions', `${sessionKey(A)}.json`);
  const envelope = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  Object.assign(envelope.record, { epoch: 9, settings: { enabled: true, recoverAfterRestart: true, autoSelectFirst: true },
    run: { phase: 'running' }, retry: { attempt: 4, retryAt: 99999 }, recovery: { status: 'need_confirmation' },
    lifecycle: { toolCalls: [{ arguments: 'legacy fixture arguments' }] }, guardEnabledAt: 100, lastDecision: { kind: 'scheduled' } });
  await fs.writeFile(fixturePath, JSON.stringify(envelope));
  const second = await host(t, { root, seeds });
  assert.equal((await second.alerts()).total, 0);
  const after = second.record(A);
  assert.equal(after.notification.id, original.id); assert.equal(after.notification.acknowledged, true);
  assert.equal(after.notificationSeq, before.notificationSeq);
  assert.equal(after.notificationProjectionVersion, before.notificationProjectionVersion);
  assert.ok(after.revision > before.revision);
  for (const key of ['epoch', 'settings', 'run', 'retry', 'recovery', 'lifecycle', 'guardEnabledAt', 'lastDecision']) assert.equal(Object.hasOwn(after, key), false);
  assert.ok(after.audit.some(entry => entry.kind === 'alerts_only_migrated'));
  assert.deepEqual(second.observedListeners.filter(name => /^(agent\/|user-questions\/|approval\/)/.test(name)), []);
});

test('short native retries stay quiet while a continuing retry appears at the two-minute threshold', { timeout: 15000 }, async t => {
  const clock = { now: Date.now() };
  t.mock.method(Date, 'now', () => clock.now);
  const h = await host(t);
  start(h, A); nativeRetry(h, A);
  await eventually(() => h.record(A), noticeStored, 'retry schedule must reach native durable storage');
  assert.equal((await h.alerts()).total, 0);
  clock.now += 1000;
  end(h, A, { kind: 'completed' });
  await eventually(() => h.record(A), value => value.notification?.state === 'resolved', 'short retry must settle');
  clock.now += RETRY_NOTICE_DELAY_MS;
  assert.equal((await h.alerts()).total, 0, 'a completed short retry must never become a delayed false alarm');
  start(h, B); const event = nativeRetry(h, B);
  await eventually(() => h.record(B), noticeStored, 'long retry must be stored');
  clock.now = event.time + RETRY_NOTICE_DELAY_MS - 1;
  assert.equal((await h.alerts()).total, 0);
  clock.now++;
  const alerts = await h.alerts();
  assert.equal(alerts.total, 1);
  assert.equal(alerts.alerts[0].sessionId, B);
  assert.equal(alerts.alerts[0].state, 'retrying');
  assert.equal(alerts.alerts[0].visibleAt, event.time + RETRY_NOTICE_DELAY_MS);
});

test('an explicit user Stop does not create an interruption failure or a later delayed retry alarm', { timeout: 15000 }, async t => {
  const clock = { now: Date.now() };
  t.mock.method(Date, 'now', () => clock.now);
  const h = await host(t);
  start(h, A);
  end(h, A, { kind: 'aborted', reason: { kind: 'user' } });
  assert.equal((await h.alerts()).total, 0, 'explicit Stop must not produce a failure notice');
  start(h, B); nativeRetry(h, B);
  await eventually(() => h.record(B), noticeStored, 'retry must be recorded before Stop');
  clock.now += 500;
  end(h, B, { kind: 'aborted', reason: { kind: 'user' } });
  await eventually(() => h.record(B), value => value.notification?.state === 'resolved', 'Stop must resolve a pending retry');
  clock.now += RETRY_NOTICE_DELAY_MS;
  assert.equal((await h.alerts()).total, 0);
});

test('accepted failure publications are persisted before Host unload drains its queued work', { timeout: 15000 }, async t => {
  const first = await host(t);
  const failureEvent = fail(first);
  // Unload immediately, without a snapshot/alerts read that might flush work.
  await first.fiber.dispose();
  await first.close();
  // Reopen the durable notice store with EMPTY Sessions: log replay cannot
  // recreate a notification the prior Host forgot to persist during teardown.
  const second = await host(t, { root: first.root });
  const alerts = await second.alerts();
  assert.equal(alerts.total, 1);
  assert.equal(alerts.alerts[0].id, `${A}:end:${failureEvent.seq}`);
  assert.equal(alerts.alerts[0].state, 'failed');
});

test('Host restart converts an abandoned retry to a fresh interruption and keeps its later acknowledgement durable', { timeout: 15000 }, async t => {
  const clock = { now: Date.now() };
  t.mock.method(Date, 'now', () => clock.now);
  const first = await host(t);
  start(first, A); const retryEvent = nativeRetry(first, A);
  await eventually(() => first.record(A), noticeStored, 'waiting retry must be durable before restart');
  clock.now = retryEvent.time + RETRY_NOTICE_DELAY_MS;
  const old = (await first.alerts()).alerts[0];
  assert.equal(old.state, 'retrying');
  assert.equal((await first.call('acknowledge', { sessionId: A, alertId: old.id })).status, 200);
  const seeds = first.seeds(), root = first.root;
  await first.close();
  const second = await host(t, { root, seeds });
  const restarted = (await second.alerts()).alerts[0];
  assert.ok(restarted);
  assert.equal(restarted.state, 'failed');
  assert.equal(restarted.kind, 'interrupted');
  assert.equal(restarted.code, 'RETRY_INTERRUPTED');
  assert.equal(restarted.nextRetryAt, null);
  assert.notEqual(restarted.id, old.id, 'abandoned retry is a new incident, not a live automatic wait');
  assert.equal((await second.call('acknowledge', { sessionId: A, alertId: old.id })).status, 409);
  assert.equal((await second.call('acknowledge', { sessionId: A, alertId: restarted.id })).status, 200);
  await second.close();
  const third = await host(t, { root, seeds });
  assert.equal((await third.alerts()).total, 0, 'acknowledged interruption must not recur on every restart');
});

test('abandoned retry becomes an interruption even when its original Session is unavailable after restart', { timeout: 15000 }, async t => {
  const first = await host(t);
  start(first, A); nativeRetry(first, A);
  await eventually(() => first.record(A), noticeStored, 'pending retry must be saved before the original session disappears');
  const root = first.root;
  await first.close();
  // Only B exists in the new native SessionStore; there is no persistence
  // reader that can reopen A. The durable notification remains recoverable.
  const second = await host(t, { root, sessionIds: [B] });
  const alerts = await second.alerts();
  assert.equal(alerts.total, 1);
  assert.equal(alerts.alerts[0].sessionId, A);
  assert.equal(alerts.alerts[0].state, 'failed');
  assert.equal(alerts.alerts[0].kind, 'interrupted');
  assert.equal(alerts.alerts[0].nextRetryAt, null);
});

test('unloading the real Host plugin removes every registered route and model tool', { timeout: 15000 }, async t => {
  const h = await host(t);
  assert.deepEqual([...h.routes.keys()].sort(), ['acknowledge', 'acknowledgeAll', 'alerts'].map(action => `/api/task-guardian/${action}`).sort());
  assert.deepEqual([...h.tools.keys()].sort(), ['task_guardian_alerts']);
  await h.fiber.dispose();
  assert.equal(h.routes.size, 0);
  assert.equal(h.tools.size, 0);
  assert.deepEqual(h.diagnostics, []);
});
