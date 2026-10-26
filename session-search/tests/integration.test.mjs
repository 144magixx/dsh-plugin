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
const { createUserMessage } = await native('dsh-llm');

test('native Cordis + Session Query + JSONL: search persisted history, live tail, route, tool and unload', { timeout: 30000 }, async () => {
  const testRoot = path.resolve(here, '.integration-data');
  const root = path.join(testRoot, randomUUID());
  await fs.mkdir(root, { recursive: true });
  const ctx = new Context();
  const errors = [];
  ctx.logger.exporter({ export: record => { if (record.type === 'error') errors.push(record.args); } });
  const fibers = [];
  async function mount(name, config = {}) {
    const mod = await native(name);
    const fiber = ctx.plugin(mod.default ?? mod, config);
    fibers.push(fiber); await fiber.await();
    assert.equal(fiber.state, 2, `${name}: ${String(fiber.error ?? fiber._error)} ${JSON.stringify(errors)}`);
    return fiber;
  }
  try {
    await mount('dsh-session');
    await mount('dsh-session-persistence-jsonl', { root: path.join(root, 'sessions'), compression: 'none' });
    await mount('dsh-session-query');
    await mount('dsh-system-prompt');
    await mount('dsh-tools');
    await mount('dsh-storage');
    await mount('dsh-storage-json', { root: path.join(root, 'storage') });
    await mount('dsh-storage-domain', { backend: 'json' });
    await mount('dsh-workspace');
    const workspace = await ctx.workspaceRegistry.create(root, 'Search integration workspace');
    const routes = new Map();
    ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } });
    const source = ctx.sessions.prepare('search-integration-history', { meta: { cwd: root, createdAt: 1 } });
    const first = source.append('user/message', createUserMessage({ content: [{ type: 'text', text: '历史查询中文片段与 FooBar[0].value' }], source: { kind: 'user' } }), { surfaceOp: 'append' });
    source.append('session/title', { title: '历史搜索标题', messageSeqs: [], source: { kind: 'user' } });
    const handle = await ctx.sessionPersistence.create(source.header);
    await handle.append(source.ownEvents());
    await handle.flush(); await handle.close();
    await workspace.attachSession(source.id);
    assert.equal(ctx.sessions.get(source.id), undefined, 'persisted fixture stays cold');
    const pluginFiber = ctx.plugin(plugin); fibers.push(pluginFiber); await pluginFiber.await();
    assert.equal(pluginFiber.state, 2, `search plugin: ${String(pluginFiber.error ?? pluginFiber._error)} ${JSON.stringify(errors)}`);
    const route = routes.get('/api/session-search/search');
    assert.ok(route, 'authenticated route registered');
    async function post(name, data) {
      const response = await routes.get('/api/session-search/' + name).fetch(new Request('http://localhost/api/session-search/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }));
      return response.json();
    }
    let page = await post('search', { mode: 'current', sessionId: source.id, query: '中文片', includeTools: false });
    assert.equal(page.ok, true, JSON.stringify(page));
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].seq, first.seq);
    page = await post('search', { mode: 'all', query: 'foobar[0]', workspaceId: workspace.id });
    assert.equal(page.items.length, 1, JSON.stringify(page));
    assert.equal(page.items[0].sessionId, source.id);
    page = await post('search', { mode: 'titles', query: '搜索标题' });
    assert.equal(page.items.length, 1, JSON.stringify(page));
    const context = await post('context', { sessionId: source.id, seq: first.seq });
    assert.equal(context.ok, true, JSON.stringify(context));
    assert.ok(context.items.some(item => item.text.includes('FooBar[0].value')));
    assert.equal(ctx.sessions.get(source.id), undefined, 'search does not activate persisted session');
    const live = ctx.sessions.create('search-integration-live', { meta: { cwd: root, createdAt: 2 } });
    live.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Fresh uncached live tail' }], source: { kind: 'user' } }), { surfaceOp: 'append' });
    page = await post('search', { mode: 'current', sessionId: live.id, query: 'UNCACHED' });
    assert.equal(page.items.length, 1, JSON.stringify(page));
    const tool = ctx.tools.get('session_find');
    assert.ok(tool, 'read-only search tool registered');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await pluginFiber.dispose();
    assert.equal(routes.size, 0, 'routes disposed with plugin');
    assert.equal(ctx.tools.get('session_find'), undefined, 'tool disposed with plugin');
  } finally {
    for (const fiber of fibers.toReversed()) await fiber.dispose();
    await ctx.fiber.dispose();
    assert.equal(path.dirname(path.resolve(root)), testRoot);
    assert.match(path.basename(root), /^[0-9a-f-]{36}$/);
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('installed DSH shortcut validator accepts desktop defaults and dispatches search', async () => {
  const vm = await import('node:vm');
  const { openArchive } = await import('../scripts/extract-test-runtime.mjs');
  const archive = openArchive();
  let nativeSource;
  try { nativeSource = archive.read('dsh/node_modules/@deepseek-ai/dsh-client-shortcuts/lib/client.js').toString(); }
  finally { archive.close(); }
  // Exercise the shipped registration validator without creating DOM, React,
  // an application shell, shortcut preferences or a desktop keyboard adapter.
  const marker = 'module.exports = ShortcutsService;';
  assert.equal(nativeSource.split(marker).length, 2, 'native registry export boundary');
  nativeSource = nativeSource.replace(marker, 'module.exports = { ShortcutRegistry };');
  let nativeRegistration;
  vm.runInNewContext(nativeSource, { window: { __ModuleLoader__: { load(value) { nativeRegistration = value; } } } });
  const { Service } = await native('cordis');
  const { ShortcutRegistry } = nativeRegistration.factory(name => {
    if (name === '@deepseek-ai/cordis') return { Service };
    // Imported symbols are only used by the uninstantiated browser service.
    return {};
  });
  let registration;
  vm.runInNewContext(await fs.readFile(path.join(here, '../lib/client.js'), 'utf8'), { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  const client = registration.factory(name => { assert.equal(name, 'react'); return {}; });
  const registry = { commands: new Map(), fixedCommands: new Map(), refreshLabels() {} };
  const invocations = [];
  const errors = [];
  const shortcuts = { runtime: 'desktop', register: command => ShortcutRegistry.prototype.register.call(registry, command) };
  const api = { open: (...args) => invocations.push(args), getSnapshot: () => ({ shortcutErrors: errors }), set: value => errors.push(...(value.shortcutErrors ?? [])) };
  const dispose = client.installShortcuts({ get: name => name === 'shortcuts' ? shortcuts : undefined,
    sessions: { list: { getSnapshot: () => ({ byId: { current: { id: 'current', retainedBy: { mainView: 1 } } } }) } } }, api, key => key);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(registry.commands.size, 2);
  for (const [id, mode] of [['sessionSearch.current', 'current'], ['sessionSearch.global', 'all']]) {
    ShortcutRegistry.prototype.invoke.call(registry, id, { modal: null, region: 'editable' });
    assert.equal(invocations.at(-1)[0], mode);
    assert.equal(invocations.at(-1)[1], 'current');
  }
  const prior = invocations.length;
  ShortcutRegistry.prototype.invoke.call(registry, 'sessionSearch.current', { modal: 'unrelated-dialog', region: 'editable' });
  assert.equal(invocations.length, prior, 'unrelated modal retains shortcut ownership');
  dispose();
  assert.equal(registry.commands.size, 0);
});
