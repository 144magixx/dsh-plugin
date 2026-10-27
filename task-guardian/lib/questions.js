/** Pure JSON projection of native timed ask_user_question events and their durable clocks. */
export const QUESTION_WAIT_MS = 30 * 60 * 1000;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const textPayload = content => {
  const text = Array.isArray(content) ? content.find(block => block?.type === 'text') : null;
  if (typeof text?.text !== 'string') return null;
  try { return JSON.parse(text.text); } catch { return null; }
};

function questionsOf(value) {
  let input = value;
  if (typeof value === 'string') {
    try { input = JSON.parse(value); } catch { return null; }
  }
  if (!record(input) || !Array.isArray(input.questions) || input.questions.length === 0) return null;
  const questions = [];
  for (const item of input.questions) {
    if (!record(item) || typeof item.id !== 'string' || typeof item.question !== 'string'
      || (item.header !== undefined && typeof item.header !== 'string')
      || (item.multi_select !== undefined && typeof item.multi_select !== 'boolean')
      || (item.options !== undefined && (!Array.isArray(item.options) || item.options.some(option =>
        !record(option) || typeof option.label !== 'string'
        || (option.description !== undefined && typeof option.description !== 'string'))))) return null;
    // Match the native projection's vocabulary. Tool-supplied risk/intent extensions
    // are not evidence of authorization or low risk and are deliberately not copied.
    questions.push({
      id: item.id,
      question: item.question,
      ...(item.header === undefined ? {} : { header: item.header }),
      ...(item.multi_select === undefined ? {} : { multiSelect: item.multi_select }),
      ...(item.options === undefined ? {} : { options: item.options.map(option => ({
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })) }),
    });
  }
  return questions;
}

function answersOf(payload) {
  if (!record(payload) || !Array.isArray(payload.answers) || payload.answers.some(answer =>
    !record(answer) || typeof answer.id !== 'string' || !Array.isArray(answer.selected)
    || answer.selected.some(label => typeof label !== 'string')
    || (answer.custom !== undefined && typeof answer.custom !== 'string'))) return null;
  return payload.answers.map(answer => ({
    id: answer.id,
    selected: [...answer.selected],
    ...(answer.custom === undefined ? {} : { custom: answer.custom }),
  }));
}

/** Pass the native inheritedEventCount: forks do not inherit answerable questions or clocks. */
export function createQuestionState(headerOrOptions = {}, inheritedEventCount = headerOrOptions.inheritedEventCount ?? 0) {
  if (!timestamp(inheritedEventCount)) throw new TypeError('inheritedEventCount must be a non-negative safe integer');
  return {
    version: 1,
    inheritedEventCount,
    lastSeq: inheritedEventCount - 1,
    timed: false,
    questions: { active: [], settled: [] },
    clocks: [],
  };
}

function clockCall(state, event, callId) {
  if (state.clocks.some(clock => clock.callId === callId)) return state;
  return {
    ...state,
    clocks: [...state.clocks, {
      callId,
      createdAt: timestamp(event.time) ? event.time : null,
      createdSeq: event.seq,
    }],
  };
}

function openCall(state, event, callId, questions, questionState) {
  if (typeof callId !== 'string' || callId.length === 0 || questions === null) return state;
  const next = clockCall(state, event, callId);
  return {
    ...next,
    questions: {
      ...next.questions,
      active: [
        ...next.questions.active.filter(call => call.callId !== callId),
        { callId, questions, state: questionState },
      ],
    },
  };
}

function settleCall(state, callId, answers) {
  if (!state.questions.active.some(call => call.callId === callId)) return state;
  return {
    ...state,
    clocks: state.clocks.filter(clock => clock.callId !== callId),
    questions: {
      active: state.questions.active.filter(call => call.callId !== callId),
      settled: answers === null ? state.questions.settled : [
        ...state.questions.settled.filter(call => call.callId !== callId),
        { callId, answers },
      ].slice(-32),
    },
  };
}

/**
 * Apply durable events in append order. Replays are idempotent by seq. A PTC
 * start records its clock, while only the dispatch result opens the card, as
 * in the native projection. Synthetic repair results never create a new clock.
 */
