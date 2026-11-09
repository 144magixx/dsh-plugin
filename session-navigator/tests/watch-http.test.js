import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once, getEventListeners } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { loadClient } from './client-harness.js';
import { Readable } from 'node:stream';
import { watchHandler, WATCH_DURATION_MS } from '../lib/index.js';

const jsonRequest = (body = '{}', options = {}) => new Request('http://synthetic.invalid/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body, ...options });
const decode = chunk => JSON.parse(new TextDecoder().decode(chunk));
function serviceStub() {
  return {
    revision: 0, watchEpoch: 'synthetic-epoch', lifetime: new AbortController(), listeners: new Set(),
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    changed(sessionId) { const frame = { revision: ++this.revision, sessionId }; for (const listener of this.listeners) listener(frame); },
  };
}
async function within(promise, ms = 1000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Condition did not become true');
}

// A local node:http bridge mirrors DSH's streaming-request/response ownership:
// Host tracks the entire bridge promise, rather than just handler/headers.
async function host(t, handler) {
  let locked = false;
  const pending = new Set();
  const server = createServer((req, res) => {
    const task = (async () => {
      if (locked) { res.writeHead(503); res.end('Host locked'); req.resume(); return; }
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      const request = new Request('http://dsh.internal/watch', { method: req.method, headers: req.headers, body: Readable.toWeb(req), duplex: 'half', signal: abort.signal });
      const response = await handler(request);
      const unread = !req.readableEnded;
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), ...(unread ? { connection: 'close' } : {}) });
      if (response.body) for await (const chunk of response.body) {
        if (abort.signal.aborted) continue;
        if (!res.write(chunk) && !res.destroyed) await new Promise(resolve => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
        });
      }
      res.end();
      if (unread) req.destroy();
    })();
    pending.add(task);
    void task.catch(error => res.destroy(error)).finally(() => pending.delete(task));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await Promise.allSettled([...pending]); });
  const url = `http://127.0.0.1:${server.address().port}/watch`;
  return {
    url, pending,
    fetch: (options = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', ...options }),
    lock() { locked = true; return Promise.all([...pending]); },
    unlock() { locked = false; },
  };
}

test('production watch naturally ends over real HTTP and Host lock drains below 10 seconds', async t => {
  const service = serviceStub();
  const bridge = await host(t, watchHandler(service));
  const started = performance.now();
  const response = await bridge.fetch();
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.deepEqual(decode((await reader.read()).value), { revision: 0, epoch: service.watchEpoch });
  assert.equal(bridge.pending.size, 1, 'Host must still own the body after response headers');
  assert.equal(service.listeners.size, 1);
  const draining = bridge.lock();
  const denied = await bridge.fetch();
  assert.equal(denied.status, 503);
  await denied.text();
  await within(draining, 4000);
  assert.equal((await within(reader.read())).done, true);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= WATCH_DURATION_MS - 100, `Unexpected early close: ${elapsed}ms`);
  assert.ok(elapsed < 4000 && elapsed < 10000, `Drain took ${elapsed}ms`);
  t.diagnostic(`Production HTTP watch and lock drain completed in ${Math.round(elapsed)}ms`);
  assert.equal(service.listeners.size, 0);
  assert.equal(bridge.pending.size, 0);
  bridge.unlock();
  const restored = await bridge.fetch();
  const restoredReader = restored.body.getReader();
  await restoredReader.read();
  service.changed('s1');
  assert.equal(decode((await restoredReader.read()).value).sessionId, 's1');
  await restoredReader.cancel();
  await eventually(() => service.listeners.size === 0 && bridge.pending.size === 0);
});

test('real HTTP watch cancellation, unload and repeated activation release Host requests', async t => {
  const service = serviceStub();
  const bridge = await host(t, watchHandler(service, { durationMs: 100 }));
  for (let cycle = 0; cycle < 4; cycle++) {
    const abort = new AbortController();
    const response = await bridge.fetch({ signal: abort.signal });
    const reader = response.body.getReader();
    await reader.read();
    assert.equal(service.listeners.size, 1);
    if (cycle % 2) await reader.cancel();
    else { abort.abort(); await reader.cancel().catch(() => {}); }
    await eventually(() => service.listeners.size === 0 && bridge.pending.size === 0);
  }
  const response = await bridge.fetch();
  const reader = response.body.getReader();
  await reader.read();
  service.lifetime.abort();
  assert.equal((await within(reader.read())).done, true);
  await within(bridge.lock());
  assert.equal(service.listeners.size, 0);
  assert.equal(bridge.pending.size, 0);
});

test('stalled HTTP watch request body has the same hard deadline and drains while locked', async t => {
  const service = serviceStub();
  const bridge = await host(t, watchHandler(service, { durationMs: 40 }));
  const started = performance.now();
  const request = httpRequest(bridge.url, { method: 'POST', headers: { 'content-type': 'application/json' } });
  t.after(() => request.destroy());
  const responsePromise = once(request, 'response');
  request.flushHeaders(); request.write('{');
  await eventually(() => bridge.pending.size === 1);
  await within(bridge.lock());
  const [response] = await within(responsePromise);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  assert.equal(response.statusCode, 499);
  assert.equal(JSON.parse(Buffer.concat(chunks)).ok, false);
  assert.ok(performance.now() - started < 1000);
  assert.equal(service.listeners.size, 0);
  assert.equal(bridge.pending.size, 0);
});

