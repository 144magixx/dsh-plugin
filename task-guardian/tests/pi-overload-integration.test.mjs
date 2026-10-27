import '../../side-branch/scripts/offline-test-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import { runtimeDir } from '../../session-summary/scripts/extract-test-runtime.mjs';
import { offlineGuard } from '../../side-branch/scripts/offline-test-guard.mjs';
import { createGuardianService, SUPPORTED_NATIVE_VERSION } from '../lib/index.js';
import { createGuardianStore, jsonObjectSchema } from '../lib/store.js';
import { createLifecycleState, applyLifecycle } from '../lib/recovery.js';
import { foldQuestions } from '../lib/questions.js';

// Reuse the already extracted, installed runtime without writing any other
// plugin's files. Missing dependencies fail explicitly instead of skipping.
const runtimeRequire = createRequire(path.join(runtimeDir, 'package.json'));
const runtimeFile = name => runtimeRequire.resolve(name);
const runtimeImport = name => import(pathToFileURL(runtimeFile(name)).href);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':')) {
    try { return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(runtimeDir, 'package.json')).href }); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }
  }
  return nextResolve(specifier, context);
} });
const [{ Context }, llm] = await Promise.all([
  runtimeImport('@deepseek-ai/cordis'), runtimeImport('@deepseek-ai/dsh-llm'),
]);
const PROVIDER = 'codex-relay', MODEL = 'gpt-6.1-terra';
const OVERLOAD = 'server_error: Our servers are currently overloaded. Please try again later.';
const ROOT = fileURLToPath(new URL('./.integration-data/pi-overload/', import.meta.url));
const LIFECYCLE = 'taskGuardianLifecycle', QUESTIONS = 'taskGuardianQuestions';

class ScriptedAdapter extends llm.LlmAdapter {
  requests = [];
  failures = [];
  constructor(failures = []) { super(); this.failures = failures; }
  async listModels(provider) { return [await this.resolveModel(provider, MODEL)]; }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, contextWindow: 100000, maxOutputTokens: 8192,
      reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } };
  }
  // Deliberately inherit providerRetryPolicy(): undefined selects the REAL
  // native normal defaults, rather than a zero-budget or patched whitelist.
  async *stream(options) {
    this.requests.push(options);
    const scripted = this.failures[this.requests.length - 1];
    if (scripted?.inBand) {
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } };
      yield { type: 'finish', reason: { kind: 'error', failure: { code: scripted.code, message: scripted.message } } };
      return;
    }
    if (scripted) throw new llm.LlmError(scripted.message, scripted.code, scripted.options);
    yield { type: 'text-delta', index: 0, text: 'Local integration answer after overload.' };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 6 } };
    yield { type: 'finish', reason: 'stop' };
  }
}

