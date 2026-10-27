import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as plugin from '../lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.DSH_TEST_RUNTIME, path.resolve(here, '../scripts/.runtime'), path.resolve(here, '../../side-branch/scripts/.runtime')].filter(Boolean);
let runtime;
for (const root of candidates) {
  try { const require = createRequire(path.join(root, 'package.json')); require.resolve('@deepseek-ai/cordis'); runtime = require; break; } catch {}
}
const native = name => import(pathToFileURL(runtime.resolve('@deepseek-ai/' + name)).href);

test('native Cordis: backend mount, current-session route, runtime providers, read-only tool and unload', { skip: !runtime && 'Extract the DSH test runtime first, or set DSH_TEST_RUNTIME.', timeout: 15000 }, async t => {
  const { Context } = await native('cordis');
  const ctx = new Context(); const errors = []; const fibers = []; const routes = new Map();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-capability-native-')));
  t.after(async () => { for (const fiber of fibers.toReversed()) await fiber.dispose(); await ctx.fiber.dispose(); assert.equal(path.dirname(root), await fs.realpath(os.tmpdir())); assert.match(path.basename(root), /^dsh-capability-native-/); await fs.rm(root, { recursive: true, force: true }); });
  ctx.logger.exporter({ export(record) { if (record.type === 'error') errors.push(record.args); } });
  async function mount(name, config = {}) {
    const mod = await native(name); const fiber = ctx.plugin(mod.default ?? mod, config); fibers.push(fiber); await fiber.await(); assert.equal(fiber.state, 2, `${name}: ${JSON.stringify(errors)}`); return fiber;
  }
  await mount('dsh-session');
  await mount('dsh-system-prompt');
  await mount('dsh-tools');
  await mount('dsh-skill');
  await mount('dsh-skill-office', { cli: false });
  ctx.skills.register({ name: 'native-test', description: 'A plugin-injected native skill', content: 'Read this native skill first.' });
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } });
  const session = ctx.sessions.create('capability-native-session', { meta: { cwd: root, createdAt: 1 } });
  ctx.provide('sessionQuery', { async observeSession(id) { assert.equal(id, session.id); return { header: session.header, events: [], [Symbol.dispose]() {} }; } });
  ctx.provide('workspaceRegistry', { list: () => [{ path: root, sessionIds: [session.id] }] });
  ctx.provide('profileContext', { patchPath: '/test-profile/cordis.patch.yml' });
  ctx.provide('loader', { *entries() { yield { options: { name: '@deepseek-ai/dsh-mcp-client' }, fiber: { config: { serverName: 'native-mcp', command: 'native-server', transport: 'stdio', env: { TOKEN: 'native-secret-must-not-return' } } } }; } });
  const fiber = ctx.plugin(plugin, { cliCommands: [], enableO2Discovery: false }); fibers.push(fiber); await fiber.await();
  assert.equal(fiber.state, 2, JSON.stringify(errors));
  assert.deepEqual([...routes.keys()].sort(), ['/api/capability-selector/detail', '/api/capability-selector/scan']);
  const tool = ctx.tools.get('capability_list'); assert.ok(tool);
  async function post(action, input) {
    const response = await routes.get('/api/capability-selector/' + action).fetch(new Request('http://localhost/api/capability-selector/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    return { response, body: await response.json() };
  }
  const invalid = await post('scan', { sessionId: session.id, cwd: '/arbitrary' }); assert.equal(invalid.response.status, 400);
  const scan = await post('scan', { sessionId: session.id }); assert.equal(scan.body.ok, true, JSON.stringify(scan.body));
  assert.ok(scan.body.items.some(item => item.name === 'native-test' && item.runtimeProvider === 'runtime'));
  const office = scan.body.items.filter(item => item.runtimeProvider === 'dsh-office');
  assert.equal(office.length, 7, 'all bundled Office skills are discovered through the real provider');
  assert.ok(office.every(item => item.sources.some(row => row.path.endsWith('/SKILL.md') || row.path.startsWith('provider:'))));
  assert.ok(scan.body.items.some(item => item.name === 'native-mcp' && item.status === 'configured'));
  assert.ok(!JSON.stringify(scan.body).includes('native-secret-must-not-return'));
  assert.ok(!JSON.stringify(scan.body).includes('TOKEN'));
  assert.ok(JSON.stringify(scan.body).length < 2 * 1024 * 1024);
  const target = scan.body.items.find(item => item.name === 'native-test'); const detail = await post('detail', { sessionId: session.id, id: target.id }); assert.equal(detail.body.ok, true);
  const result = await tool.execute({}, { agent: { id: session.id }, signal: new AbortController().signal }); assert.equal(result.cached, true);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await fiber.dispose(); assert.equal(routes.size, 0); assert.equal(ctx.tools.get('capability_list'), undefined);
});
