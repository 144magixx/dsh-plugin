import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { getEventListeners } from 'node:events';
import { createFavoritesService, createChangeStream, WATCH_DURATION_MS, INITIAL } from '../lib/service.js';

function serviceFixture() {
  let state = structuredClone(INITIAL);
  return createFavoritesService({
    storageDomain: { async open() { return { global: { get: () => state, async set(value) { state = value; } }, async close() {} }; } },
  });
}

// Model the desktop gate: reject new requests, then wait for response bodies
// already being bridged to HTTP, not merely for fetch handlers to return.
async function bridge(service) {
  let locked = false;
  const pending = new Set();
  const server = createServer((req, res) => {
    if (locked) { res.writeHead(503); res.end(); return; }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const task = (async () => {
      const response = await service.watch(abort.signal);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      await pipeline(Readable.fromWeb(response.body), res);
    })();
    pending.add(task);
    void task.catch(() => {}).finally(() => pending.delete(task));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async lock() { locked = true; await Promise.all([...pending]); },
    unlock() { locked = false; },
    pending: () => pending.size,
    async close() { await service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

test('real HTTP bridge drains active production watch naturally before the desktop 10s deadline', { timeout: 6000 }, async t => {
  const service = serviceFixture(), host = await bridge(service);
  t.after(() => host.close());
  const response = await fetch(host.url), reader = response.body.getReader();
  assert.equal(response.status, 200); await reader.read();
  assert.equal(host.pending(), 1);
  const at = performance.now();
  let timeout;
  try {
    await Promise.race([host.lock(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('watch did not naturally drain within 3.5s')), 3500); })]);
  } finally { clearTimeout(timeout); }
  while (!(await reader.read()).done) {}
  reader.releaseLock();
  assert.ok(performance.now() - at < 3500);
  assert.equal(host.pending(), 0);
  assert.equal((await fetch(host.url)).status, 503);
  host.unlock();
  const resumed = await fetch(host.url); assert.equal(resumed.status, 200); await resumed.body.cancel();
});

function streamFixture() {
  const signal = new AbortController(), callbacks = new Set(), previous = [], timers = new Map();
  let id = 0, unsubscribed = 0;
  const stream = createChangeStream({
    signal: signal.signal, initial: { revision: 0, cursor: 'epoch:0' }, durationMs: 25,
    subscribe(send) { callbacks.add(send); previous.push(send); return () => { callbacks.delete(send); unsubscribed++; }; },
    setTimer(fn, delay) { assert.equal(delay, 25); timers.set(++id, fn); return id; },
    clearTimer(key) { timers.delete(key); },
  });
  return { stream, signal, timers, callbacks, previous, unsubscribed: () => unsubscribed };
}

for (const ending of ['expiry', 'abort', 'cancel']) {
  test(`${ending} clears timers, abort listeners and subscribers exactly once`, async () => {
    const f = streamFixture(), reader = f.stream.getReader(); await reader.read();
    assert.equal(getEventListeners(f.signal.signal, 'abort').length, 1);
    if (ending === 'expiry') [...f.timers.values()][0]();
    if (ending === 'abort') f.signal.abort();
    if (ending === 'cancel') await reader.cancel();
    assert.equal((await reader.read()).done, true);
    f.signal.abort(); await reader.cancel();
    for (const send of f.previous) assert.doesNotThrow(() => send({ revision: 99 }));
    assert.equal(f.timers.size, 0); assert.equal(f.callbacks.size, 0); assert.equal(f.unsubscribed(), 1);
    assert.equal(getEventListeners(f.signal.signal, 'abort').length, 0);
    reader.releaseLock();
  });
}

test('slow readers retain only the initial frame and the latest coalesced activity', async () => {
  const f = streamFixture();
  const send = [...f.callbacks][0];
  for (let revision = 1; revision <= 10000; revision++) send({ revision, cursor: `epoch:${revision}`, activity: revision === 3 });
  const reader = f.stream.getReader(), decode = value => JSON.parse(new TextDecoder().decode(value));
  assert.equal(decode((await reader.read()).value).revision, 0);
  const latest = decode((await reader.read()).value);
  assert.equal(latest.revision, 10000); assert.equal(latest.activity, true);
  await reader.cancel(); reader.releaseLock(); assert.equal(f.timers.size, 0); assert.equal(f.callbacks.size, 0);
});

test('expiry ends even an unread saturated stream without draining an unbounded backlog', async () => {
  const f = streamFixture(), send = [...f.callbacks][0];
  for (let revision = 1; revision < 10000; revision++) send({ revision });
  [...f.timers.values()][0]();
  const reader = f.stream.getReader(); let frames = 0;
  while (!(await reader.read()).done) frames++;
  assert.equal(frames, 1); assert.equal(f.callbacks.size, 0); assert.equal(f.timers.size, 0);
  reader.releaseLock();
});

test('high-frequency notifications also cap total response bytes and close early', async () => {
  const f = streamFixture(), send = [...f.callbacks][0], reader = f.stream.getReader();
  let bytes = (await reader.read()).value.byteLength, frames = 1;
  for (let revision = 1; revision <= 10000; revision++) {
    send({ revision, cursor: `epoch:${revision}`, activity: true });
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength; frames++;
  }
  assert.ok(bytes <= 4096); assert.ok(frames > 1 && frames < 10000);
  assert.equal(f.callbacks.size, 0); assert.equal(f.timers.size, 0); reader.releaseLock();
});

test('already aborted subscriptions do not register timers or subscribers', async () => {
  const abort = new AbortController(); abort.abort();
  const stream = createChangeStream({ signal: abort.signal, initial: {}, subscribe() { assert.fail('must not subscribe'); }, setTimer() { assert.fail('must not schedule'); } });
  assert.equal((await stream.getReader().read()).done, true);
});

test('service abort, dispose and repeated start/stop finish all readers', async () => {
  for (let cycle = 0; cycle < 5; cycle++) {
    const service = serviceFixture(), abort = new AbortController();
    const first = (await service.watch(abort.signal)).body.getReader();
    const second = (await service.watch(new AbortController().signal)).body.getReader();
    await first.read(); await second.read(); abort.abort();
    assert.equal((await first.read()).done, true);
    await service.dispose(); await service.dispose(); assert.equal((await second.read()).done, true);
    await assert.rejects(service.watch(new AbortController().signal), /plugin_closed/);
    first.releaseLock(); second.releaseLock();
  }
});

test('waiting for storage initialization is cancellable and shares the production deadline', { timeout: 4000 }, async () => {
  let open;
  const service = createFavoritesService({ storageDomain: { open: () => new Promise(resolve => { open = resolve; }) } });
  const abort = new AbortController();
  const canceled = service.watch(abort.signal); abort.abort();
  await assert.rejects(canceled, { name: 'AbortError' });
  const at = performance.now();
  const timeout = await service.watch(new AbortController().signal);
  assert.equal(timeout.status, 503); assert.equal((await timeout.json()).error, 'watch_timeout');
  assert.ok(performance.now() - at < 3000); assert.equal(WATCH_DURATION_MS, 2500);
  open({ global: { get: () => INITIAL }, async close() {} }); await service.dispose();
});
