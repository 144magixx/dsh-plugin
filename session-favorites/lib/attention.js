export const ATTENTION_KEY = 'sessionFavoritesAttention';
export function initialAttention(_header = {}, inheritedEventCount = 0) {
  return { floor: inheritedEventCount, running: false, completedSeq: -1, completedAt: 0, openQuestions: [] };
}
export function applyAttention(state, event) {
  if (event.seq < state.floor) return state;
  const data = event.data;
  if (event.type === 'turn/start') return { ...state, running: true, openQuestions: [] };
  if (event.type === 'turn/end') return {
    ...state, running: false, openQuestions: [],
    ...(data.reason?.kind === 'completed' ? { completedSeq: event.seq, completedAt: event.time } : {}),
  };
  if (event.type === 'tool/call' && ['ask_user_question', 'exit_plan_mode'].includes(data.name) && !state.openQuestions.includes(data.callId)) return { ...state, openQuestions: [...state.openQuestions, data.callId] };
  if (event.type === 'tool/result' && state.openQuestions.includes(data.message?.toolCallId)) return { ...state, openQuestions: state.openQuestions.filter(id => id !== data.message.toolCallId) };
  return state;
}
export const attentionSchema = {
  parse(value) {
    if (!value || !Number.isSafeInteger(value.floor) || value.floor < 0 || typeof value.running !== 'boolean' || !Number.isSafeInteger(value.completedSeq) || value.completedSeq < -1 || !Number.isFinite(value.completedAt) || !Array.isArray(value.openQuestions) || value.openQuestions.some(id => typeof id !== 'string')) throw new Error('Invalid favorite attention state');
    return structuredClone(value);
  },
  safeParse(value) { try { return { success: true, data: this.parse(value) }; } catch (error) { return { success: false, error }; } },
};
/** Open native questions and live request tokens take precedence over unread completion. */
export function attentionFor(item, status) {
  if (!status) return { attention: 'unknown', running: false, completedSeq: -1, seenSeq: item.seenSeq ?? -1 };
  const unseen = status.completedSeq > (item.seenSeq ?? -1) && status.completedAt >= item.addedAt;
  return {
    attention: status.question ? 'question' : unseen && !status.running ? 'completed' : 'none', running: status.running === true,
    completedSeq: status.completedSeq, completedAt: status.completedAt, seenSeq: item.seenSeq ?? -1,
  };
}
