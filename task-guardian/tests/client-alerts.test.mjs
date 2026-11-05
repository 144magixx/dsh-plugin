import '../../session-summary/scripts/offline-test-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Reuse the workspace's existing React dependencies; no installation, server or browser.
const requireReact = createRequire(new URL('../../mermaid-diagrams-preview/package.json', import.meta.url));
const React = requireReact('react');
const { renderToStaticMarkup } = requireReact('react-dom/server');
let registration;
vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: value => { registration = value; } } },
  AbortController, setTimeout, clearTimeout, setInterval, clearInterval, console,
});
const client = registration.factory(name => { assert.equal(name, 'react'); return React; });
const t = key => client.ZH[key] || key;
const settle = () => new Promise(resolve => setImmediate(resolve));
const alert = (id = 'a', patch = {}) => ({ id, sessionId: `session-${id}`, title: `任务 ${id}`, at: 1000, kind: 'error', code: 'SERVER', message: '上游 503', state: 'failed', acknowledged: false, ...patch });
const response = (alerts = [], patch = {}) => ({ ok: true, alerts, readToken: 'snapshot-one', mode: 'alerts-only', fault: null, serverNow: 2000, ...patch });
function fixture() {
  const calls = [], timers = new Map(); let next = 0;
  const api = (action, payload, signal) => new Promise((resolve, reject) => calls.push({ action, payload, signal, resolve, reject }));
  const store = client.createAlertStore(api, { schedule(callback, delay) { const id = ++next; timers.set(id, { callback, delay }); return id; }, unschedule: id => timers.delete(id) });
  function fire(delay) { const item = [...timers].find(([, entry]) => entry.delay === delay); assert.ok(item, `timer ${delay}`); timers.delete(item[0]); item[1].callback(); }
  return { store, calls, timers, fire };
}

test('one global poll survives view unsubscribe and collapses, filters acknowledgements and deduplicates', async () => {
  const f = fixture(); let changes = 0;
  try {
    const unsubscribe = f.store.subscribe(() => { changes++; });
    f.store.start(); f.store.start();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].action, 'alerts'); assert.equal(JSON.stringify(f.calls[0].payload), '{}');
    f.calls[0].resolve(response([alert(), alert(), alert('read', { acknowledged: true })])); await settle();
    assert.equal(f.store.getSnapshot().alerts.length, 1); assert.equal(f.store.getSnapshot().total, 1);
    f.store.toggle(); assert.equal(f.store.getSnapshot().collapsed, true);
    unsubscribe(); f.fire(3000);
    assert.equal(f.calls.length, 2, 'changing/removing a view does not cancel the plugin-owned poll');
    assert.equal(f.calls[1].signal.aborted, false);
    f.calls[1].resolve(response([alert('b', { state: 'retrying', nextRetryAt: 9000, attempt: 7 })], { total: 101, hasMore: true })); await settle();
    assert.equal(f.store.getSnapshot().collapsed, true);
    assert.equal(f.store.getSnapshot().total, 101); assert.equal(f.store.getSnapshot().hasMore, true);
    assert.ok(changes >= 2);
  } finally { f.store.dispose(); }
  assert.equal(f.timers.size, 0);
});

test('offline and old Host failures retain prior alerts and recover on the next poll', async () => {
  const f = fixture();
  try {
    f.store.start(); f.calls[0].resolve(response([alert()])); await settle();
    f.fire(3000); f.calls[1].reject(new Error('network unavailable')); await settle();
    assert.equal(f.store.getSnapshot().status, 'offline'); assert.equal(f.store.getSnapshot().alerts.length, 1);
    f.fire(3000); f.calls[2].reject(Object.assign(new Error('not found'), { status: 404 })); await settle();
    assert.equal(f.store.getSnapshot().status, 'unavailable'); assert.equal(f.store.getSnapshot().alerts.length, 1);
    f.fire(3000); f.calls[3].resolve(response([alert('b')])); await settle();
    assert.equal(f.store.getSnapshot().status, 'online'); assert.equal(f.store.getSnapshot().alerts[0].id, 'b');
    f.fire(3000); f.calls[4].resolve({ ok: true, alerts: [] }); await settle();
    assert.equal(f.store.getSnapshot().status, 'unavailable', 'missing new contract fields cannot claim healthy');
    assert.equal(f.store.getSnapshot().alerts[0].id, 'b');
  } finally { f.store.dispose(); }
});

