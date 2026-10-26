import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigatorService, collectSummary, resolveConfig, validateCache } from '../lib/service.js';
import { readBody, routeHandler, watchHandler, createTool, apply } from '../lib/index.js';
import { projectionDefinition, foldProjection } from '../lib/core.js';

// Synthetic session data only. No provider credentials, network or live model.
const oldSummary = { recentTopic: '自由意志与道德责任', recentSummary: '讨论自由意志与道德责任的关系。', pastTopics: [] };
const newSummary = { recentTopic: '摄影与印象派的关系', recentSummary: '讨论摄影对印象派的影响，具体因果关系仍待澄清。', pastTopics: ['自由意志与道德责任'] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function within(promise, ms = 500, label = 'operation') {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function eventually(predicate, label, ms = 800) {
  const deadline = performance.now() + ms;
  while (!predicate()) {
    if (performance.now() > deadline) assert.fail(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
function controlledModel() {
  const calls = [];
  return {
    calls,
    stream(options) {
      const gate = deferred();
      const call = { options, gate, resolve: value => gate.resolve(value ?? newSummary), reject: gate.reject };
      calls.push(call);
      return (async function* () {
        // Deliberately ignores AbortSignal until the gate opens. The service's
        // own deadline must release its queue slot without waiting for this.
        const result = await gate.promise;
        yield { type: 'text-delta', index: 0, text: typeof result === 'string' ? result : JSON.stringify(result) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
}
function memoryTable(initial = []) {
  const records = new Map(initial.map(([id, value]) => [id, structuredClone(value)]));
  const writes = [];
  return {
    records, writes,
    get(id) { const value = records.get(id); return value ? structuredClone(value) : undefined; },
    async put(id, value) { const clone = structuredClone(validateCache(value)); records.set(id, clone); writes.push([id, clone]); },
  };
}
function user(seq, text) {
  return { type: 'user/message', seq, time: 1000 + seq, surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } };
}
function assistant(seq, text) {
  return { type: 'assistant/message', seq, time: 1000 + seq, surfaceOp: 'append', data: { turn: 1, step: 1, stream: [], message: { role: 'assistant', source: { kind: 'model', provider: 'synthetic', model: 'synthetic' }, content: [{ type: 'text', text }] } } };
}
const end = seq => ({ type: 'turn/end', seq, time: 1000 + seq, data: { turn: 1, reason: { kind: 'completed' } } });
function harness(t, { ids = ['s1'], config = {}, model = controlledModel(), table = memoryTable(), cold = false } = {}) {
  const sessions = new Map(), states = new Map(), histories = new Map();
  const observed = [], disposedObservations = [];
  for (const [index, id] of ids.entries()) {
    const header = { id, createdAt: 100 + index, isSeeded: false };
    const events = [user(0, '自由意志与道德责任有什么关系？'), { type: 'session/title', seq: 1, time: 1001, data: { title: `稳定标题-${id}`, messageSeqs: [0], source: { kind: 'user' } } }, assistant(2, '可以从选择和责任归属进行分析。'), end(3)];
    sessions.set(id, { id, header }); histories.set(id, events); states.set(id, foldProjection(events, header));
  }
  const ctx = {
    llm: model,
    sessions: { get: id => cold ? undefined : sessions.get(id) },
    sessionProjections: { stateOf(session, key) { assert.equal(key, projectionDefinition.key); return states.get(session.id); } },
    workspaceRegistry: { archivedSessionIds: [], list: () => [{ id: 'synthetic-workspace', title: '测试工作区', sessionIds: ids }] },
    sessionQuery: {
      async listSessions(signal) { signal?.throwIfAborted(); return [...sessions.values()].map(session => ({ header: session.header })); },
      async observeSession(id, { signal }) {
        signal?.throwIfAborted(); observed.push(id);
        const session = sessions.get(id); if (!session) throw new Error('Synthetic session not found');
        return { header: session.header, events: histories.get(id), inheritedEventCount: 0, [Symbol.dispose]() { disposedObservations.push(id); } };
      },
    },
  };
  const service = new NavigatorService(ctx, table, { autoSummarize: false, initialSummaries: 0, debounceMs: 0, timeoutMs: 2000, concurrency: 1, cooldownMs: 1000, ...config });
  t.after(async () => {
    await within(service.dispose(), 700, 'service disposal');
    for (const call of model.calls ?? []) call.resolve?.();
  });
  function append(id, event) {
    histories.get(id).push(event);
    states.set(id, foldProjection(histories.get(id), sessions.get(id).header));
    service.onProjection(sessions.get(id), projectionDefinition.key);
  }
  function question(id, text) { append(id, user(histories.get(id).at(-1).seq + 1, text)); }
  function finish(id, text = '这个问题仍需要进一步分析。') {
    append(id, assistant(histories.get(id).at(-1).seq + 1, text));
    append(id, end(histories.get(id).at(-1).seq + 1));
  }
  return { service, ctx, model, table, sessions, states, histories, observed, disposedObservations, question, finish };
}
function seededCache(state, extra = {}) {
  return validateCache({ ...oldSummary, summarySeq: state.sourceSeq, resetSeq: state.resetSeq, summaryUpdatedAt: 10, model: 'gpt-6-luna', ...extra });
}
async function idle(service) { await eventually(() => service.active.size === 0 && service.queue.size === 0 && service.timers.size === 0, 'idle summary queue'); }
function jsonRequest(value, options = {}) {
  return new Request('http://synthetic.invalid/api/session-navigator/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...options });
}

test('refresh returns queued immediately while the model remains unresolved, without renaming', async t => {
  const h = harness(t);
  const originalEvents = structuredClone(h.histories.get('s1'));
  const result = await within(h.service.refresh({ sessionId: 's1' }), 150, 'nonblocking refresh');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.item.latestQuestion, '自由意志与道德责任有什么关系？');
  await eventually(() => h.model.calls.length === 1, 'model invocation');
  assert.equal(h.service.row('s1').status, 'generating');
  h.model.calls[0].resolve();
  await idle(h.service);
  assert.equal(h.service.row('s1').recentTopic, newSummary.recentTopic);
  assert.equal(h.service.row('s1').title, '稳定标题-s1');
  assert.deepEqual(h.histories.get('s1'), originalEvents);
});

test('collectSummary enforces its own deadline when a model ignores abort', async () => {
  const model = controlledModel();
  const owner = new AbortController();
  const started = performance.now();
  await assert.rejects(within(collectSummary(model, {}, 30, owner.signal), 300, 'deadline'), error => error.code === 'summary-timeout');
  assert.ok(performance.now() - started < 300);
  assert.equal(model.calls[0].options.signal.aborted, true);
  model.calls[0].resolve();
  await tick();
});

test('a timed-out hanging model releases the service queue and its late output cannot publish', async t => {
  const h = harness(t, { ids: ['slow', 'next'], config: { timeoutMs: 100, concurrency: 1 } });
  await h.service.refresh({ sessionId: 'slow' });
  await h.service.refresh({ sessionId: 'next' });
  await eventually(() => h.model.calls.length === 2, 'next request after timeout', 600);
  assert.equal(h.model.calls[0].options.signal.aborted, true);
  h.model.calls[1].resolve();
  await idle(h.service);
  assert.equal(h.service.row('slow').status, 'error');
  assert.match(h.service.row('slow').error, /超时/u);
  assert.equal(h.service.row('slow').recentTopic, '');
  assert.equal(h.service.row('next').recentTopic, newSummary.recentTopic);
  h.model.calls[0].resolve(oldSummary);
  await tick();
  assert.equal(h.service.row('slow').recentTopic, '');
});

test('failed model retains the old summary alongside the new raw question', async t => {
  const h = harness(t);
  await h.table.put('s1', seededCache(h.states.get('s1')));
  h.question('s1', '换个话题：摄影如何影响印象派？');
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'model invocation');
  h.model.calls[0].reject(new Error('Synthetic provider unavailable'));
  await idle(h.service);
  const row = (await h.service.get({ sessionId: 's1' })).item;
  assert.equal(row.recentTopic, oldSummary.recentTopic);
  assert.equal(row.recentSummary, oldSummary.recentSummary);
  assert.equal(row.latestQuestion, '换个话题：摄影如何影响印象派？');
  assert.equal(row.summarySeq, 2);
  assert.ok(row.sourceSeq > row.summarySeq);
  assert.equal(row.status, 'error');
  assert.equal(row.title, '稳定标题-s1');
});

test('late output from an old snapshot cannot overwrite a newer user question', async t => {
  const h = harness(t);
  await h.table.put('s1', seededCache(h.states.get('s1')));
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'first request');
  h.question('s1', '艺术的新问题尚未回答');
  h.model.calls[0].resolve({ recentTopic: '已经过时的旧请求', recentSummary: '这是旧请求生成的结果。', pastTopics: [] });
  await idle(h.service);
  assert.equal(h.service.row('s1').recentTopic, oldSummary.recentTopic);
  assert.equal(h.service.row('s1').latestQuestion, '艺术的新问题尚未回答');
  assert.equal(h.table.get('s1').summarySeq, 2);
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 2, 'fresh request');
  h.model.calls[1].resolve();
  await idle(h.service);
  assert.equal(h.table.get('s1').summarySeq, h.states.get('s1').sourceSeq);
  assert.equal(h.service.row('s1').recentTopic, newSummary.recentTopic);
});

test('repeated explicit refreshes of one active snapshot coalesce into one model call', async t => {
  const h = harness(t);
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'first request');
  await Promise.all(Array.from({ length: 8 }, () => h.service.refresh({ sessionId: 's1' })));
  h.model.calls[0].resolve();
  await eventually(() => h.table.get('s1')?.recentTopic === newSummary.recentTopic, 'first result');
  await tick(); await tick();
  assert.equal(h.model.calls.length, 1, 'same active source snapshot must not be generated twice');
  await idle(h.service);
});

test('a genuinely newer snapshot requested during active work gets one follow-up', async t => {
  const h = harness(t);
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'first request');
  h.question('s1', '新的艺术话题');
  await h.service.refresh({ sessionId: 's1' });
  await h.service.refresh({ sessionId: 's1' });
  h.model.calls[0].resolve(oldSummary);
  await eventually(() => h.model.calls.length === 2, 'new snapshot request');
  const payload = JSON.parse(h.model.calls[1].options.messages[0].content[0].text);
  assert.equal(payload.latestQuestion, '新的艺术话题');
  h.model.calls[1].resolve();
  await idle(h.service);
  assert.equal(h.model.calls.length, 2);
  assert.equal(h.table.get('s1').summarySeq, h.states.get('s1').sourceSeq);
});

test('paused auto-generation stays idle but explicit refresh remains available', async t => {
  const h = harness(t, { config: { autoSummarize: true } });
  await h.service.pause({ sessionId: 's1', paused: true });
  h.question('s1', '解释艺术的表达方式'); h.finish('s1');
  await tick(); await tick();
  assert.equal(h.model.calls.length, 0);
  assert.equal(h.service.row('s1').paused, true);
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'manual refresh while paused');
  h.model.calls[0].resolve(); await idle(h.service);
  assert.equal(h.service.row('s1').paused, true);
  assert.equal(h.service.row('s1').recentTopic, newSummary.recentTopic);
});

test('list and hover/get read cached or raw details without any model call', async t => {
  const h = harness(t, { ids: ['s1', 's2'], cold: true, config: { autoSummarize: true, initialSummaries: 0 } });
  await h.service.start();
  const listed = await h.service.list({ query: '道德责任' });
  assert.equal(listed.items.length, 2);
  assert.equal(listed.items[0].recentTopic, '');
  await h.service.get({ sessionId: 's1' });
  await h.service.get({ sessionId: 's1' });
  await h.service.list();
  assert.equal(h.model.calls.length, 0);
  assert.deepEqual(h.observed.sort(), ['s1', 's2']);
  assert.deepEqual(h.disposedObservations.sort(), ['s1', 's2']);
});

test('repeated provider failures stop automatic work during cooldown but allow manual retry', async t => {
  const h = harness(t, { ids: ['a', 'b', 'c', 'd'], config: { autoSummarize: true, failureThreshold: 3, cooldownMs: 1000 } });
  await h.service.start();
  for (const [index, id] of ['a', 'b', 'c'].entries()) {
    h.question(id, `新的实质问题${index}`); h.finish(id);
    await eventually(() => h.model.calls.length === index + 1, 'automatic request');
    h.model.calls[index].reject(new Error('Synthetic provider failure'));
    await eventually(() => h.service.active.size === 0, 'failed request settlement');
  }
  assert.ok(h.service.cooldownUntil > Date.now());
  h.question('d', '另一个待概括问题'); h.finish('d');
  await tick(); await tick();
  assert.equal(h.model.calls.length, 3, 'automatic work must wait for cooldown');
  await h.service.refresh({ sessionId: 'd' });
  await eventually(() => h.model.calls.length === 4, 'manual retry bypassing cooldown');
  h.model.calls[3].resolve();
  await idle(h.service);
  assert.equal(h.service.row('d').recentTopic, newSummary.recentTopic);
});

test('unload cancels active/queued work promptly and refuses late publication', async t => {
  const h = harness(t, { ids: ['a', 'b'] });
  await h.service.refresh({ sessionId: 'a' });
  await h.service.refresh({ sessionId: 'b' });
  await eventually(() => h.model.calls.length === 1, 'active request');
  await within(h.service.dispose(), 200, 'unload');
  assert.equal(h.model.calls[0].options.signal.aborted, true);
  assert.equal(h.service.queue.size, 0);
  assert.equal(h.service.timers.size, 0);
  h.model.calls[0].resolve();
  await tick();
  assert.equal(h.model.calls.length, 1);
  assert.equal(h.table.get('a')?.recentTopic ?? '', '');
  await assert.rejects(h.service.list(), error => error.code === 'unloading' || error.name === 'AbortError');
});

test('summary, pause and visits survive reconstruction from persisted storage records', async t => {
  const original = harness(t);
  await original.service.refresh({ sessionId: 's1' });
  await eventually(() => original.model.calls.length === 1, 'model request');
  original.model.calls[0].resolve(); await idle(original.service);
  await original.service.touch({ sessionId: 's1' });
  await original.service.pause({ sessionId: 's1', paused: true });
  await original.service.dispose();
  // Round-trip through the storage value format, not original service memory.
  const persisted = JSON.parse(JSON.stringify([...original.table.records]));
  const restored = harness(t, { table: memoryTable(persisted), cold: true });
  const result = await restored.service.get({ sessionId: 's1' });
  assert.equal(result.item.recentTopic, newSummary.recentTopic);
  assert.equal(result.item.paused, true);
  assert.ok(result.item.lastVisitedAt > 0);
  assert.equal(result.item.title, '稳定标题-s1');
  assert.equal(result.item.status, 'ready');
  assert.equal(restored.model.calls.length, 0);
});

test('HTTP rejects wrong content types, malformed JSON and non-object bodies without invoking the model', async t => {
  const h = harness(t);
  const handler = routeHandler(h.service, 'refresh');
  for (const [body, contentType, status, code] of [
    ['{}', 'text/plain', 415, 'invalid-content-type'],
    ['{broken', 'application/json', 400, 'invalid-json'],
    ['null', 'application/json', 400, 'invalid-request'],
    ['[]', 'application/json', 400, 'invalid-request'],
    ['"text"', 'application/json', 400, 'invalid-request'],
    ['{}', 'application/json', 400, 'invalid-session'],
  ]) {
    const response = await handler(new Request('http://synthetic.invalid/', { method: 'POST', headers: { 'Content-Type': contentType }, body }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(h.model.calls.length, 0);
});

test('HTTP enforces 16KiB body limit both from headers and streamed bytes', async t => {
  const h = harness(t);
  const handler = routeHandler(h.service, 'refresh');
  const declared = await handler(jsonRequest({ sessionId: 's1' }, { headers: { 'Content-Type': 'application/json', 'Content-Length': '17000' } }));
  assert.equal(declared.status, 413);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(17000))); },
    cancel() { cancelled = true; },
  });
  const streamed = await handler(new Request('http://synthetic.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' }));
  assert.equal(streamed.status, 413);
  assert.equal((await streamed.json()).code, 'request-too-large');
  assert.equal(cancelled, true);
  assert.equal(h.model.calls.length, 0);
});

