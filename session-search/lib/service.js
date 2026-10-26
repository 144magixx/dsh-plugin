import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

export const LIMITS = Object.freeze({ queryChars: 512, pageSize: 100, sessionsPerPage: 24, eventsPerPage: 4000, snippetChars: 320, contextChars: 20000, neighborChars: 3000, bodyBytes: 16384 });
export class SearchError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'SearchError'; this.code = code; this.status = status; }
}
function fail(code, message, status) { throw new SearchError(code, message, status); }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST', 'Expected a JSON object.'); return value; }
function text(value, name, max = 256, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_REQUEST', `${name} must be non-empty text of at most ${max} characters.`);
  return value;
}
function bool(value, name) { if (value === undefined) return false; if (typeof value !== 'boolean') fail('INVALID_REQUEST', `${name} must be a boolean.`); return value; }
function integer(value, name, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_REQUEST', `${name} must be an integer from ${min} to ${max}.`);
  return value;
}
function keys(value, allowed) { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_REQUEST', `Unknown field: ${key}.`); }
function check(signal) { signal?.throwIfAborted(); }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('base64url'); }
function clip(value, limit) {
  let end = Math.min(value.length, limit);
  if (end < value.length && end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
  // A one-unit requested window must still advance over an astral character.
  if (end === 0 && limit > 0 && value.length >= 2) end = 2;
  return value.slice(0, end);
}
function plainBlocks(blocks) { return Array.isArray(blocks) ? blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : ''; }

/** Only visible semantic text; replay, reasoning, attachments and system content never enter results. */
export function semanticMessage(event, includeTools = false) {
  let role;
  let value;
  switch (event?.type) {
    case 'user/message': role = 'user'; value = plainBlocks(event.data?.content); break;
    case 'assistant/message': role = 'assistant'; value = plainBlocks(event.data?.message?.content); break;
    case 'tool/result':
      if (!includeTools) return undefined;
      role = 'tool'; value = plainBlocks(event.data?.message?.content); break;
    case 'tool/call':
      if (!includeTools) return undefined;
      role = 'tool'; value = [typeof event.data?.name === 'string' ? event.data.name : '', typeof event.data?.arguments === 'string' ? event.data.arguments : ''].filter(Boolean).join('\n'); break;
    default: return undefined;
  }
  if (!value || !Number.isSafeInteger(event.seq)) return undefined;
  return { seq: event.seq, time: Number.isFinite(event.time) ? event.time : 0, role, text: value };
}
function matcher(query) { return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'); }
function snippet(value, match) {
  let start = Math.max(0, match.index - 90);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start])) start--;
  const body = clip(value.slice(start), Math.max(LIMITS.snippetChars, match[0].length + 90));
  const prefix = start ? '…' : '';
  return { snippet: prefix + body + (start + body.length < value.length ? '…' : ''), matchStart: prefix.length + match.index - start, matchLength: match[0].length, matchOffset: match.index };
}
function searchRequest(input) {
  object(input);
  keys(input, ['query', 'mode', 'sessionId', 'workspaceId', 'includeTools', 'includeArchived', 'cursor', 'limit']);
  const query = text(input.query, 'query', LIMITS.queryChars, true).trim();
  const mode = input.mode ?? 'current';
  if (!['current', 'titles', 'all'].includes(mode)) fail('INVALID_REQUEST', 'mode must be current, titles, or all.');
  return { query, mode, sessionId: text(input.sessionId, 'sessionId', 256, mode === 'current'), workspaceId: text(input.workspaceId, 'workspaceId'), includeTools: bool(input.includeTools, 'includeTools'), includeArchived: bool(input.includeArchived, 'includeArchived'), cursor: text(input.cursor, 'cursor', 4096), limit: integer(input.limit, 'limit', 40, 1, LIMITS.pageSize) };
}
function cursorCodec() {
  const key = randomBytes(32);
  const sign = payload => createHmac('sha256', key).update(payload).digest();
  return {
    encode(state) { const payload = Buffer.from(JSON.stringify(state)).toString('base64url'); return `${payload}.${sign(payload).toString('base64url')}`; },
    decode(cursor) {
      try {
        const [payload, signature, extra] = cursor.split('.');
        if (!payload || !signature || extra) throw new Error();
        const actual = Buffer.from(signature, 'base64url');
        const expected = sign(payload);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
        const state = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (state.v !== 1 || !Number.isSafeInteger(state.index) || state.index < 0 || !Number.isSafeInteger(state.seq) || state.seq < -1 || !Number.isSafeInteger(state.scanned) || state.scanned < 0) throw new Error();
        return state;
      } catch { fail('INVALID_CURSOR', 'Search cursor is invalid or belongs to a previous plugin instance. Start a new search.'); }
    },
  };
}
function metadata(registry) {
  const workspaces = registry.list();
  const bySession = new Map();
  for (const workspace of workspaces) for (const id of workspace.sessionIds) bySession.set(id, { workspaceId: workspace.id, workspaceTitle: clip(workspace.title, 512) });
  return { workspaces, bySession, archived: new Set(registry.archivedSessionIds) };
}
// Mirrors dsh-session-title foldSessionTitle: the last session/title event is authoritative.
// Reading it from an existing observation avoids the title API's separate corpus listing and log read.
function latestTitle(events) {
  const event = events.findLast(item => item.type === 'session/title');
  return event ? { title: event.data.title, updatedAt: event.time } : undefined;
}
function itemMeta(header, title, meta) {
  return {
    sessionId: header.id,
    title: clip(title || header.id, 1024),
    ...meta.bySession.get(header.id),
    archived: meta.archived.has(header.id),
    ...(header.parentSession ? { parentSession: header.parentSession } : {}),
    ...(header.origin ? { origin: header.origin } : {}),
  };
}
function warning(sessionId, error) { return { sessionId, code: typeof error?.code === 'string' ? error.code : 'SESSION_READ_FAILED', message: clip(error instanceof Error ? error.message : String(error), 500) }; }