test('an unresponsive request times out and disposal fences late publication', async () => {
  const f = fixture(); let changes = 0;
  f.store.subscribe(() => { changes++; }); f.store.start();
  f.fire(10000); await settle();
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.store.getSnapshot().status, 'offline');
  f.fire(3000); assert.equal(f.calls.length, 2);
  f.store.dispose(); const before = changes;
  f.calls[1].resolve(response([alert()])); await settle();
  assert.equal(f.calls[1].signal.aborted, true); assert.equal(changes, before); assert.equal(f.timers.size, 0);
});

test('explicit acknowledgement fences an older poll and replenishes the next batch', async () => {
  const f = fixture();
  try {
    f.store.start(); f.calls[0].resolve(response([alert()], { total: 101, hasMore: true })); await settle();
    f.fire(3000); const old = f.calls[1];
    const acknowledging = f.store.acknowledge(alert());
    assert.equal(f.calls[2].action, 'acknowledge'); assert.equal(JSON.stringify(f.calls[2].payload), '{"sessionId":"session-a","alertId":"a"}');
    await f.store.acknowledge(alert()); assert.equal(f.calls.length, 3, 'duplicate click is coalesced');
    f.calls[2].resolve({ ok: true }); await settle();
    assert.equal(f.store.getSnapshot().alerts.length, 0);
    old.resolve(response([alert()], { total: 101, hasMore: true })); await settle();
    assert.equal(f.store.getSnapshot().alerts.length, 0, 'pre-ack read cannot resurrect acknowledged alert');
    assert.equal(f.calls[3].action, 'alerts');
    f.calls[3].resolve(response([alert('next')], { total: 100, hasMore: true })); await acknowledging;
    assert.equal(f.store.getSnapshot().alerts[0].id, 'next'); assert.equal(f.store.getSnapshot().total, 100);
  } finally { f.store.dispose(); }
});

test('mark all sends the snapshot token once and never optimistically erases concurrent new alerts', async () => {
  const f = fixture();
  try {
    f.store.start(); f.calls[0].resolve(response([alert()], { total: 101, hasMore: true })); await settle();
    f.fire(3000); const oldRead = f.calls[1];
    const bulk = f.store.acknowledgeAll();
    assert.equal(f.calls[2].action, 'acknowledgeAll'); assert.equal(JSON.stringify(f.calls[2].payload), '{"readToken":"snapshot-one"}');
    assert.equal(f.store.getSnapshot().bulkBusy, true);
    await f.store.acknowledgeAll(); await f.store.acknowledge(alert()); assert.equal(f.calls.length, 3);
    f.calls[2].resolve({ ok: true, acknowledged: 101 }); await settle();
    assert.equal(f.store.getSnapshot().alerts.length, 1, 'the client never clears the catalog optimistically');
    assert.equal(f.store.getSnapshot().readToken, null, 'old snapshot cannot be submitted again before refresh');
    await f.store.acknowledgeAll(); assert.equal(f.calls.length, 3);
    oldRead.resolve(response([alert('stale')])); await settle();
    assert.equal(f.store.getSnapshot().alerts[0].id, 'a', 'old poll is fenced');
    f.calls[3].resolve(response([alert('new')], { readToken: 'snapshot-two' })); await bulk;
    assert.equal(f.store.getSnapshot().alerts[0].id, 'new'); assert.equal(f.store.getSnapshot().total, 1);
    assert.equal(f.store.getSnapshot().readToken, 'snapshot-two');
  } finally { f.store.dispose(); }
});