test('HTTP cancellation interrupts a stalled request body reader', async () => {
  const aborter = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const request = new Request('http://synthetic.invalid/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half', signal: aborter.signal });
  const reading = readBody(request, aborter.signal);
  aborter.abort();
  await assert.rejects(within(reading, 200, 'body abort'), error => error.name === 'AbortError');
  assert.equal(cancelled, true);
});

test('watch emits revisions and reader cancellation removes its listener', async t => {
  const h = harness(t);
  const response = await watchHandler(h.service)(jsonRequest({}));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  const reader = response.body.getReader();
  const initial = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal(initial.revision, h.service.revision);
  assert.equal(h.service.listeners.size, 1);
  h.service.changed('s1');
  const update = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal(update.sessionId, 's1');
  assert.equal(update.revision, initial.revision + 1);
  await reader.cancel();
  assert.equal(h.service.listeners.size, 0);
});

test('watch closes on request abort and plugin unload', async t => {
  const h = harness(t);
  const controller = new AbortController();
  const response = await watchHandler(h.service)(jsonRequest({}, { signal: controller.signal }));
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  assert.equal((await within(reader.read(), 200, 'watch abort')).done, true);
  assert.equal(h.service.listeners.size, 0);
  const second = await watchHandler(h.service)(jsonRequest({}));
  const secondReader = second.body.getReader(); await secondReader.read();
  await h.service.dispose();
  assert.equal((await within(secondReader.read(), 200, 'watch unload')).done, true);
  assert.equal(h.service.listeners.size, 0);
});

