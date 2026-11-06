import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let client;
vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(module) { client = module.factory(() => ({ createElement() {} })); } } },
  AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout, Date,
});
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function clock() {
  let time = 0, id = 0; const timers = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { const key = ++id; timers.set(key, { fn, at: time + delay }); return key; },
    clearTimer(key) { timers.delete(key); },
    count: () => timers.size,
    nextDelay: () => Math.min(...[...timers.values()].map(timer => timer.at - time)),
    async tick(ms) {
      const target = time + ms;
      while (true) {
        const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > target) break;
        timers.delete(entry[0]); time = entry[1].at; entry[1].fn(); await settle();
      }
      time = target; await settle();
    },
  };
}
function fixture({ locked = false } = {}) {
  const time = clock(), connections = [];
  let lists = 0, calls = 0, active = 0, maximum = 0, cursor = 'epoch:0', revision = 0;
  function fetchImpl(url, { signal }) {
    calls++;
    if (locked) return Promise.resolve(new Response(null, { status: 503 }));
    let ended = false, controller;
    active++; maximum = Math.max(maximum, active);
    const stop = () => { if (ended) return; ended = true; active--; signal.removeEventListener('abort', stop); controller.close(); };
    const body = new ReadableStream({
      start(value) { controller = value; signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop(); },
      cancel() { if (ended) return; ended = true; active--; signal.removeEventListener('abort', stop); },
    });
    const connection = { close: stop, send(frame = { revision, cursor }) { if (!ended) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`)); }, raw(text) { controller.enqueue(new TextEncoder().encode(text)); } };
    connections.push(connection); connection.send();
    return Promise.resolve(new Response(body));
  }
  const request = async input => { assert.equal(input.action, 'list'); lists++; return { ok: true, items: [], revision }; };
  const api = client.createController(request, fetchImpl, time);
  return { api, time, connections, lock(value) { locked = value; }, change(next, rev = revision) { cursor = next; revision = rev; }, lists: () => lists, calls: () => calls, active: () => active, maximum: () => maximum };
}

test('normal rotations retain data without errors or list refresh; gap activity is caught by cursor', async () => {
  const f = fixture(); f.api.start(); f.api.start(); await settle();
  assert.equal(f.calls(), 1); assert.equal(f.lists(), 1);
  for (let i = 0; i < 3; i++) {
    await f.time.tick(2500); f.connections.at(-1).close(); await settle();
    assert.equal(f.api.getSnapshot().disconnected, false);
    assert.equal(f.time.nextDelay(), 150);
    await f.time.tick(150);
  }
  assert.equal(f.calls(), 4); assert.equal(f.lists(), 1);
  await f.time.tick(2500); f.connections.at(-1).close(); await settle();
  f.change('epoch:1'); await f.time.tick(150);
  assert.equal(f.lists(), 2);
  f.connections.at(-1).send({ revision: 0, cursor: 'epoch:2', activity: true }); await settle();
  assert.equal(f.lists(), 3);
  f.api.dispose(); await settle();
  assert.equal(f.active(), 0); assert.equal(f.time.count(), 0); assert.equal(f.maximum(), 1);
});

test('503 retries use bounded backoff, unlock resumes once, and unmount prevents reconnect', async () => {
  const f = fixture({ locked: true }); f.api.start(); await settle();
  assert.equal(f.api.getSnapshot().disconnected, true);
  for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
    assert.equal(f.time.nextDelay(), delay);
    const calls = f.calls(); await f.time.tick(delay - 1); assert.equal(f.calls(), calls);
    await f.time.tick(1); assert.equal(f.calls(), calls + 1);
  }
  f.lock(false); await f.time.tick(10000);
  assert.equal(f.api.getSnapshot().disconnected, false); assert.equal(f.active(), 1); assert.equal(f.lists(), 2);
  f.api.dispose(); await settle(); await f.time.tick(60000);
  assert.equal(f.active(), 0); assert.equal(f.time.count(), 0); assert.equal(f.maximum(), 1);
});

test('repeated retry serializes cancellation before replacing a connection; dispose and start are idempotent', async () => {
  const f = fixture(); f.api.start(); await settle();
  for (let i = 0; i < 10; i++) f.api.retry();
  await settle();
  assert.equal(f.maximum(), 1); assert.equal(f.active(), 1); assert.equal(f.calls(), 2);
  f.api.dispose(); f.api.dispose(); f.api.start(); f.api.retry(); await settle();
  const calls = f.calls(); await f.time.tick(60000);
  assert.equal(f.active(), 0); assert.equal(f.time.count(), 0); assert.equal(f.calls(), calls);
});

test('early clean EOF is rate limited and malformed frames recover with backoff', async () => {
  const f = fixture(); f.api.start(); await settle();
  f.connections[0].close(); await settle(); assert.equal(f.time.nextDelay(), 2500);
  await f.time.tick(2500);
  f.connections.at(-1).raw('x'.repeat(4097) + '\n'); await settle();
  assert.equal(f.api.getSnapshot().disconnected, true); assert.equal(f.time.nextDelay(), 1000);
  f.api.dispose(); await settle(); assert.equal(f.active(), 0); assert.equal(f.time.count(), 0);
});

test('unmount while a connection is opening cancels it and never starts a second connection', async () => {
  const time = clock(); let resolve, calls = 0, aborted = false;
  const api = client.createController(async () => ({ items: [], revision: 0 }), (_, { signal }) => {
    calls++; signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(done => { resolve = done; });
  }, time);
  api.start(); api.dispose();
  resolve(new Response(new ReadableStream({ start(controller) { controller.close(); } })));
  await settle(); await time.tick(60000);
  assert.equal(aborted, true); assert.equal(calls, 1); assert.equal(time.count(), 0);
});

test('a revision observed before an older initial list triggers one catch-up refresh', async () => {
  const time = clock(); let first, lists = 0;
  const api = client.createController(() => {
    lists++;
    return lists === 1 ? new Promise(resolve => { first = resolve; }) : Promise.resolve({ items: [], revision: 2 });
  }, async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"revision":2,"cursor":"epoch:1"}\n')); } })), time);
  api.start(); await settle(); first({ items: [], revision: 1 }); await settle();
  assert.equal(lists, 2); assert.equal(api.getSnapshot().revision, 2);
  api.dispose(); await settle(); assert.equal(time.count(), 0);
});

test('row marks: question first, then a spinner for live sessions, then unread and unknown dots', async () => {
  let marks;
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(module) { marks = module.factory(() => ({ createElement: (type, props) => ({ type, props }) })); } } },
    AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout, Date,
  });
  const kind = item => { const node = marks.rowMark(item, key => key); return node.type === marks.Spinner ? 'spin' : node.props?.status ?? 'chat'; };
  assert.deepEqual([kind({ attention: 'question', running: true }), kind({ attention: 'none', running: true }), kind({ attention: 'completed' }), kind({ attention: 'unknown' }), kind({ attention: 'none' })], ['question', 'spin', 'completed', 'unknown', 'chat']);
});