async function createLoopHost(t, failures, { enabled = true } = {}) {
  const root = path.resolve(ROOT, randomUUID());
  assert.equal(path.dirname(root), path.resolve(ROOT));
  const cwd = path.join(root, 'workspace');
  await fs.mkdir(cwd, { recursive: true });
  const ctx = new Context(), diagnostics = [], emittedErrors = [], failuresSeen = [], scheduled = [], waits = [], nativeRetries = [];
  const adapter = new ScriptedAdapter(failures);
  let guardian, store, handle, closed = false;
  ctx.logger.exporter({ export: entry => { if (entry.type === 'error') diagnostics.push(entry.args); } });
  async function mount(name, config = {}) {
    const module = await runtimeImport('@deepseek-ai/' + name);
    const fiber = ctx.plugin(module.default ?? module, config);
    await fiber.await();
    assert.equal(fiber.state, 2, `${name}: ${String(fiber.error ?? fiber._error)} ${JSON.stringify(diagnostics)}`);
    return fiber;
  }
  async function close() {
    if (closed) return;
    closed = true;
    try { await guardian?.dispose(); } finally { await ctx.fiber.dispose(); }
  }
  t.after(close);
  try {
    for (const name of ['dsh-typert-registry', 'dsh-session', 'dsh-session-projection']) await mount(name);
    await mount('dsh-session-persistence-jsonl', { root: path.join(root, 'sessions'), compression: 'none' });
    await mount('dsh-storage');
    await mount('dsh-storage-json', { root: path.join(root, 'storage') });
    await mount('dsh-storage-domain', { backend: 'json' });
    await mount('dsh-system-prompt');
    await mount('dsh-tools');
    await mount('dsh-llm');
    ctx.llm.registerAdapter([PROVIDER], adapter);
    await mount('dsh-agent');
    await mount('dsh-session-query');
    await mount('dsh-agent-loop');
    await mount('dsh-llm-retry');
    ctx.sessionProjections.register({ key: LIFECYCLE, stateVersion: 1, stateSchema: jsonObjectSchema,
      init: createLifecycleState, apply: applyLifecycle, wire: { viewSchema: jsonObjectSchema, view: state => state } });
    ctx.sessionProjections.register({ key: QUESTIONS, stateVersion: 1, stateSchema: jsonObjectSchema,
      init: foldQuestions.init, apply: foldQuestions.apply, wire: { viewSchema: jsonObjectSchema, view: state => state } });
    ctx.on('agent/error', ({ agent, error }) => emittedErrors.push({ sessionId: agent.id, error }));
    ctx.on('agent/request-error', (payload, next) => {
      failuresSeen.push({ failure: structuredClone(payload.failure), policy: structuredClone(payload.retryPolicy), provider: payload.provider });
      return next();
    });
    ctx.on('session/event', (session, event) => { if (event.type === 'llm/retry') nativeRetries.push({ sessionId: session.id, event }); });
    ctx.on('domain/changed', change => {
      if (change.domain !== 'task_guardian' || change.table !== 'sessions' || change.operation !== 'put') return;
      const last = change.value?.audit?.at(-1);
      if (last?.kind === 'retry_scheduled') scheduled.push(structuredClone(change.value));
    });
    const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(runtimeFile('@deepseek-ai/dsh-llm-retry')), '..', 'package.json'), 'utf8'));
    assert.equal(manifest.version, SUPPORTED_NATIVE_VERSION, 'this test must use the supported actual native implementation');
    guardian = createGuardianService(ctx, {
      // The OS lease is independently tested elsewhere. This test process has a
      // strict no-socket guard and an isolated native storage root.
      leaseFactory: async () => ({ close: async () => {} }),
      compatibilityReader: async () => ({ supported: true, version: manifest.version, reason: 'isolated_native_contract' }),
      storeFactory: async (storageDomain, options) => { store = await createGuardianStore(storageDomain, options); return store; },
      startupSetter: async () => { throw new Error('startup is forbidden in this request-loop test'); },
      retryOptions: { random: () => 0.5, wait: async (delayMs, signal) => {
        waits.push(delayMs);
        const record = store.get(handle.agent.id);
        assert.equal(record.retry.delayMs, delayMs, 'native storage must commit the schedule before waiting');
        assert.equal(record.audit.at(-1).kind, 'retry_scheduled');
        return !signal.aborted;
      } },
    });
    ctx.on('agent/request', guardian.request, { prepend: true });
    ctx.on('agent/status', guardian.onStatus);
    ctx.sessionProjections.onChanged((session, key, value) => { void guardian.onProjection(session, key, value).catch(guardian.fail); });
    await guardian.ready;
    const id = 'pi-overload-' + randomUUID();
    handle = await ctx.agents.create({ sessionId: id, meta: { cwd }, agentOptions: { provider: PROVIDER, model: MODEL, reasoningEffort: 'low' } });
    assert.ok(handle.agent, 'the native factory returns an AgentHandle');
    if (enabled) {
      const result = await guardian.configure({ sessionId: id, epoch: 0, settings: { enabled: true } });
      assert.equal(result.record.settings.enabled, true);
      assert.ok(result.record.revision > 0);
      assert.equal(result.fault, null);
    }
    async function drainGuardian() {
      // Queue barriers drain already-accepted writes and their onProjection
      // continuations without sleeping or manufacturing new session events.
      await store.update(id, 'test_barrier', () => undefined);
      await store.update(id, 'test_barrier', () => undefined);
    }
    return { ctx, root, cwd, adapter, agent: handle.agent, guardian, store, diagnostics, emittedErrors, failuresSeen, scheduled, waits, nativeRetries, drainGuardian,
      async turn(text = 'Synthetic direct user task; no tools or external actions.') {
        const message = llm.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
        handle.agent.followup(message);
        await handle.agent.whenIdle();
        await ctx.sessions.flush(handle.agent.session);
        await drainGuardian();
        return message;
      },
      events: () => handle.agent.session.snapshotEvents(),
    };
  } catch (error) { await close(); throw error; }
}

function assertSingleAdmission(h, message) {
  const events = h.events();
  const admitted = events.filter(event => event.type === 'user/message' && event.data.id === message.id);
  assert.equal(admitted.length, 1, 'the direct user batch is admitted exactly once');
  assert.equal(events.filter(event => event.type === 'turn/start').length, 1);
  assert.equal(events.filter(event => event.type === 'step/start').length, 1, 'request retries stay within the original step');
  assert.equal(events.filter(event => event.type === 'tool/call' || event.type.startsWith('tool/ptc-')).length, 0, 'the loop did not execute or replay tools');
  assert.equal(h.nativeRetries.length, 0, 'the original native retry budget was not consumed for an excluded code');
  assert.ok(h.failuresSeen.every(value => value.policy?.mode === 'normal'));
  assert.ok(h.failuresSeen.every(value => !value.policy.retryableCodes.includes('PI_AI_ERROR')), 'the real native default list still excludes PI_AI_ERROR');
  assert.ok(h.failuresSeen.every(value => value.provider === PROVIDER));
}

