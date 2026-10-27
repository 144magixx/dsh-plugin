/** Conservative, side-effect-free lifecycle replay and restart recovery assessment. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const json = value => JSON.parse(JSON.stringify(value));
const result = (status, reasonCode, reason) => ({ status, reasonCode, reason });
const lifecycleEvents = new Set([
  'assistant/message', 'turn/start', 'turn/end', 'step/start', 'step/end',
  'tool/call', 'tool/result', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'goal/change', 'user/message',
]);

/** JSON-only projection state. Native fork-inherited events are excluded with the supplied cut. */
export function createLifecycleState(headerOrOptions = {}, inheritedEventCount = headerOrOptions.inheritedEventCount ?? 0) {
  if (!nonNegative(inheritedEventCount)) throw new TypeError('inheritedEventCount must be a non-negative safe integer');
  return {
    version: 1,
    inheritedEventCount,
    lastSeq: inheritedEventCount - 1,
    lastEventAt: null,
    lastSuccessfulAssistantSeq: null,
    turn: null,
    step: null,
    lastTurnEnd: null,
    toolCalls: [],
    goal: null,
    lastGoalOperation: null,
    stopped: false,
    closed: false,
    issues: [],
  };
}

function issue(state, code, seq) {
  // Preserve the first evidence of each problem without an unbounded duplicate list.
  return state.issues.some(item => item.code === code) ? state : {
    ...state, issues: [...state.issues, { code, seq: nonNegative(seq) ? seq : null }],
  };
}

function startCall(state, event, { callId, name, arguments: args, kind, rootCallId = null, parentCallId = null }) {
  if (typeof callId !== 'string' || callId.length === 0 || typeof name !== 'string') return issue(state, 'invalid_tool_call', event.seq);
  if (state.toolCalls.some(call => call.callId === callId)) return issue(state, 'duplicate_tool_call', event.seq);
  let storedArguments;
  try { storedArguments = json(args); } catch { return issue(state, 'invalid_tool_arguments', event.seq); }
  return {
    ...state,
    toolCalls: [...state.toolCalls, {
      callId,
      name,
      kind,
      arguments: storedArguments,
      rootCallId,
      parentCallId,
      turn: event.data.turn ?? state.turn?.number ?? null,
      step: event.data.step ?? state.step?.number ?? null,
      startedSeq: event.seq,
      startedAt: event.time,
      status: 'pending',
      result: null,
    }],
  };
}

function finishCall(state, event, callId, isError, error, kind) {
  if (typeof callId !== 'string' || callId.length === 0) return issue(state, 'invalid_tool_result', event.seq);
  const errorCode = typeof error?.code === 'string' ? error.code : null;
  const status = errorCode === 'TOOL_OUTCOME_UNKNOWN' ? 'outcome_unknown'
    : errorCode === 'TOOL_NOT_STARTED' ? 'not_started' : isError || error !== undefined ? 'error' : 'completed';
  const outcome = { seq: event.seq, time: event.time, isError: isError || error !== undefined, errorCode };
  const prior = state.toolCalls.find(call => call.callId === callId);
  if (prior === undefined) {
    const next = issue(state, 'orphan_tool_result', event.seq);
    return {
      ...next,
      toolCalls: [...next.toolCalls, {
        callId, name: null, kind, arguments: null, rootCallId: null, parentCallId: null,
        turn: event.data.turn ?? state.turn?.number ?? null,
        step: event.data.step ?? state.step?.number ?? null,
        startedSeq: null, startedAt: null, status, result: outcome,
      }],
    };
  }
  if (prior.result !== null) return issue(state, 'duplicate_tool_result', event.seq);
  return { ...state, toolCalls: state.toolCalls.map(call => call.callId === callId ? {
    ...call, status, result: outcome, arguments: status === 'outcome_unknown' ? call.arguments : null,
  } : call) };
}

