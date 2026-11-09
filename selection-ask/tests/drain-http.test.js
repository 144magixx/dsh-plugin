import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { SelectionAskService, VIEW_WAIT_MAX_MS, SESSION_PREFIX } from '../lib/service.js';
import { ROUTES, routeHandler } from '../lib/index.js';
import { client } from './client-core.mjs';

const record = { id: 't1', requestId: 'r1', sourceSessionId: 's1', sessionId: `${SESSION_PREFIX}x`, title: 'q', cwd: '/w', model: null, agentPreset: null, createdAt: 1, updatedAt: 1, selection: { kind: 'chat', text: 'x' } };
function service() {
  const rows = new Map([[record.id, record]]);
  const table = { entries: () => rows.entries(), get: id => rows.get(id), put: async (id, value) => rows.set(id, value), delete: async id => rows.delete(id) };
  const ctx = { agents: { get: () => undefined }, sessionQuery: { observeSession: async () => ({ events: [], inheritedEventCount: 0, [Symbol.dispose]() {} }) }, get: () => undefined };
  return new SelectionAskService(ctx, table);
}
async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function eventually(predicate, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Condition did not become true');
}

// node:http bridge mirroring DSH: the Host tracks each request until its body is fully written.
async function host(t, svc) {
  const handlers = Object.fromEntries(Object.entries(ROUTES).map(([path, method]) => [`/api/selection-ask/${path}`, routeHandler(svc, method)]));
  let locked = false;
  const pending = new Set();
  const server = createServer((req, res) => {
    const task = (async () => {
      if (locked) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"ok":false,"code":"locked","message":"Host locked"}'); req.resume(); return; }
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      const request = new Request(`http://dsh.internal${req.url}`, { method: req.method, headers: req.headers, body: Readable.toWeb(req), duplex: 'half', signal: abort.signal });
      const response = await handlers[req.url](request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    })();
    pending.add(task);
    void task.catch(error => res.destroy(error)).finally(() => pending.delete(task));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, pending, lock() { locked = true; return Promise.all([...pending]); }, unlock() { locked = false; } };
}

test('an active long-poll drains under Host lock, sees 503, recovers after unlock, and stops cleanly', async t => {
  const svc = service();
  const bridge = await host(t, svc);
  let requests = 0; let statuses = [];
  const api = client.createApi(async (path, init) => { requests++; const response = await fetch(bridge.base + path, init); statuses.push(response.status); return response; });
  const updates = [];
  const feed = client.createFeed({ api, threadId: 't1', onUpdate: patch => updates.push(patch) });
  feed.start();
  await eventually(() => updates.some(update => update.view) && svc.waiters.size === 1);
  assert.equal(bridge.pending.size, 1, 'one bounded long-poll is in flight');
  const started = performance.now();
  await within(bridge.lock(), VIEW_WAIT_MAX_MS + 1500);
  const drained = performance.now() - started;
  assert.ok(drained < VIEW_WAIT_MAX_MS + 500 && drained < 10000, `drain took ${drained}ms`);
  t.diagnostic(`Locked drain with an active long-poll completed in ${Math.round(drained)}ms`);
  await eventually(() => statuses.includes(503));
  assert.equal(svc.waiters.size, 0, 'no waiter survives the drain');
  await eventually(() => updates.at(-1)?.error?.status === 503);
  const lockedRequests = requests;
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.ok(requests - lockedRequests <= 2, `bounded backoff while locked (${requests - lockedRequests} retries in 700ms)`);
  bridge.unlock();
  await eventually(() => updates.at(-1)?.view && svc.waiters.size === 1, 20000);
  feed.stop();
  await eventually(() => svc.waiters.size === 0 && bridge.pending.size === 0);
  const final = requests;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(requests, final, 'a stopped feed never reconnects');
});

test('plugin unload ends an in-flight long-poll body promptly and refuses new work', async t => {
  const svc = service();
  const bridge = await host(t, svc);
  const view = async () => (await fetch(`${bridge.base}/api/selection-ask/view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"threadId":"t1"}' })).json();
  await view();
  await new Promise(resolve => setTimeout(resolve, 50)); // the model catalog loads once in the background
  const first = await view();
  const started = performance.now();
  const waiting = fetch(`${bridge.base}/api/selection-ask/view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: 't1', since: first.revision, waitMs: 2500 }) });
  await eventually(() => svc.waiters.size === 1);
  await svc.dispose();
  const response = await within(waiting, 1000);
  await response.text();
  assert.ok(performance.now() - started < 1000);
  await eventually(() => bridge.pending.size === 0);
  const refused = await fetch(`${bridge.base}/api/selection-ask/list`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(refused.status, 503);
  await refused.text();
  assert.equal(svc.waiters.size, 0);
});

test('client aborts release Host waiters immediately', async t => {
  const svc = service();
  const bridge = await host(t, svc);
  const api = client.createApi((path, init) => fetch(bridge.base + path, init));
  for (let cycle = 0; cycle < 4; cycle++) {
    const feed = client.createFeed({ api, threadId: 't1', onUpdate() {} });
    feed.start();
    await eventually(() => svc.waiters.size === 1);
    feed.stop();
    await eventually(() => svc.waiters.size === 0 && bridge.pending.size === 0);
  }
});
