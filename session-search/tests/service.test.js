import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchService, LIMITS, semanticMessage } from '../lib/service.js';
import { apply, createFetchHandler, createTool } from '../lib/index.js';

const text = value => ({ type: 'text', text: value });
const user = (seq, value) => ({ type: 'user/message', seq, time: seq * 1000, data: { content: [text(value)] } });
const assistant = (seq, value, extras = []) => ({ type: 'assistant/message', seq, time: seq * 1000, data: { message: { content: [text(value), ...extras] } } });
const tool = (seq, value) => ({ type: 'tool/result', seq, time: seq * 1000, data: { message: { content: [text(value)] } } });
const system = (seq, value) => ({ type: 'system/message', seq, data: { message: { content: [text(value)] } } });
function fixture(sessions, { workspaces = [], archived = [], broken = [] } = {}) {
  const stats = { opened: 0, released: 0, listed: 0, titleReads: 0 };
  const store = new Map(sessions.map((session, i) => {
    const events = [...(session.events ?? [])];
    if (session.title !== undefined) events.push({ type: 'session/title', seq: (events.at(-1)?.seq ?? -1) + 1, time: 1234, data: { title: session.title, messageSeqs: [], source: { kind: 'user' } } });
    return [session.id, { header: { id: session.id, createdAt: session.createdAt ?? 1000 - i, cwd: '/ignored' }, events }];
  }));
  const sessionQuery = {
    async listSessions(signal) { signal?.throwIfAborted(); stats.listed++; return [...store.values()].map(value => ({ header: value.header, persisted: true, live: false })); },
    async readTitleSnapshot() {
      stats.titleReads++;
      throw new Error('Search must reuse observation events instead of rereading titles.');
    },
    async observeSession(id, { signal, projectionMode }) {
      signal?.throwIfAborted(); assert.equal(projectionMode, 'none');
      if (broken.includes(id)) throw Object.assign(new Error('Unreadable history'), { code: 'BROKEN_HISTORY' });
      const value = store.get(id);
      if (!value) throw Object.assign(new Error('Session absent'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' });
      stats.opened++;
      return { header: value.header, events: value.events, cursor: value.events.at(-1)?.seq ?? -1, [Symbol.dispose]() { stats.released++; } };
    },
  };
  const workspaceRegistry = { list: () => workspaces, archivedSessionIds: archived };
  return { service: createSearchService({ sessionQuery, workspaceRegistry }), sessionQuery, workspaceRegistry, stats, store };
}
async function collect(service, input) {
  const items = [];
  const warnings = [];
  let cursor;
  let pages = 0;
  let result;
  do {
    result = await service.search({ ...input, ...(cursor ? { cursor } : {}) });
    items.push(...result.items); warnings.push(...result.warnings);
    cursor = result.nextCursor;
    assert.ok(++pages < 1000, 'pagination must make progress');
  } while (cursor);
  return { items, warnings, pages, result };
}

const current = { mode: 'current', sessionId: 'a' };

test('literal Chinese substrings, mixed case, punctuation and code fragments retain correct offsets', async () => {
  const f = fixture([{ id: 'a', events: [user(1, '这是中文关键词。BRAID has Foo.bar(x) and a+b[0] / C:\\tmp'), assistant(9, '```js\nconst WeirdNAME = 2\n```')] }]);
  for (const query of ['中文关', 'raid', 'foo.bar(x)', 'a+b[0]', 'C:\\tmp', 'weirdname']) {
    const result = await f.service.search({ ...current, query });
    assert.equal(result.items.length, 1, query);
    const hit = result.items[0];
    assert.equal(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength).toLowerCase(), query.toLowerCase());
  }
  assert.equal((await f.service.search({ ...current, query: 'FooXbar' })).items.length, 0);
  assert.equal(f.stats.listed, 0, 'current searches do not enumerate all history');
  assert.equal(f.stats.titleReads, 0, 'current searches do not indirectly relist history through the title API');
  assert.equal(f.stats.opened, 7, 'each current search acquires exactly one observation');
  assert.equal(f.stats.opened, f.stats.released);
});

test('reasoning, system, provider fields, attachments and tool blocks are excluded by default', async () => {
  const events = [user(0, 'ordinary'), assistant(2, 'visible', [{ type: 'reasoning', text: 'hiddenneedle' }, { type: 'tool-call', arguments: 'hiddenneedle' }, { type: 'file', attachment: { name: 'hiddenneedle' } }]), system(3, 'hiddenneedle'), tool(4, 'hiddenneedle'), { type: 'tool/call', seq: 6, data: { name: 'bash', arguments: 'hiddenneedle' } }];
  const f = fixture([{ id: 'a', events }]);
  assert.equal((await f.service.search({ ...current, query: 'hiddenneedle' })).items.length, 0);
  const withTools = await f.service.search({ ...current, query: 'hiddenneedle', includeTools: true });
  assert.deepEqual(withTools.items.map(item => item.seq), [4, 6]);
  assert.ok(withTools.items.every(item => item.role === 'tool'));
  assert.equal(semanticMessage(events[1], true).text, 'visible');
  await assert.rejects(f.service.context({ sessionId: 'a', seq: 3, includeTools: true }), { code: 'MESSAGE_NOT_FOUND' });
  await assert.rejects(f.service.context({ sessionId: 'a', seq: 4 }), { code: 'MESSAGE_NOT_FOUND' });
});

test('all content returns every matching message across root and persisted sessions', async () => {
  const f = fixture([{ id: 'a', events: [user(1, 'find'), assistant(3, 'find')] }, { id: 'old', createdAt: 1, events: [user(100, 'find in old history')] }]);
  const result = await collect(f.service, { query: 'find', mode: 'all', limit: 1 });
  assert.deepEqual(result.items.map(hit => [hit.sessionId, hit.seq]), [['a', 1], ['a', 3], ['old', 100]]);
  assert.equal(result.result.complete, true);
  assert.equal(f.stats.opened, f.stats.released);
});

test('title mode uses current titles and latest renames without a stale cache', async () => {
  const f = fixture([{ id: 'a', title: '中文API设计', events: [user(1, 'unrelated')] }, { id: 'b', title: 'Other', events: [user(2, 'API')] }]);
  let result = await f.service.search({ query: 'api', mode: 'titles' });
  assert.deepEqual(result.items.map(item => item.sessionId), ['a']);
  assert.equal(result.items[0].kind, 'title');
  assert.equal(result.items[0].time, 1234);
  const events = f.store.get('a').events;
  events.push({ type: 'session/title', seq: events.at(-1).seq + 1, time: 100, data: { title: 'Renamed', messageSeqs: [], source: { kind: 'user' } } });
  result = await f.service.search({ query: 'api', mode: 'titles' });
  assert.equal(result.items.length, 0, 'last logged title wins even if its timestamp is earlier');
  assert.equal(f.stats.opened, 4, 'one observation per candidate per query');
  assert.equal(f.stats.released, 4);
  assert.equal(f.stats.listed, 2, 'one corpus listing per global query');
  assert.equal(f.stats.titleReads, 0);
});

test('workspace membership and global archive state filter sessions, including ungrouped archives', async () => {
  const f = fixture(['a', 'b', 'c', 'd'].map(id => ({ id, title: `Title ${id}`, events: [user(0, 'match')] })), { workspaces: [{ id: 'w', title: 'Work', sessionIds: ['a', 'b'] }], archived: ['b', 'c'] });
  assert.deepEqual((await f.service.search({ query: 'match', mode: 'all' })).items.map(item => item.sessionId), ['a', 'd']);
  const scoped = await f.service.search({ query: 'match', mode: 'all', workspaceId: 'w', includeArchived: true });
  assert.deepEqual(scoped.items.map(item => item.sessionId), ['a', 'b']);
  assert.equal(scoped.items[1].archived, true);
  assert.equal(scoped.items[0].workspaceTitle, 'Work');
  assert.equal((await f.service.search({ ...current, sessionId: 'b', query: 'match' })).items.length, 0);
  assert.equal((await f.service.search({ ...current, sessionId: 'b', query: 'match', includeArchived: true })).items.length, 1);
  await assert.rejects(f.service.search({ query: 'match', mode: 'all', workspaceId: 'missing' }), { code: 'WORKSPACE_NOT_FOUND' });
});

test('more than one session batch produces an empty continuation page and eventually finds the oldest hit', async () => {
  const sessions = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, events: [user(0, i === 69 ? 'needle' : 'other')] }));
  const f = fixture(sessions);
  const first = await f.service.search({ query: 'needle', mode: 'all' });
  assert.equal(first.items.length, 0);
  assert.equal(first.complete, false);
  assert.equal(first.scannedSessions, LIMITS.sessionsPerPage);
  assert.ok(first.nextCursor);
  const result = await collect(f.service, { query: 'needle', mode: 'all' });
  assert.equal(result.items[0].sessionId, 's69');
  assert.equal(result.result.scannedSessions, 70);
  assert.equal(result.result.totalSessions, 70);
});