function applyGoal(state, event) {
  const change = event.data;
  if (change.kind !== 'goal/change' || change.version !== 1) return issue(state, 'invalid_goal_change', event.seq);
  const previous = state.goal;
  if (change.operation === 'clear') {
    if (!record(change.cleared) || typeof change.cleared.id !== 'string' || !positive(change.cleared.revision)
      || !nonNegative(change.clearedAt) || previous === null
      || change.cleared.id !== previous.goal.id || change.cleared.revision !== previous.goal.revision + 1
      || change.clearedAt < previous.updatedAt) return issue(state, 'invalid_goal_change', event.seq);
    return { ...state, goal: null, lastGoalOperation: 'clear' };
  }
  const goal = change.goal;
  const phases = { create: 'active', pause: 'paused', resume: 'active', complete: 'complete', block: 'blocked' };
  if (!['create', 'edit', 'pause', 'resume', 'complete', 'block'].includes(change.operation)
    || !record(goal) || typeof goal.id !== 'string' || goal.id.length === 0 || !positive(goal.revision)
    || typeof goal.objective !== 'string' || goal.objective.trim().length === 0
    || !['active', 'paused', 'complete', 'blocked'].includes(goal.phase)
    || !positive(goal.maxGoalRounds) || !nonNegative(change.roundsStarted)
    || !nonNegative(change.createdAt) || !nonNegative(change.updatedAt) || change.updatedAt < change.createdAt
    || (goal.phase === 'blocked' && (!record(goal.blockedReason)
      || typeof goal.blockedReason.code !== 'string' || typeof goal.blockedReason.message !== 'string'))
    || (phases[change.operation] !== undefined && goal.phase !== phases[change.operation])) return issue(state, 'invalid_goal_change', event.seq);
  if (change.operation === 'create') {
    if (goal.revision !== 1 || change.roundsStarted !== 0 || (previous !== null && previous.goal.phase !== 'complete')) return issue(state, 'invalid_goal_change', event.seq);
  } else if (previous === null || previous.goal.id !== goal.id || goal.revision !== previous.goal.revision + 1
    || change.roundsStarted !== previous.roundsStarted || change.createdAt !== previous.createdAt
    || change.updatedAt < previous.updatedAt
    || (change.operation === 'edit' && goal.phase !== previous.goal.phase)
    || (change.operation !== 'edit' && (goal.objective !== previous.goal.objective || goal.maxGoalRounds !== previous.goal.maxGoalRounds))
    || (['pause', 'block'].includes(change.operation) && previous.goal.phase !== 'active')
    || (change.operation === 'resume' && (previous.goal.phase === 'complete' || change.roundsStarted >= goal.maxGoalRounds))
    || (change.operation === 'complete' && previous.goal.phase === 'complete')) return issue(state, 'invalid_goal_change', event.seq);
  // Activation is process-local. Never persist/infer an armed flag from goal/change.
  return {
    ...state,
    goal: {
      goal: {
        id: goal.id, revision: goal.revision, objective: goal.objective, phase: goal.phase,
        maxGoalRounds: goal.maxGoalRounds,
        ...(goal.phase === 'blocked' ? { blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message } } : {}),
      },
      roundsStarted: change.roundsStarted,
      createdAt: change.createdAt,
      updatedAt: change.updatedAt,
    },
    lastGoalOperation: change.operation,
  };
}

