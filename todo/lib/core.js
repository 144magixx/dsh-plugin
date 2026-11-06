import { randomUUID } from 'node:crypto';

/** Pure data model of the 待办 plugin: validation, mutations and smart views. */
export const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'pink', 'purple', 'brown', 'gray'];
export const VIEWS = ['today', 'scheduled', 'all', 'flagged', 'completed'];
export const LIMITS = { lists: 50, items: 5000, title: 500, notes: 4000, listName: 60, sessionTitle: 200 };
export const ALERT_GRACE_MS = 12 * 60 * 60 * 1000;

export function fail(code, status = 400, message = code) { return Object.assign(new Error(message), { code, status }); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 240 && !/[\x00-\x1f]/.test(id);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/, TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validDate(value) {
  const match = DATE.exec(value || '');
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export const validTime = value => TIME.test(value || '');
const pad = value => String(value).padStart(2, '0');
/** Local calendar date of an instant in this process' time zone. */
export function localDate(at = Date.now()) { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function localTime(at) { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function addDays(date, days) { const [y, m, d] = date.split('-').map(Number); return localDate(new Date(y, m - 1, d + days, 12).getTime()); }
/** The instant a dated, timed reminder becomes due in this process' time zone. */
export function instantOf(date, time) { const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh, mm).getTime(); }

/** Accepts `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, `YYYY-MM-DDTHH:mm[:ss]` (local) or an ISO instant with an offset. */
export function parseDue(value) {
  if (value === null || value === '') return { dueDate: null, dueTime: null };
  if (typeof value !== 'string' || value.length > 40) throw fail('invalid_due');
  const text = value.trim();
  if (validDate(text)) return { dueDate: text, dueTime: null };
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text);
  if (local && validDate(local[1]) && validTime(local[2])) return { dueDate: local[1], dueTime: local[2] };
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const at = Date.parse(text);
    if (Number.isFinite(at)) return { dueDate: localDate(at), dueTime: localTime(at), alertAt: at };
  }
  throw fail('invalid_due', 400, 'Use YYYY-MM-DD, YYYY-MM-DD HH:mm, or an ISO time with offset.');
}

const validList = list => object(list) && validId(list.id) && typeof list.name === 'string' && list.name.length > 0 && list.name.length <= LIMITS.listName && COLORS.includes(list.color) && Number.isFinite(list.createdAt);
const nullable = (value, check) => value === null || check(value);
const validItem = item => object(item) && validId(item.id) && validId(item.listId) && typeof item.title === 'string' && item.title.length <= LIMITS.title
  && typeof item.notes === 'string' && item.notes.length <= LIMITS.notes && nullable(item.dueDate, validDate) && nullable(item.dueTime, validTime)
  && (item.dueTime === null || item.dueDate !== null) && nullable(item.alertAt, Number.isFinite) && typeof item.alerted === 'boolean'
  && typeof item.flagged === 'boolean' && typeof item.completed === 'boolean' && nullable(item.completedAt, Number.isFinite)
  && Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt) && nullable(item.sessionId, validId)
  && typeof item.sessionTitle === 'string' && item.sessionTitle.length <= LIMITS.sessionTitle;

export const stateSchema = {
  parse(value) {
    if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.lists) || value.lists.length < 1 || value.lists.length > LIMITS.lists || !value.lists.every(validList)
      || !Array.isArray(value.items) || value.items.length > LIMITS.items || !value.items.every(validItem)) throw fail('invalid_stored_todo', 500);
    const lists = new Set(value.lists.map(list => list.id));
    if (lists.size !== value.lists.length || new Set(value.items.map(item => item.id)).size !== value.items.length || value.items.some(item => !lists.has(item.listId))) throw fail('invalid_stored_todo', 500);
    return structuredClone(value);
  },
  safeParse(value) { try { return { success: true, data: this.parse(value) }; } catch (error) { return { success: false, error }; } },
};
export function initialState(now = 0, name = '提醒事项') {
  return { version: 1, revision: 0, lists: [{ id: 'default', name, color: 'blue', createdAt: now }], items: [] };
}

function text(value, max, code, { required = false } = {}) {
  if (typeof value !== 'string') throw fail(code);
  const trimmed = value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
  if (required && !trimmed) throw fail(code);
  if (trimmed.length > max) throw fail(code, 400, `${code}: at most ${max} characters`);
  return trimmed;
}
const bool = (value, code) => { if (typeof value !== 'boolean') throw fail(code); return value; };
function color(value) { if (!COLORS.includes(value)) throw fail('invalid_color'); return value; }
function findList(state, id) { const list = state.lists.find(row => row.id === id); if (!list) throw fail('list_not_found', 404); return list; }
function findItem(state, id) { if (!validId(id)) throw fail('invalid_id'); const item = state.items.find(row => row.id === id); if (!item) throw fail('item_not_found', 404); return item; }

