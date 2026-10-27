import test from 'node:test';
import assert from 'node:assert/strict';
import { client } from './client-core.mjs';

const { createStore, sanitizePrefs, createSummaryCache, createApi, cardPlacement, summaryLayout, STORAGE_KEY } = client;
const defaultCollapsed = { subagents: true, sources: true, plan: true, files: true, jobs: true, related: true };
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, map };
}

test('window defaults replace old saved UI state while only position persists', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ pinned: true, collapsed: { sources: true, bogus: true, jobs: false }, extra: 1 }) });
  const { prefs } = harness({}, storage).api;
  assert.deepEqual(plain(prefs.getSnapshot()), { pinned: true, collapsed: defaultCollapsed, floating: false, position: null });
  let notified = 0;
  prefs.subscribe(() => { notified++; });
  prefs.set({ pinned: true });
  assert.equal(notified, 0, 'unchanged values do not notify');
  prefs.set({ pinned: false });
  assert.equal(notified, 1);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)), { position: null });
  const broken = createStore(sanitizePrefs({}), { storage: memoryStorage({ [STORAGE_KEY]: '{not json' }), key: STORAGE_KEY, sanitize: sanitizePrefs });
  assert.equal(broken.getSnapshot().pinned, true);
  const failing = createStore({ a: 1 }, { storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } }, key: 'k' });
  failing.set({ a: 2 });
  assert.equal(failing.getSnapshot().a, 2, 'storage failures keep the in-memory state usable');
});

test('summary cache maps Host responses, never retries automatically and retries on request', async () => {
  const calls = [];
  const replies = { 1: { status: 200, ok: true, json: async () => ({ turn: 1, files: [{ path: 'a', display: 'a', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }) }, 2: { status: 404, ok: false }, 3: { status: 500, ok: false }, 5: { status: 200, ok: true, json: async () => ({ nope: true }) } };
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, 'same-origin');
    const seq = Number(new URL(url, 'http://x/').searchParams.get('seq'));
    if (seq === 4) throw new Error('offline');
    return replies[seq];
  };
  const cache = createSummaryCache(fetchImpl);
  let published = 0;
  cache.subscribe(() => { published++; });
  for (const seq of [1, 2, 3, 4, 5]) cache.ensure('s', seq);
  assert.equal(cache.entry('s', 1).status, 'loading');
  await tick(); await tick();
  assert.deepEqual([1, 2, 3, 4, 5].map(seq => cache.entry('s', seq).status), ['ok', 'missing', 'error', 'error', 'error']);
  assert.ok(published >= 10);
  for (const seq of [1, 2, 3, 4, 5]) cache.ensure('s', seq);
  assert.equal(calls.length, 5, 'existing entries, including failures, are not refetched automatically');
  cache.retry('s');
  assert.equal(cache.entry('s', 1).status, 'ok', 'retry keeps successful summaries');
  assert.equal(cache.entry('s', 3), undefined);
  for (const seq of [1, 2, 3, 4, 5]) cache.ensure('s', seq);
  assert.equal(calls.length, 9);
  cache.ensure('s', 1.5); cache.ensure(undefined, 1);
  assert.equal(calls.length, 9, 'invalid coordinates are ignored');
  cache.dispose();
  cache.ensure('s', 99);
  assert.equal(calls.length, 9, 'a disposed cache reads nothing');
});

function harness(services = {}, storage = memoryStorage()) {
  const ctx = { get: name => services[name] };
  const opened = [];
  const api = createApi(ctx, {
    storage,
    fetchImpl: async () => ({ status: 404, ok: false }),
    transportFetch: async (url, init) => ({ json: async () => (services.sideBranchReply?.(url, init) ?? { ok: false }) }),
    clipboard: services.clipboard,
    openWindow: url => opened.push(url),
  });
  return { api, opened };
}