/** Fold actual durable Session events, never execute/replay the tools they describe. */
export function applyLifecycle(state, event) {
  if (!record(event) || !nonNegative(event.seq)) return issue(state, 'invalid_event', event?.seq);
  if (event.seq < state.inheritedEventCount || event.seq <= state.lastSeq) return state;
  let next = event.seq > state.lastSeq + 1 ? issue(state, 'event_gap', event.seq) : state;
  next = { ...next, lastSeq: event.seq };
  if (!nonNegative(event.time)) return issue(next, 'invalid_event', event.seq);
  next.lastEventAt = event.time;
  if (!record(event.data)) return event.ignorable === true && !lifecycleEvents.has(event.type)
    ? next : issue(next, 'invalid_event', event.seq);
  const data = event.data;
  switch (event.type) {
    case 'assistant/message':
      return data.interrupted !== true && data.message?.role === 'assistant' && Array.isArray(data.message.content)
        ? { ...next, lastSuccessfulAssistantSeq: event.seq } : next;
    case 'turn/start':
      if (!positive(data.turn)) return issue(next, 'invalid_turn', event.seq);
      if (next.turn !== null) next = issue(next, 'overlapping_turn', event.seq);
      return { ...next, turn: { number: data.turn, startedSeq: event.seq, startedAt: event.time }, step: null };
    case 'step/start':
      if (!positive(data.turn) || !positive(data.step)) return issue(next, 'invalid_step', event.seq);
      if (next.turn?.number !== data.turn) next = issue(next, 'orphan_step', event.seq);
      return {
        ...next,
        step: { turn: data.turn, number: data.step, startedSeq: event.seq, startedAt: event.time },
        toolCalls: next.toolCalls.filter(call => !['completed', 'not_started'].includes(call.status)),
      };
    case 'step/end':
      if (next.step?.turn !== data.turn || next.step?.number !== data.step) return issue(next, 'orphan_step_end', event.seq);
      return { ...next, step: null };
    case 'turn/end': {
      if (!positive(data.turn) || !record(data.reason) || typeof data.reason.kind !== 'string') return issue(next, 'invalid_turn_end', event.seq);
      if (next.turn?.number !== data.turn) next = issue(next, 'orphan_turn_end', event.seq);
      return {
        ...next,
        turn: null,
        step: null,
        lastTurnEnd: { turn: data.turn, seq: event.seq, time: event.time, reason: json(data.reason) },
        // A later turn/start cannot manufacture authorization to undo a recorded stop.
        stopped: next.stopped || data.reason.kind === 'aborted',
      };
    }
    case 'tool/call':
      if (typeof data.arguments !== 'string') return issue(next, 'invalid_tool_arguments', event.seq);
      return startCall(next, event, { callId: data.callId, name: data.name, arguments: data.arguments, kind: 'direct' });
    case 'tool/result':
      return finishCall(next, event, data.message?.toolCallId, data.message?.isError === true, data.error, 'direct');
    case 'tool/ptc-dispatch-start':
      return startCall(next, event, { callId: data.subCallId, name: data.name, arguments: data.arguments, kind: 'ptc', rootCallId: data.rootCallId, parentCallId: data.parentCallId });
    case 'tool/ptc-dispatch': {
      // Some historical PTC logs have only the complete dispatch event.
      if (!next.toolCalls.some(call => call.callId === data.subCallId)) {
        next = startCall(next, event, { callId: data.subCallId, name: data.name, arguments: data.arguments, kind: 'ptc', rootCallId: data.rootCallId, parentCallId: data.parentCallId });
      }
      return finishCall(next, event, data.subCallId, data.isError === true, data.error, 'ptc');
    }
    case 'goal/change':
      return applyGoal(next, event);
    case 'user/message': {
      const source = data.source;
      if (source?.kind === 'user') return {
        ...next, toolCalls: next.toolCalls.filter(call => call.status === 'pending' || call.status === 'outcome_unknown'),
      };
      if (source?.kind !== 'goal' || source.round === 0) return next;
      const current = next.goal;
      if (current === null || current.goal.phase !== 'active' || source.goalId !== current.goal.id
        || source.revision !== current.goal.revision || source.round !== current.roundsStarted + 1
        || source.round > current.goal.maxGoalRounds) return issue(next, 'invalid_goal_round', event.seq);
      return { ...next, goal: { ...current, roundsStarted: source.round } };
    }
    default:
      // In particular session/end-seed is a fork boundary, not a closed Session.
      return next;
  }
}

function lifecycleOf(recordValue, snapshot) {
  if (record(snapshot?.lifecycle)) return snapshot.lifecycle;
  if (record(snapshot) && Array.isArray(snapshot.toolCalls)) return snapshot;
  return record(recordValue?.lifecycle) ? recordValue.lifecycle : null;
}

function projectedGoal(snapshot) {
  const value = snapshot?.projections?.values?.goal ?? snapshot?.goal;
  return record(value?.goal) ? value : record(value) && typeof value.phase === 'string' ? { goal: value } : null;
}

/**
 * Pure advisory result. The current Host must leave apiCompatible=false.
 * true is only an attestation by a verified future adapter with durable grants
 * and fences covering every stop/revocation path; merely finding goals.resume
 * does not establish compatibility. This function never grants or resumes work.
 * snapshot may be native runtime metadata plus goal projection, or the lifecycle
 * state itself for offline assessment. Human stop/closure always takes priority.
 */