test('long histories are searched beyond the raw-event page budget without dropped matches', async () => {
  const events = Array.from({ length: 8205 }, (_, i) => user(i * 2, i >= 8200 ? `needle ${i}` : 'other'));
  const f = fixture([{ id: 'a', events }]);
  const first = await f.service.search({ ...current, query: 'needle', limit: 2 });
  assert.equal(first.items.length, 0);
  assert.ok(first.nextCursor);
  const result = await collect(f.service, { ...current, query: 'needle', limit: 2 });
  assert.deepEqual(result.items.map(item => item.seq), [16400, 16402, 16404, 16406, 16408]);
  assert.equal(new Set(result.items.map(item => item.seq)).size, 5);
});

test('cursor validates query/filter identity and authenticity, permits page-size changes', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle'), user(2, 'needle'), user(4, 'needle')] }]);
  const first = await f.service.search({ ...current, query: 'needle', limit: 1 });
  for (const change of [{ query: 'different' }, { includeTools: true }, { includeArchived: true }]) {
    await assert.rejects(f.service.search({ ...current, query: 'needle', cursor: first.nextCursor, ...change }), { code: 'INVALID_CURSOR' });
  }
  await assert.rejects(f.service.search({ ...current, query: 'needle', cursor: `${first.nextCursor}x` }), { code: 'INVALID_CURSOR' });
  const second = await f.service.search({ ...current, query: 'needle', cursor: first.nextCursor, limit: 100 });
  assert.deepEqual(second.items.map(item => item.seq), [2, 4]);
});

