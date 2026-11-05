import { randomUUID } from 'node:crypto';
import { acquireLease, createAlertStore, jsonObjectSchema } from './store.js';
import { ALERT_PROJECTION, createAlertState, applyAlertState, mergeNotice, visibleNotice } from './alerts.js';

// Package/route identity is retained so existing installations and unread records migrate in place.
export const name = 'dsh-task-guardian';
export const inject = ['connection', 'storageDomain', 'sessionProjections', 'sessionQuery', 'agents'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function failure(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
function sessionIdOf(input) {
  const id = input?.sessionId;
  if (typeof id !== 'string' || !id || id.length > 240 || /[\x00-\x1f]/.test(id)) throw failure('session_required');
  return id;
}

/** Observation and notification acknowledgement only: no model requests or agent control. */
export function createAlertsService(ctx, { now = Date.now, leaseFactory = acquireLease, storeFactory = createAlertStore } = {}) {
  const lifetime = new AbortController();
  const ownerId = randomUUID(), notices = new Map(), readBatches = new Map(), pending = new Set();
  let store, lease, disposed = false, fault = null, disposal;
  const cacheNotice = record => { if (record.notification) notices.set(record.sessionId, record.notification); };
  const writeRecord = async (id, kind, change) => { const record = await store.update(id, kind, change); cacheNotice(record); return record; };
  const fail = error => { fault = error?.code || 'alerts_unavailable'; ctx.logger?.warn?.('Task alerts unavailable:', error?.message || String(error)); };
  async function observe(id, callback) {
    const observed = await ctx.sessionQuery.observeSession(id, { signal: lifetime.signal });
    try { return await callback(observed); } finally { observed[Symbol.dispose](); }
  }
  async function recordAlertState(id, state) {
    if (!state || fault || !store?.healthy()) return;
    const current = store.get(id);
    if (!state.incident && !current.notification) return;
    if (state.seq <= (current.notificationSeq ?? -1) && current.notificationProjectionVersion === 2) return;
    let title;
    if (state.incident && state.incident.id !== current.notification?.id) {
      try { title = (await ctx.sessionQuery.readTitle(id, lifetime.signal))?.title; } catch { /* session identity is still available */ }
    }
    await writeRecord(id, 'notification_observed', record => state.seq <= (record.notificationSeq ?? -1) && record.notificationProjectionVersion === 2 ? undefined : ({ ...record,
      notificationProjectionVersion: 2, notificationSeq: state.seq,
      notification: mergeNotice(record.notification, state.incident ? { ...state.incident, ...(title ? { title } : {}) } : null),
    }));
  }
  const ready = (async () => {
    try {
      lease = await leaseFactory({ onLost: fail });
      if (disposed) return;
      store = await storeFactory(ctx.storageDomain, { ownerId, now });
      if (disposed) return;
      const records = store.list();
      records.forEach(cacheNotice);
      const ids = new Set([...records.map(record => record.sessionId), ...(ctx.agents.list?.() || []).map(agent => agent.id)]);
      for (const id of ids) {
        try { await observe(id, session => recordAlertState(id, session.projections?.values[ALERT_PROJECTION])); }
        catch { /* persisted notices remain available even if their session cannot be reopened */ }
        const notice = store.get(id).notification;
        if (notice?.state === 'retrying' && (notice.origin === 'guardian' || ctx.agents.get(id)?.status !== 'running')) {
          await writeRecord(id, 'notification_interrupted', current => current.notification?.state === 'retrying' ? { ...current,
            notification: { ...current.notification, id: `${current.notification.id}:restart`, kind: 'interrupted', state: 'failed',
              code: 'RETRY_INTERRUPTED', message: notice.origin === 'guardian' ? '自动守护已移除，原守护重试已停止；请查看会话确认任务进展。' : '重试等待已中断，请查看会话确认任务进展。',
              at: now(), updatedAt: now(), visibleAt: now(), nextRetryAt: null, acknowledged: false },
          } : undefined);
        }
      }
    } catch (error) { fail(error); }
  })();

  function onProjection(session, key, state) {
    if (disposed || key !== ALERT_PROJECTION) return Promise.resolve();
    const work = ready.then(() => recordAlertState(session.id, state));
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  async function alerts(input = {}) {
    await ready;
    await Promise.allSettled([...pending]);
    const offset = input.offset ?? 0, limit = input.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure('invalid_page');
    const at = now();
    const values = [...notices.values()].filter(item => visibleNotice(item, at)).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const readToken = randomUUID();
    readBatches.set(readToken, values.map(item => ({ sessionId: item.sessionId, id: item.id })));
    if (readBatches.size > 32) readBatches.delete(readBatches.keys().next().value);
    return { ok: true, mode: 'alerts-only', alerts: values.slice(offset, offset + limit).map(item => ({ ...item, title: item.title || item.sessionId })),
      total: values.length, hasMore: offset + limit < values.length, readToken,
      fault: fault || (store && !store.healthy() ? 'persistence_unavailable' : null), serverNow: at };
  }
  async function acknowledge(input) {
    const id = sessionIdOf(input);
    if (typeof input.alertId !== 'string' || !input.alertId || input.alertId.length > 512) throw failure('alert_required');
    await ready;
    if (disposed || fault || !store?.healthy()) throw failure('alerts_unavailable', 503);
    await writeRecord(id, 'notification_acknowledged', record => {
      if (record.notification?.id !== input.alertId) throw failure('alert_changed_reload', 409);
      return record.notification.acknowledged ? undefined : { ...record, notification: { ...record.notification, acknowledged: true, acknowledgedAt: now() } };
    });
    return { ok: true };
  }
  async function acknowledgeAll(input) {
    await ready;
    if (disposed || fault || !store?.healthy()) throw failure('alerts_unavailable', 503);
    const batch = readBatches.get(input?.readToken);
    if (!batch) throw failure('alerts_changed_reload', 409);
    let acknowledged = 0;
    for (const item of batch) {
      await writeRecord(item.sessionId, 'notification_acknowledged', record => {
        if (record.notification?.id !== item.id || record.notification.acknowledged) return undefined;
        acknowledged++;
        return { ...record, notification: { ...record.notification, acknowledged: true, acknowledgedAt: now() } };
      });
    }
    return { ok: true, acknowledged };
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true; lifetime.abort();
    disposal = (async () => {
      await ready;
      try { await Promise.allSettled([...pending]); }
      finally { try { await store?.close(); } finally { await lease?.close(); } }
      readBatches.clear();
    })();
    return disposal;
  }
  return { ready, alerts, acknowledge, acknowledgeAll, onProjection, fail, dispose };
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
const ROUTES = { alerts: ['offset', 'limit'], acknowledge: ['sessionId', 'alertId'], acknowledgeAll: ['readToken'] };
export function createFetchHandler(service, action) {
  return async request => {
    try {
      const input = await readInput(request), keys = ROUTES[action];
      if (!keys || Object.keys(input).some(key => !keys.includes(key))) throw failure('invalid_request');
      return Response.json(await service[action](input, request.signal), { headers: { 'cache-control': 'no-store' } });
    } catch (error) { return Response.json({ ok: false, error: error.code || 'operation_failed' }, { status: error.status || 500, headers: { 'cache-control': 'no-store' } }); }
  };
}
export function apply(ctx) {
  ctx.effect(() => ctx.sessionProjections.register({ key: ALERT_PROJECTION, stateVersion: 2, stateSchema: jsonObjectSchema, init: createAlertState, apply: applyAlertState, wire: { viewSchema: jsonObjectSchema, view: state => state } }));
  const service = createAlertsService(ctx);
  ctx.effect(() => () => service.dispose());
  ctx.effect(() => ctx.sessionProjections.onChanged((session, key, value) => { void service.onProjection(session, key, value).catch(service.fail); }));
  for (const action of Object.keys(ROUTES)) ctx.effect(() => ctx.connection.fetch.register({ path: `/api/task-guardian/${action}`, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service, action) }));
  ctx.inject(['tools'], child => child.effect(() => child.tools.register({
    name: 'task_guardian_alerts',
    description: 'List unread task interruptions across sessions, acknowledge one alert, or mark a listed snapshot read. Acknowledging hides notices; it does not stop or resume tasks.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'acknowledge', 'acknowledge_all'], description: 'Defaults to list.' },
      readToken: { type: 'string', description: 'Snapshot token from list; required for acknowledge_all. New interruptions are preserved.' },
      offset: { type: 'integer', minimum: 0, description: 'List offset; defaults to 0.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'List page size; defaults to 50.' },
      sessionId: { type: 'string', description: 'Session identity from the alert; required to acknowledge.' },
      alertId: { type: 'string', description: 'Exact alert identity from the list; required to acknowledge.' },
    }, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: args => !args.action || args.action === 'list',
    execute: async args => {
      if (!args.action || args.action === 'list') return service.alerts({ offset: args.offset ?? 0, limit: args.limit ?? 50 });
      if (args.action === 'acknowledge_all') return service.acknowledgeAll({ readToken: args.readToken });
      if (args.action === 'acknowledge') return service.acknowledge({ sessionId: args.sessionId, alertId: args.alertId });
      throw failure('invalid_action');
    },
  })));
}