export function assessRecovery({ record: guardianRecord, snapshot, workspaceAvailable, apiCompatible = false } = {}) {
  const lifecycle = lifecycleOf(guardianRecord, snapshot);
  const runPhase = guardianRecord?.run?.phase;
  const goals = [projectedGoal(snapshot), lifecycle?.goal].filter(Boolean);
  if (guardianRecord?.closed === true || lifecycle?.closed === true || snapshot?.closed === true || snapshot?.removed === true) {
    return result('not_needed', 'session_closed', '会话或监护记录已关闭，保留关闭状态。');
  }
  if (runPhase === 'stopped' || guardianRecord?.stopped === true || lifecycle?.stopped === true
    || lifecycle?.lastTurnEnd?.reason?.kind === 'aborted') {
    return result('not_needed', 'explicit_stop', '已有停止或 aborted 记录，保留停止决定；再次执行需要新的人工授权。');
  }
  if (goals.some(item => item.goal.phase === 'paused')) return result('not_needed', 'goal_paused', '持久目标已暂停，保留暂停决定。');
  const completionRecordCurrent = lifecycle !== null && lifecycle.turn === null && Number.isSafeInteger(guardianRecord?.run?.lastSeq) && guardianRecord.run.lastSeq >= lifecycle.lastSeq;
  if (goals.some(item => item.goal.phase === 'complete') || runPhase === 'completed' && completionRecordCurrent) return result('not_needed', 'goal_completed', '目标或监护运行已完成，无需恢复。');
  if (goals.some(item => item.goal.phase === 'blocked')) return result('need_confirmation', 'goal_blocked', '持久目标已 blocked，需人工处理阻塞并决定是否恢复。');
  if (lifecycle?.lastGoalOperation === 'clear') return result('not_needed', 'goal_cleared', '持久目标已清除，保留清除决定。');
  if (guardianRecord?.settings?.enabled === false || guardianRecord?.settings?.recoverAfterRestart === false) {
    return result('disabled', 'recovery_disabled', '监护或重启恢复未启用，保留当前状态。');
  }
  if (snapshot?.running === true || snapshot?.status === 'running') return result('running', 'already_running', '会话当前仍在运行，无需另行恢复。');
  if (workspaceAvailable !== true) return result('need_confirmation', 'workspace_unavailable', '工作区不可用或尚未确认，需人工确认工作区后再评估恢复。');
  if (!record(guardianRecord) || lifecycle === null) return result('need_confirmation', 'durable_state_unavailable', '缺少可靠的持久监护或生命周期状态，需人工确认。');
  if (Array.isArray(lifecycle.issues) && lifecycle.issues.length > 0) return result('need_confirmation', 'lifecycle_evidence_incomplete', '生命周期事件存在缺口或无效记录，无法可靠重建执行边界，需人工确认。');
  const calls = Array.isArray(lifecycle.toolCalls) ? lifecycle.toolCalls : [];
  if (calls.some(call => call.status === 'pending' || call.status === 'outcome_unknown')) return result('need_confirmation', 'tool_outcome_unproven', '工具调用缺少可靠结果，可能已经产生效果；保留调用身份和参数，需人工核对，不能盲目重放。');
  if (calls.some(call => call.status === 'error')) return result('need_confirmation', 'tool_failed', '已有工具错误结果，需人工核对失败原因和已产生的效果。');
  const endKind = lifecycle.lastTurnEnd?.reason?.kind;
  if (endKind !== undefined && endKind !== 'completed' && lifecycle.turn === null) return result('need_confirmation', 'turn_not_completed', `最近轮次以 ${endKind} 结束，需人工确认后续处理。`);
  const current = goals.find(item => item.goal.phase === 'active');
  if (current && nonNegative(current.roundsStarted) && positive(current.goal.maxGoalRounds)
    && current.roundsStarted >= current.goal.maxGoalRounds) return result('need_confirmation', 'goal_round_limit', '持久目标已达到轮次上限，需人工调整预算或决定结束。');
  const unfinished = lifecycle.turn !== null || lifecycle.step !== null || current !== undefined
    || runPhase === 'running' || runPhase === 'waiting' || runPhase === 'need_confirmation';
  if (!unfinished) return result('not_needed', 'no_unfinished_work', '没有发现需要恢复的未结束轮次或 active 持久目标。');
  if (apiCompatible !== true) return result('need_confirmation', 'safe_recovery_adapter_unavailable', '发现未结束状态，但不能据此确定异常原因；当前恢复适配器缺少覆盖停止和撤销路径的可靠持久授权 fence，需人工确认。');
  return result('recommend_recovery', 'compatible_adapter_available', '当前适配器已确认具备可靠持久授权及停止 fence，可由该适配器再次核验后建议恢复。');
}