test('changed session catalog returns an explicit stale cursor instead of skipping entries', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle')] }, { id: 'b', events: [user(0, 'needle')] }]);
  const first = await f.service.search({ query: 'needle', mode: 'all', limit: 1 });
  f.store.delete('a');
  await assert.rejects(f.service.search({ query: 'needle', mode: 'all', cursor: first.nextCursor }), { code: 'STALE_CURSOR' });
});

test('paged current search freezes its upper seq while a fresh search includes new messages', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle'), user(2, 'needle')] }]);
  const first = await f.service.search({ ...current, query: 'needle', limit: 1 });
  f.store.get('a').events.push(user(4, 'needle'));
  const second = await f.service.search({ ...current, query: 'needle', cursor: first.nextCursor });
  assert.deepEqual(second.items.map(item => item.seq), [2]);
  assert.deepEqual((await f.service.search({ ...current, query: 'needle' })).items.map(item => item.seq), [0, 2, 4]);
});

test('context selects semantic neighbors past many internal events and excludes hidden content', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'before'), ...Array.from({ length: 150 }, (_, i) => system(i + 1, 'secret')), assistant(151, 'target'), tool(152, 'tool secret'), user(153, 'after')] }]);
  const result = await f.service.context({ sessionId: 'a', seq: 151 });
  assert.deepEqual(result.items.map(item => item.seq), [0, 151, 153]);
  assert.ok(!JSON.stringify(result).includes('secret'));
  const withTools = await f.service.context({ sessionId: 'a', seq: 151, includeTools: true });
  assert.deepEqual(withTools.items.map(item => item.seq), [0, 151, 152, 153]);
  assert.equal(f.stats.opened, f.stats.released);
});

test('long target text is bounded, marks truncation and can be retrieved by nextOffset', async () => {
  const value = 'a'.repeat(19999) + '😀' + 'ending'.repeat(3000);
  const f = fixture([{ id: 'a', events: [user(0, value)] }]);
  const first = (await f.service.context({ sessionId: 'a', seq: 0 })).items[0];
  assert.ok(first.text.length <= LIMITS.contextChars);
  assert.equal(first.truncated, true);
  assert.equal(first.totalChars, value.length);
  const second = (await f.service.context({ sessionId: 'a', seq: 0, offset: first.nextOffset })).items[0];
  assert.equal(first.text + second.text, value);
  assert.equal(second.nextOffset, undefined);
});

