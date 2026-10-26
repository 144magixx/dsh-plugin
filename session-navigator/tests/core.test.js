import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, PROJECTION_KEY, SUMMARY_PROMPT, projectionDefinition, stateSchema, viewSchema,
  foldProjection, buildSummaryInput, parseSummary, isSubstantiveInput, isRuntimeText,
  truncateText, hasOwnInput, getCachedSummary, mergeHistoricalTopics,
} from '../lib/core.js';

const header = { id: 'synthetic-session', createdAt: 100, isSeeded: false };
const textBlock = text => ({ type: 'text', text });
const user = (seq, text, extra = {}) => ({ type: 'user/message', seq, time: 1000 + seq, surfaceOp: 'append', data: { role: 'user', source: { kind: 'user' }, content: [textBlock(text)] }, ...extra });
const assistant = (seq, text, extra = {}) => ({ type: 'assistant/message', seq, time: 1000 + seq, surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model', provider: 'synthetic', model: 'synthetic' }, content: [textBlock(text)] }, stream: [] }, ...extra });
const title = (seq, value) => ({ type: 'session/title', seq, time: 1000 + seq, data: { title: value, messageSeqs: [0], source: { kind: 'user' } } });
const turnEnd = (seq, kind = 'completed') => ({ type: 'turn/end', seq, time: 1000 + seq, data: { turn: 1, reason: { kind } } });
const summary = { recentTopic: '摄影与印象派的关系', recentSummary: '正在讨论摄影对印象派的影响，具体因果关系仍待澄清。', pastTopics: ['自由意志与责任'] };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
};
function cacheFor(state, overrides = {}) {
  return { sessionId: state.sessionId, sourceSeq: state.sourceSeq, resetSeq: state.resetSeq, ...summary, generatedAt: 1234, ...overrides };
}

test('projection exposes the verified schema.parse runtime contract and stable metadata-only wire view', () => {
  assert.equal(PROJECTION_KEY, 'sessionNavigator');
  assert.equal(projectionDefinition.key, PROJECTION_KEY);
  assert.equal(projectionDefinition.stateVersion, 1);
  const state = projectionDefinition.init(header, 0);
  assert.equal(stateSchema.parse(state), state);
  const view = projectionDefinition.wire.view(state);
  assert.equal(projectionDefinition.wire.view(state), view);
  assert.equal(viewSchema.parse(view), view);
  assert.equal(Object.hasOwn(view, 'messages'), false);
  assert.equal(state.title, '');
  assert.equal(state.sourceSeq, -1);
});

test('philosophy-to-art input preserves latest question while stable title remains unchanged', () => {
  const events = [
    user(0, '自由意志与道德责任有什么关系？'),
    title(1, '自由意志与道德责任'),
    assistant(2, '讨论决定论下的责任归属。'),
    turnEnd(3),
    user(4, '换个话题，摄影如何影响印象派绘画？'),
    assistant(5, '可以讨论摄影的影响，但不能简单断言它是唯一原因。'),
    turnEnd(6),
  ];
  const state = foldProjection(events, header);
  const input = buildSummaryInput(state);
  assert.equal(input.stableTitle, '自由意志与道德责任');
  assert.equal(input.latestQuestion, events[4].data.content[0].text);
  assert.equal(input.latestQuestionSeq, 4);
  assert.deepEqual(input.messages.map(m => [m.seq, m.role]), [[0, 'user'], [2, 'assistant'], [4, 'user'], [5, 'assistant']]);
  assert.equal(state.sourceSeq, 5);
  assert.equal(state.lastTurnEndSeq, 6);
  assert.equal(state.turnEnded, true);
  assert.equal(input.previousSummary, null);
});

test('injected user-source runtime and background notifications never become questions', () => {
  const state = freeze(foldProjection([user(0, '联合阅读三个仓库的调用链')], header));
  const injections = [
    '<system-reminder>internal instructions</system-reminder>',
    'Current runtime context. This snapshot supersedes earlier snapshots.',
    'The working directory changed from "/synthetic/old" to "/synthetic/new".',
    'Time sampled while preparing turn 2, step 1: 2030-01-01',
    'Browser time zone for this request: Asia/Shanghai.',
    'Elapsed since the preceding model-visible message: 12m.',
    'Background subagent synthetic finished and will do no further work.',
    'background job synthetic finished [status: completed, exit code: 0].',
    '<task-notification>job done</task-notification>',
    '<compacted-summary>generated context</compacted-summary>',
  ];
  for (const [index, text] of injections.entries()) {
    assert.equal(isRuntimeText(text), true, text);
    assert.equal(projectionDefinition.apply(state, freeze(user(index + 1, text))), state, text);
  }
  assert.equal(state.latestQuestion, '联合阅读三个仓库的调用链');
});

test('only human sources are admitted; ignored text blocks do not suppress a real block', () => {
  const state = foldProjection([user(0, '起始问题')], header);
  const fromAgent = user(1, 'agent-authored text');
  fromAgent.data.source = { kind: 'subagent', sessionId: 'synthetic-child' };
  assert.equal(projectionDefinition.apply(state, fromAgent), state);
  const mixed = user(2, '被替换的测试文本');
  mixed.data.content = [textBlock('<system-reminder>runtime</system-reminder>'), textBlock('解释艺术作品中的光影'), { type: 'reasoning', text: 'never include' }];
  const next = projectionDefinition.apply(state, mixed);
  assert.equal(next.latestQuestion, '解释艺术作品中的光影');
  assert.equal(next.messages.at(-1).text, '解释艺术作品中的光影');
  assert.equal(isRuntimeText('请解释 Current runtime context 这个词的含义'), false);
});

test('assistant keeps finalized visible text only, never reasoning, tools, attempts or streams', () => {
  const initial = foldProjection([user(0, '分析画面的光线')], header);
  const event = assistant(1, 'placeholder');
  event.data.message.content = [
    { type: 'reasoning', text: 'PRIVATE REASONING MUST NOT LEAK' },
    textBlock('画面使用侧光。'),
    { type: 'tool-call', id: 'synthetic-call', name: 'read', arguments: 'SECRET TOOL INPUT' },
    { type: 'image', attachment: { attachmentId: 'synthetic-image' } },
  ];
  event.data.stream = [{ type: 'reasoning-chunks', texts: ['STREAM SECRET'] }, { type: 'text-chunks', texts: ['unsettled draft'] }];
  const state = projectionDefinition.apply(freeze(initial), freeze(event));
  assert.equal(state.messages.at(-1).text, '画面使用侧光。');
  assert.doesNotMatch(JSON.stringify(buildSummaryInput(state)), /PRIVATE|SECRET|unsettled/);
  const interrupted = assistant(2, 'interrupted draft');
  interrupted.data.interrupted = true;
  assert.equal(projectionDefinition.apply(state, interrupted), state);
  assert.equal(projectionDefinition.apply(state, { type: 'assistant/attempt', seq: 3, time: 1003, data: { stream: [{ text: 'failed draft' }] } }), state);
});

test('ignored log events do not churn state or wire view', () => {
  const state = freeze(foldProjection([user(0, '如何设计会话导航？')], header));
  const view = projectionDefinition.wire.view(state);
  for (const [index, type] of ['tool/call', 'tool/result', 'system/message', 'developer/message', 'agent/inbox/spliced', 'request/header', 'step/end', 'plugin:unknown/record'].entries()) {
    const next = projectionDefinition.apply(state, { type, seq: index + 1, time: 2000, surfaceOp: 'append', data: { message: { content: [textBlock('ignored')] } } });
    assert.equal(next, state, type);
    assert.equal(projectionDefinition.wire.view(next), view, type);
  }
});

test('title-only and turn/end changes do not advance the content revision', () => {
  const state = foldProjection([user(0, '艺术如何表达情绪？'), assistant(1, '可以通过色彩与构图分析。')], header);
  const renamed = projectionDefinition.apply(state, title(2, '艺术与情绪'));
  assert.notEqual(renamed, state);
  assert.equal(renamed.sourceSeq, state.sourceSeq);
  assert.equal(renamed.updatedAt, state.updatedAt);
  const ended = projectionDefinition.apply(renamed, turnEnd(3));
  assert.equal(ended.sourceSeq, state.sourceSeq);
  assert.equal(ended.lastTurnEndSeq, 3);
  assert.equal(ended.turnEnded, true);
  assert.equal(projectionDefinition.apply(ended, turnEnd(4)), ended);
  assert.equal(projectionDefinition.apply(ended, title(5, '艺术与情绪')), ended);
  const nextQuestion = projectionDefinition.apply(ended, user(6, '摄影呢？'));
  assert.equal(nextQuestion.turnEnded, false);
  assert.equal(nextQuestion.sourceSeq, 6);
});

test('long input is bounded and preserves the question tail without broken Unicode', () => {
  const longQuestion = '这是较长的背景。'.repeat(2000) + '最终问题：摄影如何影响印象派？';
  const state = foldProjection([user(0, longQuestion)], header);
  assert.ok(state.latestQuestion.length <= LIMITS.messageChars);
  assert.match(state.latestQuestion, /最终问题：摄影如何影响印象派？$/u);
  assert.match(state.latestQuestion, /截断/u);
  assert.equal(state.messages[0].text, state.latestQuestion);
  const unicode = truncateText('🖼️'.repeat(4000) + '尾部问题');
  assert.ok(unicode.length <= LIMITS.messageChars);
  assert.equal(unicode.isWellFormed(), true);
  assert.match(unicode, /尾部问题$/u);
});

test('rolling window caps total text and pins the newest user question across many assistant messages', () => {
  const events = [user(0, '请分析摄影与印象派的关系。')];
  for (let seq = 1; seq <= 40; seq++) events.push(assistant(seq, `第${seq}条分析：` + '光线与色彩'.repeat(900)));
  const state = foldProjection(events, header);
  assert.ok(state.messages.length <= 12);
  assert.ok(state.messages.every(m => m.text.length <= 3000));
  assert.ok(state.messages.reduce((total, m) => total + m.text.length, 0) <= 10000);
  assert.equal(state.messages.find(m => m.role === 'user').seq, 0);
  assert.equal(state.latestQuestion, '请分析摄影与印象派的关系。');
  assert.equal(state.messages.at(-1).seq, 40);
  assert.equal(stateSchema.parse(state), state);
});

test('message count bound holds for short messages and newer user question replaces the pinned one', () => {
  const events = [user(0, '旧问题')];
  for (let seq = 1; seq <= 25; seq++) events.push(assistant(seq, `分析${seq}`));
  events.push(user(26, '新问题：艺术与技术如何互相影响？'));
  const state = foldProjection(events, header);
  assert.equal(state.messages.length, 12);
  assert.equal(state.latestQuestionSeq, 26);
  assert.equal(state.messages.some(m => m.seq === 0), false);
});

test('model-only replacements and compaction preserve the human transcript without ingesting checkpoints', () => {
  const state = freeze(foldProjection([user(0, '哲学问题'), assistant(1, '哲学解释'), user(2, '现在聊艺术'), assistant(3, '艺术解释'), turnEnd(4)], header));
  const replacement = user(6, 'GENERATED CHECKPOINT NOT A HUMAN QUESTION', { surfaceOp: { op: 'replace', startSeq: 0, endSeq: 3 }, sourceEventSeqs: [0, 1, 2, 3, 5] });
  const compacted = { type: 'compaction/summary', seq: 5, time: 1005, data: { shadowedRange: { start: 0, end: 3 }, shadowedSeqs: [0, 1, 2, 3], summary: [textBlock('generated summary')] } };
  assert.equal(projectionDefinition.apply(state, compacted), state);
  assert.equal(projectionDefinition.apply(state, replacement), state);
  const reversed = { ...replacement, seq: 7, surfaceOp: { op: 'replace', startSeq: 6, endSeq: 2 } };
  assert.equal(projectionDefinition.apply(state, reversed), state);
  assert.equal(state.latestQuestion, '现在聊艺术');
  assert.equal(state.sourceSeq, 3);
  assert.equal(state.resetSeq, -1);
  assert.doesNotMatch(JSON.stringify(buildSummaryInput(state)), /GENERATED|generated summary/u);
});

test('forks retain inherited context but do not treat inherited or fork-closure turn ends as new work', () => {
  const inherited = [user(0, '父会话的问题'), assistant(1, '父会话的解释'), turnEnd(2)];
  const childHeader = { ...header, id: 'synthetic-fork', parentSession: header.id, isSeeded: true };
  const state = foldProjection([...inherited, { type: 'session/end-seed', seq: 3, time: 1003, data: {} }, turnEnd(4, 'forked')], childHeader, 3);
  assert.equal(state.latestQuestion, '父会话的问题');
  assert.equal(state.inheritedEventCount, 3);
  assert.equal(hasOwnInput(state), false);
  assert.equal(state.turnEnded, false);
  assert.equal(state.lastTurnEndSeq, -1);
  const own = projectionDefinition.apply(state, user(5, '子会话的新问题'));
  const ended = projectionDefinition.apply(own, turnEnd(6));
  assert.equal(hasOwnInput(ended), true);
  assert.equal(ended.turnEnded, true);
  assert.equal(ended.latestQuestionSeq, 5);
});

test('schemas reject corrupted checkpoints and expose stable parsed references', () => {
  const state = foldProjection([user(0, '有效问题')], header);
  assert.equal(stateSchema.parse(state), state);
  for (const bad of [
    { ...state, extra: true },
    { ...state, sourceSeq: -2 },
    { ...state, latestQuestion: 'not the retained question' },
    { ...state, messages: [{ ...state.messages[0], role: 'tool' }] },
    { ...state, resetSeq: 99 },
    { ...state, messages: [state.messages[0], state.messages[0]] },
  ]) assert.throws(() => stateSchema.parse(bad), TypeError);
  assert.throws(() => viewSchema.parse({ ...projectionDefinition.wire.view(state), messages: [] }), TypeError);
});

test('summary parsing accepts bounded JSON without adding or rewriting facts', () => {
  assert.deepEqual(parseSummary(JSON.stringify(summary)), summary);
  const minimal = { recentTopic: '联合阅读', recentSummary: '方案待确认。', pastTopics: [] };
  assert.deepEqual(parseSummary(JSON.stringify(minimal)), minimal);
  const unicode = { recentTopic: '🎨'.repeat(24), recentSummary: '艺术讨论。', pastTopics: [] };
  assert.deepEqual(parseSummary(JSON.stringify(unicode)), unicode);
});

test('summary parsing rejects malformed, wrong-shaped, overlong or manufactured fallback output', () => {
  const invalid = [
    '', 'not json', '```json\n{}\n```', 'null', '[]',
    JSON.stringify({ ...summary, extra: 'unexpected' }),
    JSON.stringify({ recentTopic: '艺术', recentSummary: '待确认。' }),
    JSON.stringify({ ...summary, recentTopic: '字'.repeat(25) }),
    JSON.stringify({ ...summary, recentSummary: '字'.repeat(101) }),
    JSON.stringify({ ...summary, recentSummary: '' }),
    JSON.stringify({ ...summary, recentTopic: 42 }),
    JSON.stringify({ ...summary, recentSummary: '第一行\n第二行' }),
    JSON.stringify({ ...summary, pastTopics: ['a', 'b', 'c', 'd'] }),
    JSON.stringify({ ...summary, pastTopics: ['字'.repeat(21)] }),
    JSON.stringify({ ...summary, pastTopics: ['重复', '重复'] }),
    JSON.stringify({ ...summary, pastTopics: [summary.recentTopic] }),
    JSON.stringify({ ...summary, pastTopics: [null] }),
  ];
  for (const raw of invalid) assert.throws(() => parseSummary(raw), undefined, raw);
});

test('only trivial acknowledgements are skipped; short questions and specific instructions survive', () => {
  for (const text of ['', '   ', '好的', '可以。', '收到！', '谢谢', 'OK', 'thanks!', '👍']) assert.equal(isSubstantiveInput(text), false, text);
  for (const text of ['为什么', '艺术呢？', '继续', '可以，改成红色', '不对', '帮我联合阅读', '可以？']) assert.equal(isSubstantiveInput(text), true, text);
});

test('prior cached summary is reused only within the same session and valid source/reset bounds', () => {
  const first = foldProjection([user(0, '自由意志与责任')], header);
  const cache = cacheFor(first);
  const later = projectionDefinition.apply(first, user(1, '换个话题，聊摄影'));
  assert.deepEqual(getCachedSummary(cache, first), summary);
  assert.equal(getCachedSummary(cache, later), null);
  assert.deepEqual(getCachedSummary(cache, later, { allowStale: true }), summary);
  assert.equal(getCachedSummary({ ...cache, sessionId: 'other-session' }, first), null);
  assert.equal(getCachedSummary({ ...cache, sourceSeq: 99 }, first), null);
  assert.equal(getCachedSummary({ ...cache, resetSeq: 0 }, first), null);
  assert.equal(getCachedSummary({ ...cache, recentSummary: null }, first), null);
  assert.deepEqual(buildSummaryInput(later, cache).previousSummary, summary);
  assert.equal(buildSummaryInput(later, { ...cache, sessionId: 'parent-session' }).previousSummary, null);
});

test('summary input is detached, bounded and contains no model instructions or tool payloads', () => {
  const state = freeze(foldProjection([user(0, '摄影如何影响绘画？'), assistant(1, '可比较记录与表达的变化。')], header));
  const input = buildSummaryInput(state, cacheFor(state));
  input.messages[0].text = 'changed outside';
  input.previousSummary.pastTopics.push('outside');
  assert.equal(state.latestQuestion, '摄影如何影响绘画？');
  assert.equal(state.messages[0].text, '摄影如何影响绘画？');
  assert.equal(Object.hasOwn(input, 'system'), false);
  assert.equal(Object.hasOwn(input, 'tools'), false);
  assert.match(SUMMARY_PROMPT, /三仓库联合阅读规则/u);
  assert.match(SUMMARY_PROMPT, /不补造结论/u);
});

test('historical topic merge deduplicates bounded explicit topics without inventing new labels', () => {
  assert.deepEqual(mergeHistoricalTopics(['哲学', '美学', '字'.repeat(21)], ['摄影', '哲学', '摄影'], '摄影'), ['哲学', '美学']);
  assert.deepEqual(mergeHistoricalTopics(['old1', 'old2'], ['new1', 'new2'], 'current'), ['new1', 'new2', 'old1']);
});

test('fold is deterministic, supports checkpoint continuation, and rejects unordered sources', () => {
  const events = [user(0, '旧问题'), assistant(2, '解释'), user(4, '新问题'), turnEnd(5)];
  const whole = foldProjection(events, header);
  const prefix = JSON.parse(JSON.stringify(foldProjection(events.slice(0, 2), header)));
  stateSchema.parse(prefix);
  const resumed = events.slice(2).reduce(projectionDefinition.apply, prefix);
  assert.deepEqual(resumed, whole);
  assert.deepEqual(foldProjection(events, header), whole);
  assert.throws(() => foldProjection([events[1], events[0]], header), TypeError);
  assert.throws(() => foldProjection([events[0], events[0]], header), TypeError);
});