/** Date fields arrive as dueDate/dueTime (client) or due (Agent). alertAt may be computed by the viewer's time zone. */
function schedule(input, previous, now) {
  let dueDate = previous?.dueDate ?? null, dueTime = previous?.dueTime ?? null, alertAt;
  if (input.due !== undefined) ({ dueDate, dueTime, alertAt } = parseDue(input.due));
  if (input.dueDate !== undefined) { if (!nullable(input.dueDate, validDate)) throw fail('invalid_due'); dueDate = input.dueDate; if (dueDate === null) dueTime = null; }
  if (input.dueTime !== undefined) { if (!nullable(input.dueTime, validTime)) throw fail('invalid_due'); dueTime = input.dueTime; }
  if (dueTime !== null && dueDate === null) throw fail('invalid_due', 400, 'A time needs a date.');
  if (input.alertAt !== undefined && input.alertAt !== null && !Number.isFinite(input.alertAt)) throw fail('invalid_alert');
  const changed = !previous || dueDate !== previous.dueDate || dueTime !== previous.dueTime;
  if (!changed && input.alertAt === undefined) return { dueDate, dueTime, alertAt: previous.alertAt, alerted: previous.alerted };
  const at = dueTime === null ? null : alertAt ?? (Number.isFinite(input.alertAt) ? input.alertAt : instantOf(dueDate, dueTime));
  // A time already passed when it is entered is not announced afterwards.
  return { dueDate, dueTime, alertAt: at, alerted: at === null ? false : at < now - 60000 };
}

const LIST_FIELDS = ['name', 'color'];
const ITEM_FIELDS = ['title', 'notes', 'listId', 'due', 'dueDate', 'dueTime', 'alertAt', 'flagged', 'sessionId', 'sessionTitle'];
function only(input, keys) { if (Object.keys(input).some(key => !keys.includes(key))) throw fail('invalid_request'); }