test('open, close, pin and session ownership follow the Codex pinned-summary model', () => {
  const { api } = harness();
  assert.equal(api.prefs.getSnapshot().pinned, true, 'a fresh installation opens and pins automatically');
  api.togglePin('a');
  assert.equal(api.ui.getSnapshot().openSession, 'a');
  api.forgetOtherSession('a');
  assert.equal(api.ui.getSnapshot().openSession, 'a');
  api.forgetOtherSession('b');
  assert.equal(api.ui.getSnapshot().openSession, null, 'an unpinned card closes when another session header mounts');
  api.open('a');
  api.togglePin('a');
  assert.equal(api.prefs.getSnapshot().pinned, true);
  api.forgetOtherSession('b');
  assert.equal(api.ui.getSnapshot().openSession, 'a', 'a pinned card survives session switches');
  api.togglePin('b');
  assert.deepEqual([api.prefs.getSnapshot().pinned, api.ui.getSnapshot().openSession], [false, 'b'], 'unpinning keeps the card open where it is');
  api.togglePin('b');
  api.close();
  assert.deepEqual([api.prefs.getSnapshot().pinned, api.ui.getSnapshot().openSession], [false, null], 'close also unpins');
  api.toggleSection('sources'); api.toggleSection('bogus');
  assert.deepEqual(plain(api.prefs.getSnapshot().collapsed), { subagents: true, plan: true, files: true, jobs: true, related: true });
  api.toggleSection('sources');
  assert.deepEqual(plain(api.prefs.getSnapshot().collapsed), defaultCollapsed);
});

test('published view keeps model and anchor per session and ignores stale unpublish', () => {
  const { api } = harness();
  api.publish('a', { model: { m: 1 }, context: { cwd: 'E:/w' } });
  api.publishAnchor('a', { right: 900, top: 60, width: 320, maxHeight: 500 });
  const first = api.view.getSnapshot();
  api.publishAnchor('a', { right: 900, top: 60, width: 320, maxHeight: 500 });
  assert.equal(api.view.getSnapshot(), first, 'identical anchors do not republish');
  api.publish('a', { model: { m: 2 }, context: { cwd: 'E:/w' } });
  assert.deepEqual(plain(api.view.getSnapshot().view), { sessionId: 'a', model: { m: 2 }, context: { cwd: 'E:/w' }, anchor: { right: 900, top: 60, width: 320, maxHeight: 500 } });
  api.publish('b', { model: { m: 3 } });
  assert.equal(api.view.getSnapshot().view.anchor, undefined, 'another session does not inherit the anchor');
  api.unpublish('a');
  assert.equal(api.view.getSnapshot().view.sessionId, 'b');
  api.unpublish('b');
  assert.equal(api.view.getSnapshot().view, null);
  api.showTip({ id: 1, text: 'x' });
  api.hideTip(2);
  assert.equal(api.tip.getSnapshot().tip.id, 1);
  api.hideTip(1);
  assert.equal(api.tip.getSnapshot().tip, null);
});

