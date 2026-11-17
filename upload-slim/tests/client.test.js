import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Reuse the workspace's existing React install; no server or browser is needed.
const requireReact = createRequire(new URL('../../mermaid-diagrams-preview/package.json', import.meta.url));
const React = requireReact('react');
const { renderToStaticMarkup } = requireReact('react-dom/server');
let registration;
vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: value => { registration = value; } } }, Intl, console, setTimeout, clearTimeout, AbortController, Response,
});
const client = registration.factory(name => { assert.equal(name, 'react'); return React; });
const T = client.__test;
const t = (key, params = {}) => String(T.ZH[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params[name]);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

const DATA = {
  ok: true, enabled: true, strategy: 'balanced', routes: null, uplinkKBps: 80, targets: ['claude-relay', 'codex-relay'], applied: ['claude-relay', 'codex-relay'], drift: [],
  available: [{ id: 'claude-relay', displayName: 'claude-relay', api: 'anthropic-messages', pixels: 1440000, maxBytes: 204800, managed: true }, { id: 'codex-relay', displayName: 'codex-relay', pixels: 1440000, maxBytes: 204800, managed: true }],
  strategies: [{ id: 'fidelity', pixels: 2048 * 1152, maxBytes: 409600 }, { id: 'balanced', pixels: 1440000, maxBytes: 204800 }, { id: 'saver', pixels: 921600, maxBytes: 122880 }, { id: 'minimal', pixels: 518400, maxBytes: 61440 }],
  notice: '# Upload slimming', capabilities: { settings: true, attachments: true, sessions: true },
};
const staticStore = state => ({ getSnapshot: () => state, subscribe: () => () => {}, load: async () => {}, sample: async () => {}, update: async () => {}, select() {}, clearToast() {} });

test('every Chinese string has an English counterpart', () => {
  assert.deepEqual(Object.keys(T.ZH).sort(), Object.keys(T.EN).sort());
});

test('page renders status, strategy cards with real estimates and the route list', () => {
  const estimate = { images: [{ id: 'a', versions: {} }, { id: 'b', versions: {} }], totals: { 'dsh-default': 4 * 1048576, balanced: 1048576, fidelity: 2097152, saver: 700000, minimal: 400000 } };
  const html = renderToStaticMarkup(React.createElement(T.Page, { store: staticStore({ status: 'ready', data: DATA, estimate, samples: [], toast: '' }), t, fetchImpl: async () => new Response('') }));
  assert.match(html, /已对 2 条路由生效：claude-relay、codex-relay/);
  assert.match(html, /aria-checked="true"[^>]*>.*?均衡/s);
  assert.match(html, /样本 2 张：1\.0 MB/);
  assert.match(html, /比默认少 75%/);
  assert.match(html, /每轮约需 13 秒上传/);
  assert.match(html, /DSH 默认（关闭时）：样本 2 张：4\.0 MB/);
  assert.match(html, /claude-relay.*协议 anthropic-messages/s);
  assert.match(html, /插件管理中/);
});

test('off state, drift and missing settings are explained', () => {
  const html = renderToStaticMarkup(React.createElement(T.Page, { store: staticStore({ status: 'ready', data: { ...DATA, enabled: false, drift: ['codex-relay'], capabilities: { ...DATA.capabilities, settings: false } }, samples: [], toast: '' }), t, fetchImpl: async () => new Response('') }));
  assert.match(html, /未开启：图片按 DSH 默认/);
  assert.match(html, /codex-relay 的图片参数被别处改过/);
  assert.match(html, /DSH 设置服务不可用/);
  assert.match(html, /role="switch"[^>]*disabled/);
});

test('chip only shows while slimming is active', () => {
  const on = renderToStaticMarkup(React.createElement(T.Chip, { store: staticStore({ data: DATA }), t, openPage() {} }));
  assert.match(on, /瘦身·均衡/);
  const off = renderToStaticMarkup(React.createElement(T.Chip, { store: staticStore({ data: { ...DATA, enabled: false } }), t, openPage() {} }));
  assert.equal(off, '');
});

test('store: load, update, sample + estimate flow, errors keep the last good data', async () => {
  const calls = [];
  const replies = {
    state: () => ({ ok: true, ...DATA, enabled: false }),
    update: input => ({ ok: true, ...DATA, enabled: input.enabled ?? true }),
    samples: () => ({ ok: true, images: [{ id: 'img1' }, { id: 'img2' }] }),
    estimate: () => ({ ok: true, images: [], totals: { balanced: 1 } }),
  };
  let failUpdate = false;
  const store = T.createStore(async input => {
    calls.push(input);
    if (input.action === 'update' && failUpdate) throw new Error('stale');
    return replies[input.action](input);
  }, { currentSession: () => 'sess-1' });
  await store.load();
  assert.equal(store.getSnapshot().data.enabled, false);
  await store.update({ enabled: true });
  assert.equal(store.getSnapshot().data.enabled, true);
  assert.equal(store.getSnapshot().toast, 'saved');
  failUpdate = true;
  await store.update({ enabled: false });
  assert.equal(store.getSnapshot().error, 'stale');
  assert.ok(store.getSnapshot().data, 'data survives a failed update');
  await store.sample();
  await settle();
  assert.equal(calls.find(call => call.action === 'samples').sessionId, 'sess-1');
  assert.deepEqual(calls.find(call => call.action === 'estimate').ids, ['img1', 'img2']);
  assert.equal(store.getSnapshot().selected, 'img1');
  store.dispose();
});

test('image URLs are encoded', () => {
  assert.equal(T.imageURL('sha256:ab', 'dsh-default'), '/api/upload-slim/image?id=sha256%3Aab&variant=dsh-default');
  assert.deepEqual(JSON.parse(JSON.stringify(T.ratioSide(1440000))), { w: 1600, h: 900 });
});
