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
  fetch: async () => new Response(JSON.stringify({ ok: false, error: 'offline' }), { status: 503 }),
});
const client = registration.factory(name => { assert.equal(name, 'react'); return React; });
const T = client.__test;
const t = (key, params = {}) => String(T.ZH[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params[name]);
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const NOW = new Date(2026, 10, 6, 10, 0).getTime(), TODAY = T.localDate(NOW);
const item = (id, patch = {}) => ({ id, listId: 'default', title: `任务 ${id}`, notes: '', dueDate: TODAY, dueTime: null, alertAt: null, alerted: false, flagged: false, completed: false, completedAt: null, createdAt: 1, updatedAt: 1, sessionId: null, sessionTitle: '', ...patch });
const LISTS = [{ id: 'default', name: '工作', color: 'blue', createdAt: 0 }, { id: 'p', name: 'dsh-plugin', color: 'orange', createdAt: 1 }];

function fixture() {
  const calls = [], timers = new Map(); let next = 0, clock = NOW;
  const call = (input, signal) => new Promise((resolve, reject) => calls.push({ input, signal, resolve, reject }));
  const store = T.createStore(call, { now: () => clock, hidden: () => false, setTimer(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  const fire = delay => { const entry = [...timers].find(([, value]) => value.delay === delay); assert.ok(entry, `timer ${delay}`); timers.delete(entry[0]); entry[1].fn(); };
  const last = () => calls.at(-1);
  return { store, calls, timers, fire, last, advance(ms) { clock += ms; } };
}
const snapshot = (items, revision = 1) => ({ ok: true, revision, token: `${revision}.0`, lists: LISTS, items });

test('sections follow the design: 上午/下午/今晚 for today, overdue first, recently completed stays visible', () => {
  const state = { lists: LISTS, showCompleted: false, recentDone: { done: true }, items: [
    item('a', { dueTime: '10:30', flagged: true }), item('b', { dueTime: '16:30', listId: 'p' }), item('c', { dueTime: '21:00' }),
    item('late', { dueDate: T.addDays(TODAY, -1) }), item('done', { dueTime: '15:00', completed: true, completedAt: NOW }),
    item('hidden', { completed: true, completedAt: NOW }), item('future', { dueDate: T.addDays(TODAY, 3) }), item('undated', { dueDate: null }),
  ] };
  const sections = T.sectionsFor(state, { kind: 'smart', id: 'today' }, { today: TODAY, lang: 'zh-CN', t });
  assert.deepEqual(plain(sections.map(section => [section.title, section.items.map(row => row.id)])), [['已逾期', ['late']], ['上午', ['a']], ['下午', ['done', 'b']], ['今晚', ['c']]]);
  const scheduled = T.sectionsFor(state, { kind: 'smart', id: 'scheduled' }, { today: TODAY, lang: 'zh-CN', t });
  assert.deepEqual(plain(scheduled.map(section => section.items.map(row => row.id))), [['late'], ['a', 'done', 'b', 'c'], ['future']]);
  const all = T.sectionsFor(state, { kind: 'smart', id: 'all' }, { today: TODAY, lang: 'zh-CN', t });
  assert.deepEqual(plain(all.map(section => section.title)), ['工作', 'dsh-plugin']);
  const search = T.sectionsFor(state, { kind: 'search', query: 'undated' }, { today: TODAY, lang: 'zh-CN', t });
  assert.deepEqual(plain(search[0].items.map(row => row.id)), ['undated']);
  assert.deepEqual(plain(T.defaultsFor({ kind: 'smart', id: 'flagged' }, state, TODAY)), { flagged: true });
  assert.deepEqual(plain(T.defaultsFor({ kind: 'list', id: 'p' }, state, TODAY)), { listId: 'p' });
  const c = T.counts(state, TODAY);
  assert.deepEqual([c.today, c.scheduled, c.all, c.flagged, c.completed, c.lists.p], [4, 5, 6, 1, 2, 1]);
});

test('due text matches the page and the compact card', () => {
  const late = item('x', { dueTime: '09:30', alertAt: NOW - 1800000 });
  assert.equal(T.dueText(late, TODAY, t, 'zh-CN', false, NOW), '今天 09:30');
  assert.equal(T.dueText(late, TODAY, t, 'zh-CN', true, NOW), '09:30 已逾期');
  assert.equal(T.dueText(item('y', { dueDate: T.addDays(TODAY, 1) }), TODAY, t, 'zh-CN'), '明天');
  assert.equal(T.dueText(item('z'), TODAY, t, 'zh-CN', true, NOW), '', 'the today card omits a redundant all-day label');
});

test('store loads, polls a cheap revision, refetches only on change and backs off when offline', async () => {
  const f = fixture();
  f.store.start(); f.store.start();
  assert.deepEqual(f.calls.map(call => call.input.action), ['snapshot']);
  f.last().resolve(snapshot([item('a')])); await settle();
  assert.equal(f.store.getSnapshot().status, 'ready');
  f.fire(3000); assert.equal(f.last().input.action, 'revision');
  f.last().resolve({ ok: true, revision: 1, token: '1.0' }); await settle();
  assert.equal(f.calls.length, 2, 'unchanged token: no snapshot');
  f.fire(3000); f.last().resolve({ ok: true, revision: 2, token: '2.0' }); await settle();
  assert.equal(f.last().input.action, 'snapshot');
  f.last().resolve(snapshot([item('a'), item('b')], 2)); await settle();
  assert.equal(f.store.getSnapshot().items.length, 2);
  f.fire(3000); f.last().reject(Object.assign(new Error('Service Unavailable'), { status: 503 })); await settle();
  assert.equal(f.store.getSnapshot().offline, true);
  f.fire(6000); f.last().reject(new Error('down')); await settle();
  f.fire(12000); f.last().resolve({ ok: true, revision: 2, token: '2.0' }); await settle();
  assert.equal(f.store.getSnapshot().offline, false);
  assert.ok([...f.timers.values()].some(timer => timer.delay === 3000), 'normal cadence after recovery');
  f.store.dispose();
  assert.equal(f.timers.size, 0, 'no timers survive dispose');
  assert.ok(f.calls.every(call => call.signal.aborted), 'in-flight requests are aborted');
});

test('optimistic completion keeps the row visible and reverts on failure', async () => {
  const f = fixture();
  f.store.start(); f.last().resolve(snapshot([item('a')])); await settle();
  void f.store.toggle('a');
  assert.equal(f.store.getSnapshot().items[0].completed, true);
  assert.equal(f.store.getSnapshot().recentDone.a, true);
  f.last().resolve({ ok: true, changed: true, revision: 2, token: '2.0', item: item('a', { completed: true, completedAt: NOW }) }); await settle();
  assert.equal(f.store.getSnapshot().revision, 2);
  assert.equal(f.calls.length, 2, 'contiguous revision needs no snapshot');
  void f.store.update('a', { title: '改名' });
  assert.equal(f.store.getSnapshot().items[0].title, '改名');
  f.last().reject(Object.assign(new Error('bad'), { code: 'invalid_title' })); await settle();
  assert.equal(f.store.getSnapshot().items[0].title, '任务 a', 'reverted');
  assert.equal(f.store.getSnapshot().error, 'invalid_title');
  assert.equal(f.last().input.action, 'snapshot', 'server truth reloaded');
  f.store.dispose();
});

test('a revision gap after a write reloads, and timed edits send the viewer\'s alert instant', async () => {
  const f = fixture();
  f.store.start(); f.last().resolve(snapshot([item('a')])); await settle();
  void f.store.update('a', { dueTime: '16:30' });
  assert.equal(f.last().input.alertAt, T.instantOf(TODAY, '16:30'));
  assert.equal(f.last().input.dueDate, TODAY);
  f.last().resolve({ ok: true, changed: true, revision: 5, token: '5.0', item: item('a', { dueTime: '16:30' }) }); await settle();
  assert.equal(f.last().input.action, 'snapshot');
  f.store.dispose();
});

test('due banners are claimed once from the server and offer done, snooze and open', async () => {
  const f = fixture();
  f.store.start();
  f.last().resolve(snapshot([item('a', { dueTime: '10:01', alertAt: NOW + 60000, sessionId: 's', sessionTitle: '会话' })])); await settle();
  assert.equal(f.calls.length, 1, 'nothing due: no claim');
  f.advance(61000); f.fire(5000); await settle();
  assert.equal(f.last().input.action, 'claimAlerts');
  f.fire(5000); await settle();
  assert.equal(f.calls.filter(call => call.input.action === 'claimAlerts').length, 1, 'no concurrent claim');
  f.last().resolve({ ok: true, changed: true, revision: 2, token: '2.0', alerts: [item('a', { dueTime: '10:01', alerted: true, sessionId: 's', sessionTitle: '会话' })] }); await settle();
  assert.equal(f.store.getSnapshot().alerts.length, 1);
  assert.equal(f.store.getSnapshot().items[0].alerted, true);
  const html = renderToStaticMarkup(React.createElement(T.AlertToasts, { store: f.store, t, openSession() {} }));
  assert.match(html, /任务 a/); assert.match(html, /10 分钟后/); assert.match(html, /打开对话/);
  void f.store.snooze('a', 10);
  assert.equal(f.store.getSnapshot().alerts.length, 0);
  assert.deepEqual(plain(f.last().input), { action: 'snooze', id: 'a', minutes: 10 });
  f.store.dispose();
});

test('page and card render the confirmed design structure', async () => {
  const f = fixture();
  f.store.start();
  f.last().resolve(snapshot([
    item('a', { title: '确认待办插件设计稿', notes: '与用户确认样式后开始实现', dueTime: '09:30', alertAt: Date.now() - 60000, flagged: true }),
    item('b', { title: '修复会话搜索高亮错位', dueTime: '16:30', sessionId: 's', sessionTitle: '会话搜索插件', listId: 'p' }),
  ])); await settle();
  const props = { store: f.store, t, openSession() {}, openPage() {}, currentSession: () => 's' };
  const page = renderToStaticMarkup(React.createElement(T.TodoPage, props));
  for (const text of ['搜索', '今天', '计划', '全部', '旗标', '已完成', '我的列表', '添加列表', '新提醒事项', '确认待办插件设计稿', '会话搜索插件', '上午', '下午']) assert.ok(page.includes(text), text);
  assert.match(page, /role="checkbox"/);
  const card = renderToStaticMarkup(React.createElement(T.TodoCard, { ...props, sessionId: 's' }));
  for (const text of ['待办', '今天 2', '新提醒事项', '打开待办', '全部 2 项 · 计划 2 项']) assert.ok(card.includes(text), text);
  f.store.dispose();
});

test('apply registers the sidebar entry, page, card and banner overlay', () => {
  const registered = [];
  const ctx = {
    locale: { register() { return () => {}; }, bind: () => t },
    slots: { inject: (name, fn) => fn(), register: (options, component) => { registered.push(options); return () => {}; } },
    effect(fn) { disposers.push(fn()); }, layout: { selectPanel() {} }, uiWorkspace: { openSession() {} },
  };
  const disposers = [];
  client.apply(ctx);
  for (const dispose of disposers) if (typeof dispose === 'function') dispose();
  assert.deepEqual(registered.map(options => options.name), ['sidebar.panellist', 'main', 'capability-selector.accessories', 'shell.overlay']);
  assert.equal(registered[0].id, registered[1].key, 'the entry id addresses the main panel');
});
