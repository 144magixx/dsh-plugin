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

function loadClient(react, globals = {}) {
  let definition;
  const win = Object.assign(globals.window || {}, { __ModuleLoader__: { load(value) { definition = value; } } });
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { ...globals, window: win, AbortController, console });
  return definition.factory(name => { assert.equal(name, 'react'); return react; });
}

test('measured dock columns and tall companions stay within the viewport without changing the standalone default', () => {
  for (const width of [280, 320, 760, 1800]) for (const height of [120, 190, 480, 900]) {
    const viewport = { width, height, left: 9, top: 23 };
    for (const summary of [null, { left: width - 300, bottom: height + 500, width: 320 }]) for (const measured of [36, 80, 124, 250, 10000, NaN]) {
      const dock = dockPlacement(summary, { right: width, bottom: 60 }, viewport, measured);
      assert.ok(dock.left >= 21 && dock.left + dock.width <= width - 3);
      assert.ok(dock.top >= 35 && dock.top + dock.height <= height + 11, JSON.stringify({ viewport, measured, dock }));
      assert.ok(dock.height <= dock.maxHeight && dock.maxHeight <= height - 24);
    }
  }
  const standalone = dockPlacement(null, { right: 1400, bottom: 74 }, { width: 1500, height: 900 });
  assert.equal(standalone.height, 36); assert.equal(standalone.height + 12, 48);
  assert.equal(dockPlacement({ left: 1000, bottom: 500, width: 320 }, null, { width: 1440, height: 900 }, 164).height, 164);
});

test('the capability overlay declares a native root list accessory slot without claiming a companion component', () => {
  const registrations = [], cleanup = [], dictionary = new Map();
  const c = loadClient({}, { document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } } });
  const ctx = {
    effect(fn) { const off = fn(); if (typeof off === 'function') cleanup.push(off); return off; },
    locale: { register: (name, values) => { dictionary.set(name, values); return () => dictionary.delete(name); }, bind: () => key => key },
    uiSession: { current: c.createStore({ key: 's' }) }, sessions: { binding: () => ({}) }, conversation: {},
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { registrations.push({ options, component }); return () => {}; } },
  };
  c.apply(ctx);
  const overlay = registrations.find(row => row.options.name === 'shell.overlay');
  assert.deepEqual(plain(overlay.options.children), { 'capability-selector.accessories': { kind: 'list', scope: 'root' } });
  assert.equal(overlay.component, c.CapabilityOverlay);
  assert.equal(registrations.some(row => row.options.name === 'capability-selector.accessories'), false, 'the owner declares the slot but does not own its occupants');
  for (const off of cleanup.reverse()) off();
});

test('native renderSlot receives the selected session below controls and fixtures can omit it', () => {
  const geometry = { dock: { left: 100, top: 200, width: 320, height: 116, maxHeight: 500 }, panel: {}, viewport: {} };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useRef: value => ({ current: value }),
    useState: value => [value === null ? geometry : value, () => {}],
    useLayoutEffect() {}, useEffect() {},
  };
  const c = loadClient(react), api = c.createController({ request() {}, append() {}, current: () => ({ id: 's' }) });
  api.setSession('s', {});
  const args = { api, anchors: new Map(), uiSession: { current: c.createStore({ key: 's' }) }, sessions: {}, t: key => key };
  const calls = [];
  const tree = c.CapabilityOverlay({ ...args, renderSlot: (name, props) => { calls.push({ name, props }); return 'companion'; } });
  const dock = tree.props.children[0], controls = dock.props.children[0], accessories = dock.props.children[1];
  assert.equal(controls.props.className, 'dsc-controls');
  assert.equal(controls.props.children[0].props.className, 'dsc-trigger');
  assert.equal(accessories.props.className, 'dsc-accessories');
  assert.deepEqual(plain(calls), [{ name: 'capability-selector.accessories', props: { sessionId: 's' } }]);
  assert.equal(accessories.props.children[0], 'companion');
  assert.equal(dock.props.style.height, 'auto', 'natural child changes remain observable');
  assert.equal(dock.props.style.maxHeight, 500, 'the owner constrains its own scrollable column');
  const bare = c.CapabilityOverlay(args);
  assert.equal(bare.props.children[0].props.children[1].props.children[0], null);
  api.dispose();
});