test('tool and HTTP adapters call the same service methods and preserve caller-session defaults', async t => {
  const h = harness(t);
  const calls = [];
  const originalGet = h.service.get.bind(h.service);
  h.service.get = async (args, signal) => { calls.push({ args, signal }); return originalGet(args, signal); };
  const tool = createTool(h.service);
  const fromTool = await tool.execute({ action: 'get' }, { agent: { id: 's1' }, signal: new AbortController().signal });
  const response = await routeHandler(h.service, 'get')(jsonRequest({ sessionId: 's1' }));
  assert.deepEqual(await response.json(), fromTool);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.args), [{ sessionId: 's1' }, { sessionId: 's1' }]);
  assert.ok(calls.every(c => c.signal instanceof AbortSignal));
  assert.equal(h.model.calls.length, 0);
  assert.throws(() => tool.execute({ action: 'rename' }, { agent: { id: 's1' } }), error => error.code === 'invalid-action');
  assert.deepEqual(tool.output.render({}, fromTool), [{ type: 'text', text: JSON.stringify(fromTool) }]);
});

test('plugin apply registers one shared service, projection, tool and streaming POST routes', async t => {
  const h = harness(t);
  const provided = new Map(), routes = [], tools = [], effects = [], registeredProjections = [], listeners = [];
  let domainClosed = false;
  Object.assign(h.ctx, {
    storageDomain: { async open() { return { table: () => h.table, async close() { domainClosed = true; } }; } },
    provide(key, value) { provided.set(key, value); },
    effect(factory) { effects.push(factory()); },
    connection: { fetch: { register(route) { routes.push(route); } } },
    tools: { register(tool) { tools.push(tool); } },
  });
  h.ctx.sessionProjections.register = definition => { registeredProjections.push(definition); };
  h.ctx.sessionProjections.onChanged = listener => { listeners.push(listener); };
  await apply(h.ctx, { autoSummarize: false, initialSummaries: 0 });
  const service = provided.get('sessionNavigator');
  t.after(async () => { for (const cleanup of effects.toReversed()) await cleanup(); });
  await service.ready;
  assert.ok(service instanceof NavigatorService);
  assert.deepEqual(registeredProjections, [projectionDefinition]);
  assert.equal(listeners.length, 1);
  assert.equal(routes.length, 6);
  assert.ok(routes.every(route => route.methods.length === 1 && route.methods[0] === 'POST' && route.requestBody === 'streaming'));
  const toolValue = await tools[0].execute({ action: 'get', sessionId: 's1' }, { agent: { id: 's1' } });
  const httpValue = await routes.find(route => route.path.endsWith('/get')).fetch(jsonRequest({ sessionId: 's1' }));
  assert.deepEqual(await httpValue.json(), toolValue);
  for (const cleanup of effects.toReversed()) await cleanup();
  assert.equal(service.closed, true);
  assert.equal(domainClosed, true);
});

