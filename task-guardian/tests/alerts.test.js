import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertState, applyAlertState, mergeNotice, visibleNotice, retryNotice } from '../lib/alerts.js';
const event = (seq, type, data, time = 1000 + seq) => ({ seq, type, data, time });
const failure = (seq, turn = 1) => event(seq, 'turn/end', { turn, reason: { kind: 'error', error: { code: 'SERVER', message: 'Upstream unavailable' } } });
const success = seq => event(seq, 'assistant/message', { message: { role: 'assistant', content: [] } });

test('terminal error has stable identity across replay and ignores inherited failures', () => {
  const initial = createAlertState({ id: 'a' });
  const state = applyAlertState(initial, failure(1));
  assert.equal(state.incident.sessionId, 'a'); assert.equal(state.incident.state, 'failed');
  assert.equal(visibleNotice(state.incident, 2000), true);
  assert.equal(applyAlertState(state, failure(1)), state);
  assert.deepEqual(applyAlertState(initial, failure(1)), state);
  const fork = createAlertState({ id: 'child' }, 3);
  assert.equal(applyAlertState(fork, failure(1)), fork);
});

test('ack survives same incident replay; another failed turn is unread', () => {
  const first = applyAlertState(createAlertState({ id: 'a' }), failure(1)).incident;
  const acked = { ...first, title: 'A task', acknowledged: true };
  assert.equal(visibleNotice(mergeNotice(acked, first), 2000), false);
  const next = applyAlertState(createAlertState({ id: 'a' }), failure(3, 2)).incident;
  assert.equal(mergeNotice(acked, next).acknowledged, false);
  assert.notEqual(first.id, next.id);
});

test('short native retries stay quiet; persistent retries become visible and merge', () => {
  const retry = (seq, time) => event(seq, 'llm/retry', { turn: 1, retry: seq + 1, delayMs: 10000, failure: { code: 'SERVER', message: '503' } }, time);
  let state = applyAlertState(createAlertState({ id: 'a' }), retry(1, 1000));
  const id = state.incident.id;
  assert.equal(visibleNotice(state.incident, 120999), false);
  assert.equal(visibleNotice(state.incident, 121000), true);
  state = applyAlertState(state, retry(2, 2000)); assert.equal(state.incident.id, id);
  state = applyAlertState(state, success(3)); assert.equal(visibleNotice(state.incident, 999999), false);
});

test('a new retry episode in the same turn cannot inherit an acknowledged episode', () => {
  const first = retryNotice(null, { sessionId: 'a', turn: 1, seq: 1, at: 1000, retryAt: 2000, attempt: 1 });
  const previous = { ...first, state: 'resumed', acknowledged: true };
  const next = retryNotice(previous, { sessionId: 'a', turn: 1, seq: 4, at: 3000, retryAt: 4000, attempt: 1 });
  const result = mergeNotice(previous, next);
  assert.notEqual(result.id, first.id); assert.equal(result.acknowledged, false);
});

test('manual stop and normal completion do not generate new failure notices', () => {
  const initial = createAlertState({ id: 'a' });
  for (const kind of ['completed', 'aborted', 'forked', 'blocked']) assert.equal(applyAlertState(initial, event(1, 'turn/end', { turn: 1, reason: { kind } })), initial);
  const failed = applyAlertState(initial, failure(1));
  const resumed = applyAlertState(failed, event(2, 'turn/start', { turn: 2 }));
  assert.equal(resumed.incident.state, 'resumed');
  const completed = applyAlertState(resumed, event(3, 'turn/end', { turn: 2, reason: { kind: 'completed' } }));
  assert.equal(completed.incident.state, 'resolved'); assert.equal(completed.incident.resolution, 'completed');
});

test('a fast recovered request does not become an alarm when the long task finishes later', () => {
  let state = createAlertState({ id: 'a' });
  state = applyAlertState(state, event(1, 'llm/retry', { turn: 1, retry: 1, delayMs: 1000, failure: { code: 'SERVER' } }, 1000));
  state = applyAlertState(state, event(2, 'assistant/message', { message: { role: 'assistant', content: [] } }, 5000));
  state = applyAlertState(state, event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 900000));
  assert.equal(state.incident.recoveredAt, 5000);
  assert.equal(visibleNotice(state.incident, 1000000), false);
});

test('projection upgrades preserve an acknowledged abandoned-retry interruption', () => {
  const incoming = retryNotice(null, { sessionId: 'a', turn: 1, seq: 1, at: 1000, retryAt: 2000, attempt: 1 });
  const previous = { ...incoming, id: `${incoming.id}:restart`, state: 'failed', kind: 'interrupted', code: 'RETRY_INTERRUPTED', acknowledged: true };
  assert.equal(mergeNotice(previous, incoming), previous);
});
