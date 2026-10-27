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

// The parent's pretest:integration prepares this current installed runtime.
// This file never extracts packages or writes another plugin's test directory.
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
const CONCURRENCY = 'gateway_concurrency_limit: Concurrency limit exceeded for user, please retry later';
const COUNTER_TOOL = 'guardian_test_memory_counter', CALL_ID = 'concurrency-counter-once';
const ROOT = fileURLToPath(new URL('./.integration-data/pi-concurrency/', import.meta.url));
const LIFE = 'taskGuardianLifecycle', QUESTIONS = 'taskGuardianQuestions';

class ScriptedAdapter extends llm.LlmAdapter {
  requests = [];
  observations = [];
  constructor(plan, counter) { super(); this.plan = plan; this.counter = counter; }
  async listModels(provider) { return [await this.resolveModel(provider, MODEL)]; }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, contextWindow: 100000, maxOutputTokens: 8192,
      reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } };
  }
  // Inherit providerRetryPolicy(): the actual runtime supplies normal defaults,
  // whose retryableCodes do not contain the generic PI_AI_ERROR code.
  async *stream(options) {
    this.requests.push(options);
    this.observations.push({
      ordinal: this.requests.length,
      toolCount: this.counter.count,
      toolResults: options.messages.filter(message => message.role === 'tool').map(message => ({ id: message.id, callId: message.toolCallId })),
    });
    const action = this.plan[this.requests.length - 1];
    assert.ok(action, 'a retry or extra step beyond the fixed script must fail the test');
    if (action.kind === 'tool') {
      assert.ok(options.tools?.some(tool => tool.name === COUNTER_TOOL), 'the model-facing native registry must advertise the counter');
      // These are the real StreamChunk/ToolCallBlock fields consumed by
      // BlockAssembler. Only AgentLoop dispatches this model-produced call.
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: CALL_ID, name: COUNTER_TOOL, argumentsDelta: '{}' };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CALL_ID, name: COUNTER_TOOL, arguments: '{}' } };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    if (action.kind === 'failure') {
      // Match the pi-ai adapter's in-band terminal finish, including the fact
      // that only code/message survive (no HTTP status, headers or Retry-After).
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 0 } };
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'PI_AI_ERROR', message: action.message } } };
      return;
    }
    assert.equal(action.kind, 'success');
    yield { type: 'text-delta', index: 0, text: 'Local integration completed after the concurrency refusal.' };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 8 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function createLoopHost(t, plan, { withCounter = false } = {}) {
  const root = path.resolve(ROOT, randomUUID());
  assert.equal(path.dirname(root), path.resolve(ROOT));
  const cwd = path.join(root, 'workspace');
  await fs.mkdir(cwd, { recursive: true });
  const ctx = new Context(), counter = { count: 0 }, toolExecutions = [];
  const diagnostics = [], emittedErrors = [], failuresSeen = [], scheduled = [], waits = [], nativeRetries = [], requestPositions = [];
  const adapter = new ScriptedAdapter(plan, counter);
  let guardian, store, handle, closed = false;
  ctx.logger.exporter({ export: entry => { if (entry.type === 'error') diagnostics.push(entry.args); } });
  async function mount(name, config = {}) {
    const module = await runtimeImport('@deepseek-ai/' + name);
    const fiber = ctx.plugin(module.default ?? module, config);
    await fiber.await();
    assert.equal(fiber.state, 2, `${name}: ${String(fiber.error ?? fiber._error)} ${JSON.stringify(diagnostics)}`);
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
    await mount('dsh-tools', { mode: 'native' });
    if (withCounter) ctx.tools.register({
      name: COUNTER_TOOL,
      description: 'Test-only counter whose only effect is an increment in this process memory.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'], additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => false,
      execute(args, exec) {
        assert.deepEqual(args, {});
        assert.equal(exec.callId, CALL_ID);
        assert.equal(exec.agent.id, handle.agent.id);
        counter.count++;
        toolExecutions.push({ callId: exec.callId, sessionId: exec.agent.id, count: counter.count });
        return { count: counter.count };
      },
    });
    await mount('dsh-llm');
    ctx.llm.registerAdapter([PROVIDER], adapter);
    await mount('dsh-agent');
    await mount('dsh-session-query');
    await mount('dsh-agent-loop');
    await mount('dsh-llm-retry');
    ctx.sessionProjections.register({ key: LIFE, stateVersion: 1, stateSchema: jsonObjectSchema,
      init: createLifecycleState, apply: applyLifecycle, wire: { viewSchema: jsonObjectSchema, view: state => state } });
    ctx.sessionProjections.register({ key: QUESTIONS, stateVersion: 1, stateSchema: jsonObjectSchema,
      init: foldQuestions.init, apply: foldQuestions.apply, wire: { viewSchema: jsonObjectSchema, view: state => state } });
    ctx.on('agent/error', ({ agent, error }) => emittedErrors.push({ sessionId: agent.id, error }));
    ctx.on('agent/request', (payload, next) => {
      requestPositions.push({ turn: payload.turn, step: payload.step });
      return next();
    });
    ctx.on('agent/request-error', (payload, next) => {
      failuresSeen.push({ failure: structuredClone(payload.failure), policy: structuredClone(payload.retryPolicy),
        provider: payload.provider, turn: payload.turn, step: payload.step, toolCount: counter.count });
      return next();
    });
    ctx.on('session/event', (session, event) => { if (event.type === 'llm/retry') nativeRetries.push({ sessionId: session.id, event }); });
    ctx.on('domain/changed', change => {
      if (change.domain !== 'task_guardian' || change.table !== 'sessions' || change.operation !== 'put') return;
      if (change.value?.audit?.at(-1)?.kind === 'retry_scheduled') scheduled.push(structuredClone(change.value));
    });
    const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(runtimeFile('@deepseek-ai/dsh-llm-retry')), '..', 'package.json'), 'utf8'));
    assert.equal(manifest.version, SUPPORTED_NATIVE_VERSION);
    guardian = createGuardianService(ctx, {
      leaseFactory: async () => ({ close: async () => {} }),
      compatibilityReader: async () => ({ supported: true, version: manifest.version, reason: 'isolated_native_contract' }),
      storeFactory: async (storageDomain, options) => { store = await createGuardianStore(storageDomain, options); return store; },
      startupSetter: async () => { throw new Error('Startup mutation is forbidden in this request-loop test.'); },
      retryOptions: { random: () => 0.5, wait: async (delayMs, signal) => {
        const record = store.get(handle.agent.id);
        waits.push({ delayMs, toolCount: counter.count, step: record.run.step });
        assert.equal(record.retry.delayMs, delayMs, 'the native durable store must contain the plan before waiting');
        assert.ok(record.audit.some(entry => entry.kind === 'retry_scheduled'));
        assert.ok(scheduled.length > 0, 'post-durability schedule publication must precede waiting');
        return !signal.aborted;
      } },
    });
    ctx.on('agent/request', guardian.request, { prepend: true });
    ctx.on('agent/status', guardian.onStatus);
    ctx.sessionProjections.onChanged((session, key, value) => { void guardian.onProjection(session, key, value).catch(guardian.fail); });
    await guardian.ready;
    const id = 'pi-concurrency-' + randomUUID();
    handle = await ctx.agents.create({ sessionId: id, meta: { cwd }, agentOptions: { provider: PROVIDER, model: MODEL, reasoningEffort: 'low' } });
    const initial = await guardian.snapshot({ sessionId: id });
    assert.deepEqual(initial.record.settings, { enabled: true, recoverAfterRestart: true, autoSelectFirst: true },
      'all three defaults must be on without calling configure');
    assert.equal(initial.record.guardEnabledAt, null);
    assert.equal(initial.fault, null);
    assert.equal(initial.record.audit.some(entry => entry.kind === 'user_settings_changed'), false);
    return { ctx, root, adapter, counter, toolExecutions, guardian, store, agent: handle.agent,
      diagnostics, emittedErrors, failuresSeen, scheduled, waits, nativeRetries, requestPositions, initial,
      async turn() {
        const message = llm.createUserMessage({ content: [{ type: 'text', text: 'Synthetic concurrency task; only the scripted in-memory counter is permitted.' }], source: { kind: 'user' } });
        handle.agent.followup(message);
        await handle.agent.whenIdle();
        await ctx.sessions.flush(handle.agent.session);
        await store.update(id, 'test_barrier', () => undefined);
        await store.update(id, 'test_barrier', () => undefined);
        return message;
      },
      events: () => handle.agent.session.snapshotEvents(),
    };
  } catch (error) { await close(); throw error; }
}