test('snippet centers deep matches and carries their original message offset', async () => {
  const f = fixture([{ id: 'a', events: [user(0, '前'.repeat(10000) + 'Needle' + '后'.repeat(10000))] }]);
  const hit = (await f.service.search({ ...current, query: 'needle' })).items[0];
  assert.equal(hit.matchOffset, 10000);
  assert.ok(hit.snippet.length <= LIMITS.snippetChars + 2);
  assert.equal(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength), 'Needle');
});

test('malformed inputs fail before any data reads', async () => {
  const f = fixture([]);
  for (const input of [null, [], {}, { query: '' }, { query: '   ' }, { query: 'x'.repeat(513) }, { query: 'x', mode: 'bad' }, { query: 'x', mode: 'current' }, { query: 'x', mode: 'all', limit: 101 }, { query: 'x', mode: 'all', includeTools: 'false' }, { query: 'x', mode: 'all', extra: true }]) {
    await assert.rejects(f.service.search(input), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(f.service.context({ sessionId: 'a' }), { code: 'INVALID_REQUEST' });
  assert.equal(f.stats.opened + f.stats.listed, 0);
});

test('per-session global failures are explicit warnings while current failures propagate', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle')] }, { id: 'broken', events: [] }], { broken: ['broken'] });
  const result = await f.service.search({ mode: 'all', query: 'needle' });
  assert.equal(result.items.length, 1);
  assert.equal(result.warnings[0].code, 'BROKEN_HISTORY');
  await assert.rejects(f.service.search({ ...current, sessionId: 'broken', query: 'needle' }), { code: 'BROKEN_HISTORY' });
});

test('cancellation before and during a scan stops work and disposes observations', async () => {
  const f = fixture([{ id: 'a', events: Array.from({ length: 8000 }, (_, i) => user(i, 'other')) }]);
  await assert.rejects(f.service.search({ ...current, query: 'needle' }, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(f.stats.opened, 0);
  const controller = new AbortController();
  const pending = f.service.search({ ...current, query: 'needle' }, controller.signal);
  setImmediate(() => controller.abort());
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.stats.opened, f.stats.released);
});

function request(body, headers = { 'content-type': 'application/json' }) { return new Request('http://localhost/api/session-search/search', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }); }

test('HTTP route and model tool call the same operation with equivalent successful results', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle')] }]);
  const handler = createFetchHandler(f.service, 'search');
  const result = await handler(request({ ...current, query: 'needle' }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const toolDefinition = createTool(f.service);
  const value = await toolDefinition.execute({ action: 'search', query: 'needle' }, { agent: { id: 'a' }, signal: new AbortController().signal });
  assert.deepEqual(await result.json(), value);
  assert.equal(toolDefinition.isConcurrencySafe(), true);
  const context = await toolDefinition.execute({ action: 'context', sessionId: 'a', seq: 0 }, { signal: new AbortController().signal });
  assert.equal(context.items[0].text, 'needle');
});

test('model tool projects flat adapter placeholders for each action while HTTP stays strict', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle')] }]);
  const definition = createTool(f.service);
  const exec = { agent: { id: 'a' }, signal: new AbortController().signal };
  const flat = { action: 'search', query: 'needle', mode: 'current', sessionId: '', workspaceId: '', includeTools: false, includeArchived: false, cursor: '', limit: 40, seq: 0, offset: 0, length: 20000 };
  const result = await definition.execute(flat, exec);
  assert.deepEqual(result, await f.service.search({ ...current, query: 'needle', includeTools: false, includeArchived: false, limit: 40 }));
  assert.equal(flat.sessionId, '', 'caller arguments remain unchanged');
  const context = await definition.execute({ ...flat, action: 'context', query: '', sessionId: 'a' }, exec);
  assert.equal(context.items[0].text, 'needle');
  assert.equal((await definition.execute({ ...flat, mode: 'all' }, exec)).items.length, 1);
  await assert.rejects(definition.execute({ ...flat, unexpected: true }, exec), { code: 'INVALID_REQUEST' });
  await assert.rejects(definition.execute({ ...flat, action: 'invalid' }, exec), { code: 'INVALID_REQUEST' });
  const response = await createFetchHandler(f.service, 'search')(request({ ...current, query: 'needle', length: 20000 }));
  assert.equal(response.status, 400, 'HTTP still rejects known but irrelevant fields');
});

test('HTTP errors preserve explicit status/code and reject malformed or oversized bodies', async () => {
  const f = fixture([]);
  const handler = createFetchHandler(f.service, 'search');
  for (const [body, headers, expected, code] of [
    ['{', { 'content-type': 'application/json' }, 400, 'INVALID_JSON'],
    [{ query: 'x' }, { 'content-type': 'text/plain' }, 415, 'INVALID_CONTENT_TYPE'],
    ['x'.repeat(LIMITS.bodyBytes + 1), { 'content-type': 'application/json' }, 413, 'REQUEST_TOO_LARGE'],
    [{ query: 'x', mode: 'current' }, { 'content-type': 'application/json' }, 400, 'INVALID_REQUEST'],
    [{ ...current, query: 'x' }, { 'content-type': 'application/json' }, 404, 'SESSION_QUERY_SESSION_NOT_FOUND'],
  ]) {
    const response = await handler(request(body, headers));
    assert.equal(response.status, expected);
    assert.equal((await response.json()).error.code, code);
  }
});

test('tiny context windows still advance over Unicode characters and reject split offsets', async () => {
  const f = fixture([{ id: 'a', events: [user(0, '😀next')] }]);
  const first = (await f.service.context({ sessionId: 'a', seq: 0, length: 1 })).items[0];
  assert.equal(first.text, '😀');
  assert.equal(first.nextOffset, 2);
  await assert.rejects(f.service.context({ sessionId: 'a', seq: 0, offset: 1 }), { code: 'INVALID_REQUEST' });
});

test('request and plugin cancellation stop a pending streaming body read', async () => {
  for (const cancelRequest of [true, false]) {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const pendingRequest = new Request('http://localhost/api/session-search/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half', ...(cancelRequest ? { signal: controller.signal } : {}) });
    const handler = createFetchHandler({ search() { assert.fail('must not reach the service'); } }, 'search', cancelRequest ? undefined : controller.signal);
    const pending = handler(pendingRequest);
    controller.abort();
    const response = await pending;
    assert.equal(response.status, 499);
    assert.equal((await response.json()).error.code, 'ABORTED');
    assert.equal(cancelled, true);
  }
});

