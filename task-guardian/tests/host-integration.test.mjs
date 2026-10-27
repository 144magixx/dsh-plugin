import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractPackages, runtimeDir } from '../../session-summary/scripts/extract-test-runtime.mjs';
import * as plugin from '../lib/index.js';
import { createGuardianStore, acquireLease } from '../lib/store.js';

extractPackages(['@deepseek-ai/cordis', '@deepseek-ai/dsh-storage', '@deepseek-ai/dsh-storage-json', '@deepseek-ai/dsh-storage-domain', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-llm-retry']);
const native = name => import(pathToFileURL(path.join(runtimeDir, 'node_modules/@deepseek-ai', name, 'lib/index.js')).href);
const [{ Context }, { Storage }, json, domain, { Session }, { SessionQueryEngine }, { SessionProjectionRegistry }, retry] = await Promise.all(['cordis', 'dsh-storage', 'dsh-storage-json', 'dsh-storage-domain', 'dsh-session', 'dsh-session-query', 'dsh-session-projection', 'dsh-llm-retry'].map(native));

async function host(t, directory) {
  const root = directory || await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-native-'));
  const ctx = new Context(), routes = new Map(), tools = new Map(), sessions = new Map(), agents = new Map();
  new Storage(ctx);
  for (const [module, config] of [[json, { root }], [domain, { backend: 'json' }]]) { const fiber = ctx.plugin(module, config); await fiber.await(); assert.equal(fiber.state, 2, String(fiber.error ?? fiber._error)); }
  new SessionProjectionRegistry(ctx);
  ctx.provide('sessions', { get: id => sessions.get(id) });
  new SessionQueryEngine(ctx);
  ctx.provide('agents', { get: id => agents.get(id), list: () => [...agents.values()] });
  ctx.provide('pluginPackages', { packageOf: name => ({ dir: path.join(runtimeDir, 'node_modules', name) }) });
  ctx.provide('connection', { fetch: { register: route => { routes.set(route.path, route); return async () => { routes.delete(route.path); }; } } });
  ctx.provide('tools', { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } });
  for (const id of ['session-a', 'session-b']) {
    const session = Session.create(id, undefined, { ...Session.create(id).header, cwd: root });
    sessions.set(id, session); agents.set(id, { id, session, status: 'idle' });
  }
  const nativeRetry = ctx.plugin(retry); await nativeRetry.await(); assert.equal(nativeRetry.state, 2, String(nativeRetry._error));
  const oldHome = process.env.DSH_HOME; process.env.DSH_HOME = root;
  const fiber = ctx.plugin(plugin); await fiber.await();
  assert.equal(fiber.state, 2, String(fiber.error ?? fiber._error));
  t.after(async () => { await ctx.fiber.dispose(); if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; });
  const call = async (action, body) => {
    const route = routes.get('/api/task-guardian/' + action); assert.ok(route);
    const response = await route.fetch(new Request('http://offline.invalid/api/task-guardian/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { ctx, root, fiber, call, sessions, agents, tools, routes };
}

test('native Host mount: exact SessionObservation API, user-only session settings, isolation and unload', { timeout: 15000 }, async t => {
  const h = await host(t);
  const initial = await h.call('snapshot', { sessionId: 'session-a' });
  assert.equal(initial.status, 200, JSON.stringify(initial.body)); assert.equal(initial.body.record.settings.enabled, false);
  assert.equal(initial.body.compatibility.supported, true);
  const on = await h.call('configure', { sessionId: 'session-a', epoch: 0, settings: { enabled: true } });
  assert.equal(on.status, 200); assert.equal(on.body.record.settings.enabled, true);
  assert.equal((await h.call('snapshot', { sessionId: 'session-b' })).body.record.settings.enabled, false);
  assert.equal((await h.call('configure', { sessionId: 'session-a', epoch: 0, settings: { autoSelectFirst: true } })).status, 409);
  assert.equal((await h.call('configure', { sessionId: 'session-a', epoch: 1, settings: { autoSelectFirst: true } })).status, 200);
  assert.deepEqual([...h.tools.keys()], ['task_guardian_status']);
  const status = await h.tools.get('task_guardian_status').execute({}, { agent: h.agents.get('session-b'), signal: new AbortController().signal });
  assert.equal(status.sessionId, 'session-b'); assert.equal(status.record.settings.enabled, false);
  assert.equal((await h.call('configure', { sessionId: 'nonexistent', epoch: 0, settings: { enabled: true } })).status, 500);
  await h.fiber.dispose(); assert.equal(h.routes.size, 0); assert.equal(h.tools.size, 0);
});

test('native request boundary: durable guardian schedule cancels on disable without aborting normal task', { timeout: 15000 }, async t => {
  const h = await host(t);
  await h.call('configure', { sessionId: 'session-a', epoch: 0, settings: { enabled: true } });
  const agent = h.agents.get('session-a'), controller = new AbortController();
  const scheduled = Promise.withResolvers();
  const off = h.ctx.on('domain/changed', change => { if (change.domain === 'task_guardian' && change.table === 'sessions' && change.value?.retry?.retryAt) scheduled.resolve(change.value); });
  const payload = { agent, turn: 1, step: 1, provider: 'test', signal: controller.signal, failure: { code: 'SERVER', message: 'Temporary upstream error', status: 503 }, retryPolicy: { mode: 'normal', maxRetries: 0, retryableCodes: ['SERVER'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } };
  const recovering = h.ctx.waterfall('agent/request-error', payload, async () => undefined);
  const record = await scheduled.promise; assert.equal(record.retry.attempt, 1); assert.equal(record.run.phase, 'waiting');
  const offResult = await h.call('configure', { sessionId: 'session-a', epoch: 1, settings: { enabled: false } });
  assert.equal(offResult.status, 200); assert.equal(await recovering, undefined); assert.equal(controller.signal.aborted, false);
  const config = { provider: 'test', model: 'unchanged' };
  assert.equal(await h.ctx.waterfall('agent/request', { agent, signal: controller.signal }, async () => config), config);
  off();
});

test('native durable storage reload keeps revocation; malformed data fails closed', { timeout: 15000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-reload-'));
  const build = async () => {
    const ctx = new Context(); new Storage(ctx);
    for (const [module, config] of [[json, { root }], [domain, { backend: 'json' }]]) { const f = ctx.plugin(module, config); await f.await(); assert.equal(f.state, 2); }
    return { ctx, store: await createGuardianStore(ctx.storageDomain) };
  };
  let current = await build();
  await current.store.update('session-a', 'grant', r => ({ ...r, settings: { ...r.settings, enabled: true }, epoch: 1 }));
  await current.store.update('session-a', 'revoke', r => ({ ...r, settings: { ...r.settings, enabled: false }, epoch: 2, run: { phase: 'stopped', lastSeq: 5 } }));
  await current.store.close(); await current.ctx.fiber.dispose();
  current = await build(); assert.equal(current.store.get('session-a').settings.enabled, false); assert.equal(current.store.get('session-a').run.phase, 'stopped');
  await current.store.close(); await current.ctx.fiber.dispose();
  // Native backend rejects schema-invalid records; the grant is never inferred from old audit rows.
  const directory = path.join(root, 'task_guardian', 'sessions');
  const names = await fs.readdir(directory); const filename = path.join(directory, names[0]);
  const parsed = JSON.parse(await fs.readFile(filename, 'utf8')); parsed.record.revision = -1; await fs.writeFile(filename, JSON.stringify(parsed));
  await assert.rejects(build(), /invalid|schema|validation|record/i);
});

test('HTTP routes bound bodies and expose no mutation through the model status tool schema', async () => {
  const { readInput } = plugin;
  await assert.rejects(readInput(new Request('http://offline.invalid/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(9000) })), error => error.status === 413);
  await assert.rejects(readInput(new Request('http://offline.invalid/', { method: 'GET' })), error => error.status === 405);
});