/** Shared read-only operation owner. No persistent caches or session writes. */
export function createSearchService({ sessionQuery, workspaceRegistry }) {
  const codec = cursorCodec();
  async function search(input, signal) {
    const request = searchRequest(input);
    check(signal);
    const meta = metadata(workspaceRegistry);
    if (request.workspaceId && !meta.workspaces.some(workspace => workspace.id === request.workspaceId)) fail('WORKSPACE_NOT_FOUND', 'The selected workspace no longer exists.', 404);
    let records;
    if (request.mode === 'current') records = [{ header: { id: request.sessionId } }];
    else {
      records = (await sessionQuery.listSessions(signal)).filter(record => (!request.workspaceId || meta.bySession.get(record.header.id)?.workspaceId === request.workspaceId) && (request.includeArchived || !meta.archived.has(record.header.id)));
      records.sort((a, b) => b.header.createdAt - a.header.createdAt || (a.header.id < b.header.id ? -1 : a.header.id > b.header.id ? 1 : 0));
    }
    check(signal);
    const fingerprint = digest({ query: request.query, mode: request.mode, sessionId: request.mode === 'current' ? request.sessionId : null, workspaceId: request.workspaceId, includeTools: request.includeTools, includeArchived: request.includeArchived });
    const catalog = digest(records.map(record => [record.header.id, record.header.createdAt]));
    const state = request.cursor ? codec.decode(request.cursor) : { v: 1, fingerprint, catalog, index: 0, seq: -1, scanned: 0 };
    if (state.fingerprint !== fingerprint) fail('INVALID_CURSOR', 'Search filters changed. Start a new search.');
    if (state.catalog !== catalog) fail('STALE_CURSOR', 'The session list changed. Start a new search.', 409);
    if (state.index > records.length) fail('INVALID_CURSOR', 'Search cursor is outside this result set.');
    const find = matcher(request.query);
    const items = [];
    const warnings = [];
    let opened = 0;
    let visited = 0;
    while (state.index < records.length && items.length < request.limit && opened < LIMITS.sessionsPerPage && visited < LIMITS.eventsPerPage) {
      check(signal);
      const id = records[state.index].header.id;
      if (request.mode === 'current' && ((request.workspaceId && meta.bySession.get(id)?.workspaceId !== request.workspaceId) || (!request.includeArchived && meta.archived.has(id)))) { state.index++; state.scanned++; continue; }
      opened++;
      try {
        const observation = await sessionQuery.observeSession(id, { signal, projectionMode: 'none' });
        try {
          check(signal);
          const events = observation.events;
          if (request.mode === 'titles') {
            const snapshot = latestTitle(events);
            const title = snapshot?.title || id;
            const match = find.exec(title);
            if (match) items.push({ ...itemMeta(observation.header, title, meta), time: snapshot?.updatedAt ?? observation.header.createdAt ?? 0, kind: 'title', ...snippet(title, match) });
            state.index++; state.seq = -1; state.scanned++; continue;
          }
          // New events appear on a fresh search; a paged conversation keeps its initial upper boundary.
          const upper = state.upper ?? observation.cursor;
          let title;
          let exhausted = true;
          for (let at = lowerBound(events, state.seq + 1); at < events.length; at++) {
            const event = events[at];
            if (event.seq > upper) break;
            if (items.length >= request.limit || visited >= LIMITS.eventsPerPage) { exhausted = false; break; }
            if (visited % 128 === 0) { await yieldToLoop(); check(signal); }
            visited++;
            state.seq = event.seq;
            const message = semanticMessage(event, request.includeTools);
            if (!message) continue;
            const match = find.exec(message.text);
            if (!match) continue;
            title ??= latestTitle(events)?.title || id;
            items.push({ ...itemMeta(observation.header, title, meta), seq: message.seq, time: message.time, role: message.role, kind: 'message', ...snippet(message.text, match) });
          }
          if (exhausted) { state.index++; state.seq = -1; delete state.upper; state.scanned++; }
          else { state.upper = upper; break; }
        } finally { observation[Symbol.dispose](); }
      } catch (error) {
        check(signal);
        if (request.mode === 'current') throw error;
        warnings.push(warning(id, error));
        state.index++; state.seq = -1; delete state.upper; state.scanned++;
      }
    }
    check(signal);
    const next = state.index < records.length ? codec.encode(state) : undefined;
    return { ok: true, items, ...(next ? { nextCursor: next } : {}), complete: !next, scannedSessions: state.scanned, totalSessions: records.length, warnings };
  }
  async function context(input, signal) {
    object(input);
    keys(input, ['sessionId', 'seq', 'includeTools', 'offset', 'length']);
    const sessionId = text(input.sessionId, 'sessionId', 256, true);
    const seq = integer(input.seq, 'seq', undefined, 0, Number.MAX_SAFE_INTEGER);
    if (seq === undefined) fail('INVALID_REQUEST', 'seq is required.');
    const includeTools = bool(input.includeTools, 'includeTools');
    const offset = integer(input.offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
    const length = integer(input.length, 'length', LIMITS.contextChars, 1, LIMITS.contextChars);
    check(signal);
    const observation = await sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' });
    try {
      check(signal);
      const events = observation.events;
      const at = lowerBound(events, seq);
      const target = events[at]?.seq === seq ? semanticMessage(events[at], includeTools) : undefined;
      if (!target) fail('MESSAGE_NOT_FOUND', 'This event is absent or outside the selected message types.', 404);
      if (offset > target.text.length) fail('INVALID_REQUEST', 'offset exceeds the target message length.');
      if (offset > 0 && /[\uD800-\uDBFF]/.test(target.text[offset - 1]) && /[\uDC00-\uDFFF]/.test(target.text[offset] ?? '')) fail('INVALID_REQUEST', 'offset splits a Unicode character; use the returned nextOffset.');
      const before = [];
      const after = [];
      for (let i = at - 1; i >= 0 && before.length < 2; i--) {
        if (i % 128 === 0) { await yieldToLoop(); check(signal); }
        const message = semanticMessage(events[i], includeTools);
        if (message) before.unshift(message);
      }
      for (let i = at + 1; i < events.length && after.length < 2; i++) {
        if (i % 128 === 0) { await yieldToLoop(); check(signal); }
        const message = semanticMessage(events[i], includeTools);
        if (message) after.push(message);
      }
      const items = [...before, target, ...after].map(message => {
        const start = message.seq === seq ? offset : 0;
        const value = clip(message.text.slice(start), message.seq === seq ? length : LIMITS.neighborChars);
        return { seq: message.seq, time: message.time, role: message.role, text: value, offset: start, totalChars: message.text.length, truncated: start > 0 || start + value.length < message.text.length, ...(start + value.length < message.text.length ? { nextOffset: start + value.length } : {}) };
      });
      check(signal);
      return { ok: true, sessionId, targetSeq: seq, items };
    } finally { observation[Symbol.dispose](); }
  }
  return { search, context };
}
function lowerBound(events, seq) {
  let low = 0;
  let high = events.length;
  while (low < high) { const middle = (low + high) >>> 1; if (events[middle].seq < seq) low = middle + 1; else high = middle; }
  return low;
}
export function errorResult(error) {
  const aborted = error?.name === 'AbortError';
  return { ok: false, error: { code: aborted ? 'ABORTED' : typeof error?.code === 'string' ? error.code : 'SEARCH_FAILED', message: clip(aborted ? 'Search cancelled.' : error instanceof Error ? error.message : String(error), 1000) } };
}