test('search hits preserve parent and origin so subagents differ from ordinary forks', async () => {
  const f = fixture([{ id: 'child', title: 'find me', events: [user(0, 'find me')] }]);
  Object.assign(f.store.get('child').header, { parentSession: 'parent', origin: 'subagent' });
  for (const mode of ['all', 'titles']) {
    const hit = (await f.service.search({ query: 'find', mode })).items[0];
    assert.equal(hit.parentSession, 'parent');
    assert.equal(hit.origin, 'subagent');
  }
  delete f.store.get('child').header.origin;
  const fork = (await f.service.search({ query: 'find', mode: 'all' })).items[0];
  assert.equal(fork.parentSession, 'parent');
  assert.equal(fork.origin, undefined);
});

test('plugin registers authenticated connection routes and cleans registrations and in-flight work on unload', async () => {
  const f = fixture([{ id: 'a', events: [user(0, 'needle')] }]);
  const effects = [];
  const routes = [];
  const tools = [];
  let disposed = 0;
  apply({ ...f, effect(callback) { effects.push(callback()); }, connection: { fetch: { register(route) { routes.push(route); return async () => { disposed++; }; } } }, tools: { register(definition) { tools.push(definition); return () => { disposed++; }; } } });
  assert.deepEqual(routes.map(route => route.path), ['/api/session-search/search', '/api/session-search/context']);
  assert.ok(routes.every(route => route.methods.join() === 'POST' && route.requestBody === 'streaming'));
  assert.equal(tools[0].name, 'session_find');
  const pending = routes[0].fetch(new Request('http://localhost/api/session-search/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new ReadableStream(), duplex: 'half' }));
  for (const dispose of [...effects].reverse()) await dispose();
  assert.equal((await pending).status, 499);
  assert.equal(disposed, 3);
  const result = await routes[0].fetch(request({ ...current, query: 'needle' }));
  assert.equal(result.status, 499);
});