test('watch coalesces slow readers into bounded global invalidations then expires', async () => {
  const service = serviceStub();
  const response = await watchHandler(service, { durationMs: 60 })(jsonRequest());
  for (let index = 0; index < 10000; index++) service.changed(`s${index}`);
  const reader = response.body.getReader();
  assert.equal(decode((await reader.read()).value).revision, 0);
  const latest = decode((await reader.read()).value);
  assert.deepEqual(latest, { revision: 10000 });
  assert.equal((await within(reader.read())).done, true);
  assert.equal(service.listeners.size, 0);
});

test('an unread watch keeps at most one frame and still unsubscribes on deadline', async () => {
  const service = serviceStub();
  const response = await watchHandler(service, { durationMs: 20 })(jsonRequest());
  for (let index = 0; index < 10000; index++) service.changed(`s${index}`);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(service.listeners.size, 0);
  const frames = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(frames.length, 1);
});

test('watch duration injection can only shorten the production bound', () => {
  assert.ok(WATCH_DURATION_MS <= 3000);
  for (const durationMs of [0, -1, Infinity, NaN, 2501, 10000, '2500', null]) assert.throws(() => watchHandler(serviceStub(), { durationMs }), RangeError);
});

test('active client rotates through real HTTP Host lock, 503 and unlock without polling', async t => {
  const service = serviceStub();
  const bridge = await host(t, watchHandler(service, { durationMs: 60 }));
  const { createController } = loadClient();
  let fetches = 0;
  const api = createController({ request: async () => assert.fail('No session data polling without an active view'),
    fetchImpl: async (_url, options) => { fetches++; return fetch(bridge.url, options); }, navigate() {}, debounceMs: 0,
  });
  t.after(() => api.dispose());
  void api.start();
  await eventually(() => api.getSnapshot().watchState === 'connected');
  await within(bridge.lock());
  assert.equal(service.listeners.size, 0);
  await eventually(() => api.getSnapshot().watchError === 'HTTP 503');
  assert.equal(bridge.pending.size, 0);
  const before = fetches;
  bridge.unlock();
  await within((async () => {
    while (api.getSnapshot().watchState !== 'connected') await new Promise(resolve => setTimeout(resolve, 5));
  })(), 2000);
  assert.equal(fetches, before + 1);
  assert.equal(service.listeners.size, 1);
  api.dispose();
  await eventually(() => service.listeners.size === 0 && bridge.pending.size === 0);
});

test('busy HTTP watch bounds total response bytes even when the application does not read', async t => {
  const service = serviceStub();
  const bridge = await host(t, watchHandler(service));
  const response = await bridge.fetch();
  for (let index = 0; index < 100; index++) { service.changed('会'.repeat(256)); await nextTurn(); }
  await within(bridge.lock(), 500);
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) <= 4096);
  assert.ok(text.trim().split('\n').length <= 32);
  assert.equal(service.listeners.size, 0);
  assert.equal(bridge.pending.size, 0);
});

test('all terminal paths clear the deadline and combined abort listener exactly once', async t => {
  const originalAny = AbortSignal.any.bind(AbortSignal);
  let deadline, timerCallback, combined;
  const cleared = [];
  t.mock.method(globalThis, 'setTimeout', callback => { timerCallback = callback; deadline = {}; return deadline; });
  t.mock.method(globalThis, 'clearTimeout', handle => cleared.push(handle));
  t.mock.method(AbortSignal, 'any', signals => { combined = originalAny(signals); return combined; });
  for (const terminal of ['expiry', 'cancel', 'request-abort', 'unload', 'invalid-body', 'subscribe-error']) {
    const service = serviceStub();
    const abort = new AbortController();
    if (terminal === 'subscribe-error') service.subscribe = () => { throw new Error('Synthetic failure'); };
    cleared.length = 0;
    const response = await watchHandler(service)(jsonRequest(terminal === 'invalid-body' ? '{' : '{}', { signal: abort.signal }));
    if (response.ok) {
      const reader = response.body.getReader(); await reader.read();
      if (terminal === 'expiry') timerCallback();
      if (terminal === 'cancel') await reader.cancel();
      if (terminal === 'request-abort') abort.abort();
      if (terminal === 'unload') service.lifetime.abort();
      assert.equal((await reader.read()).done, true);
      abort.abort(); service.lifetime.abort();
    }
    assert.deepEqual(cleared, [deadline], terminal);
    assert.equal(getEventListeners(combined, 'abort').length, 0, terminal);
    assert.equal(service.listeners.size, 0, terminal);
  }
});

test('watch invalid body and subscribe exceptions leave no subscription', async () => {
  const service = serviceStub();
  assert.equal((await watchHandler(service, { durationMs: 20 })(jsonRequest('{'))).status, 400);
  service.subscribe = () => { throw new Error('Synthetic subscribe failure'); };
  const response = await watchHandler(service, { durationMs: 20 })(jsonRequest());
  assert.equal(response.status, 500);
  assert.match((await response.json()).message, /Synthetic subscribe failure/);
  assert.equal(service.listeners.size, 0);
});
