import { createHash, randomUUID } from 'node:crypto';
import { ATTENTION_KEY, attentionFor } from './attention.js';

export function fail(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 240 && !/[\x00-\x1f]/.test(id);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validItem = item => object(item) && validId(item.sessionId) && typeof item.title === 'string' && typeof item.cwd === 'string' && Number.isFinite(item.addedAt) && (item.seenSeq === undefined || Number.isSafeInteger(item.seenSeq) && item.seenSeq >= -1);
export const stateSchema = {
  parse(value) {
    if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.items) || value.items.length > 200 || !value.items.every(validItem) || new Set(value.items.map(item => item.sessionId)).size !== value.items.length) throw fail('invalid_stored_favorites', 500);
    return structuredClone(value);
  },
  safeParse(value) { try { return { success: true, data: this.parse(value) }; } catch (error) { return { success: false, error }; } },
};
export const INITIAL = { version: 1, revision: 0, items: [] };
export function validate(input) {
  if (!object(input) || !['list', 'search', 'add', 'remove', 'seen'].includes(input.action)) throw fail('invalid_action');
  const allowed = ['action', 'query', 'offset', 'limit', 'sessionId', 'throughSeq'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw fail('invalid_request');
  if (['add', 'remove', 'seen'].includes(input.action) && !validId(input.sessionId)) throw fail('invalid_session_id');
  if (input.action === 'seen' && (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < -1)) throw fail('invalid_cursor');
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw fail('invalid_query');
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw fail('invalid_offset');
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50)) throw fail('invalid_limit');
  return input;
}

// Keep every HTTP response comfortably below desktop's 10s update drain.
export const WATCH_DURATION_MS = 2500;

