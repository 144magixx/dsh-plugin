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

/** Mirrors the Host update drain: locked admission answers 503; drain waits for consumed bodies. */
function drainableConnection() {
  const routes = new Map(), active = new Set();
  let locked = false;
  async function call(request) {
    if (locked) return new Response(JSON.stringify({ ok: false, error: 'admission_locked' }), { status: 503 });
    const token = Symbol('request'); active.add(token);
    try {
      const response = await routes.get(new URL(request.url).pathname).fetch(request);
      const body = new Uint8Array(await response.arrayBuffer());
      return new Response(body, { status: response.status, headers: response.headers });
    } finally { active.delete(token); }
  }
  return {
    routes, active,
    lock() { locked = true; }, unlock() { locked = false; },
    async drain(limitMs) {
      const started = performance.now();
      while (active.size) { if (performance.now() - started > limitMs) throw new Error('drain timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
      return performance.now() - started;
    },
    service: { fetch: { register(route) { assert.ok(!routes.has(route.path)); routes.set(route.path, route); return () => routes.delete(route.path); } } },
    async post(body, signal) {
      const response = await call(new Request('http://localhost' + plugin.ACTION_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }));
      return { status: response.status, value: await response.json() };
    },
    get: url => call(new Request('http://localhost' + url)),
  };
}

const ref = n => ({ attachmentId: `sha256:${String(n).repeat(64)}`, width: 2048, height: 1152, mediaType: 'image/png', bytes: 300000 });

function fakeHostServices() {
  const layer = { revision: 0, user: {} };
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision: layer.revision, user: { providers: structuredClone(layer.user) }, value: { providers: { 'claude-relay': { ...layer.user['claude-relay'] }, google: { ...layer.user.google } } } }],
    async mutate(ns, ops, revision) {
      if (ns !== 'llm-pi-ai' || revision !== layer.revision) throw Object.assign(new Error('stale'), { name: 'SettingsConflictError' });
      for (const op of ops) { const [, route, field] = op.path; layer.user[route] ??= {}; if (op.op === 'set') layer.user[route][field] = op.value; else delete layer.user[route][field]; }
      layer.revision++;
    },
  };
  const attachments = {
    async readImageRequest(r, target, signal) { signal?.throwIfAborted(); const bytes = Math.min(target.maxBytes, Math.round(target.width * target.height / 8)); return { data: new Uint8Array(bytes), bytes, width: target.width, height: target.height, mediaType: 'image/jpeg' }; },
    async readImage(r) { return { data: new Uint8Array(r.bytes), mediaType: r.mediaType }; },
  };
  const sessionQuery = {
    async listSessions() { return [{ header: { id: 's1', createdAt: 5 } }]; },
    async readSurface() { return { events: [{ seq: 1, type: 'user/message', data: { content: [{ type: 'image', attachment: ref(1) }, { type: 'image', attachment: ref(2) }] } }] }; },
  };
  return { layer, settings, attachments, sessionQuery };
}