function assertNativeAndAdmission(h, message) {
  const events = h.events();
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user').length, 1);
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.id === message.id).length, 1);
  assert.equal(events.filter(event => event.type === 'turn/start').length, 1);
  assert.equal(h.nativeRetries.length, 0, 'the actual native whitelist rejects PI_AI_ERROR without consuming retry budget');
  assert.ok(h.failuresSeen.length > 0);
  for (const seen of h.failuresSeen) {
    assert.equal(seen.failure.code, 'PI_AI_ERROR'); assert.equal(seen.provider, PROVIDER);
    assert.equal(seen.policy.mode, 'normal');
    assert.equal(seen.policy.retryableCodes.includes('PI_AI_ERROR'), false);
    assert.equal(seen.policy.maxRetries, 5);
  }
  for (const request of h.adapter.requests) { assert.equal(request.provider, PROVIDER); assert.equal(request.model, MODEL); }
}

function assertSuccessfulTurn(h) {
  assert.equal(h.events().at(-1).type, 'turn/end');
  assert.equal(h.events().at(-1).data.reason.kind, 'completed');
  assert.equal(h.emittedErrors.length, 0);
  assert.deepEqual(h.diagnostics, []);
  assert.deepEqual(offlineGuard.denied, []);
}

test('new default-on session retries exact PI gateway concurrency refusal without manual configure', { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [{ kind: 'failure', message: CONCURRENCY }, { kind: 'success' }]);
  const message = await h.turn();
  assert.equal(h.adapter.requests.length, 2);
  assertNativeAndAdmission(h, message);
  assert.deepEqual(h.requestPositions, [{ turn: 1, step: 1 }, { turn: 1, step: 1 }]);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].retry.attempt, 1);
  assert.equal(h.scheduled[0].retry.delayMs, 30_000);
  assert.deepEqual(h.waits, [{ delayMs: 30_000, toolCount: 0, step: 1 }]);
  assert.equal(h.failuresSeen[0].failure.message, CONCURRENCY);
  assert.equal(h.events().some(event => event.type === 'tool/call' || event.type.startsWith('tool/ptc-')), false);
  const status = await h.guardian.snapshot({ sessionId: h.agent.id });
  assert.equal(status.record.retry.attempt, 0); assert.equal(status.record.retry.retryAt, null);
  assertSuccessfulTurn(h);
});

