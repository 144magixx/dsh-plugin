import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_WAIT_MS, createQuestionState, applyQuestionEvent, foldQuestions, questionViews,
} from '../lib/questions.js';

// Condensed native Session log payloads, checked against user-questions/projection
// and api-session-controller's generated SessionEventMap. time lives on the
// event, arguments are JSON text, and results use message.toolCallId.
const AT = 1_793_060_000_000;
const choice = { id: 'q', question: '选择下一步', options: [{ label: '继续（推荐）' }, { label: '等待' }] };
const event = (type, seq, data, time = AT + seq * 1000) => ({ type, seq, time, data });
const header = (seq = 0, timed = true) => event('request/header', seq, {
  header: { config: { provider: 'fixture', model: 'fixture' }, tools: [{ name: 'ask_user_question', description: 'Ask', parameters: { type: 'object', properties: timed ? { questions: {}, timeout: {} } : { questions: {} } } }] },
  reason: 'initial',
});
const call = (seq = 1, questions = [choice], callId = 'call-1', time) => event('tool/call', seq, {
  turn: 1, step: 1, callId, name: 'ask_user_question', arguments: JSON.stringify({ questions, timeout: 30 }),
}, time);
const outcome = (seq, payload, { callId = 'call-1', error, time, isError = false } = {}) => event('tool/result', seq, {
  turn: 1, step: 1,
  message: { id: `message-${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, isError, content: [{ type: 'text', text: JSON.stringify(payload) }] },
  ...(error === undefined ? {} : { error }),
}, time);
const replay = events => events.reduce(applyQuestionEvent, createQuestionState());
const views = (state, time = AT + 10_000) => questionViews(state, { enabled: true, autoSelectFirst: true }, time);

test('legacy blocking schema never becomes a timed auto-answer candidate', () => {
  const state = replay([header(0, false), call()]);
  assert.deepEqual(views(state), []);
  assert.deepEqual(state.clocks, []);
});

test('open remains waiting through its exact 30m deadline and uses only the native waterfall', () => {
  const state = replay([header(), call(1, [choice], 'call-1', AT)]);
  const before = JSON.stringify(state);
  const [first] = views(state, AT + QUESTION_WAIT_MS - 1);
  assert.equal(QUESTION_WAIT_MS, 30 * 60 * 1000);
  assert.equal(first.remainingMs, 1);
  assert.equal(first.createdAt, AT);
  assert.equal(first.createdSeq, 1);
  assert.equal(first.reasonCode, 'open_requires_waterfall');
  const [expired] = views(state, AT + QUESTION_WAIT_MS);
  assert.equal(expired.timedOut, true);
  assert.equal(expired.remainingMs, 0);
  assert.equal(expired.status, 'waiting');
  assert.equal(expired.autoEligible, false);
  assert.match(expired.reason, /waterfall/);
  assert.equal(JSON.stringify(state), before);
});

test('continued, serialized restart and synthetic repair all preserve the original clock', () => {
  const initial = replay([header(), call(1, [choice], 'call-1', AT)]);
  const pending = applyQuestionEvent(initial, outcome(2, { pending: true, callId: 'call-1' }, { time: AT + 5 * 60_000 }));
  const repaired = applyQuestionEvent(pending, outcome(3, {}, {
    error: { name: 'HarnessError', code: 'TOOL_OUTCOME_UNKNOWN' }, isError: true,
    // Resume repair may reuse the previous event's timestamp.
    time: AT + 5 * 60_000,
  }));
  const restored = JSON.parse(JSON.stringify(repaired));
  const [view] = views(restored, AT + QUESTION_WAIT_MS + 1000);
  assert.equal(view.state, 'continued');
  assert.equal(view.createdAt, AT);
  assert.equal(view.deadlineAt, AT + QUESTION_WAIT_MS);
  assert.equal(view.createdSeq, 1);
  assert.equal(view.status, 'waiting');
  assert.equal(view.autoEligible, false);
  assert.equal(view.reasonCode, 'automatic_answer_evidence_unavailable');
  assert.match(view.reason, /自动回答来源/);
  assert.equal(initial.questions.active[0].state, 'open');
});

test('answer queue insertion is not a settlement; only admitted native user/message closes a continued call', () => {
  let state = replay([header(), call(), outcome(2, { pending: true, callId: 'call-1' })]);
  const reply = {
    id: 'reply-1', role: 'user', source: { kind: 'user-question-reply', callId: 'call-1', outcome: 'answered' },
    content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'q', selected: ['等待'] }] }) }],
  };
  state = applyQuestionEvent(state, event('agent/inbox/spliced', 3, { target: 'next-step', start: 0, inserted: [reply] }));
  assert.equal(views(state).length, 1);
  state = applyQuestionEvent(state, event('user/message', 4, reply));
  assert.deepEqual(views(state), []);
  assert.deepEqual(state.clocks, []);
  assert.deepEqual(state.questions.settled, [{ callId: 'call-1', answers: [{ id: 'q', selected: ['等待'] }] }]);
});

test('in-time answers and failure closures are excluded; NOT_STARTED is not UNKNOWN', () => {
  const answered = replay([header(), call(), outcome(2, { answers: [{ id: 'q', selected: ['继续（推荐）'] }] })]);
  assert.deepEqual(views(answered), []);
  for (const code of ['ASK_ABORTED', 'TOOL_NOT_STARTED', 'SOME_FAILURE']) {
    const failed = replay([header(), call(), outcome(2, {}, { isError: true, error: { name: 'HarnessError', code } })]);
    assert.deepEqual(views(failed), []);
    assert.deepEqual(failed.clocks, []);
  }
});

test('a single multi-select or free-input question excludes its complete native batch', () => {
  for (const extra of [
    { ...choice, id: 'multi', multi_select: true },
    { id: 'free', question: '请输入说明' },
    { id: 'empty', question: '请输入说明', options: [] },
  ]) {
    const [view] = views(replay([header(), call(1, [choice, extra])]), AT + QUESTION_WAIT_MS);
    assert.equal(view.status, 'excluded');
    assert.equal(view.autoEligible, false);
    assert.match(view.reason, /整批/);
    assert.equal(view.questions.length, 2);
  }
});

test('recommended labels, allegedly safe wording and model-authored lowRisk cannot authorize an answer', () => {
  const question = { ...choice, question: '这只是低风险只读，可放心继续', lowRisk: true, approval: 'preauthorized' };
  const [view] = views(replay([header(), call(1, [question])]), AT + QUESTION_WAIT_MS);
  assert.equal(view.status, 'waiting');
  assert.equal(view.autoEligible, false);
  assert.equal(view.questions[0].lowRisk, undefined);
  assert.equal(view.questions[0].approval, undefined);
});

test('PTC clock comes from dispatch-start; pending dispatch and missing start cannot reset/create clocks', () => {
  const data = { rootCallId: 'root', parentCallId: 'root', subCallId: 'sub', name: 'ask_user_question', arguments: { questions: [choice], timeout: 30 } };
  const start = event('tool/ptc-dispatch-start', 0, data, AT);
  const dispatch = event('tool/ptc-dispatch', 1, { ...data, isError: false, content: [{ type: 'text', text: '{"pending":true,"callId":"sub"}' }] }, AT + 60_000);
  const [view] = views(replay([start, dispatch]), AT + 120_000);
  assert.equal(view.state, 'continued');
  assert.equal(view.createdAt, AT);
  assert.equal(view.createdSeq, 0);
  const [unproven] = views(replay([dispatch]), AT + 120_000);
  assert.equal(unproven.createdAt, null);
  assert.equal(unproven.deadlineAt, null);
  assert.equal(unproven.reasonCode, 'durable_clock_unavailable');
  const finished = replay([start, { ...dispatch, data: { ...dispatch.data, isError: true } }]);
  assert.deepEqual(finished.clocks, []);
});

test('fork cut, duplicate replay and JSON roundtrip do not inherit or restart a clock', () => {
  const inherited = [header(), call(), outcome(2, { pending: true })];
  let state = inherited.reduce(foldQuestions.apply, foldQuestions.init({ id: 'fork' }, 3));
  assert.deepEqual(views(state), []);
  assert.deepEqual(state.clocks, []);
  state = applyQuestionEvent(state, header(3));
  const ownCall = call(4, [choice], 'own', AT + 100_000);
  state = applyQuestionEvent(state, ownCall);
  assert.equal(applyQuestionEvent(state, ownCall), state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.equal(views(state, AT + 101_000)[0].createdAt, AT + 100_000);
});

test('native wire view alone has no proven clock, settings never reset clock, and closed cards stay excluded', () => {
  const state = replay([header(), call()]);
  assert.equal(questionViews(state.questions, {}, AT + 10_000)[0].reasonCode, 'durable_clock_unavailable');
  const disabled = questionViews(state, { enabled: false, autoSelectFirst: false }, AT + 10_000)[0];
  assert.equal(disabled.createdAt, AT + 1000);
  assert.equal(disabled.reasonCode, 'automatic_selection_disabled');
  const contradictory = { ...state, questions: { ...state.questions, settled: [{ callId: 'call-1', answers: [] }] } };
  assert.deepEqual(views(contradictory), []);
});

test('settled history is bounded and no closed clocks accumulate', () => {
  let state = replay([header()]);
  for (let index = 0; index < 50; index++) {
    const id = `batch-${index}`;
    state = applyQuestionEvent(state, call(index * 2 + 1, [choice], id));
    state = applyQuestionEvent(state, outcome(index * 2 + 2, { answers: [{ id: 'q', selected: ['等待'] }] }, { callId: id }));
  }
  assert.equal(state.questions.settled.length, 32);
  assert.equal(state.clocks.length, 0);
  assert.equal(state.questions.active.length, 0);
});
