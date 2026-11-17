import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchHandler, createImageHandler, createSlimService } from '../lib/service.js';
import { strategyFields } from '../lib/core.js';

const ref = n => ({ attachmentId: `sha256:${String(n).repeat(64)}`, width: 2048, height: 1152, mediaType: 'image/png', bytes: 300000, name: `shot${n}.png` });

/** Minimal stand-ins with the same contracts the plugin relies on. */
function fixture({ settings = true, user = {} } = {}) {
  let stored;
  const storageDomain = { async open({ global }) { stored = structuredClone(global.initial); return { global: { get: () => structuredClone(stored), set: async value => { stored = global.schema.parse(structuredClone(value)); } }, async close() {} }; } };
  const layer = { revision: 1, user: structuredClone(user) };
  const mutations = [];
  const settingsService = {
    describe: () => [{ ns: 'llm-pi-ai', revision: layer.revision, user: { providers: structuredClone(layer.user) }, value: { providers: Object.fromEntries(['claude-relay', 'codex-relay'].map(route => [route, { api: 'x', ...layer.user[route] }])) } }],
    async mutate(ns, ops, revision) {
      assert.equal(ns, 'llm-pi-ai');
      if (revision !== layer.revision) throw Object.assign(new Error('conflict'), { name: 'SettingsConflictError' });
      mutations.push(ops);
      for (const op of ops) {
        const [, route, field] = op.path;
        layer.user[route] ??= {};
        if (op.op === 'set') layer.user[route][field] = op.value; else delete layer.user[route][field];
      }
      layer.revision++;
    },
  };
  const reads = [];
  const attachments = {
    async readImageRequest(r, target) { reads.push(target); const bytes = Math.min(target.maxBytes, Math.round(target.width * target.height / 10)); return { data: new Uint8Array(bytes), bytes, width: target.width, height: target.height, mediaType: 'image/jpeg' }; },
    async readImage(r) { return { data: new Uint8Array(r.bytes), mediaType: r.mediaType }; },
  };
  const sessionQuery = {
    async listSessions() { return [{ header: { id: 'old', createdAt: 1 } }, { header: { id: 'new', createdAt: 2 } }]; },
    async readSurface(id) {
      const images = { cur: [ref(1)], new: [ref(2), ref(1)], old: [ref(3)] }[id] ?? [];
      return { events: images.map((attachment, i) => ({ seq: i + 1, type: 'user/message', data: { content: [{ type: 'image', attachment }] } })) };
    },
  };
  const service = createSlimService({ storageDomain });
  if (settings) service.bind('settings', settingsService);
  service.bind('attachments', attachments);
  service.bind('sessionQuery', sessionQuery);
  return { service, layer, mutations, reads, get stored() { return stored; } };
}

test('enable writes both fields to every route, notice follows applied routes, disable restores exactly', async () => {
  const f = fixture({ user: { 'claude-relay': { requestImageMaxBytes: 777 } } });
  await f.service.ready;
  let state = await f.service.update({ enabled: true, strategy: 'saver' });
  assert.deepEqual(state.applied, ['claude-relay', 'codex-relay']);
  assert.equal(f.layer.user['codex-relay'].requestImagePixelBudget, 1280 * 720);
  assert.equal(f.layer.user['claude-relay'].requestImageMaxBytes, 120 * 1024);
  assert.match(f.service.noticeFor('claude-relay'), /921,600 pixels/);
  assert.equal(f.service.noticeFor('deepseek'), '');
  assert.deepEqual(state.drift, []);

  state = await f.service.update({ strategy: 'fidelity' });
  assert.equal(f.layer.user['claude-relay'].requestImagePixelBudget, strategyFields('fidelity').requestImagePixelBudget);

  state = await f.service.update({ enabled: false });
  assert.deepEqual(f.layer.user['claude-relay'], { requestImageMaxBytes: 777 });
  assert.deepEqual(f.layer.user['codex-relay'], {});
  assert.deepEqual(state.applied, []);
  assert.equal(f.service.noticeFor('claude-relay'), '');
  await f.service.dispose();
});

test('route selection restores the deselected route only', async () => {
  const f = fixture();
  await f.service.update({ enabled: true });
  const state = await f.service.update({ routes: ['codex-relay'] });
  assert.deepEqual(state.applied, ['codex-relay']);
  assert.deepEqual(f.layer.user['claude-relay'], {});
  assert.equal(f.layer.user['codex-relay'].requestImagePixelBudget, strategyFields('balanced').requestImagePixelBudget);
});

