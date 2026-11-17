import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSaveRoute, REQUEST_DEADLINE_MS, SAVE_ROUTE, apply } from '../lib/index.js';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'annotation-http-'));
  await fs.writeFile(path.join(root, 'source.html'), '<html/>');
  const registry = { list: () => [{ path: root, sessionIds: ['s'] }] };
  const service = createSaveRoute(registry, options);
  let locked = false;
  let active = 0;
  const server = http.createServer(async (req, res) => {
    // Test transport models connection admission and real response completion.
    if (locked) { res.writeHead(503); res.end('locked'); return; }
    active++;
    const abort = new AbortController();
    req.once('aborted', () => abort.abort());
    res.once('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: Readable.toWeb(req), duplex: 'half', signal: abort.signal });
      const result = await service.route.fetch(request);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(String(error)); } }
    finally { active--; }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${SAVE_ROUTE}`;
  t.after(async () => {
    await service.dispose();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    const actual = await fs.realpath(root); assert.ok(path.basename(actual).startsWith('annotation-http-')); await fs.rm(actual, { recursive: true, force: true });
  });
  const input = { sessionId: 's', sourcePath: path.join(root, 'source.html'), count: 1, markdown: '# 批注\n解释这个元素。', images: [] };
  return { service, url, input, root, lock: value => { locked = value; }, active: () => active };
}
function post(url, body) { return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
function stalled(url) {
  let incoming;
  const ready = new Promise(resolve => { incoming = resolve; });
  const response = new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', part => { body += part; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.write('{'); incoming(req);
  });
  return { ready, response };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real HTTP response completes with saved file metadata; request validation errors are finite', async t => {
  const f = await fixture(t);
  const response = await post(f.url, f.input);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true); assert.equal(data.count, 1);
  assert.equal(await fs.readFile(data.absolutePath, 'utf8'), f.input.markdown);
  assert.equal(data.workspaceRoot, await fs.realpath(f.root));
  assert.equal(f.active(), 0);
  const bad = await post(f.url, { ...f.input, count: 0 });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).ok, false);
  assert.equal(f.active(), 0);
});
test('stalled upload reaches deadline, body finishes; locked admission returns 503 and unlock recovers', async t => {
  const f = await fixture(t, { deadlineMs: 120 });
  const start = Date.now();
  const hanging = stalled(f.url); const req = await hanging.ready;
  await delay(30); f.lock(true);
  const locked = await post(f.url, f.input); assert.equal(locked.status, 503); await locked.text();
  const result = await hanging.response; req.destroy();
  assert.equal(result.status, 408); assert.equal(JSON.parse(result.body).code, 'timeout');
  assert.ok(Date.now() - start < REQUEST_DEADLINE_MS);
  assert.equal(f.active(), 0);
  f.lock(false);
  const recovered = await post(f.url, f.input); assert.equal(recovered.status, 200); await recovered.json();
});
test('dispose cancels active uploads and later requests return finite 503', async t => {
  const f = await fixture(t);
  const hanging = stalled(f.url); const req = await hanging.ready;
  await delay(25); await f.service.dispose();
  const result = await hanging.response; req.destroy();
  assert.equal(result.status, 503); assert.equal(JSON.parse(result.body).code, 'unloading');
  const response = await post(f.url, f.input); assert.equal(response.status, 503); await response.json();
  assert.equal(f.service.pendingCount, 0);
});
test('HTTP client abort releases active request without files', async t => {
  const f = await fixture(t);
  const hanging = stalled(f.url); const req = await hanging.ready;
  const settled = hanging.response.catch(() => null);
  await delay(25); req.destroy(); await settled;
  for (let i = 0; i < 20 && f.active(); i++) await delay(10);
  assert.equal(f.active(), 0); assert.equal(f.service.pendingCount, 0);
  assert.deepEqual(await fs.readdir(f.root), ['source.html']);
});
test('uncooperative stream cancellation cannot keep the response open', async () => {
  const service = createSaveRoute({ list: () => [] }, { deadlineMs: 35 });
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const response = await service.route.fetch(new Request('http://local/api/page-annotate/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' }));
  assert.equal(response.status, 408); await response.json();
  await service.dispose();
});
test('repeated apply/dispose unregisters routes and rejects stale handlers', async () => {
  const effects = [], routes = []; let registrations = 0;
  const ctx = { workspaceRegistry: { list: () => [] }, connection: { fetch: { register(route) { routes.push(route); registrations++; return async () => { registrations--; }; } } }, effect(fn) { effects.push(fn()); } };
  for (let i = 0; i < 3; i++) { apply(ctx); assert.equal(registrations, 1); await effects.pop()(); assert.equal(registrations, 0); }
  for (const route of routes) {
    const response = await route.fetch(new Request('http://local' + SAVE_ROUTE, { method: 'POST' }));
    assert.equal(response.status, 503); await response.json();
  }
});
