import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleState, applyLifecycle, assessRecovery } from '../lib/recovery.js';

// Native Session event spellings and nested payloads, checked against the
// installed SessionEventMap, PtcDispatchEventData, and durable goal/change fold.
const AT = 1_793_060_000_000;
const event = (type, seq, data) => ({ type, seq, time: AT + seq * 1000, data });
const turn = seq => event('turn/start', seq, { turn: 1 });
const step = (seq, number = 1) => event('step/start', seq, { turn: 1, step: number });
const call = (seq, name = 'third_party_mutation', callId = 'call-1') => event('tool/call', seq, {
  turn: 1, step: 1, callId, name, arguments: '{"resource":"example","mode":"read-only"}',
});
const outcome = (seq, code, callId = 'call-1') => event('tool/result', seq, {
  turn: 1, step: 1,
  message: {
    id: `result-${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId,
    ...(code ? { isError: true } : {}), content: [{ type: 'text', text: code ?? 'done' }],
  },
  ...(code ? { error: { name: 'HarnessError', code } } : {}),
});
const goal = (seq, operation = 'create', phase = 'active', revision = 1, roundsStarted = 0) => event('goal/change', seq, {
  kind: 'goal/change', version: 1, operation,
  goal: { id: 'goal-1', revision, objective: '完成用户目标', phase, maxGoalRounds: 10,
    ...(phase === 'blocked' ? { blockedReason: { code: 'external-condition', message: '等待外部条件' } } : {}),
  },
  roundsStarted, createdAt: AT, updatedAt: AT + seq * 1000,
});
const replay = events => events.reduce(applyLifecycle, createLifecycleState());
const guardian = lifecycle => ({
  sessionId: 'session-1', revision: 1,
  settings: { enabled: true, recoverAfterRestart: true, autoSelectFirst: false },
  run: { phase: 'idle', ownerId: 'previous-process', lastSeq: lifecycle.lastSeq },
  lifecycle,
});
const assess = (lifecycle, extra = {}) => assessRecovery({ record: guardian(lifecycle), snapshot: lifecycle, workspaceAvailable: true, ...extra });

test('normal native turn/step/tool fold is pure, JSON-only and records the successful assistant boundary', () => {
  const initial = createLifecycleState();
  const state = [turn(0), step(1), call(2), outcome(3), event('step/end', 4, { turn: 1, step: 1 }),
    event('assistant/message', 5, { turn: 1, step: 1, message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '完成' }] }, stream: [] }),
    event('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
  ].reduce(applyLifecycle, initial);
  assert.equal(initial.lastSeq, -1);
  assert.equal(initial.toolCalls.length, 0);
  assert.equal(state.lastSuccessfulAssistantSeq, 5);
  assert.equal(state.turn, null);
  assert.equal(state.step, null);
  assert.deepEqual(state.lastTurnEnd, { turn: 1, seq: 6, time: AT + 6000, reason: { kind: 'completed' } });
  assert.equal(state.toolCalls[0].status, 'completed');
  assert.equal(state.toolCalls[0].arguments, null);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.equal(assess(state).reasonCode, 'no_unfinished_work');
});

test('residual running state is not evidence of a cause and defaults to need_confirmation', () => {
  const state = replay([turn(0), step(1)]);
  const view = assess(state);
  assert.equal(view.status, 'need_confirmation');
  assert.equal(view.reasonCode, 'safe_recovery_adapter_unavailable');
  assert.match(view.reason, /停止和撤销/);
  assert.doesNotMatch(view.reason, /断电|掉电/);
  assert.equal(assess(state, { apiCompatible: true }).status, 'recommend_recovery');
  assert.equal(assess(state, { apiCompatible: 'true' }).status, 'need_confirmation');
});

test('unrecognized tool names and read-only-looking arguments still require outcome proof', () => {
  const pending = replay([turn(0), step(1), call(2, 'read_file_safely')]);
  assert.equal(pending.toolCalls[0].name, 'read_file_safely');
  assert.equal(pending.toolCalls[0].arguments, '{"resource":"example","mode":"read-only"}');
  assert.equal(assess(pending, { apiCompatible: true }).reasonCode, 'tool_outcome_unproven');
  const unknown = applyLifecycle(pending, outcome(3, 'TOOL_OUTCOME_UNKNOWN'));
  assert.equal(unknown.toolCalls[0].status, 'outcome_unknown');
  assert.equal(unknown.toolCalls[0].arguments, pending.toolCalls[0].arguments);
  assert.equal(assess(unknown, { apiCompatible: true }).status, 'need_confirmation');
  assert.equal(assess(unknown).reasonCode, 'tool_outcome_unproven');
  assert.equal(Object.hasOwn(assess(unknown), 'replay'), false);
});

test('TOOL_NOT_STARTED is distinct from an unknown outcome and never authorizes recovery on its own', () => {
  const state = replay([turn(0), step(1), call(2), outcome(3, 'TOOL_NOT_STARTED')]);
  assert.equal(state.toolCalls[0].status, 'not_started');
  assert.equal(state.toolCalls[0].arguments, null);
  assert.equal(assess(state).reasonCode, 'safe_recovery_adapter_unavailable');
  assert.equal(assess(state, { apiCompatible: true }).status, 'recommend_recovery');
});

test('native user abort is a stop and outranks residual state, current running state and future adapters', () => {
  let state = replay([turn(0), step(1), call(2), event('turn/end', 3, {
    turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
  })]);
  assert.equal(state.stopped, true);
  assert.deepEqual(state.lastTurnEnd.reason, { kind: 'aborted', reason: { kind: 'user' } });
  assert.equal(assess(state, { snapshot: { lifecycle: state, running: true }, apiCompatible: true }).reasonCode, 'explicit_stop');
  state = applyLifecycle(state, event('turn/start', 4, { turn: 2 }));
  assert.equal(assess(state, { apiCompatible: true }).status, 'not_needed');
  const hostStopped = { ...guardian(state), run: { phase: 'stopped' } };
  assert.equal(assessRecovery({ record: hostStopped, snapshot: {}, workspaceAvailable: false }).reasonCode, 'explicit_stop');
});

test('pause, complete, block, clear and session closure take priority over recommendations', () => {
  for (const [operation, phase, expected] of [
    ['pause', 'paused', 'goal_paused'], ['complete', 'complete', 'goal_completed'], ['block', 'blocked', 'goal_blocked'],
  ]) {
    const state = replay([goal(0), goal(1, operation, phase, 2)]);
    assert.equal(assess(state, { apiCompatible: true }).reasonCode, expected);
    assert.notEqual(assess(state, { apiCompatible: true }).status, 'recommend_recovery');
  }
  const cleared = replay([goal(0), event('goal/change', 1, {
    kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'goal-1', revision: 2 }, clearedAt: AT + 1000,
  })]);
  assert.equal(assess(cleared).reasonCode, 'goal_cleared');
  for (const snapshot of [{ removed: true }, { closed: true }]) {
    assert.equal(assessRecovery({ record: {}, snapshot, workspaceAvailable: false, apiCompatible: true }).reasonCode, 'session_closed');
  }
});

test('active persisted goal never implies armed authority, including after session-start and snapshot projection', () => {
  const state = replay([goal(0)]);
  assert.equal(state.goal.goal.phase, 'active');
  assert.equal(Object.hasOwn(state.goal, 'activation'), false);
  const snapshot = { running: false, agentAvailable: true, lifecycle: state, projections: { asOfSeq: 0, values: { goal: state.goal } } };
  const view = assess(state, { snapshot });
  assert.equal(view.status, 'need_confirmation');
  assert.equal(view.reasonCode, 'safe_recovery_adapter_unavailable');
  assert.equal(assess(state, { snapshot: { ...snapshot, goals: { resume: true } } }).status, 'need_confirmation');
});

test('goal rounds only advance on matching admitted native goal source and round cap stays conservative', () => {
  let state = replay([goal(0), event('user/message', 1, {
    id: 'round-1', role: 'user', source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 }, content: [{ type: 'text', text: 'continue' }],
  })]);
  assert.equal(state.goal.roundsStarted, 1);
  const invalid = applyLifecycle(state, event('user/message', 2, {
    id: 'bad-round', role: 'user', source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 3 }, content: [],
  }));
  assert.equal(assess(invalid).reasonCode, 'lifecycle_evidence_incomplete');
  state = { ...state, goal: { ...state.goal, roundsStarted: 10 } };
  assert.equal(assess(state, { apiCompatible: true }).reasonCode, 'goal_round_limit');
});

test('PTC start and dispatch track the actual subCallId and unknown result without replay', () => {
  const data = { rootCallId: 'root', parentCallId: 'root', subCallId: 'sub', name: 'unknown_plugin', arguments: { message: 'hello' } };
  const state = replay([turn(0), step(1), event('tool/ptc-dispatch-start', 2, data),
    event('tool/ptc-dispatch', 3, { ...data, isError: true, content: [], error: { name: 'HarnessError', code: 'TOOL_OUTCOME_UNKNOWN' } }),
  ]);
  assert.equal(state.toolCalls.length, 1);
  assert.equal(state.toolCalls[0].callId, 'sub');
  assert.equal(state.toolCalls[0].rootCallId, 'root');
  assert.equal(state.toolCalls[0].status, 'outcome_unknown');
  assert.deepEqual(state.toolCalls[0].arguments, { message: 'hello' });
  assert.equal(assess(state, { apiCompatible: true }).status, 'need_confirmation');
});

test('gaps, orphan results and malformed goals cannot pass a compatible adapter check', () => {
  const states = [
    replay([turn(0), step(2)]),
    replay([outcome(0)]),
    replay([goal(0), goal(1, 'resume', 'active', 9)]),
  ];
  for (const state of states) {
    assert.equal(assess(state, { apiCompatible: true }).reasonCode, 'lifecycle_evidence_incomplete');
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  }
});

test('workspace, disabled recovery, already running, missing evidence and failed turn are explicit', () => {
  const state = replay([turn(0)]);
  assert.equal(assess(state, { workspaceAvailable: false }).reasonCode, 'workspace_unavailable');
  assert.equal(assess(state, { snapshot: { lifecycle: state, running: true } }).status, 'running');
  const disabled = { ...guardian(state), settings: { enabled: true, recoverAfterRestart: false } };
  assert.equal(assess(state, { record: disabled }).status, 'disabled');
  assert.equal(assessRecovery({ snapshot: {}, workspaceAvailable: true }).reasonCode, 'durable_state_unavailable');
  const failed = replay([turn(0), event('turn/end', 1, { turn: 1, reason: { kind: 'max-tokens' } })]);
  assert.equal(assess(failed, { apiCompatible: true }).reasonCode, 'turn_not_completed');
});

test('resolved tools are pruned on next step while unknown outcomes survive human input and JSON restart', () => {
  let state = replay([turn(0), step(1), call(2, 'mutate', 'unknown'), outcome(3, 'TOOL_OUTCOME_UNKNOWN', 'unknown'),
    call(4, 'mutate', 'complete'), outcome(5, undefined, 'complete'), event('step/end', 6, { turn: 1, step: 1 }), step(7, 2),
  ]);
  assert.equal(state.toolCalls.length, 1);
  assert.equal(state.toolCalls[0].callId, 'unknown');
  state = applyLifecycle(state, event('user/message', 8, { id: 'human', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '检查现状' }] }));
  assert.equal(state.toolCalls.length, 1);
  assert.equal(assess(JSON.parse(JSON.stringify(state)), { apiCompatible: true }).reasonCode, 'tool_outcome_unproven');
});

test('native init(header, cut), duplicate events, interrupted assistant and unknown ignorable event handling', () => {
  let state = [turn(0), step(1)].reduce(applyLifecycle, createLifecycleState({ id: 'fork' }, 2));
  assert.equal(state.turn, null);
  state = applyLifecycle(state, event('session/end-seed', 2, { inherited: true }));
  assert.equal(state.closed, false);
  state = applyLifecycle(state, { ...event('future/optional', 3, ['opaque', null]), ignorable: true });
  assert.deepEqual(state.issues, []);
  const own = event('turn/start', 4, { turn: 1 });
  state = applyLifecycle(state, own);
  assert.equal(applyLifecycle(state, own), state);
  state = applyLifecycle(state, event('assistant/message', 5, { turn: 1, step: 1, interrupted: true, message: { role: 'assistant', content: [] }, stream: [] }));
  assert.equal(state.lastSuccessfulAssistantSeq, null);
  assert.equal(state.lastSeq, 5);
});
