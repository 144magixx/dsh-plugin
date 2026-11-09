import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './client-harness.js';

const settle = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const row = id => ({ sessionId: id, title: id, sourceSeq: 1, summarySeq: 1 });
const page = () => ({ ok: true, items: [row('a')], total: 1, workspaces: [] });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
const frame = value => new TextEncoder().encode(JSON.stringify(value) + '\n');
function streamResponse(values, { live = false, onCancel = () => {} } = {}) {
  let control;
  const body = new ReadableStream({ start(controller) { control = controller; for (const value of values) controller.enqueue(frame(value)); if (!live) controller.close(); }, cancel: onCancel });
  return { ok: true, body, control };
}
// Fake only the client's timers, leaving stream scheduling native. This tests
// 15-second backoff bounds without waiting minutes or exposing production knobs.
function harness() {
  let time = 0, nextId = 0;
  const timers = new Map();
  const clock = {
    timers,
    setTimeout(callback, delay = 0) { const id = ++nextId; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    nextDelay() { return Math.min(...[...timers.values()].map(timer => timer.at - time)); },
    async advance(ms) {
      const target = time + ms;
      for (let count = 0; ; count++) {
        if (count > 1000) assert.fail('Client timer loop');
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      time = target; await settle();
    },
  };
  return { clock, create: loadClient(clock).createController };
}

test('normal EOF rotates without error, duplicate refresh or model actions', async () => {
  const { clock, create } = harness();
  const actions = [], states = [];
  let fetches = 0;
  const api = create({
    request: async action => { actions.push(action); return action === 'list' ? page() : { ok: true, item: row('a') }; },
    fetchImpl: async () => { fetches++; return streamResponse([{ revision: 7, epoch: 'one' }]); }, navigate() {}, debounceMs: 0,
  });
  api.subscribe(() => states.push(api.getSnapshot().watchState));
  api.activate(); await api.start(); await clock.advance(0);
  const baseline = [...actions];
  for (let rotation = 0; rotation < 5; rotation++) {
    await clock.advance(100);
    assert.equal(api.getSnapshot().watchState, 'connected');
    assert.equal(api.getSnapshot().watchError, '');
  }
  assert.equal(fetches, 6);
  assert.deepEqual(actions, baseline, 'same cursor must not invalidate cached data again');
  assert.ok(!states.includes('disconnected'));
  assert.ok(actions.every(action => ['list', 'get'].includes(action)));
  api.dispose(); await clock.advance(60000);
  assert.equal(fetches, 6);
  assert.equal(clock.timers.size, 0);
});

test('503 retries have bounded exponential backoff, start dedup, and recover', async () => {
  const { clock, create } = harness();
  let fetches = 0, cancelled = 0, locked = true;
  const api = create({ request: async () => assert.fail('Watch must not poll session data'),
    fetchImpl: async () => {
      fetches++;
      if (locked) return { ok: false, status: 503, body: { async cancel() { cancelled++; } } };
      return streamResponse([{ revision: 3, epoch: 'one' }], { live: true });
    }, navigate() {},
  });
  await api.start();
  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
    assert.equal(api.getSnapshot().watchState, 'disconnected');
    assert.equal(api.getSnapshot().watchError, 'HTTP 503');
    assert.equal(clock.nextDelay(), delay);
    const before = fetches;
    await api.start(); await api.start();
    await clock.advance(delay - 1);
    assert.equal(fetches, before, 'no early retries, including repeated start');
    await clock.advance(1);
    assert.equal(fetches, before + 1);
  }
  assert.equal(cancelled, fetches);
  locked = false;
  await clock.advance(15000);
  assert.equal(api.getSnapshot().watchState, 'connected');
  assert.equal(api.getSnapshot().watchError, '');
  api.dispose(); await settle();
  assert.equal(clock.timers.size, 0);
});

test('service epochs, cursor resets and disconnection gaps invalidate each retained item once', async () => {
  const { clock, create } = harness();
  const actions = [];
  let response;
  const api = create({ request: async (action, payload) => { actions.push([action, payload.sessionId]); return action === 'list' ? page() : { ok: true, item: row(payload.sessionId) }; },
    fetchImpl: async () => response, navigate() {}, debounceMs: 0,
  });
  api.activate(); api.retainItem('a'); api.retainItem('hidden');
  response = streamResponse([{ revision: 4, epoch: 'one' }]);
  await api.start(); await clock.advance(0);
  actions.length = 0;
  // Same numeric revision in a newly created service is still a fresh snapshot.
  response = streamResponse([{ revision: 4, epoch: 'two' }]);
  await clock.advance(100);
  assert.deepEqual(actions.sort(), [['get', 'a'], ['get', 'hidden'], ['list', undefined]].sort());
  actions.length = 0;
  response = streamResponse([{ revision: 4, epoch: 'two' }], { live: true });
  await clock.advance(100);
  assert.deepEqual(actions, []);
  response.control.enqueue(frame({ revision: 5, sessionId: 'a' }));
  response.control.enqueue(frame({ revision: 5, sessionId: 'a' }));
  await settle(); await clock.advance(0);
  assert.deepEqual(actions.sort(), [['get', 'a'], ['list', undefined]].sort());
  actions.length = 0;
  // Coalesced revisions must refresh hidden retained details, even if the last
  // frame carries an individual session ID from a non-coalescing old server.
  response.control.enqueue(frame({ revision: 9, sessionId: 'a' }));
  await settle(); await clock.advance(0);
  assert.deepEqual(actions.sort(), [['get', 'a'], ['get', 'hidden'], ['list', undefined]].sort());
  actions.length = 0;
  response.control.enqueue(frame({ revision: 0 }));
  await settle(); await clock.advance(0);
  assert.equal(actions.filter(([action]) => action === 'list').length, 1);
  api.dispose(); await settle();
  assert.equal(clock.timers.size, 0);
});

test('manual reconnect waits for the old fetch to settle and cancels its late response', async () => {
  const { clock, create } = harness();
  const gate = deferred();
  let calls = 0, oldSignal, cancelled = 0;
  const api = create({ request: async () => assert.fail('No view'), fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 1) { oldSignal = options.signal; return gate.promise; }
    return streamResponse([{ revision: 0, epoch: 'one' }], { live: true, onCancel: () => cancelled++ });
  }, navigate() {} });
  const first = api.start(); await api.start();
  api.reconnect(); api.reconnect();
  assert.equal(oldSignal.aborted, true);
  assert.equal(calls, 1, 'never start overlapping fetches while old request is settling');
  gate.resolve(streamResponse([], { live: true, onCancel: () => cancelled++ }));
  await first; await clock.advance(0);
  assert.equal(calls, 2);
  assert.equal(cancelled, 1, 'late aborted response must release its body');
  api.dispose(); await settle();
  assert.equal(cancelled, 2);
  await clock.advance(60000); api.reconnect(); await api.start();
  assert.equal(calls, 2);
  assert.equal(clock.timers.size, 0);
});