test('uplink changes do not touch config; drift is reported and re-apply fixes it', async () => {
  const f = fixture();
  await f.service.update({ enabled: true });
  const writes = f.mutations.length;
  await f.service.update({ uplinkKBps: 120 });
  assert.equal(f.mutations.length, writes);
  f.layer.user['codex-relay'].requestImagePixelBudget = 1;
  assert.deepEqual(f.service.snapshot().drift, ['codex-relay']);
  await f.service.update({ reapply: true });
  assert.deepEqual(f.service.snapshot().drift, []);
});

test('missing settings service refuses to enable but still saves preferences', async () => {
  const f = fixture({ settings: false });
  await assert.rejects(f.service.update({ enabled: true }), { code: 'settings_unavailable' });
  const state = await f.service.update({ uplinkKBps: 50 });
  assert.equal(state.uplinkKBps, 50);
  assert.equal(state.capabilities.settings, false);
});

test('samples: current session first, deduplicated, then newest sessions; estimate totals per variant', async () => {
  const f = fixture();
  const samples = await f.service.execute({ action: 'samples', sessionId: 'cur' });
  assert.deepEqual(samples.images.map(image => image.id.slice(7, 8)), ['1', '2', '3']);
  assert.equal(samples.images[0].current, true);
  const estimate = await f.service.execute({ action: 'estimate', ids: samples.images.map(image => image.id) });
  assert.equal(estimate.images.length, 3);
  assert.ok(estimate.totals['dsh-default'] > estimate.totals.balanced);
  assert.ok(estimate.totals.balanced > estimate.totals.minimal);
  assert.deepEqual(estimate.images[0].versions.saver, { bytes: 92160, width: 1280, height: 720, mediaType: 'image/jpeg' });
  const before = f.reads.length;
  await f.service.execute({ action: 'estimate', ids: [samples.images[0].id] });
  assert.equal(f.reads.length, before, 'versions are cached');
});

test('HTTP handlers: JSON errors, size limits, image bytes', async () => {
  const f = fixture();
  const handler = createFetchHandler(f.service);
  const post = body => handler(new Request('http://x/api/upload-slim/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
  let response = await post('{bad');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_json');
  response = await post(JSON.stringify({ action: 'state' }));
  assert.equal((await response.json()).ok, true);
  response = await post(JSON.stringify({ action: 'update', strategy: 'nope' }));
  assert.equal((await response.json()).error, 'unknown_strategy');
  response = await post('x'.repeat(20000));
  assert.equal(response.status, 413);

  const samples = await f.service.execute({ action: 'samples', sessionId: 'cur' });
  const image = createImageHandler(f.service);
  const id = encodeURIComponent(samples.images[0].id);
  response = await image(new Request(`http://x/api/upload-slim/image?id=${id}&variant=saver`));
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal((await response.arrayBuffer()).byteLength, 92160);
  response = await image(new Request(`http://x/api/upload-slim/image?id=${id}&variant=source`));
  assert.equal((await response.arrayBuffer()).byteLength, 300000);
  response = await image(new Request(`http://x/api/upload-slim/image?id=sha256:zz&variant=saver`));
  assert.equal(response.status, 404);
  response = await image(new Request(`http://x/api/upload-slim/image?id=${id}&variant=../../etc`));
  assert.equal(response.status, 400);
});

test('stale revision surfaces as settings_conflict and keeps originals for retry', async () => {
  const f = fixture();
  const original = f.service.snapshot;
  await f.service.ready;
  const settings = { describe: () => [{ ns: 'llm-pi-ai', revision: 0, user: { providers: {} }, value: { providers: { a: {} } } }], mutate: async () => { throw Object.assign(new Error('stale'), { name: 'SettingsConflictError' }); } };
  f.service.bind('settings', settings);
  await assert.rejects(f.service.update({ enabled: true }), { code: 'settings_conflict' });
  assert.ok(f.stored.originals.a, 'originals recorded before the failed write');
  assert.equal(f.stored.enabled, false, 'preferences roll back when config was not written');
  assert.equal(typeof original, 'function');
});

test('dispose is idempotent and rejects later work', async () => {
  const f = fixture();
  await f.service.dispose();
  await f.service.dispose();
  await assert.rejects(f.service.update({ enabled: true }), { code: 'plugin_closed' });
  assert.equal(f.service.noticeFor('claude-relay'), '');
});
