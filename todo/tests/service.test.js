import test from 'node:test';
import assert from 'node:assert/strict';
import { createTodoService, createFetchHandler, DOMAIN } from '../lib/service.js';
import { runTool, apply as applyPlugin, ROUTE, TOOL } from '../lib/index.js';

/** In-memory stand-in for ctx.storageDomain with the same validation contract. */
function fakeStorage() {
  const stored = new Map();
  let opened = 0, closed = 0;
  return {
    stored, get opened() { return opened; }, get closed() { return closed; },
    async open(spec) {
      opened++;
      let value = stored.has(spec.name) ? spec.global.schema.parse(stored.get(spec.name)) : structuredClone(spec.global.initial);
      return { global: { get: () => value, async set(next) { value = spec.global.schema.parse(next); stored.set(spec.name, structuredClone(value)); } }, async close() { closed++; } };
    },
  };
}
const post = (handler, body, headers = {}) => handler(new Request('http://localhost' + ROUTE, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

test('HTTP exchanges are finite JSON responses whose bodies complete', async () => {
  const storageDomain = fakeStorage(), service = createTodoService({ storageDomain }, { now: () => 1000 });
  const handler = createFetchHandler(service);
  let response = await post(handler, { action: 'snapshot' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let value = await response.json();
  assert.equal(value.revision, 0); assert.equal(value.lists[0].name, '提醒事项'); assert.equal(value.token, '0.0');
  response = await post(handler, { action: 'create', title: '整理插件 README' });
  value = await response.json();
  assert.equal(value.ok, true); assert.equal(value.revision, 1); assert.equal(value.item.title, '整理插件 README');
  assert.equal(storageDomain.stored.get(DOMAIN).items.length, 1, 'durable before the response');
  value = await (await post(handler, { action: 'revision' })).json();
  assert.deepEqual(value, { ok: true, revision: 1, token: '1.0' });
  assert.equal((await post(handler, { action: 'revision', extra: true })).status, 400);
  assert.equal((await post(handler, 'not json')).status, 400);
  assert.equal((await post(handler, { action: 'create', title: 'x'.repeat(20000) })).status, 413);
  assert.equal((await handler(new Request('http://localhost' + ROUTE, { method: 'POST', body: '{}' }))).status, 415);
  await service.dispose(); await service.dispose();
  assert.equal(storageDomain.closed, 1, 'idempotent close');
  response = await post(handler, { action: 'revision' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'plugin_closed');
});

test('concurrent writes are serialized and survive a restart', async () => {
  const storageDomain = fakeStorage();
  let service = createTodoService({ storageDomain }, { now: () => 5 });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => service.execute({ action: 'create', title: `item ${i}` })));
  assert.deepEqual(results.map(result => result.revision), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await assert.rejects(service.execute({ action: 'update', id: 'missing', title: 'x' }), { code: 'item_not_found', status: 404 });
  assert.equal((await service.execute({ action: 'revision' })).revision, 10, 'a failed write does not bump the revision');
  await service.dispose();
  service = createTodoService({ storageDomain });
  assert.equal((await service.execute({ action: 'snapshot' })).items.length, 10);
  await service.dispose();
});

test('linked session titles are resolved on link and refreshed lazily into the token', async () => {
  let clock = 0, title = '';
  const storageDomain = fakeStorage(), service = createTodoService({ storageDomain }, { now: () => clock });
  const reads = [];
  service.setTitleReader(async ids => { reads.push(ids); return new Map(ids.map(id => [id, title])); });
  title = '新会话';
  const created = await service.execute({ action: 'create', title: 'x', sessionId: 's-1' });
  assert.equal(created.item.sessionTitle, '新会话');
  title = '会话搜索插件';
  clock = 60000;
  const before = await service.execute({ action: 'revision' });
  await new Promise(resolve => setImmediate(resolve));
  const after = await service.execute({ action: 'snapshot' });
  assert.notEqual(after.token, before.token, 'a title change is visible to polling clients');
  assert.equal(after.items[0].sessionTitle, '会话搜索插件');
  await service.dispose();
});

test('the Agent tool links the calling conversation and resolves lists by name', async () => {
  const storageDomain = fakeStorage(), service = createTodoService({ storageDomain });
  const exec = { agent: { id: 'session-42' }, signal: new AbortController().signal };
  await runTool(service, { action: 'add_list', name: 'dsh-plugin', color: 'orange' }, exec);
  const added = await runTool(service, { action: 'add', title: '修复会话搜索高亮错位', list: 'DSH-Plugin', due: '2099-01-01 16:30', flagged: true }, exec);
  assert.equal(added.item.sessionId, 'session-42'); assert.equal(added.item.due, '2099-01-01 16:30');
  const unlinked = await runTool(service, { action: 'add', title: 'no link', linkSession: false }, exec);
  assert.equal(unlinked.item.sessionId, undefined);
  await assert.rejects(runTool(service, { action: 'add', title: 'x', list: 'nope' }, exec), { code: 'list_not_found' });
  let listed = await runTool(service, { action: 'list', view: 'scheduled' }, exec);
  assert.deepEqual(listed.items.map(item => item.title), ['修复会话搜索高亮错位']);
  assert.equal(listed.items[0].list, 'dsh-plugin');
  listed = await runTool(service, { action: 'list', query: '高亮' }, exec);
  assert.equal(listed.total, 1);
  await runTool(service, { action: 'update', id: added.item.id, due: '' }, exec);
  await runTool(service, { action: 'complete', id: added.item.id }, exec);
  listed = await runTool(service, { action: 'list', view: 'completed' }, exec);
  assert.equal(listed.items[0].dueDate, null);
  const lists = await runTool(service, { action: 'lists' }, exec);
  assert.equal(lists.lists.length, 2); assert.equal(lists.counts.completed, 1);
  await runTool(service, { action: 'delete', id: added.item.id }, exec);
  await assert.rejects(runTool(service, { action: 'explode' }, exec), { code: 'invalid_action' });
  await service.dispose();
});

test('plugin apply registers one route and the tool, and cleans both up', async () => {
  const routes = new Map(), tools = new Map(), effects = [];
  const ctx = {
    storageDomain: fakeStorage(),
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    effect(fn) { const dispose = fn(); effects.push(dispose); },
    inject(names, callback) {
      if (names[0] === 'tools') callback({ tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } }, effect: ctx.effect });
    },
  };
  applyPlugin(ctx);
  assert.deepEqual([...routes.keys()], [ROUTE]);
  const tool = tools.get(TOOL);
  assert.ok(tool); assert.equal(tool.isConcurrencySafe({ action: 'list' }), true); assert.equal(tool.isConcurrencySafe({ action: 'add' }), false);
  const value = await tool.execute({ action: 'add', title: 'from agent' }, { agent: { id: 's' } });
  assert.equal(value.item.sessionId, 's');
  for (const dispose of effects.reverse()) await dispose?.();
  assert.equal(routes.size, 0); assert.equal(tools.size, 0);
});