test('navigation uses native services and degrades without them', async () => {
  const calls = [];
  const sidebarRight = { openResource: (address, options) => calls.push(['resource', address, options]), openTab: (kind, options) => calls.push(['tab', kind, options]) };
  const tabs = new Map([['browser', {}], ['files', {}], ['side-branch', {}]]);
  const services = {
    sidebarRight, sidebarRightTabs: { get: kind => tabs.get(kind) },
    uiWorkspace: { openSession: id => calls.push(['session', id]) },
    remote: { skills: { list: async ({ sessionId }) => ({ ok: true, value: { skills: [{ name: 'office', path: 'E:/w/.skills/office/SKILL.md' }, { name: 'other' }] } }) } },
    sessions: { binding: id => ({ session: { loadOlder: () => calls.push(['older', id]) } }), refreshProjections: id => { calls.push(['refresh', id]); return Promise.resolve(); } },
    clipboard: { writeText: async text => calls.push(['copy', text]) },
    sideBranchReply: (url, init) => (url === '/api/side-branch/branch' && JSON.parse(init.body).sessionId === 'cur' ? { ok: true, branch: { sourceSessionId: 'src', turn: 2, mode: 'continue' } } : { ok: false }),
  };
  const { api, opened } = harness(services);
  api.openUrl('https://example.com');
  assert.deepEqual(plain(calls.pop()), ['tab', 'browser', { params: { url: 'https://example.com' } }]);
  tabs.delete('browser');
  api.openUrl('https://example.org');
  assert.deepEqual(opened, ['https://example.org']);
  assert.throws(() => api.openUrl('javascript:alert(1)'), /unsupported URL/);
  api.openSession('x');
  assert.deepEqual(plain(calls.pop()), ['session', 'x']);
  await api.openSkill('s1', 'E:/w', 'office');
  assert.deepEqual(plain(calls.pop()), ['resource', 'dsh-resource://file/session/s1/.skills/office/SKILL.md', null]);
  await assert.rejects(api.openSkill('s1', 'E:/w', 'other'), /other/);
  assert.equal(api.canOpenFilesTab(), true);
  api.openFilesTab();
  assert.deepEqual(plain(calls.pop()), ['tab', 'files', null]);
  await api.copyText('E:/w');
  assert.deepEqual(plain(calls.pop()), ['copy', 'E:/w']);
  api.loadOlder('s1');
  assert.deepEqual(plain(calls.pop()), ['older', 's1']);
  api.refreshProjections('child'); api.refreshProjections('child');
  assert.equal(calls.filter(entry => entry[0] === 'refresh').length, 1, 'child projections are requested once unless forced');
  api.refreshProjections('child', true);
  assert.equal(calls.filter(entry => entry[0] === 'refresh').length, 2);
  assert.equal(api.hasSideBranch(), true);
  assert.deepEqual(plain(await api.sideBranchInfo('cur')), { sourceSessionId: 'src', turn: 2, mode: 'continue' });
  assert.equal(await api.sideBranchInfo('other'), null);

  const bare = harness({}).api;
  assert.throws(() => bare.openResource('dsh-resource://file/session/s/a'), /sidebarRight unavailable/);
  assert.throws(() => bare.openSession('x'), /uiWorkspace unavailable/);
  await assert.rejects(bare.openSkill('s', 'E:/w', 'office'), /skills unavailable/);
  await assert.rejects(bare.copyText('x'), /clipboard unavailable/);
  assert.throws(() => bare.loadOlder('s'), /history paging unavailable/);
  assert.equal(bare.canOpenFilesTab(), false);
  assert.equal(bare.hasSideBranch(), false);
  bare.refreshProjections('child');
});


test('each new window opens pinned with only changes expanded even after closing', () => {
  for (const value of [null, '{broken', '{}', 'null', '{"pinned":"false"}', '{"collapsed":{"sources":true}}']) {
    const storage = memoryStorage(value === null ? {} : { [STORAGE_KEY]: value });
    assert.equal(harness({}, storage).api.prefs.getSnapshot().pinned, true);
  }
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(harness({}, blocked).api.prefs.getSnapshot().pinned, true);
  for (const pinned of [true, false]) {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ pinned, collapsed: { jobs: true } }) });
    const { api } = harness({}, storage);
    assert.equal(api.prefs.getSnapshot().pinned, true);
    assert.deepEqual(plain(api.prefs.getSnapshot().collapsed), defaultCollapsed);
  }
  const storage = memoryStorage();
  const { api } = harness({}, storage);
  api.toggleSection('sources');
  api.toggleSection('changes');
  api.close();
  assert.equal(api.prefs.getSnapshot().pinned, false, 'close stays effective inside this window');
  const nextWindow = harness({}, storage).api;
  assert.equal(nextWindow.prefs.getSnapshot().pinned, true, 'a new window opens pinned again');
  assert.deepEqual(plain(nextWindow.prefs.getSnapshot().collapsed), defaultCollapsed);
  api.open('a');
  api.togglePin('a');
  assert.equal(harness({}, storage).api.prefs.getSnapshot().pinned, true, 'pinning is remembered on reload');
});