test('own dock ResizeObserver measures companions, publishes only changed reserve and restores ownership on cleanup', () => {
  const values = new Map([['--dsh-summary-accessory-height', '19px']]), windowListeners = new Map(), frames = new Map();
  const resizeObservers = [], mutationObservers = [], effects = [];
  let geometry, serial = 0, cssWrites = 0, cssEvents = 0, summaryBottom = 300, dockHeight = 36;
  const style = { getPropertyValue: key => values.get(key) || '', setProperty: (key, value) => { cssWrites++; values.set(key, value); }, removeProperty: key => { cssWrites++; values.delete(key); } };
  const summary = { getAttribute: name => name === 'data-dsh-session-summary' ? 's' : null, getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 1000, top: 84, bottom: summaryBottom, width: 320 }) };
  const header = { getBoundingClientRect: () => ({ right: 1400, bottom: 74 }) };
  const dock = { getBoundingClientRect: () => ({ height: dockHeight }) }, ref = { current: null };
  class Observer {
    constructor(callback, list) { this.callback = callback; this.nodes = new Set(); list.push(this); }
    observe(node) { this.nodes.add(node); }
    disconnect() { this.nodes.clear(); }
  }
  const win = {
    innerWidth: 1440, innerHeight: 900,
    addEventListener(name, fn) { if (!windowListeners.has(name)) windowListeners.set(name, new Set()); windowListeners.get(name).add(fn); },
    removeEventListener(name, fn) { windowListeners.get(name)?.delete(fn); },
    dispatchEvent(event) { if (event.type === 'dsh:summary-accessory-change') cssEvents++; for (const fn of windowListeners.get(event.type) || []) fn(); },
  };
  const react = { useState: initial => { geometry = initial; return [initial, update => { geometry = typeof update === 'function' ? update(geometry) : update; }]; }, useLayoutEffect: fn => { effects.push(fn()); } };
  const c = loadClient(react, {
    window: win, document: { documentElement: { style }, body: {}, getElementById: id => { assert.equal(id, 'dsh-session-summary-card'); return summary; } },
    Event: class { constructor(type) { this.type = type; } },
    ResizeObserver: class extends Observer { constructor(fn) { super(fn, resizeObservers); } },
    MutationObserver: class extends Observer { constructor(fn) { super(fn, mutationObservers); } },
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame: id => frames.delete(id),
  });
  const flush = () => { let remaining = 20; while (frames.size) { assert.ok(remaining-- > 0, 'layout events must converge'); const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(); } };
  c.useDockGeometry('s', new Map([['s', { closest: () => header }]]), ref);
  flush(); assert.equal(values.get('--dsh-summary-accessory-height'), '48px');
  ref.current = dock; mutationObservers.at(-1).callback(); flush();
  assert.equal(resizeObservers.length, 1); assert.ok(resizeObservers[0].nodes.has(dock), 'the existing observer now observes only the owning dock in addition to existing anchors');
  dockHeight = 116; resizeObservers[0].callback(); flush();
  assert.equal(geometry.dock.height, 116); assert.equal(values.get('--dsh-summary-accessory-height'), '128px');
  const settledWrites = cssWrites, settledEvents = cssEvents;
  resizeObservers[0].callback(); summaryBottom = 250; resizeObservers[0].callback(); flush();
  assert.equal(cssWrites, settledWrites); assert.equal(cssEvents, settledEvents);
  assert.equal(geometry.dock.top, 258, 'drag/resize of the summary keeps the accessory column attached');
  dockHeight = 36; resizeObservers[0].callback(); flush();
  assert.equal(values.get('--dsh-summary-accessory-height'), '48px', 'unmounting a companion releases its additional reserve');
  dockHeight = 500; win.innerHeight = 190;
  resizeObservers[0].callback(); flush();
  assert.equal(geometry.dock.height, 114);
  assert.equal(values.get('--dsh-summary-accessory-height'), '126px');
  assert.ok(geometry.dock.top + geometry.dock.height <= 178);
  for (const off of effects.reverse()) off?.();
  assert.equal(values.get('--dsh-summary-accessory-height'), '19px');
  assert.equal(frames.size, 0); assert.ok(resizeObservers[0].nodes.size === 0);
  assert.ok(mutationObservers.every(observer => observer.nodes.size === 0));
  assert.ok([...windowListeners.values()].every(list => list.size === 0));
});