test('expired bulk token refreshes the list and keeps an explicit retry explanation', async () => {
  const f = fixture();
  try {
    f.store.start(); f.calls[0].resolve(response([alert()])); await settle();
    const bulk = f.store.acknowledgeAll(); f.calls[1].reject(Object.assign(new Error('expired token'), { status: 409 })); await settle();
    assert.equal(f.store.getSnapshot().actionError, 'alertSnapshotChanged');
    assert.equal(f.store.getSnapshot().alerts.length, 1);
    f.calls[2].resolve(response([alert(), alert('new')], { readToken: 'renewed' })); await bulk;
    assert.equal(f.store.getSnapshot().alerts.length, 2); assert.equal(f.store.getSnapshot().readToken, 'renewed');
    assert.equal(f.store.getSnapshot().bulkBusy, false);
  } finally { f.store.dispose(); }
});

test('acknowledgement failure retains the record and visible action failure', async () => {
  const f = fixture();
  try {
    f.store.start(); f.calls[0].resolve(response([alert()])); await settle();
    const task = f.store.acknowledge(alert()); f.calls[1].reject(new Error('write failed')); await settle();
    assert.equal(f.store.getSnapshot().alerts.length, 1); assert.equal(f.store.getSnapshot().actionError, 'alertAckFailed');
    f.calls[2].resolve(response([alert()])); await task;
    assert.equal(f.store.getSnapshot().alerts.length, 1); assert.equal(f.store.getSnapshot().busy.length, 0);
  } finally { f.store.dispose(); }
});

function flatten(element, elements = []) {
  if (!element || typeof element !== 'object') return elements;
  elements.push(element);
  for (const child of React.Children.toArray(element.props?.children)) flatten(child, elements);
  return elements;
}
function view(patch = {}) {
  return { alerts: [alert()], total: 1, hasMore: false, readToken: 'snapshot-one', bulkBusy: false, mode: 'alerts-only', fault: null, status: 'online', collapsed: false, busy: [], actionError: null, serverNow: 2000, ...patch };
}

test('real React renders alerts from other sessions with navigation, read controls, escaped messages and bounded layout', async () => {
  const acknowledged = [], opened = [], failures = [], bulkActions = [];
  const store = { refresh() {}, toggle() {}, acknowledgeAll: () => bulkActions.push('all'), acknowledge: value => acknowledged.push(value), actionFailed: code => failures.push(code) };
  const props = { value: view({ alerts: [alert('other', { title: '另一会话', message: '<script>unsafe</script>' })] }), store, open: id => opened.push(id), t };
  const html = renderToStaticMarkup(React.createElement(client.AlertContent, props));
  assert.match(html, /另一会话/); assert.match(html, /已中断，需要处理/); assert.match(html, /查看会话/); assert.match(html, /标记已读/);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/); assert.equal(html.includes('<script>unsafe'), false);
  assert.equal(html.includes('autofocus'), false); assert.match(client.CSS, /max-height:min\(28vh,240px\)/);
  const buttons = flatten(client.AlertContent(props)).filter(element => element.type === 'button');
  buttons.find(button => button.props['aria-label'] === '查看会话 · 另一会话').props.onClick(); await settle();
  assert.deepEqual(opened, ['session-other']); assert.equal(acknowledged.length, 0, 'navigation never acknowledges');
  buttons.find(button => button.props['aria-label'] === '标记已读 · 另一会话').props.onClick();
  assert.equal(acknowledged[0].id, 'other'); assert.deepEqual(failures, []);
  assert.deepEqual(bulkActions, []);
  const bulkButton = buttons.find(button => button.props.children === '一键全部已读');
  assert.equal(bulkButton.props.disabled, false); bulkButton.props.onClick(); assert.deepEqual(bulkActions, ['all']);
  const failed = client.AlertContent({ ...props, open() { throw new Error('not found'); } });
  flatten(failed).find(button => button.props['aria-label'] === '查看会话 · 另一会话').props.onClick();
  assert.deepEqual(failures, ['alertOpenFailed']);
});

