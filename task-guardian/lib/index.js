import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLease, createGuardianStore, defaultRecord, DEFAULT_SETTINGS, jsonObjectSchema } from './store.js';
import { registerRetryMiddleware } from './retry.js';
import { createLifecycleState, applyLifecycle, assessRecovery } from './recovery.js';
import { foldQuestions, questionViews } from './questions.js';
import { buildStartupPlan, setStartup } from './startup.js';

export const name = 'dsh-task-guardian';
export const inject = ['connection', 'storageDomain', 'sessionProjections', 'sessionQuery', 'agents'];
const LIFE = 'taskGuardianLifecycle';
const QUESTIONS = 'taskGuardianQuestions';
export const SUPPORTED_NATIVE_VERSION = '0.2.1-rc.3';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const optional = (ctx, key) => { try { return ctx.get?.(key); } catch { return undefined; } };
function failure(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function sessionIdOf(input) {
  const id = input?.sessionId;
  if (typeof id !== 'string' || id.length === 0 || id.length > 240 || /[\x00-\x1f]/.test(id)) throw failure('session_required');
  return id;
}
export async function detectCompatibility(ctx) {
  try {
    const packages = optional(ctx, 'pluginPackages');
    const info = packages?.packageOf('@deepseek-ai/dsh-llm-retry', ctx.baseUrl);
    if (!info?.dir) return { supported: false, reason: 'native_version_unavailable' };
    const manifest = JSON.parse(await fs.readFile(path.join(info.dir, 'package.json'), 'utf8'));
    return { supported: manifest.name === '@deepseek-ai/dsh-llm-retry' && manifest.version === SUPPORTED_NATIVE_VERSION, version: manifest.version, reason: manifest.version === SUPPORTED_NATIVE_VERSION ? 'verified_contract' : 'native_version_unsupported' };
  } catch { return { supported: false, reason: 'native_version_unavailable' }; }
}

/** Business operations are shared by the user UI and the read-only status tool.
 * Settings, startup authority and answering/resuming remain user-only operations.
 */
export function createGuardianService(ctx, { now = Date.now, leaseFactory = acquireLease, storeFactory = createGuardianStore, compatibilityReader = detectCompatibility, startupSetter = setStartup, retryOptions = {} } = {}) {
  const lifetime = new AbortController();
  const ownerId = randomUUID();
  let store, lease, retries, disposed = false, fault = null, compatibility = { supported: false, reason: 'initializing' };
  const revoking = new Set(), markers = new Map();
  const enabled = id => !disposed && !fault && compatibility.supported && store?.healthy() === true && !revoking.has(id) && store.get(id).settings.enabled;
  const fail = error => { fault = error?.code || 'guardian_unavailable'; lifetime.abort(); void retries?.dispose(); ctx.logger?.warn?.('Task Guardian stopped:', error?.message || String(error)); };
  async function observe(id, callback, signal = lifetime.signal) {
    const observed = await ctx.sessionQuery.observeSession(id, { signal });
    try { return await callback(observed); } finally { observed[Symbol.dispose](); }
  }
  async function recoveryFor(record, observed) {
    const lifecycle = observed.projections?.values[LIFE];
    let workspaceAvailable = false;
    try { workspaceAvailable = (await fs.stat(observed.header.cwd)).isDirectory(); } catch { /* unavailable stays blocked */ }
    return assessRecovery({ record, snapshot: { lifecycle, running: ctx.agents.get(observed.header.id)?.status === 'running' }, workspaceAvailable, apiCompatible: false });
  }
  const ready = (async () => {
    try {
      lease = await leaseFactory({ onLost: fail });
      if (disposed) { await lease.close(); return; }
      store = await storeFactory(ctx.storageDomain, { ownerId, now });
      compatibility = await compatibilityReader(ctx);
      if (disposed) return;
      retries = registerRetryMiddleware(ctx, {
        ...retryOptions, lifetimeSignal: lifetime.signal, now, isEnabled: enabled,
        async onSchedule({ sessionId, attempt, retryAt, delayMs, reason, payload, signal, failure: requestFailure, handoff, nativeRetryCount, maxRetries }) {
          // Durable record first; both the retry helper and this queued writer recheck revocation.
          await store.update(sessionId, 'retry_scheduled', current => {
            if (signal.aborted || !enabled(sessionId)) return undefined;
            const lastDecision = { kind: 'scheduled', reason, code: requestFailure?.code ?? null, at: now(), turn: payload.turn, step: payload.step, handoff: handoff ?? null, nativeRetryCount: nativeRetryCount ?? null, maxRetries: maxRetries ?? null };
            return { ...current, lastDecision, retry: { attempt, retryAt, delayMs, reason }, run: { ...current.run, phase: 'waiting', ownerId, turn: payload.turn, step: payload.step, lastSeq: payload.agent.session.seq - 1 } };
          });
        },
        async onReset({ sessionId }) {
          if (!store?.healthy() || disposed) return;
          await store.update(sessionId, 'retry_cleared', current => current.retry.attempt || current.retry.retryAt !== null ? { ...current, retry: { attempt: 0, retryAt: null } } : undefined);
        },
        async onBlocked({ sessionId, kind, reason, signal, payload, failure: requestFailure, handoff, nativeRetryCount, maxRetries }) {
          await store.update(sessionId, 'retry_refused', current => !signal.aborted && enabled(sessionId) ? { ...current,
            lastDecision: { kind, reason, code: requestFailure?.code ?? null, at: now(), turn: payload?.turn ?? null, step: payload?.step ?? null, handoff: handoff ?? null, nativeRetryCount: nativeRetryCount ?? null, maxRetries: maxRetries ?? null },
            retry: { ...current.retry, retryAt: null, reason: `${kind}:${reason}` },
          } : undefined);
        },
      });
      // Only inspect explicitly opted-in records. Never activate agents or submit prompts.
      for (const record of store.list()) {
        if (!record.settings.enabled || !record.settings.recoverAfterRestart) continue;
        try {
          await observe(record.sessionId, async session => {
            const recovery = await recoveryFor(record, session);
            await store.update(record.sessionId, 'restart_review', current => ({ ...current, recovery, run: { ...current.run, phase: recovery.status === 'need_confirmation' ? 'need_confirmation' : current.run.phase } }));
          });
        } catch {
          await store.update(record.sessionId, 'restart_review_failed', current => ({ ...current, recovery: { status: 'need_confirmation', reasonCode: 'session_unavailable', reason: '会话记录或运行条件不可读取，需人工确认。' } }));
        }
      }
    } catch (error) { fail(error); }
  })();

  async function snapshot(input, signal) {
    const id = sessionIdOf(input);
    await ready;
    const record = store?.get(id) || defaultRecord(id, now());
    const stateFault = fault || (store && !store.healthy() ? 'persistence_unavailable' : null);
    if (stateFault) return { ok: true, sessionId: id, record, questions: [], compatibility, fault: stateFault, startup: { supported: false, enabled: false }, serverNow: now() };
    return observe(id, async observed => {
      const projections = observed.projections?.values;
      const lifecycle = projections?.[LIFE];
      const questions = questionViews(projections?.[QUESTIONS], record.settings, now());
      const ended = lifecycle?.turn === null ? lifecycle.lastTurnEnd : null;
      const firstGrant = record.settings.enabled && record.epoch === 1 ? record.audit.find(entry => entry.kind === 'user_settings_changed') : undefined;
      const guardEnabledAt = Object.hasOwn(record, 'guardEnabledAt') ? record.guardEnabledAt : firstGrant?.at ?? null;
      const lastFailure = ended?.reason?.kind === 'error' ? { at: ended.time, code: ended.reason.error?.code ?? null, guardEnabledAt, beforeGuardEnabled: Number.isFinite(guardEnabledAt) && ended.time < guardEnabledAt } : null;
      const startup = store.getStartup();
      let startupSupported = false;
      try { buildStartupPlan(); startupSupported = true; } catch { /* no supported Desktop executable */ }
      return { ok: true, sessionId: id, record, questions, lastFailure, compatibility, fault, startup: { ...startup, supported: startupSupported }, serverNow: now() };
    }, signal);
  }
  async function configure(input, signal) {
    const id = sessionIdOf(input);
    const patch = input.settings;
    if (!object(patch) || Object.keys(patch).length !== 1 || Object.entries(patch).some(([key, value]) => !Object.hasOwn(DEFAULT_SETTINGS, key) || typeof value !== 'boolean') || !Number.isSafeInteger(input.epoch)) throw failure('invalid_settings');
    await ready;
    if (fault || disposed || !store?.healthy()) throw failure('guardian_unavailable', 503);
    // Confirm identity/read availability before accepting any new grant.
    await observe(id, () => {}, signal);
    const disabling = patch.enabled === false;
    if (disabling) { revoking.add(id); retries?.cancel(id); }
    try {
      await store.update(id, 'user_settings_changed', current => {
        if (current.epoch !== input.epoch) throw failure('settings_changed_reload', 409);
        const settings = { ...current.settings, ...patch };
        return { ...current, settings, epoch: current.epoch + 1,
          ...(patch.enabled === true && !current.settings.enabled ? { guardEnabledAt: now() } : {}),
          ...(patch.enabled === false ? { guardEnabledAt: null } : {}),
          ...(patch.enabled !== undefined ? { lastDecision: null } : {}),
          recovery: settings.enabled && settings.recoverAfterRestart ? { status: 'need_confirmation', reasonCode: 'safe_recovery_adapter_unavailable', reason: '已记录事前恢复偏好；当前版本仍需人工确认停止、工具结果及原生目标授权。' } : { status: 'disabled', reasonCode: 'recovery_disabled', reason: '未启用重启恢复。' },
          ...(settings.enabled ? {} : { retry: { ...current.retry, retryAt: null }, run: { ...current.run, phase: 'idle' } }),
        };
      });
      return snapshot({ sessionId: id }, signal);
    } finally { if (store.healthy()) revoking.delete(id); }
  }
  async function startup(input) {
    sessionIdOf(input);
    if (typeof input.enabled !== 'boolean') throw failure('invalid_settings');
    await ready;
    if (fault || disposed || !store?.healthy()) throw failure('guardian_unavailable', 503);
    const value = await startupSetter(input.enabled);
    await store.setStartup({ ...value, at: now(), ownerId });
    return { ok: true, startup: value };
  }
  async function onProjection(session, key, state) {
    if (key !== LIFE || !store || disposed || !store.healthy()) return;
    const record = store.get(session.id);
    if (!record.settings.enabled) return;
    const previous = markers.get(session.id) || { success: record.lifecycle?.lastSuccessfulAssistantSeq ?? null, end: record.lifecycle?.lastTurnEnd?.seq, goal: record.lifecycle?.goal?.goal?.revision, operation: record.lifecycle?.lastGoalOperation };
    markers.set(session.id, { success: state.lastSuccessfulAssistantSeq, end: state.lastTurnEnd?.seq, goal: state.goal?.goal?.revision, operation: state.lastGoalOperation });
    const successChanged = state.lastSuccessfulAssistantSeq !== null && state.lastSuccessfulAssistantSeq !== previous.success;
    const endChanged = state.lastTurnEnd?.seq !== previous.end;
    if (successChanged || endChanged) await retries?.reset(session.id);
    const goalChanged = state.goal?.goal?.revision !== previous.goal || state.lastGoalOperation !== previous.operation;
    if (endChanged && state.lastTurnEnd?.reason?.kind === 'aborted' || goalChanged && (['paused', 'complete', 'blocked'].includes(state.goal?.goal?.phase) || state.lastGoalOperation === 'clear')) retries?.cancel(session.id);
    const phase = state.turn !== null ? 'running' : state.stopped ? 'stopped' : state.goal?.goal?.phase === 'complete' || state.lastTurnEnd?.reason?.kind === 'completed' ? 'completed' : 'idle';
    await store.update(session.id, 'lifecycle_observed', current => current.settings.enabled && (current.lifecycle?.lastSeq ?? -1) < state.lastSeq ? { ...current, lifecycle: state, run: { ...current.run, phase, ownerId, lastSeq: state.lastSeq }, ...(phase === 'stopped' || phase === 'completed' ? { retry: { ...current.retry, retryAt: null } } : {}) } : undefined);
  }
  function onStatus({ agent, status }) {
    if (status !== 'running' || !enabled(agent.id)) return;
    // A new run is observed, never launched, by the guardian.
    void store.update(agent.id, 'run_observed', current => current.settings.enabled ? { ...current, run: { ...current.run, phase: 'running', ownerId, lastSeq: agent.session.seq - 1 } } : undefined).catch(fail);
  }
  async function request(payload, next) {
    const config = await next();
    if (!enabled(payload.agent.id)) return config;
    try {
      await store.update(payload.agent.id, 'request_observed', current => current.settings.enabled ? { ...current, lastDecision: null, run: { ...current.run, phase: 'running', ownerId, turn: payload.turn, step: payload.step, lastSeq: payload.agent.session.seq - 1 }, retry: { ...current.retry, retryAt: null } } : undefined);
    } catch (error) { fail(error); }
    payload.signal.throwIfAborted();
    return config;
  }
  let disposal;
  function dispose() {
    if (disposal) return disposal;
    disposed = true; lifetime.abort();
    disposal = (async () => {
      await ready;
      try { await retries?.dispose(); }
      finally { try { await store?.close(); } finally { await lease?.close(); } }
    })();
    return disposal;
  }
  return { ready, snapshot, configure, startup, onProjection, onStatus, request, fail, dispose, enabled };
}

export async function readInput(request) {
  if (request.method !== 'POST') throw failure('post_required', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw failure('json_required', 415);
  if (Number(request.headers.get('content-length')) > 8192) throw failure('body_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw failure('json_required');
  let size = 0; const chunks = [];
  try {
    while (true) { request.signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); throw failure('body_too_large', 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!object(value)) throw failure('invalid_request'); return value; } catch { throw failure('invalid_json'); }
}
export function createFetchHandler(service, action) {
  return async request => {
    try {
      const input = await readInput(request);
      const keys = action === 'configure' ? ['sessionId', 'settings', 'epoch'] : action === 'startup' ? ['sessionId', 'enabled'] : ['sessionId'];
      if (Object.keys(input).some(key => !keys.includes(key))) throw failure('invalid_request');
      return Response.json(await service[action](input, request.signal), { headers: { 'cache-control': 'no-store' } });
    } catch (error) { return Response.json({ ok: false, error: error.code || 'operation_failed' }, { status: error.status || 500, headers: { 'cache-control': 'no-store' } }); }
  };
}
export function apply(ctx) {
  ctx.effect(() => ctx.sessionProjections.register({ key: LIFE, stateVersion: 1, stateSchema: jsonObjectSchema, init: createLifecycleState, apply: applyLifecycle, wire: { viewSchema: jsonObjectSchema, view: state => state } }));
  ctx.effect(() => ctx.sessionProjections.register({ key: QUESTIONS, stateVersion: 1, stateSchema: jsonObjectSchema, init: foldQuestions.init, apply: foldQuestions.apply, wire: { viewSchema: jsonObjectSchema, view: state => state } }));
  const service = createGuardianService(ctx);
  ctx.effect(() => () => service.dispose());
  ctx.on('agent/request', service.request, { prepend: true });
  ctx.on('agent/status', service.onStatus);
  ctx.effect(() => ctx.sessionProjections.onChanged((session, key, value) => { void service.onProjection(session, key, value).catch(service.fail); }));
  for (const action of ['snapshot', 'configure', 'startup']) ctx.effect(() => ctx.connection.fetch.register({ path: `/api/task-guardian/${action}`, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service, action) }));
  ctx.inject(['tools'], child => child.effect(() => child.tools.register({
    name: 'task_guardian_status', description: 'Read the calling session’s Task Guardian settings, retry schedule, question deadlines and recovery review. This read-only tool cannot enable authority, answer questions or resume tasks.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, isConcurrencySafe: () => true,
    execute: async (_args, exec) => service.snapshot({ sessionId: exec.agent.id }, exec.signal),
  })));
}
