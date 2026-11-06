import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, counts, initialState, instantOf, localDate, addDays, overdue, parseDue, stateSchema, ALERT_GRACE_MS } from '../lib/core.js';

const NOW = new Date(2026, 10, 6, 10, 0).getTime();
const TODAY = localDate(NOW);
let seq = 0;
const run = (state, input, now = NOW) => apply(state, input, { now, id: `id-${++seq}` });

test('initial state is valid and stored state is strictly validated', () => {
  const state = initialState(1);
  assert.deepEqual(stateSchema.parse(state), state);
  assert.throws(() => stateSchema.parse({ ...state, lists: [] }), { code: 'invalid_stored_todo' });
  assert.throws(() => stateSchema.parse({ ...state, items: [{ id: 'x', listId: 'missing' }] }), { code: 'invalid_stored_todo' });
  assert.equal(stateSchema.safeParse(null).success, false);
});

test('parseDue accepts all-day dates, local times and offset instants only', () => {
  assert.deepEqual(parseDue('2026-11-07'), { dueDate: '2026-11-07', dueTime: null });
  assert.deepEqual(parseDue('2026-11-07 09:30'), { dueDate: '2026-11-07', dueTime: '09:30' });
  assert.deepEqual(parseDue('2026-11-07T09:30:00'), { dueDate: '2026-11-07', dueTime: '09:30' });
  const iso = parseDue('2026-11-07T01:30:00Z');
  assert.equal(iso.alertAt, Date.parse('2026-11-07T01:30:00Z'));
  assert.equal(iso.dueDate, localDate(iso.alertAt));
  assert.deepEqual(parseDue(''), { dueDate: null, dueTime: null });
  for (const bad of ['2026-02-30', 'tomorrow', '2026-11-07 25:00', 42]) assert.throws(() => parseDue(bad), { code: 'invalid_due' });
});

test('create, update, complete and delete bump the revision and keep invariants', () => {
  let state = initialState(0);
  let out = run(state, { action: 'create', title: '  确认待办插件设计稿 ', notes: '与用户确认', dueDate: TODAY, dueTime: '10:30', flagged: true });
  assert.equal(out.changed, true); assert.equal(out.state.revision, 1);
  const item = out.result.item;
  assert.equal(item.title, '确认待办插件设计稿'); assert.equal(item.listId, 'default');
  assert.equal(item.alertAt, instantOf(TODAY, '10:30')); assert.equal(item.alerted, false);
  state = out.state;
  out = run(state, { action: 'update', id: item.id, title: '新标题', sessionId: 's1', sessionTitle: '会话' });
  assert.equal(out.result.item.title, '新标题'); assert.equal(out.result.item.sessionTitle, '会话');
  assert.equal(out.result.item.alertAt, item.alertAt, 'unrelated edits keep the alert');
  state = out.state;
  out = run(state, { action: 'update', id: item.id, sessionId: null });
  assert.equal(out.result.item.sessionId, null); assert.equal(out.result.item.sessionTitle, '');
  state = out.state;
  out = run(state, { action: 'complete', id: item.id });
  assert.equal(out.result.item.completed, true); assert.equal(out.result.item.completedAt, NOW);
  assert.equal(run(out.state, { action: 'complete', id: item.id }).changed, false, 'idempotent completion');
  state = out.state;
  out = run(state, { action: 'delete', id: item.id });
  assert.equal(out.state.items.length, 0); assert.equal(out.state.revision, state.revision + 1);
});

test('invalid input is rejected without side effects', () => {
  const state = initialState(0);
  assert.throws(() => run(state, { action: 'create', title: '   ' }), { code: 'invalid_title' });
  assert.throws(() => run(state, { action: 'create', title: 'x', listId: 'nope' }), { code: 'list_not_found' });
  assert.throws(() => run(state, { action: 'create', title: 'x', dueTime: '10:00' }), { code: 'invalid_due' });
  assert.throws(() => run(state, { action: 'create', title: 'x', extra: 1 }), { code: 'invalid_request' });
  assert.throws(() => run(state, { action: 'drop' }), { code: 'invalid_action' });
  assert.throws(() => run(state, { action: 'deleteList', listId: 'default' }), { code: 'last_list' });
  assert.equal(state.revision, 0);
});

test('lists can be created, recolored and deleted together with their items', () => {
  let state = run(initialState(0), { action: 'createList', name: 'dsh-plugin', color: 'orange' }).state;
  const list = state.lists[1];
  assert.equal(list.color, 'orange');
  state = run(state, { action: 'create', title: 'a', listId: list.id }).state;
  state = run(state, { action: 'updateList', listId: list.id, color: 'green' }).state;
  assert.equal(state.lists[1].color, 'green');
  assert.throws(() => run(state, { action: 'updateList', listId: list.id, color: 'neon' }), { code: 'invalid_color' });
  const out = run(state, { action: 'deleteList', listId: list.id });
  assert.equal(out.result.removedItems, 1); assert.equal(out.state.items.length, 0); assert.equal(out.state.lists.length, 1);
});

test('due alerts are claimed exactly once; snooze re-arms; long-missed and past-entered times stay silent', () => {
  let state = initialState(0);
  state = run(state, { action: 'create', title: 'soon', dueDate: TODAY, dueTime: '10:30' }).state;
  state = run(state, { action: 'create', title: 'entered late', dueDate: TODAY, dueTime: '08:00' }).state;
  assert.equal(state.items[1].alerted, true, 'a time already past when entered is not announced');
  let out = run(state, { action: 'claimAlerts' }, NOW);
  assert.equal(out.changed, false, 'nothing due yet');
  const later = instantOf(TODAY, '10:31');
  out = run(state, { action: 'claimAlerts' }, later);
  assert.deepEqual(out.result.alerts.map(item => item.title), ['soon']);
  state = out.state;
  assert.equal(run(state, { action: 'claimAlerts' }, later).changed, false, 'claimed once');
  state = run(state, { action: 'snooze', id: state.items[0].id, minutes: 10 }, later).state;
  assert.equal(state.items[0].alertAt, later + 600000);
  assert.deepEqual(run(state, { action: 'claimAlerts' }, later + 600000).result.alerts.map(item => item.title), ['soon']);
  const missed = run(state, { action: 'claimAlerts' }, later + 600000 + ALERT_GRACE_MS + 1);
  assert.deepEqual(missed.result.alerts, []); assert.equal(missed.changed, true);
  assert.equal(missed.state.items[0].alerted, true, 'retired without a banner');
});

test('smart view counts follow iOS Reminders rules', () => {
  let state = initialState(0);
  const add = input => { state = run(state, { action: 'create', ...input }).state; return state.items.at(-1); };
  add({ title: 'overdue', dueDate: addDays(TODAY, -1) });
  add({ title: 'today', dueDate: TODAY, flagged: true });
  add({ title: 'tomorrow', dueDate: addDays(TODAY, 1) });
  add({ title: 'undated' });
  const done = add({ title: 'done', dueDate: TODAY });
  state = run(state, { action: 'complete', id: done.id }).state;
  const value = counts(state, TODAY);
  assert.deepEqual({ today: value.today, scheduled: value.scheduled, all: value.all, flagged: value.flagged, completed: value.completed }, { today: 2, scheduled: 3, all: 4, flagged: 1, completed: 1 });
  assert.equal(value.lists.default, 4);
  assert.equal(overdue(state.items[0], NOW), true);
  assert.equal(overdue(state.items[1], NOW), false);
});