export function applyQuestionEvent(state, event) {
  if (!record(event) || !timestamp(event.seq) || event.seq < state.inheritedEventCount
    || event.seq <= state.lastSeq || !record(event.data)) return state;
  let next = { ...state, lastSeq: event.seq };
  const data = event.data;
  switch (event.type) {
    case 'request/header': {
      const tools = data.header?.tools;
      next.timed = Array.isArray(tools) && tools.some(tool => tool?.name === 'ask_user_question'
        && record(tool.parameters?.properties)
        && Object.hasOwn(tool.parameters.properties, 'timeout'));
      return next;
    }
    case 'tool/call':
      return state.timed && data.name === 'ask_user_question'
        ? openCall(next, event, data.callId, questionsOf(data.arguments), 'open') : next;
    case 'tool/ptc-dispatch-start':
      return data.name === 'ask_user_question' && typeof data.subCallId === 'string'
        && questionsOf(data.arguments) !== null ? clockCall(next, event, data.subCallId) : next;
    case 'tool/ptc-dispatch': {
      if (data.name !== 'ask_user_question') return next;
      if (data.isError || textPayload(data.content)?.pending !== true) return {
        ...next, clocks: next.clocks.filter(clock => clock.callId !== data.subCallId),
      };
      // A missing start is not substituted with the dispatch/repair time.
      // Native cards may still be shown, but their clock remains unproven.
      const before = next.clocks;
      next = openCall(next, event, data.subCallId, questionsOf(data.arguments), 'continued');
      if (!before.some(clock => clock.callId === data.subCallId)) next = { ...next, clocks: before };
      return next;
    }
    case 'tool/result': {
      const callId = data.message?.toolCallId;
      if (!state.questions.active.some(call => call.callId === callId)) return next;
      const payload = textPayload(data.message.content);
      if (payload?.pending === true || data.error?.code === 'TOOL_OUTCOME_UNKNOWN') {
        return {
          ...next,
          questions: {
            ...next.questions,
            active: next.questions.active.map(call => call.callId === callId ? { ...call, state: 'continued' } : call),
          },
        };
      }
      const answers = data.error === undefined && data.message.isError !== true ? answersOf(payload) : null;
      return settleCall(next, callId, answers);
    }
    case 'user/message':
      // Queue insertion is not admission: only this durable user/message closes it.
      return data.source?.kind === 'user-question-reply'
        ? settleCall(next, data.source.callId, answersOf(textPayload(data.content)) ?? []) : next;
    default:
      return next;
  }
}

/** Suitable for a persisted projection unit's init/apply hooks; all values are JSON. */
export const foldQuestions = Object.freeze({
  initial: createQuestionState,
  init: (_header, inheritedEventCount = 0) => createQuestionState({ inheritedEventCount }),
  apply: applyQuestionEvent,
});

/**
 * One view per active call, because native answer() must answer the entire batch.
 * `autoEligible` is always false with the currently available question API.
 * settings may contain autoSelectFirst, but opting in cannot supply missing risk
 * evidence or the automatic provenance that native answer() cannot record.
 */
export function questionViews(projectionState, settings = {}, nowMs) {
  if (!timestamp(nowMs)) throw new TypeError('nowMs must be a non-negative safe integer');
  const view = projectionState?.questions ?? projectionState;
  const active = Array.isArray(view?.active) ? view.active : [];
  const settled = Array.isArray(view?.settled) ? view.settled : [];
  const clocks = Array.isArray(projectionState?.clocks) ? projectionState.clocks : [];
  return active.filter(call => (call.state === 'open' || call.state === 'continued')
    && !settled.some(item => item.callId === call.callId)).map(call => {
    const clock = clocks.find(item => item.callId === call.callId);
    const createdAt = timestamp(clock?.createdAt) ? clock.createdAt : null;
    const deadlineAt = createdAt === null || !Number.isSafeInteger(createdAt + QUESTION_WAIT_MS)
      ? null : createdAt + QUESTION_WAIT_MS;
    const remainingMs = deadlineAt === null ? null : Math.min(QUESTION_WAIT_MS, Math.max(0, deadlineAt - nowMs));
    const timedOut = remainingMs === 0;
    const questions = Array.isArray(call.questions) ? call.questions : [];
    let status = 'waiting';
    let reasonCode;
    let reason;
    // Exclude the whole batch when even one question needs a non-single-choice reply.
    if (questions.length === 0 || questions.some(question => !record(question)
      || typeof question.id !== 'string' || typeof question.question !== 'string')) {
      status = 'excluded';
      reasonCode = 'invalid_question_batch';
      reason = '问题批次不完整，无法可靠处理；保留人工回答。';
    } else if (questions.some(question => question.multiSelect === true || question.multi_select === true)) {
      status = 'excluded';
      reasonCode = 'multi_select_excluded';
      reason = '整批包含多选问题，排除自动选择；保留人工回答。';
    } else if (questions.some(question => !Array.isArray(question.options) || question.options.length === 0)) {
      status = 'excluded';
      reasonCode = 'free_text_excluded';
      reason = '整批包含无选项或自由输入问题，排除自动选择；保留人工回答。';
    } else if (createdAt === null || deadlineAt === null) {
      reasonCode = 'durable_clock_unavailable';
      reason = '缺少原始 durable 创建事件时钟，不能从刷新、恢复或 continued 时间重新起算；等待人工回答。';
    } else if (settings.enabled === false || settings.autoSelectFirst === false) {
      reasonCode = 'automatic_selection_disabled';
      reason = '自动选择未启用，等待人工回答；30 分钟时钟仍按原始创建事件计算。';
    } else if (call.state === 'open') {
      reasonCode = 'open_requires_waterfall';
      reason = 'open 问题只能由原生 answerer waterfall 处理；当前 API 不能证明普通问题低风险或记录自动回答来源，继续等待人工回答。';
    } else {
      reasonCode = 'automatic_answer_evidence_unavailable';
      reason = 'continued 问题虽可整批 answer，当前 API 不能证明普通问题低风险，也不能记录自动回答来源；继续等待人工回答。';
    }
    return {
      callId: call.callId,
      state: call.state,
      questions,
      createdAt,
      createdSeq: timestamp(clock?.createdSeq) ? clock.createdSeq : null,
      deadlineAt,
      remainingMs,
      timedOut,
      status,
      reasonCode,
      reason,
      autoEligible: false,
    };
  });
}
