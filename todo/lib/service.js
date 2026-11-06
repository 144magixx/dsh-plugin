import { apply as applyMutation, counts, compareDue, fail, initialState, inView, localDate, MUTATIONS, stateSchema, VIEWS } from './core.js';

export const DOMAIN = 'dsh_todo';
export const MAX_BODY = 16384;
const TITLE_REFRESH_MS = 20000;
const READS = ['snapshot', 'revision'];

/**
 * Durable reminders behind one serialized write queue. Every request is a
 * finite JSON exchange: no stream is held open, so Host update draining is
 * never blocked by this plugin.
 */
export function createTodoService(ctx, { now = Date.now, defaultListName = '提醒事项' } = {}) {
  const lifetime = new AbortController();
  let closed = false, domain, queue = Promise.resolve(), titleGen = 0, titlesAt = 0, titleWork, readTitles;
  const titles = new Map();
  const ready = ctx.storageDomain.open({ name: DOMAIN, version: 1, layout: 'single', global: { schema: stateSchema, initial: initialState(0, defaultListName) }, tables: {} }).then(value => { domain = value; });
  void ready.catch(() => {});
  const snapshot = () => stateSchema.parse(domain.global.get());
  const token = state => `${state.revision}.${titleGen}`;
  const view = item => item.sessionId && titles.has(item.sessionId) ? { ...item, sessionTitle: titles.get(item.sessionId) } : item;

  /** Session titles change after creation (auto titles); refresh them lazily and cheaply. */
  function refreshTitles(state) {
    if (!readTitles || titleWork || now() - titlesAt < TITLE_REFRESH_MS) return;
    const ids = [...new Set(state.items.filter(item => item.sessionId).map(item => item.sessionId))].slice(0, 200);
    titlesAt = now();
    if (!ids.length) return;
    titleWork = readTitles(ids, lifetime.signal).then(values => {
      let changed = false;
      for (const [id, title] of values) if (typeof title === 'string' && title && titles.get(id) !== title) { titles.set(id, title.slice(0, 200)); changed = true; }
      if (changed && !closed) titleGen++;
    }).catch(() => {}).finally(() => { titleWork = undefined; });
  }
  async function titleOf(sessionId, signal) {
    if (!readTitles || !sessionId) return '';
    try { return (await readTitles([sessionId], signal)).get(sessionId)?.slice(0, 200) || ''; } catch { return ''; }
  }
  function change(input, signal) {
    const operation = queue.then(async () => {
      if (closed) throw fail('plugin_closed', 503);
      signal?.throwIfAborted();
      let payload = input;
      if (input.sessionId && input.sessionTitle === undefined && (input.action === 'create' || input.action === 'update')) {
        const title = await titleOf(input.sessionId, signal);
        payload = { ...input, sessionTitle: title };
        if (title) titles.set(input.sessionId, title);
      }
      const state = snapshot();
      const outcome = applyMutation(state, payload, { now: now() });
      if (outcome.changed) await domain.global.set(outcome.state);
      const next = outcome.changed ? outcome.state : state;
      return { ok: true, changed: outcome.changed, revision: next.revision, token: token(next), ...outcome.result };
    });
    queue = operation.catch(() => {});
    return operation;
  }
  async function execute(input, signal = lifetime.signal) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid_request');
    await ready;
    if (closed) throw fail('plugin_closed', 503);
    signal.throwIfAborted();
    if (READS.includes(input.action)) {
      if (Object.keys(input).length !== 1) throw fail('invalid_request');
      const state = snapshot();
      refreshTitles(state);
      if (input.action === 'revision') return { ok: true, revision: state.revision, token: token(state) };
      return { ok: true, revision: state.revision, token: token(state), lists: state.lists, items: state.items.map(view), serverNow: now() };
    }
    if (!MUTATIONS.includes(input.action)) throw fail('invalid_action');
    return change(input, signal);
  }

  /** Agent-facing reads use the Host's local calendar. */
  function query({ view: name = 'today', listId, query: search, includeCompleted = false, limit = 50 } = {}) {
    const state = snapshot(), today = localDate(now());
    if (listId !== undefined && !state.lists.some(list => list.id === listId)) throw fail('list_not_found', 404);
    if (!VIEWS.includes(name) && name !== 'list') throw fail('invalid_view');
    const needle = typeof search === 'string' ? search.trim().toLocaleLowerCase() : '';
    const items = state.items.filter(item => {
      if (listId !== undefined && item.listId !== listId) return false;
      if (needle && !`${item.title}\n${item.notes}`.toLocaleLowerCase().includes(needle)) return false;
      if (listId !== undefined || needle) return includeCompleted || !item.completed;
      return inView(item, name, today);
    }).sort(name === 'completed' ? (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) : compareDue);
    const names = new Map(state.lists.map(list => [list.id, list.name]));
    return {
      ok: true, today, total: items.length, counts: counts(state, today),
      items: items.slice(0, limit).map(item => ({ ...view(item), list: names.get(item.listId) })),
      lists: state.lists.map(list => ({ id: list.id, name: list.name, color: list.color })),
    };
  }
  return {
    ready, execute, query, change,
    snapshot: () => snapshot(),
    setTitleReader(reader) { readTitles = reader; titlesAt = 0; return () => { if (readTitles === reader) readTitles = undefined; }; },
    async dispose() { if (closed) return; closed = true; lifetime.abort(); await ready.catch(() => {}); await queue; await titleWork; await domain?.close(); titles.clear(); },
  };
}

export async function readInput(request) {
  if (request.method !== 'POST') throw fail('post_required', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw fail('json_required', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw fail('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw fail('invalid_request');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel().catch(() => {}); throw fail('request_too_large', 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('invalid_json'); }
}
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
export function createFetchHandler(service) {
  return async request => {
    try { return json(await service.execute(await readInput(request), request.signal)); }
    catch (error) { return json({ ok: false, error: error.code || 'operation_failed', message: error.message }, error.status || 500); }
  };
}