test('full queue rejects extra manual work while raw session details remain readable', async t => {
  const h = harness(t, { ids: ['a', 'b', 'c'], config: { maxQueue: 1 } });
  await h.service.refresh({ sessionId: 'a' });
  await eventually(() => h.model.calls.length === 1, 'active request');
  await h.service.refresh({ sessionId: 'b' });
  const response = await routeHandler(h.service, 'refresh')(jsonRequest({ sessionId: 'c' }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'queue-full');
  assert.equal(h.service.queue.size, 1);
  const row = (await h.service.get({ sessionId: 'c' })).item;
  assert.equal(row.latestQuestion, '自由意志与道德责任有什么关系？');
  assert.equal(h.model.calls.length, 1);
  h.model.calls[0].resolve();
  await eventually(() => h.model.calls.length === 2, 'queued request');
  h.model.calls[1].resolve(); await idle(h.service);
  assert.equal(h.model.calls.length, 2);
});

test('newer-snapshot follow-ups cannot bypass the configured queue capacity', async t => {
  const h = harness(t, { ids: ['a', 'b'], config: { maxQueue: 1 } });
  await h.service.refresh({ sessionId: 'a' });
  await eventually(() => h.model.calls.length === 1, 'active request');
  await h.service.refresh({ sessionId: 'b' });
  h.question('a', 'A 的新问题必须仍可浏览');
  await assert.rejects(h.service.refresh({ sessionId: 'a' }), error => error.code === 'queue-full');
  assert.equal(h.service.queue.size, 1);
  assert.equal((await h.service.get({ sessionId: 'a' })).item.latestQuestion, 'A 的新问题必须仍可浏览');
});

test('automatic updates do not downgrade a queued explicit refresh', async t => {
  const h = harness(t, { config: { autoSummarize: true } });
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'active request');
  h.question('s1', '新的艺术问题');
  await h.service.refresh({ sessionId: 's1' });
  h.finish('s1', '新的回答需要概括。');
  assert.equal(h.service.queue.get('s1')?.force, true, 'automatic turn-end must preserve explicit refresh priority');
  h.model.calls[0].resolve(oldSummary);
  await eventually(() => h.model.calls.length === 2, 'explicit follow-up');
  h.model.calls[1].resolve(); await idle(h.service);
  assert.equal(h.service.row('s1').recentTopic, newSummary.recentTopic);
});

test('pause cancels active work and a subsequent explicit refresh is not lost', async t => {
  const h = harness(t);
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 1, 'active request');
  await h.service.pause({ sessionId: 's1', paused: true });
  assert.equal(h.model.calls[0].options.signal.aborted, true);
  await h.service.refresh({ sessionId: 's1' });
  await eventually(() => h.model.calls.length === 2, 'manual request after cancellation');
  h.model.calls[1].resolve(); await idle(h.service);
  h.model.calls[0].resolve(oldSummary); await tick();
  assert.equal(h.service.row('s1').recentTopic, newSummary.recentTopic);
  assert.equal(h.service.row('s1').paused, true);
});

test('configuration validates queue, timeout and cooldown bounds', () => {
  const defaults = resolveConfig();
  assert.equal(defaults.failureThreshold, 3);
  assert.equal(defaults.cooldownMs, 60000);
  assert.equal(defaults.maxQueue, 48);
  for (const value of [{ timeoutMs: 0 }, { failureThreshold: 0 }, { maxQueue: 0 }, { cooldownMs: 0 }, { unexpected: true }]) assert.throws(() => resolveConfig(value));
});