test('drag positions persist independently of pin state and reject invalid coordinates', () => {
  const storage = memoryStorage();
  const { api } = harness({}, storage);
  api.setPosition({ left: 123.5, top: 80 });
  assert.deepEqual(plain(harness({}, storage).api.prefs.getSnapshot().position), { left: 123.5, top: 80 });
  assert.equal(api.prefs.getSnapshot().pinned, true);
  api.close();
  assert.deepEqual(plain(api.prefs.getSnapshot().position), { left: 123.5, top: 80 });
  api.setPosition(null);
  assert.equal(harness({}, storage).api.prefs.getSnapshot().position, null);
  for (const position of [{ left: NaN, top: 1 }, { left: 1, top: Infinity }, { left: '3', top: 4 }, [], null]) {
    assert.equal(sanitizePrefs({ position }).position, null);
  }
});

test('card placement keeps dragged, anchored and resized cards inside the viewport', () => {
  const anchor = { right: 1000, top: 60, width: 340, maxHeight: 600 };
  assert.deepEqual(plain(cardPlacement(anchor, null, { width: 1200, height: 900 }, 400)), { left: 660, top: 60, width: 340, maxHeight: 600 });
  for (const viewport of [{ width: 1200, height: 900 }, { width: 300, height: 200 }, { width: 180, height: 120 }]) {
    for (const position of [null, { left: -500, top: -200 }, { left: 9000, top: 9000 }]) {
      for (const height of [100, 600, 1000]) {
        const box = cardPlacement(anchor, position, viewport, height);
        assert.ok(box.left >= 12 && box.top >= 12);
        assert.ok(box.left + box.width <= viewport.width - 12);
        assert.ok(box.top + Math.min(height, box.maxHeight) <= viewport.height - 12);
      }
    }
  }
});


test('companion controls keep reserved space below long, docked and dragged summaries', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 760, height: 480 }, { width: 320, height: 190 }]) {
    const anchor = summaryLayout({ width: viewport.width, right: viewport.width, bottom: 60 }, viewport, false);
    for (const position of [null, { left: 9999, top: 9999 }, { left: -99, top: -99 }]) {
      const box = cardPlacement(anchor, position, viewport, 10000, 48);
      assert.ok(box.top + box.maxHeight + 48 <= viewport.height - 12, JSON.stringify({ viewport, box }));
      assert.ok(box.top >= 12 && box.maxHeight >= 1);
    }
  }
});

test('default layout reserves a side column or a narrow-window summary row', () => {
  const viewport = { width: 1440, height: 900 };
  const side = summaryLayout({ width: 1200, right: 1440, bottom: 76 }, viewport, false);
  assert.equal(side.layout, 'side');
  assert.equal(side.width, 320);
  const tinyViewport = { width: 760, height: 120 };
  const tinyAnchor = summaryLayout({ width: 760, right: 760, bottom: 76 }, tinyViewport, false);
  const tiny = cardPlacement(tinyAnchor, null, tinyViewport, 40);
  assert.ok(tiny.top >= 76, 'docked summary must not move over the header');
  assert.ok(tiny.top + tiny.maxHeight <= 108, 'docked height uses the real remaining space');
  const stack = summaryLayout({ width: 760, right: 1000, bottom: 76 }, viewport, false);
  assert.equal(stack.layout, 'stack');
  assert.ok(stack.width <= 760 - 24);
  assert.ok(stack.maxHeight <= viewport.height * 0.45);
  assert.equal(summaryLayout({ width: 1200, right: 1440, bottom: 76 }, viewport, true).layout, 'floating');
  const storage = memoryStorage();
  const { api } = harness({}, storage);
  api.setPosition({ left: 500, top: 150 });
  assert.equal(api.prefs.getSnapshot().floating, true, 'manual drag detaches the card in this window');
  assert.equal(harness({}, storage).api.prefs.getSnapshot().floating, false, 'a new window always starts docked');
  api.setPosition(null);
  assert.equal(api.prefs.getSnapshot().floating, false, 'reset docks the card again');
});
