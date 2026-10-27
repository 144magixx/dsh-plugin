import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let registration;
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
  AbortController, console,
});
const client = registration.factory(name => { assert.equal(name, 'react'); return {}; });
const { createController, dockPlacement, panelPlacement, filterItems, buildSelectionText } = client;
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const items = [
  { id: 'a', kind: 'skill', name: 'digger-main', description: '日志诊断', status: 'installed', sources: [{ agent: 'Codex', path: '/skills/a/SKILL.md' }, { agent: 'DSH', path: '/dsh/a/SKILL.md' }], selectionText: '- Skill digger-main: /skills/a/SKILL.md' },
  { id: 'b', kind: 'cli', name: 'digger', description: '企业日志检索', status: 'installed', sources: [{ agent: '本机 CLI' }], selectionText: '- CLI digger：先核对帮助' },
  { id: 'c', kind: 'mcp', name: 'internal', description: 'Trace 调用链', status: 'configured', sources: [{ agent: 'Claude Code' }] },
  { id: 'd', kind: 'cli', name: 'absent', description: '', status: 'missing', sources: [] },
];
function harness(overrides = {}) {
  const calls = [], binding = { sessionId: 's' };
  let active = { id: 's', binding };
  const api = createController({ request: async (action, body) => action === 'scan' ? { ok: true, items } : { ok: true, content: body.id }, current: () => active, append: (target, text) => { calls.push({ target, text }); return 'applied'; }, copy: async text => calls.push({ copied: text }), t: key => key, ...overrides });
  api.setSession('s', binding);
  return { api, calls, binding, activate: value => { active = value; } };
}

test('filters intersect kind, source, installation state and every search word', () => {
  assert.deepEqual(plain(filterItems(items, { query: '日志 codex', kind: 'skill', agent: 'DSH', readyOnly: true })).map(item => item.id), ['a']);
  assert.equal(filterItems(items, { query: '日志 absent' }).length, 0);
  assert.equal(filterItems(items, { readyOnly: true }).length, 3);
  assert.equal(filterItems(items, { kind: 'mcp' })[0].id, 'c');
});

test('popup and trigger stay within every supported viewport, including visual viewport offsets', () => {
  for (const width of [280, 320, 375, 760, 1000, 1800]) for (const height of [190, 320, 480, 900]) {
    const viewport = { width, height, left: 9, top: 23 };
    const dock = dockPlacement({ left: width - 300, bottom: height + 500, width: 320 }, null, viewport);
    assert.ok(dock.left >= 21 && dock.left + dock.width <= width - 3);
    assert.ok(dock.top >= 35 && dock.top + dock.height <= height + 11);
    const panel = panelPlacement(dock, viewport);
    assert.ok(panel.left >= 21 && panel.top >= 35, JSON.stringify({ width, height, panel }));
    assert.ok(panel.left + panel.width <= width - 3 && panel.top + panel.height <= height + 11);
  }
  assert.equal(panelPlacement({ left: 1500, top: 300 }, { width: 1900, height: 1000 }).mode, 'left');
  assert.equal(panelPlacement({ left: 600, top: 300 }, { width: 1000, height: 900 }).mode, 'center');
  assert.equal(panelPlacement({ left: 12, top: 30 }, { width: 320, height: 480 }).mode, 'sheet');
});

test('fallback stays beside owning header, independent of summary length', () => {
  const placement = dockPlacement(null, { right: 1400, bottom: 74 }, { width: 1500, height: 900 });
  assert.equal(placement.left, 1068);
  assert.equal(placement.top, 82);
});

test('selection adds canonical instructions to the exact binding and never submits', async () => {
  const { api, calls, binding } = harness();
  api.open(); await tick();
  api.toggle('a'); api.toggle('b'); api.toggle('d');
  assert.deepEqual(plain(api.getSnapshot().selectedIds), ['a', 'b']);
  api.add();
  assert.equal(calls.length, 1); assert.equal(calls[0].target, binding);
  assert.match(calls[0].text, /\/skills\/a\/SKILL\.md/); assert.match(calls[0].text, /CLI digger/);
  assert.equal(api.getSnapshot().open, false);
  api.dispose();
});

test('session and binding generations are rechecked immediately before append', async () => {
  const { api, calls, activate } = harness();
  api.open(); await tick(); api.toggle('a');
  activate({ id: 'other', binding: {} }); api.add();
  assert.equal(calls.length, 0); assert.equal(api.getSnapshot().notice, 'stale');
  activate({ id: 's', binding: { sessionId: 's' } }); api.add();
  assert.equal(calls.length, 0);
  api.setSession('other', {});
  assert.equal(api.getSnapshot().open, false); assert.equal(api.selected().length, 0);
  api.dispose();
});

test('busy composer retains selection; copying does not append', async () => {
  const { api, calls } = harness({ append: () => 'blocked' });
  api.open(); await tick(); api.toggle('b'); api.add();
  assert.equal(api.getSnapshot().notice, 'blocked'); assert.equal(api.selected().length, 1); assert.equal(api.getSnapshot().open, true);
  await api.copySelection(); assert.match(calls[0].copied, /digger/);
  api.dispose();
});

test('late scans cannot cross sessions or replace newer scan results', async () => {
  const pending = [];
  const { api } = harness({ request: (_action, payload, signal) => new Promise(resolve => pending.push({ resolve, payload, signal })) });
  api.open(); const first = pending[0];
  api.setSession('other', {}); api.open();
  first.resolve({ ok: true, items }); await tick();
  assert.equal(api.getSnapshot().items.length, 0); assert.equal(first.signal.aborted, true);
  pending[1].resolve({ ok: true, items: [items[1]], complete: false, warnings: [{ code: 'LIMIT' }] }); await tick();
  assert.equal(api.getSnapshot().items[0].id, 'b'); assert.equal(api.getSnapshot().complete, false);
  api.dispose();
});

test('refresh invalidates outstanding details and drops deleted selections', async () => {
  let resolveDetail; let scans = 0;
  const { api } = harness({ request: action => action === 'scan' ? Promise.resolve({ ok: true, items: ++scans === 1 ? items : [items[1]] }) : new Promise(resolve => { resolveDetail = resolve; }) });
  api.open(); await tick(); api.toggle('a'); api.detail('a');
  await api.scan(true); resolveDetail({ ok: true, content: 'stale' }); await tick();
  assert.equal(api.getSnapshot().detail, null); assert.equal(api.selected().length, 0);
  api.dispose();
});

test('disposal aborts ongoing requests and ignores late completion', async () => {
  let resolve, signal;
  const { api } = harness({ request: (_a, _b, s) => { signal = s; return new Promise(done => { resolve = done; }); } });
  api.open(); api.dispose(); assert.equal(signal.aborted, true);
  resolve({ ok: true, items }); await tick(); assert.equal(api.getSnapshot().items.length, 0);
});

test('selection text asks for task-specific use, not global enablement', () => {
  const text = buildSelectionText(items.slice(0, 3));
  assert.match(text, /本次任务/); assert.match(text, /MCP 是否已接入/); assert.match(text, /Skill digger-main/);
});