test('the standalone right-side alert card contains no guarding controls and ignores current-session changes', () => {
  const value = view({ alerts: [alert('other', { title: '另一会话异常' })] });
  const store = { getSnapshot: () => value, subscribe: () => () => {}, start() {}, refresh() {}, toggle() {}, acknowledge() {}, acknowledgeAll() {}, actionFailed() {} };
  const props = { sessionId: 'session-current', store, open() {}, t };
  const html = renderToStaticMarkup(React.createElement(client.TaskAlertsCard, props));
  assert.match(html, /class="dta dta-card"/);
  assert.match(html, /任务异常提醒/);
  assert.match(html, /data-alert-session="session-other"/);
  assert.match(html, /另一会话异常/);
  assert.match(html, /查看会话/);
  assert.doesNotMatch(html, /role="switch"|任务守护|自动恢复|自动选择|费用|兼容|详细设置|登录后启动|倒计时/);
  const next = renderToStaticMarkup(React.createElement(client.TaskAlertsCard, { ...props, sessionId: 'session-third' }));
  assert.match(next, /data-alert-session="session-other"/);
  assert.match(next, /1 未读/);
  assert.equal(client.GuardianPanel, undefined);
  assert.equal(client.GuardianAccessory, undefined);
  assert.equal(client.Switch, undefined);
  assert.equal(client.effectiveGuardianText, undefined);
});

test('collapsed alerts preserve unread entry and offline warnings; native retry status has no execution action', () => {
  const store = { refresh() {}, toggle() {}, acknowledge() {}, acknowledgeAll() {}, actionFailed() {} };
  const value = view({ collapsed: true, status: 'offline', total: 101, hasMore: true });
  const html = renderToStaticMarkup(React.createElement(client.AlertContent, { value, store, open() {}, t }));
  assert.match(html, /101 未读/); assert.match(html, /展开提醒/); assert.match(html, /提醒连接中断/);
  assert.doesNotMatch(html, /上游 503|原生版本|兼容|任务守护/);
  assert.match(client.alertStatusText({ state: 'resumed' }, t), /已恢复执行，尚未确认完成/);
  assert.equal(client.alertStatusText({ state: 'resolved', resolution: 'stopped' }, t), '已停止');
  assert.equal(client.alertStatusText({ state: 'resolved' }, t), '故障已解除');
  assert.equal(client.alertStatusText({ state: 'future-state' }, t), '状态待确认');
  const retrying = { ...value, collapsed: false, status: 'online', alerts: [alert('retrying', { state: 'retrying', nextRetryAt: 9000, attempt: 7 })] };
  const expanded = renderToStaticMarkup(React.createElement(client.AlertContent, { value: retrying, store, open() {}, t }));
  assert.match(expanded, /还有更多未读提醒/); assert.match(expanded, /长时间重试中/); assert.match(expanded, /下次重试/);
  const labels = flatten(client.AlertContent({ value: retrying, store, open() {}, t })).filter(element => element.type === 'button').map(button => button.props.children);
  assert.deepEqual(labels, ['一键全部已读', '刷新', '收起提醒', '查看会话', '标记已读']);
});

test('alerts-only contract requires no compatibility field and rejects old mode without losing records', async () => {
  const f = fixture();
  try {
    f.store.start(); f.calls[0].resolve(response([alert()])); await settle();
    assert.equal(f.store.getSnapshot().status, 'online');
    assert.equal(Object.hasOwn(f.store.getSnapshot(), 'compatibility'), false);
    f.fire(3000); f.calls[1].resolve({ ok: true, alerts: [], compatibility: { supported: true } }); await settle();
    assert.equal(f.store.getSnapshot().status, 'unavailable');
    assert.equal(f.store.getSnapshot().alerts[0].id, 'a');
    assert.deepEqual(f.calls.map(call => call.action), ['alerts', 'alerts']);
  } finally { f.store.dispose(); }
});

test('transport rejects removed settings and execution actions before making a request', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return { ok: true, json: async () => response() }; };
  for (const action of ['snapshot', 'configure', 'startup', 'retry', 'resume', 'followup']) {
    await assert.rejects(client.requestJSON(fetchImpl, action, {}), error => error.code === 'unsupported_action');
  }
  assert.equal(calls.length, 0);
  await client.requestJSON(fetchImpl, 'alerts', {});
  assert.equal(calls[0][0], '/api/task-guardian/alerts');
  await assert.rejects(client.requestJSON(async () => ({ ok: false, status: 404, json() { throw new Error('HTML response'); } }), 'alerts', {}), error => error.status === 404);
});