/** One queued frame plus one coalesced frame; no unbounded event backlog. */
export function createChangeStream({ signal, subscribe, initial, durationMs = WATCH_DURATION_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const encoder = new TextEncoder();
  let cleanup = () => {}, flush = () => {};
  return new ReadableStream({
    start(controller) {
      let ended = false, pending, timer, bytes = 0, unsubscribe = () => {};
      const enqueue = frame => {
        const chunk = encoder.encode(`${JSON.stringify(frame)}\n`);
        // Bound total output too, so a noisy subscription cannot fill the bridge.
        if (bytes + chunk.byteLength > 4096) { cleanup(); return; }
        bytes += chunk.byteLength; controller.enqueue(chunk);
      };
      const send = frame => {
        if (ended) return;
        if (controller.desiredSize > 0) enqueue(frame);
        else pending = { ...frame, activity: !!(pending?.activity || frame.activity) };
      };
      cleanup = () => {
        if (ended) return;
        ended = true; pending = undefined;
        clearTimer(timer); unsubscribe(); signal.removeEventListener('abort', cleanup);
        try { controller.close(); } catch {}
      };
      // pull is installed before any consumer can start reading.
      flush = () => { if (!ended && pending && controller.desiredSize > 0) { const frame = pending; pending = undefined; enqueue(frame); } };
      if (signal.aborted) return cleanup();
      unsubscribe = subscribe(send);
      signal.addEventListener('abort', cleanup, { once: true });
      timer = setTimer(cleanup, durationMs);
      send(initial);
    },
    pull() { flush(); },
    cancel() { cleanup(); },
  }, { highWaterMark: 1 });
}

/** Favorites and read receipts are independent from native pins and session logs. */
export function createFavoritesService(ctx, { profile = process.env.DSH_PROFILE_DIR || process.env.DSH_PROFILE || 'default', now = Date.now } = {}) {
  const domainName = `session_favorites_${createHash('sha256').update(profile).digest('hex').slice(0, 12)}`;
  const lifetime = new AbortController(), subscribers = new Set(), liveQuestions = new Map(), epoch = randomUUID();
  let closed = false, domain, queue = Promise.resolve(), catalogCache, catalogUntil = 0, cursor = 0;
  const ready = ctx.storageDomain.open({ name: domainName, version: 1, layout: 'single', global: { schema: stateSchema, initial: INITIAL }, tables: {} }).then(value => { domain = value; });
  void ready.catch(() => {});
  const snapshot = () => stateSchema.parse(domain.global.get());
  const publish = frame => { const update = { ...frame, cursor: `${epoch}:${++cursor}` }; for (const callback of subscribers) { try { callback(update); } catch {} } };
  function notify(sessionId) {
    if (closed || !domain) return;
    const state = snapshot();
    if (state.items.some(item => item.sessionId === sessionId)) publish({ revision: state.revision, activity: true, sessionId });
  }
  function beginQuestion(sessionId) {
    const token = Symbol('question');
    const tokens = liveQuestions.get(sessionId) || new Set(); tokens.add(token); liveQuestions.set(sessionId, tokens); notify(sessionId);
    return () => { tokens.delete(token); if (!tokens.size) liveQuestions.delete(sessionId); notify(sessionId); };
  }
  const workspaceLabels = () => new Map((ctx.workspaceRegistry?.list() || []).flatMap(workspace => workspace.sessionIds.map(id => [id, workspace.title])));
  const metadata = (observation, labels) => ({ sessionId: observation.session.id, title: observation.title?.title || '', cwd: observation.session.cwd || '', workspace: labels.get(observation.session.id) || '' });
  async function statusOf(sessionId, signal) {
    const observed = await ctx.sessionQuery.observeSession(sessionId, { signal });
    try {
      const state = observed.projections?.values?.[ATTENTION_KEY];
      if (!state) throw fail('status_unavailable', 503);
      const questions = observed.projections?.values?.userQuestions?.active || [];
      const running = state.running && !!ctx.agents.get(sessionId);
      return { completedSeq: state.completedSeq, completedAt: state.completedAt, running,
        question: !!liveQuestions.get(sessionId)?.size || questions.some(question => question.state === 'open' || question.state === 'continued') || running && state.openQuestions.length > 0 };
    } finally { observed[Symbol.dispose](); }
  }
  async function catalog(signal) {
    if (catalogCache && now() < catalogUntil) return catalogCache;
    const records = (await ctx.sessionQuery.listSessions(signal)).filter(record => record.header.origin !== 'subagent');
    const titles = await ctx.sessionQuery.readTitleSnapshots(records.map(record => record.header.id), signal);
    const labels = workspaceLabels();
    const values = titles.filter(result => result.status === 'fulfilled').map(result => metadata(result.value, labels));
    catalogCache = values; catalogUntil = now() + 5000;
    return values;
  }
  async function list(signal) {
    const state = snapshot();
    const titles = state.items.length ? await ctx.sessionQuery.readTitleSnapshots(state.items.map(item => item.sessionId), signal) : [];
    const byId = new Map(titles.map(result => [result.sessionId, result]));
    const labels = workspaceLabels();
    const items = await Promise.all(state.items.map(async item => {
      const result = byId.get(item.sessionId); let status;
      try { status = await statusOf(item.sessionId, signal); } catch { signal?.throwIfAborted(); }
      const view = result?.status === 'fulfilled' ? { ...item, ...metadata(result.value, labels), unavailable: false } : { ...item, workspace: labels.get(item.sessionId) || '', unavailable: true };
      return { ...view, ...attentionFor(item, status) };
    }));
    return { ok: true, revision: state.revision, items };
  }
  function change(input, signal) {
    const operation = queue.then(async () => {
      if (closed) throw fail('plugin_closed', 503);
      signal?.throwIfAborted();
      const state = snapshot();
      const existing = state.items.find(item => item.sessionId === input.sessionId);
      if (input.action === 'add' && existing || ['remove', 'seen'].includes(input.action) && !existing) return { ok: true, changed: false, revision: state.revision, items: state.items };
      let items;
      if (input.action === 'add') {
        if (state.items.length >= 200) throw fail('favorites_limit');
        const observed = await ctx.sessionQuery.readTitleSnapshot(input.sessionId, signal);
        if (observed.session.origin === 'subagent') throw fail('ordinary_sessions_only');
        const status = await statusOf(input.sessionId, signal);
        signal?.throwIfAborted();
        items = [...state.items, { sessionId: input.sessionId, title: observed.title?.title || '', cwd: observed.session.cwd || '', addedAt: now(), seenSeq: status.completedSeq }];
      } else if (input.action === 'seen') {
        const status = await statusOf(input.sessionId, signal);
        // Acknowledging a displayed result must never swallow a newer completion.
        const seenSeq = Math.max(existing.seenSeq ?? -1, Math.min(input.throughSeq, status.completedSeq));
        if (seenSeq === (existing.seenSeq ?? -1)) return { ok: true, changed: false, revision: state.revision, items: state.items };
        items = state.items.map(item => item.sessionId === input.sessionId ? { ...item, seenSeq } : item);
      } else items = state.items.filter(item => item.sessionId !== input.sessionId);
      const next = stateSchema.parse({ version: 1, revision: state.revision + 1, items });
      await domain.global.set(next);
      publish({ revision: next.revision });
      return { ok: true, changed: true, revision: next.revision, items: next.items };
    });
    queue = operation.catch(() => {});
    return operation;
  }
  async function execute(raw, signal = lifetime.signal) {
    const input = validate(raw);
    await ready;
    if (closed) throw fail('plugin_closed', 503);
    signal.throwIfAborted();
    if (input.action === 'list') return list(signal);
    if (input.action === 'search') {
      const query = (input.query || '').trim().toLocaleLowerCase();
      const results = (await catalog(signal)).filter(item => !query || `${item.title}\n${item.cwd}\n${item.workspace}\n${item.sessionId}`.toLocaleLowerCase().includes(query));
      const offset = input.offset || 0, limit = input.limit || 30;
      const selected = new Set(snapshot().items.map(item => item.sessionId));
      return { ok: true, items: results.slice(offset, offset + limit).map(item => ({ ...item, favorite: selected.has(item.sessionId) })), total: results.length, nextOffset: offset + limit < results.length ? offset + limit : null };
    }
    return change(input, signal);
  }
  return {
    ready, execute, notify, beginQuestion,
    async watch(requestSignal) {
      const deadline = performance.now() + WATCH_DURATION_MS;
      if (closed) throw fail('plugin_closed', 503);
      const signal = AbortSignal.any([requestSignal, lifetime.signal]);
      signal.throwIfAborted();
      // Initialization must share the HTTP request's deadline as well.
      try {
        await new Promise((resolve, reject) => {
          const finish = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
          const abort = () => finish(signal.reason);
          const timer = setTimeout(() => finish(fail('watch_timeout', 503)), WATCH_DURATION_MS);
          signal.addEventListener('abort', abort, { once: true });
          ready.then(() => finish(), finish);
        });
      } catch (error) {
        if (error.code !== 'watch_timeout') throw error;
        return Response.json({ ok: false, error: 'watch_timeout' }, { status: 503, headers: { 'cache-control': 'no-store' } });
      }
      if (closed) throw fail('plugin_closed', 503);
      const stream = createChangeStream({
        signal,
        durationMs: Math.max(0, deadline - performance.now()),
        initial: { revision: snapshot().revision, cursor: `${epoch}:${cursor}` },
        subscribe(send) { subscribers.add(send); return () => subscribers.delete(send); },
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
    },
    async dispose() { if (closed) return; closed = true; lifetime.abort(); await ready.catch(() => {}); await queue; await domain?.close(); subscribers.clear(); liveQuestions.clear(); },
  };
}

export async function readInput(request) {
  if (request.method !== 'POST') throw fail('post_required', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw fail('json_required', 415);
  const reader = request.body?.getReader(); if (!reader) throw fail('invalid_request');
  const chunks = []; let bytes = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 4096) { await reader.cancel(); throw fail('request_too_large', 413); } chunks.push(next.value); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('invalid_json'); }
}
export function createFetchHandler(service) {
  return async request => {
    try { return Response.json(await service.execute(await readInput(request), request.signal), { headers: { 'cache-control': 'no-store' } }); }
    catch (error) { return Response.json({ ok: false, error: error.code || 'operation_failed', message: error.message }, { status: error.status || 500, headers: { 'cache-control': 'no-store' } }); }
  };
}
