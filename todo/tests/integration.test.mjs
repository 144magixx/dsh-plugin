import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as plugin from '../lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = createRequire(path.join(here, '../scripts/.runtime/package.json'));
const native = name => import(pathToFileURL(runtime.resolve('@deepseek-ai/' + name)).href);
const { Context } = await native('cordis');

/**
 * Mirrors the Host's update drain: admission can be locked (new requests get
 * 503) and the drain waits until every admitted request's body is consumed.
 */
function drainableConnection() {
  const routes = new Map(), active = new Set();
  let locked = false;
  return {
    routes, active,
    lock() { locked = true; }, unlock() { locked = false; },
    async drain(limitMs) {
      const started = performance.now();
      while (active.size) { if (performance.now() - started > limitMs) throw new Error('drain timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
      return performance.now() - started;
    },
    service: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    async post(pathname, body, signal) {
      if (locked) return { status: 503, value: { ok: false, error: 'admission_locked' } };
      const token = Symbol('request'); active.add(token);
      try {
        const response = await routes.get(pathname).fetch(new Request('http://localhost' + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }));
        // Consume the real body: the request only counts as finished at its end.
        const text = await response.text();
        return { status: response.status, value: JSON.parse(text) };
      } finally { active.delete(token); }
    },
  };
}

test('native Cordis + storage domain: durable reminders, finite HTTP bodies, drain/503/recovery, tool and unload', { timeout: 30000 }, async () => {
  const root = path.join(here, '.integration-data', randomUUID());
  await fs.mkdir(root, { recursive: true });
  const ctx = new Context();
  const errors = [];
  ctx.logger.exporter({ export: record => { if (record.type === 'error') errors.push(record.args); } });
  const fibers = [];
  async function mount(target, config = {}) {
    const mod = typeof target === 'string' ? await native(target) : target;
    const fiber = ctx.plugin(mod.default ?? mod, config);
    fibers.push(fiber); await fiber.await();
    assert.equal(fiber.state, 2, `${typeof target === 'string' ? target : 'todo'}: ${String(fiber.error ?? fiber._error)} ${JSON.stringify(errors)}`);
    return fiber;
  }
  const connection = drainableConnection();
  try {
    await mount('dsh-system-prompt');
    await mount('dsh-tools');
    await mount('dsh-storage');
    await mount('dsh-storage-json', { root: path.join(root, 'storage') });
    await mount('dsh-storage-domain', { backend: 'json' });
    ctx.provide('connection', connection.service);
    let todo = await mount(plugin);
    assert.ok(connection.routes.get(plugin.ROUTE), 'route registered');

    let result = await connection.post(plugin.ROUTE, { action: 'snapshot' });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.lists[0].name, '提醒事项');
    result = await connection.post(plugin.ROUTE, { action: 'create', title: '确认待办插件设计稿', dueDate: '2099-01-01', dueTime: '10:30', flagged: true });
    assert.equal(result.value.ok, true, JSON.stringify(result.value));
    const id = result.value.item.id;

    // Host update drain while the client keeps its normal poll cadence.
    let polling = true, polls = 0;
    const poller = (async () => { while (polling) { await connection.post(plugin.ROUTE, { action: 'revision' }); polls++; await new Promise(resolve => setTimeout(resolve, 20)); } })();
    await new Promise(resolve => setTimeout(resolve, 80));
    connection.lock();
    const drained = await connection.drain(3000);
    assert.ok(drained < 3000, `drained in ${drained}ms`);
    assert.equal(connection.active.size, 0);
    const refused = await connection.post(plugin.ROUTE, { action: 'revision' });
    assert.equal(refused.status, 503, 'locked admission refuses new requests');
    connection.unlock();
    polling = false; await poller;
    assert.ok(polls > 0);
    result = await connection.post(plugin.ROUTE, { action: 'revision' });
    assert.equal(result.status, 200, 'recovers after unlock');

    // A cancelled request finishes promptly and leaves no admitted request behind.
    const abort = new AbortController(); abort.abort();
    const cancelled = await connection.post(plugin.ROUTE, { action: 'snapshot' }, abort.signal).catch(error => error);
    assert.ok(cancelled.status === 500 || cancelled.name === 'AbortError' || cancelled.value?.ok === false);
    assert.equal(connection.active.size, 0);

    // The Agent tool through the native tool registry.
    const tool = ctx.tools.get(plugin.TOOL);
    assert.ok(tool, 'tool registered');
    const added = await tool.execute({ action: 'add', title: '整理插件 README', due: '2099-01-02' }, { agent: { id: 'session-1' }, signal: new AbortController().signal });
    assert.equal(added.item.sessionId, 'session-1');
    const listed = await tool.execute({ action: 'list', view: 'scheduled' }, { signal: new AbortController().signal });
    assert.deepEqual(listed.items.map(item => item.title), ['确认待办插件设计稿', '整理插件 README']);

    // Repeated disable/enable keeps data and releases the domain each time.
    for (let round = 0; round < 3; round++) {
      await todo.dispose();
      assert.equal(connection.routes.size, 0, 'route removed on unload');
      assert.equal(ctx.tools.get(plugin.TOOL), undefined, 'tool removed on unload');
      todo = await mount(plugin);
    }
    result = await connection.post(plugin.ROUTE, { action: 'snapshot' });
    assert.deepEqual(result.value.items.map(item => item.id).includes(id), true, 'persisted across reloads');
    assert.equal(result.value.items.find(item => item.id === id).flagged, true);
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    for (const fiber of fibers.reverse()) { try { await fiber.dispose(); } catch {} }
    await fs.rm(root, { recursive: true, force: true });
  }
});