test('actual AgentLoop retries a retained PI overload once after native normal declines it, with one durable 30s schedule', { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [{ code: 'PI_AI_ERROR', message: OVERLOAD }]);
  const message = await h.turn();
  assert.equal(h.adapter.requests.length, 2, 'the actual loop must make the second adapter call');
  assert.deepEqual(h.waits, [30_000]);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].retry.attempt, 1);
  assert.equal(h.scheduled[0].retry.delayMs, 30_000);
  assert.equal(h.failuresSeen[0].failure.code, 'PI_AI_ERROR');
  assert.equal(h.failuresSeen[0].failure.message, OVERLOAD);
  assertSingleAdmission(h, message);
  for (const request of h.adapter.requests) { assert.equal(request.provider, PROVIDER); assert.equal(request.model, MODEL); }
  const record = (await h.guardian.snapshot({ sessionId: h.agent.id })).record;
  assert.equal(record.retry.attempt, 0, 'a successful real assistant response clears the failure chain');
  assert.equal(record.retry.retryAt, null);
  assert.ok(h.events().some(event => event.type === 'assistant/message' && event.data.interrupted !== true));
  assert.equal(h.events().at(-1).type, 'turn/end');
  assert.equal(h.events().at(-1).data.reason.kind, 'completed');
  assert.equal(h.emittedErrors.length, 0);
  assert.deepEqual(offlineGuard.denied, []);
});

test('actual AgentLoop handles pi-style in-band overload and preserves a later permanent refusal', { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [
    { code: 'PI_AI_ERROR', message: OVERLOAD, inBand: true },
    { code: 'AUTH', message: 'Invalid API key; authentication failed.', inBand: true },
  ]);
  const message = await h.turn();
  assert.equal(h.adapter.requests.length, 2);
  assert.deepEqual(h.waits, [30_000]);
  assert.equal(h.scheduled.length, 1);
  assertSingleAdmission(h, message);
  assert.equal(h.failuresSeen[0].failure.message, OVERLOAD);
  const result = await h.guardian.snapshot({ sessionId: h.agent.id });
  assert.equal(result.record.retry.attempt, 0);
  assert.equal(result.record.retry.retryAt, null);
  assert.equal(result.record.lastDecision.kind, 'permanent');
  assert.equal(result.record.lastDecision.code, 'AUTH');
  assert.equal(result.lastFailure.code, 'AUTH');
  assert.equal(h.events().at(-1).data.reason.error.code, 'AUTH');
});

for (const scenario of [
  { label: 'permanent authentication', code: 'AUTH', message: 'Invalid API key; authentication failed.' },
  { label: 'permanent quota', code: 'QUOTA', message: 'Insufficient balance; long-term quota exhausted.' },
  { label: 'unknown PI failure', code: 'PI_AI_ERROR', message: 'Unrecognized provider response; execution state cannot be classified.' },
]) test(`actual AgentLoop stops ${scenario.label} without scheduling or replay`, { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [scenario]);
  const message = await h.turn();
  assert.equal(h.adapter.requests.length, 1);
  assert.deepEqual(h.waits, []); assert.deepEqual(h.scheduled, []);
  assertSingleAdmission(h, message);
  assert.equal(h.events().at(-1).type, 'turn/end');
  assert.equal(h.events().at(-1).data.reason.kind, 'error');
  assert.equal(h.events().at(-1).data.reason.error.code, scenario.code);
  assert.equal((await h.guardian.snapshot({ sessionId: h.agent.id })).record.retry.attempt, 0);
  assert.deepEqual(offlineGuard.denied, []);
});

test('enabling guarding only after a real failed turn never retroactively follows up or replays it', { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [{ code: 'PI_AI_ERROR', message: OVERLOAD }], { enabled: false });
  const message = await h.turn('Synthetic task failed before guardian enable; never retrospectively resend.');
  assert.equal(h.adapter.requests.length, 1, 'guard disabled at the failure boundary cannot retry');
  assert.deepEqual(h.waits, []); assert.deepEqual(h.scheduled, []);
  assertSingleAdmission(h, message);
  const before = h.events();
  assert.equal(before.at(-1).type, 'turn/end');
  assert.equal(before.at(-1).data.reason.kind, 'error');
  assert.equal(before.at(-1).data.reason.error.code, 'PI_AI_ERROR');
  const enabled = await h.guardian.configure({ sessionId: h.agent.id, epoch: 0, settings: { enabled: true } });
  assert.equal(enabled.record.settings.enabled, true);
  assert.equal(enabled.lastFailure.code, 'PI_AI_ERROR');
  assert.equal(enabled.lastFailure.at, before.at(-1).time);
  assert.equal(enabled.lastFailure.guardEnabledAt, enabled.record.guardEnabledAt);
  assert.ok(enabled.record.guardEnabledAt >= enabled.lastFailure.at);
  await h.agent.whenIdle(); await h.drainGuardian();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.agent.status, 'idle');
  assert.equal(h.adapter.requests.length, 1, 'enabling is a preference change, never an automatic new user task');
  assert.deepEqual(h.events(), before, 'turns and admitted user messages remain untouched after enable');
  assert.deepEqual(h.waits, []); assert.deepEqual(h.scheduled, []);
  assert.deepEqual(offlineGuard.denied, []);
});
