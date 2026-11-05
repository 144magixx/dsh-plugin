/** Global interruption notices derived from committed events, independently of retry authority. */
export const ALERT_PROJECTION = 'taskGuardianAlerts';
export const RETRY_NOTICE_DELAY_MS = 120_000;
const text = (value, max = 600) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : '';
export function failureSummary(value = {}) {
  return { code: text(value.code, 100), message: text(value.message || value.reason) };
}
export function createAlertState(header = {}, inheritedEventCount = 0) {
  return { sessionId: header.id ?? '', inheritedEventCount, seq: inheritedEventCount - 1, incident: null };
}
function settled(incident, state, at, resolution) {
  return incident ? { ...incident, state, updatedAt: at, nextRetryAt: null,
    ...(incident.state === 'retrying' && incident.recoveredAt === undefined ? { recoveredAt: at } : {}),
    ...(resolution ? { resolution } : {}) } : null;
}
export function retryNotice(previous, { sessionId, turn, seq, at, retryAt, attempt, failure }) {
  const same = previous?.turn === turn && previous.state === 'retrying';
  return { ...(same ? previous : {}), id: same ? previous.id : `${sessionId}:retry:${seq}`, sessionId, turn,
    at: same ? previous.at : at, updatedAt: at, kind: 'retrying', state: 'retrying', ...failureSummary(failure),
    nextRetryAt: retryAt, attempt, acknowledged: same ? previous.acknowledged === true : false,
    visibleAt: same ? previous.visibleAt : at + RETRY_NOTICE_DELAY_MS };
}
export function applyAlertState(state, event) {
  if (event.seq < state.inheritedEventCount || event.seq <= state.seq) return state;
  const data = event.data;
  if (!data || typeof data !== 'object') return state;
  let incident = state.incident;
  if (event.type === 'llm/retry') {
    incident = retryNotice(incident, { sessionId: state.sessionId, turn: data.turn, seq: event.seq, at: event.time,
      retryAt: event.time + data.delayMs, attempt: data.retry, failure: data.failure });
  } else if (event.type === 'turn/end') {
    const kind = data.reason?.kind;
    if (['error', 'max-tokens', 'interrupted'].includes(kind)) {
      incident = { id: `${state.sessionId}:end:${event.seq}`, sessionId: state.sessionId, turn: data.turn,
        at: event.time, updatedAt: event.time, visibleAt: event.time, kind, state: 'failed',
        ...failureSummary(data.reason.error), nextRetryAt: null, acknowledged: false };
    } else if (kind === 'completed' && incident && ['retrying', 'resumed'].includes(incident.state)) {
      incident = settled(incident, 'resolved', event.time, 'completed');
    } else if (kind === 'aborted' && incident?.state === 'retrying') {
      incident = settled(incident, 'resolved', event.time, 'stopped');
    } else return state;
  } else if (event.type === 'turn/start' && incident?.state === 'failed') {
    incident = settled(incident, 'resumed', event.time);
  } else if (event.type === 'assistant/message' && !data.interrupted && data.message?.role === 'assistant' && incident?.state === 'retrying') {
    incident = settled(incident, 'resumed', event.time);
  } else return state;
  return { ...state, seq: event.seq, incident };
}
/** Persist ack separately from the projection: replay cannot resurrect a read notice. */
export function mergeNotice(previous, incoming) {
  if (!incoming) return previous ?? null;
  if (previous?.code === 'RETRY_INTERRUPTED' && previous.id === `${incoming.id}:restart` && incoming.state === 'retrying') return previous;
  const same = previous?.id === incoming.id;
  if (previous?.turn === incoming.turn && previous.kind === 'retrying' && incoming.kind === 'retrying'
    && (same || previous.origin === 'guardian' && previous.state === 'retrying' && incoming.state !== 'retrying')) {
    return { ...incoming, id: previous.id, at: previous.at, visibleAt: previous.visibleAt,
      title: previous.title || incoming.title || '', acknowledged: previous.acknowledged === true };
  }
  return { ...incoming, title: incoming.title || previous?.title || '', acknowledged: same && previous.acknowledged === true };
}
export function visibleNotice(notice, now) {
  if (!notice || notice.acknowledged) return false;
  return notice.visibleAt <= now && (notice.state === 'failed' || notice.state === 'retrying' || (notice.recoveredAt ?? notice.updatedAt) >= notice.visibleAt);
}