/** Each mutation returns the next state and a compact result; the caller persists it. */
export const mutations = {
  createList(state, input, { now, id = randomUUID() }) {
    only(input, ['action', ...LIST_FIELDS]);
    if (state.lists.length >= LIMITS.lists) throw fail('lists_limit');
    const list = { id, name: text(input.name, LIMITS.listName, 'invalid_list_name', { required: true }), color: input.color === undefined ? 'blue' : color(input.color), createdAt: now };
    return { state: { ...state, lists: [...state.lists, list] }, result: { list } };
  },
  updateList(state, input) {
    only(input, ['action', 'listId', ...LIST_FIELDS]);
    const old = findList(state, input.listId);
    const list = { ...old, ...(input.name !== undefined ? { name: text(input.name, LIMITS.listName, 'invalid_list_name', { required: true }) } : {}), ...(input.color !== undefined ? { color: color(input.color) } : {}) };
    return { state: { ...state, lists: state.lists.map(row => row.id === list.id ? list : row) }, result: { list } };
  },
  deleteList(state, input) {
    only(input, ['action', 'listId']);
    findList(state, input.listId);
    if (state.lists.length === 1) throw fail('last_list');
    const removed = state.items.filter(item => item.listId === input.listId).length;
    return { state: { ...state, lists: state.lists.filter(row => row.id !== input.listId), items: state.items.filter(item => item.listId !== input.listId) }, result: { removedItems: removed } };
  },
  create(state, input, { now, id = randomUUID() }) {
    only(input, ['action', ...ITEM_FIELDS]);
    if (state.items.length >= LIMITS.items) throw fail('items_limit');
    const listId = input.listId ?? state.lists[0].id;
    findList(state, listId);
    if (input.sessionId !== undefined && !nullable(input.sessionId, validId)) throw fail('invalid_session_id');
    const item = {
      id, listId, title: text(input.title, LIMITS.title, 'invalid_title', { required: true }),
      notes: input.notes === undefined ? '' : text(input.notes, LIMITS.notes, 'invalid_notes'),
      ...schedule(input, null, now), flagged: input.flagged === undefined ? false : bool(input.flagged, 'invalid_flag'),
      completed: false, completedAt: null, createdAt: now, updatedAt: now, sessionId: input.sessionId ?? null,
      sessionTitle: input.sessionId ? (input.sessionTitle === undefined ? '' : text(input.sessionTitle, LIMITS.sessionTitle, 'invalid_session_title')) : '',
    };
    return { state: { ...state, items: [...state.items, item] }, result: { item } };
  },
  update(state, input, { now }) {
    only(input, ['action', 'id', ...ITEM_FIELDS]);
    const old = findItem(state, input.id);
    if (input.listId !== undefined) findList(state, input.listId);
    if (input.sessionId !== undefined && !nullable(input.sessionId, validId)) throw fail('invalid_session_id');
    const sessionId = input.sessionId === undefined ? old.sessionId : input.sessionId;
    const item = {
      ...old,
      ...(input.title !== undefined ? { title: text(input.title, LIMITS.title, 'invalid_title', { required: true }) } : {}),
      ...(input.notes !== undefined ? { notes: text(input.notes, LIMITS.notes, 'invalid_notes') } : {}),
      ...(input.listId !== undefined ? { listId: input.listId } : {}),
      ...(input.flagged !== undefined ? { flagged: bool(input.flagged, 'invalid_flag') } : {}),
      ...schedule(input, old, now), sessionId,
      sessionTitle: !sessionId ? '' : input.sessionTitle !== undefined ? text(input.sessionTitle, LIMITS.sessionTitle, 'invalid_session_title') : sessionId === old.sessionId ? old.sessionTitle : '',
      updatedAt: now,
    };
    return { state: { ...state, items: state.items.map(row => row.id === item.id ? item : row) }, result: { item } };
  },
  complete(state, input, { now }) {
    only(input, ['action', 'id', 'completed']);
    const old = findItem(state, input.id), completed = input.completed === undefined ? true : bool(input.completed, 'invalid_completed');
    if (old.completed === completed) return { state, result: { item: old }, unchanged: true };
    const item = { ...old, completed, completedAt: completed ? now : null, updatedAt: now };
    return { state: { ...state, items: state.items.map(row => row.id === item.id ? item : row) }, result: { item } };
  },
  delete(state, input) {
    only(input, ['action', 'id']);
    findItem(state, input.id);
    return { state: { ...state, items: state.items.filter(row => row.id !== input.id) }, result: { id: input.id } };
  },
  snooze(state, input, { now }) {
    only(input, ['action', 'id', 'minutes']);
    const old = findItem(state, input.id);
    if (!Number.isSafeInteger(input.minutes) || input.minutes < 1 || input.minutes > 24 * 60) throw fail('invalid_minutes');
    const item = { ...old, alertAt: now + input.minutes * 60000, alerted: false, updatedAt: now };
    return { state: { ...state, items: state.items.map(row => row.id === item.id ? item : row) }, result: { item } };
  },
  /** Atomically hand out due announcements once; long-missed ones are retired silently. */
  claimAlerts(state, input, { now }) {
    only(input, ['action']);
    const claimed = [], retired = new Set();
    for (const item of state.items) {
      if (item.completed || item.alerted || item.alertAt === null || item.alertAt > now) continue;
      if (item.alertAt < now - ALERT_GRACE_MS) retired.add(item.id); else claimed.push(item);
    }
    if (!claimed.length && !retired.size) return { state, result: { alerts: [] }, unchanged: true };
    const ids = new Set([...claimed.map(item => item.id), ...retired]);
    return { state: { ...state, items: state.items.map(item => ids.has(item.id) ? { ...item, alerted: true } : item) }, result: { alerts: claimed.map(item => ({ ...item, alerted: true })) } };
  },
};
export const MUTATIONS = Object.keys(mutations);

export function apply(state, input, options) {
  if (!object(input) || !Object.hasOwn(mutations, input.action)) throw fail('invalid_action');
  const outcome = mutations[input.action](state, input, options);
  if (outcome.unchanged) return { ...outcome, changed: false };
  const next = stateSchema.parse({ ...outcome.state, revision: state.revision + 1 });
  return { state: next, result: outcome.result, changed: true };
}

/** Smart views in the host's local time zone; the Web client mirrors these rules for its viewer. */
export function overdue(item, now = Date.now()) {
  if (item.completed || !item.dueDate) return false;
  return item.dueTime ? (item.alertAt ?? instantOf(item.dueDate, item.dueTime)) < now : item.dueDate < localDate(now);
}
export function inView(item, view, today) {
  switch (view) {
    case 'today': return !item.completed && item.dueDate !== null && item.dueDate <= today;
    case 'scheduled': return !item.completed && item.dueDate !== null;
    case 'all': return !item.completed;
    case 'flagged': return !item.completed && item.flagged;
    case 'completed': return item.completed;
    default: return false;
  }
}
export function compareDue(a, b) {
  return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.createdAt - b.createdAt;
}
export function counts(state, today) {
  const result = Object.fromEntries(VIEWS.map(view => [view, 0])), lists = Object.fromEntries(state.lists.map(list => [list.id, 0]));
  for (const item of state.items) {
    for (const view of VIEWS) if (inView(item, view, today)) result[view]++;
    if (!item.completed) lists[item.listId]++;
  }
  return { ...result, lists };
}
