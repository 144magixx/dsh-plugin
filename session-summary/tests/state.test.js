import test from 'node:test';
import assert from 'node:assert/strict';
import { client } from './client-core.mjs';

const { createStore, sanitizePrefs, createSummaryCache, createApi, STORAGE_KEY } = client;
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, map };
}

test('preferences persist pinned state and only known collapsed sections', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ pinned: true, collapsed: { sources: true, bogus: true, jobs: false }, extra: 1 }) });
  const prefs = createStore(sanitizePrefs({}), { storage, key: STORAGE_KEY, sanitize: sanitizePrefs });
  assert.deepEqual(plain(prefs.getSnapshot()), { pinned: true, collapsed: { sources: true } });
  let notified = 0;
  prefs.subscribe(() => { notified++; });
  prefs.set({ pinned: true });
  assert.equal(notified, 0, 'unchanged values do not notify');
  prefs.set({ pinned: false });
  assert.equal(notified, 1);
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEY)), { pinned: false, collapsed: { sources: true } });
  const broken = createStore(sanitizePrefs({}), { storage: memoryStorage({ [STORAGE_KEY]: '{not json' }), key: STORAGE_KEY, sanitize: sanitizePrefs });
  assert.equal(broken.getSnapshot().pinned, false);
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

function harness(services = {}) {
  const ctx = { get: name => services[name] };
  const opened = [];
  const api = createApi(ctx, {
    storage: memoryStorage(),
    fetchImpl: async () => ({ status: 404, ok: false }),
    transportFetch: async (url, init) => ({ json: async () => (services.sideBranchReply?.(url, init) ?? { ok: false }) }),
    clipboard: services.clipboard,
    openWindow: url => opened.push(url),
  });
  return { api, opened };
}

test('open, close, pin and session ownership follow the Codex pinned-summary model', () => {
  const { api } = harness();
  api.open('a');
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
  assert.deepEqual(plain(api.prefs.getSnapshot().collapsed), { sources: true });
  api.toggleSection('sources');
  assert.deepEqual(plain(api.prefs.getSnapshot().collapsed), {});
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