test('step-two concurrency retry never replays the counter tool executed by step one', { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [{ kind: 'tool' }, { kind: 'failure', message: CONCURRENCY }, { kind: 'success' }], { withCounter: true });
  const message = await h.turn();
  assert.equal(h.adapter.requests.length, 3);
  assertNativeAndAdmission(h, message);
  assert.deepEqual(h.requestPositions, [{ turn: 1, step: 1 }, { turn: 1, step: 2 }, { turn: 1, step: 2 }]);
  assert.deepEqual(h.adapter.observations.map(value => value.toolCount), [0, 1, 1]);
  assert.equal(h.failuresSeen[0].toolCount, 1, 'the real tool completed before the request failed');
  assert.equal(h.failuresSeen[0].step, 2);
  assert.equal(h.counter.count, 1); assert.equal(h.toolExecutions.length, 1);
  assert.equal(h.toolExecutions[0].callId, CALL_ID);
  const calls = h.events().filter(event => event.type === 'tool/call');
  const results = h.events().filter(event => event.type === 'tool/result');
  assert.equal(calls.length, 1); assert.equal(results.length, 1);
  assert.equal(calls[0].data.callId, CALL_ID); assert.equal(calls[0].data.name, COUNTER_TOOL);
  assert.equal(calls[0].data.step, 1); assert.equal(results[0].data.step, 1);
  assert.equal(results[0].data.message.toolCallId, CALL_ID); assert.equal(results[0].data.message.isError, false);
  assert.deepEqual(JSON.parse(results[0].data.message.content[0].text), { count: 1 });
  assert.ok(results[0].seq < h.events().find(event => event.type === 'step/start' && event.data.step === 2).seq);
  assert.equal(h.events().filter(event => event.type === 'step/start' && event.data.step === 1).length, 1);
  assert.equal(h.events().filter(event => event.type === 'step/start' && event.data.step === 2).length, 1, 'retry does not reopen step two');
  assert.equal(h.scheduled.length, 1); assert.equal(h.scheduled[0].run.step, 2);
  assert.deepEqual(h.waits, [{ delayMs: 30_000, toolCount: 1, step: 2 }]);
  const secondResult = h.adapter.observations[1].toolResults;
  const retriedResult = h.adapter.observations[2].toolResults;
  assert.deepEqual(secondResult.map(value => value.callId), [CALL_ID]);
  assert.deepEqual(retriedResult, secondResult, 'retry reads the same durable tool result identity, not a new execution');
  const status = await h.guardian.snapshot({ sessionId: h.agent.id });
  assert.equal(status.record.retry.attempt, 0); assert.equal(status.record.retry.retryAt, null);
  assertSuccessfulTurn(h);
});

for (const scenario of [
  { label: 'authentication', message: 'invalid_api_key: Invalid API key.', expectedKind: 'permanent' },
  { label: 'quota', message: 'insufficient_quota: Insufficient balance; long-term quota exhausted.', expectedKind: 'permanent' },
  { label: 'unclassified failure', message: 'unknown_error: Unable to classify gateway response.', expectedKind: 'unknown' },
]) test(`same PI error code with ${scenario.label} text never grants a retry`, { timeout: 15000 }, async t => {
  const h = await createLoopHost(t, [{ kind: 'failure', message: scenario.message }]);
  const message = await h.turn();
  assert.equal(h.adapter.requests.length, 1);
  assertNativeAndAdmission(h, message);
  assert.deepEqual(h.waits, []); assert.deepEqual(h.scheduled, []);
  assert.equal(h.counter.count, 0);
  assert.equal(h.events().filter(event => event.type === 'tool/call').length, 0);
  assert.equal(h.events().at(-1).data.reason.kind, 'error');
  assert.equal(h.events().at(-1).data.reason.error.code, 'PI_AI_ERROR');
  const status = await h.guardian.snapshot({ sessionId: h.agent.id });
  assert.equal(status.record.retry.attempt, 0);
  assert.equal(status.record.lastDecision.kind, scenario.expectedKind);
  assert.deepEqual(offlineGuard.denied, []);
});