test('native Cordis + storage domain + system prompt: switch, preview, notice, drain, reload', { timeout: 30000 }, async () => {
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
    assert.equal(fiber.state, 2, `${typeof target === 'string' ? target : 'upload-slim'}: ${String(fiber.error ?? fiber._error)} ${JSON.stringify(errors)}`);
    return fiber;
  }
  const connection = drainableConnection();
  const host = fakeHostServices();
  const promptFor = async provider => (await ctx.systemPrompt.assemble({ modelSelection: { provider, model: 'm' } })).sections.find(section => section.name === plugin.SECTION)?.text ?? '';
  try {
    await mount('dsh-system-prompt');
    await mount('dsh-storage');
    await mount('dsh-storage-json', { root: path.join(root, 'storage') });
    await mount('dsh-storage-domain', { backend: 'json' });
    ctx.provide('connection', connection.service);
    ctx.provide('settings', host.settings);
    ctx.provide('attachments', host.attachments);
    ctx.provide('sessionQuery', host.sessionQuery);
    let slim = await mount(plugin);
    assert.ok(connection.routes.has(plugin.ACTION_ROUTE) && connection.routes.has(plugin.IMAGE_ROUTE), 'routes registered');

    let result = await connection.post({ action: 'state' });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.deepEqual(result.value.available.map(route => route.id), ['claude-relay', 'google']);
    assert.equal(result.value.capabilities.settings, true);
    assert.equal(await promptFor('claude-relay'), '', 'no notice while off');

    result = await connection.post({ action: 'update', enabled: true, strategy: 'saver', routes: ['claude-relay'] });
    assert.equal(result.value.ok, true, JSON.stringify(result.value));
    assert.deepEqual(host.layer.user['claude-relay'], { requestImagePixelBudget: 921600, requestImageMaxBytes: 122880 });
    assert.equal(host.layer.user.google, undefined, 'unselected route untouched');
    assert.match(await promptFor('claude-relay'), /921,600 pixels/, 'notice on the slimmed route');
    assert.equal(await promptFor('google'), '', 'no notice on other routes');

    // DSH 0.2.1 assembles without `modelSelection`; its per-Agent listener adds the route as variables.provider after the waterfall.
    let legacyProvider = 'claude-relay';
    const releaseLegacy = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembled = await next();
      return { ...assembled, variables: { ...assembled.variables, provider: legacyProvider } };
    });
    const legacyPrompt = async () => (await ctx.systemPrompt.assemble({})).sections.find(section => section.name === plugin.SECTION)?.text ?? '';
    assert.match(await legacyPrompt(), /921,600 pixels/, 'notice reaches routes of hosts without modelSelection in the assembly context');
    legacyProvider = 'google';
    assert.equal(await legacyPrompt(), '', 'no notice on other routes (legacy host)');
    releaseLegacy();
    assert.equal(await legacyPrompt(), '', 'no notice when the host reports no route at all');

    // Preview: samples, estimate and real image bodies.
    result = await connection.post({ action: 'samples', sessionId: 's1' });
    assert.equal(result.value.images.length, 2);
    const ids = result.value.images.map(image => image.id);
    result = await connection.post({ action: 'estimate', ids });
    assert.ok(result.value.totals['dsh-default'] > result.value.totals.saver);
    const imageResponse = await connection.get(`${plugin.IMAGE_ROUTE}?id=${encodeURIComponent(ids[0])}&variant=saver`);
    assert.equal(imageResponse.status, 200);
    assert.equal((await imageResponse.arrayBuffer()).byteLength, 1280 * 720 / 8);

    // Host update drain while a client keeps polling state.
    let polling = true, polls = 0;
    const poller = (async () => { while (polling) { await connection.post({ action: 'state' }); polls++; await new Promise(resolve => setTimeout(resolve, 15)); } })();
    await new Promise(resolve => setTimeout(resolve, 60));
    connection.lock();
    const drained = await connection.drain(3000);
    assert.ok(drained < 3000, `drained in ${drained}ms`);
    assert.equal((await connection.post({ action: 'state' })).status, 503);
    connection.unlock();
    polling = false; await poller;
    assert.ok(polls > 0);
    assert.equal((await connection.post({ action: 'state' })).status, 200, 'recovers after unlock');

    // Disable/enable the plugin: preferences persist, routes and notice are released, config untouched by reloads.
    for (let round = 0; round < 3; round++) {
      await slim.dispose();
      assert.equal(connection.routes.size, 0, 'routes removed on unload');
      assert.equal(await promptFor('claude-relay'), '', 'notice removed on unload');
      assert.equal(host.layer.user['claude-relay'].requestImagePixelBudget, 921600, 'unload does not write config');
      slim = await mount(plugin);
    }
    result = await connection.post({ action: 'state' });
    assert.equal(result.value.enabled, true, 'persisted across reloads');
    assert.deepEqual(result.value.applied, ['claude-relay']);
    assert.match(await promptFor('claude-relay'), /921,600 pixels/, 'notice back after reload');

    // Switching off restores exactly (fields were absent before → unset).
    result = await connection.post({ action: 'update', enabled: false });
    assert.equal(result.value.ok, true);
    assert.deepEqual(host.layer.user['claude-relay'], {});
    assert.equal(await promptFor('claude-relay'), '');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    for (const fiber of fibers.reverse()) { try { await fiber.dispose(); } catch {} }
    // Windows may still hold the JSON storage files for a moment after dispose (EBUSY/EPERM).
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