test('dispose cancels a pending retry and every repeated controller activation releases its stream', async () => {
  const { clock, create } = harness();
  let calls = 0, cancelled = 0;
  const createApi = fetchImpl => create({ request: async () => assert.fail('No view'), fetchImpl, navigate() {} });
  const failed = createApi(async () => { calls++; throw new Error('Synthetic transport failure'); });
  await failed.start();
  assert.equal(clock.nextDelay(), 1000);
  failed.dispose(); await clock.advance(60000);
  assert.equal(calls, 1);
  for (let cycle = 0; cycle < 5; cycle++) {
    const api = createApi(async () => streamResponse([{ revision: 0, epoch: `epoch-${cycle}` }], { live: true, onCancel: () => cancelled++ }));
    const watching = api.start(); await settle();
    assert.equal(api.getSnapshot().watchState, 'connected');
    const snapshot = api.getSnapshot(); api.dispose(); await watching;
    assert.equal(api.getSnapshot(), snapshot);
    assert.equal(clock.timers.size, 0);
  }
  assert.equal(cancelled, 5);
});

test('multiple controller instances keep independent cursors and one subscription each', async () => {
  const { clock, create } = harness();
  const counts = [0, 0], lists = [0, 0];
  const controllers = counts.map((_value, index) => create({ request: async () => { lists[index]++; return page(); }, fetchImpl: async () => { counts[index]++; return streamResponse([{ revision: 8, epoch: 'one' }]); }, navigate() {}, debounceMs: 0 }));
  for (const api of controllers) { api.activate(); await api.start(); await api.start(); }
  await clock.advance(0);
  const baseline = [...lists];
  await clock.advance(300);
  assert.deepEqual(counts, [4, 4]);
  assert.deepEqual(lists, baseline);
  controllers[0].dispose();
  await clock.advance(200);
  assert.deepEqual(counts, [4, 6]);
  controllers[1].dispose();
  assert.equal(clock.timers.size, 0);
});

test('empty EOF and malformed frames back off and release the response reader', async () => {
  const { clock, create } = harness();
  let cancelled = 0, calls = 0;
  const api = create({ request: async () => assert.fail('No view'), fetchImpl: async () => {
    calls++;
    if (calls === 1) return streamResponse([]);
    return { ok: true, body: new ReadableStream({ start(control) { control.enqueue(new TextEncoder().encode('{broken\n')); }, cancel() { cancelled++; } }) };
  }, navigate() {} });
  await api.start();
  assert.equal(api.getSnapshot().watchError, 'Empty change stream');
  assert.equal(clock.nextDelay(), 1000);
  await clock.advance(1000);
  assert.equal(api.getSnapshot().watchState, 'disconnected');
  assert.equal(cancelled, 1);
  assert.equal(clock.nextDelay(), 2000);
  api.dispose();
  assert.equal(clock.timers.size, 0);
});
