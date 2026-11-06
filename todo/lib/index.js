import { COLORS, fail } from './core.js';
import { createFetchHandler, createTodoService } from './service.js';

export const name = 'dsh-todo';
export const inject = ['connection', 'storageDomain'];
export const TOOL = 'todo_reminders';
export const ROUTE = '/api/todo/action';

const TOOL_ACTIONS = ['list', 'lists', 'add', 'update', 'complete', 'delete', 'add_list', 'update_list', 'delete_list'];
export const toolParameters = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: TOOL_ACTIONS, description: 'list reads reminders; lists reads lists and counts; the others change them.' },
    view: { type: 'string', enum: ['today', 'scheduled', 'all', 'flagged', 'completed'], description: 'For list: smart list; default today (due today or overdue).' },
    query: { type: 'string', description: 'For list: match title or notes across all lists.' },
    includeCompleted: { type: 'boolean', description: 'For list with list or query: include completed reminders.' },
    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'For list: default 50.' },
    id: { type: 'string', description: 'Reminder id; required for update, complete and delete.' },
    title: { type: 'string' },
    notes: { type: 'string' },
    list: { type: 'string', description: 'List id or exact list name. For add defaults to the first list; for list filters to that list.' },
    due: { type: 'string', description: 'YYYY-MM-DD (all day), YYYY-MM-DD HH:mm (local time, announced in the GUI when due) or ISO time with offset; empty string clears.' },
    flagged: { type: 'boolean' },
    completed: { type: 'boolean', description: 'For complete: default true; false marks it incomplete again.' },
    linkSession: { type: 'boolean', description: 'For add (default true) and update: link to this conversation so the user can jump back; false unlinks.' },
    name: { type: 'string', description: 'List name for add_list and update_list.' },
    color: { type: 'string', enum: COLORS, description: 'List color for add_list and update_list.' },
    listId: { type: 'string', description: 'List id for update_list and delete_list.' },
  },
  required: ['action'],
  additionalProperties: false,
};

function resolveList(service, value) {
  if (value === undefined) return undefined;
  const lists = service.snapshot().lists;
  const match = lists.find(list => list.id === value) || lists.find(list => list.name.toLocaleLowerCase() === String(value).trim().toLocaleLowerCase());
  if (!match) throw fail('list_not_found', 404, `No list "${value}". Existing lists: ${lists.map(list => list.name).join(', ')}`);
  return match.id;
}
const strip = value => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
const brief = item => item && strip({ id: item.id, title: item.title, listId: item.listId, due: item.dueDate ? `${item.dueDate}${item.dueTime ? ` ${item.dueTime}` : ''}` : null, flagged: item.flagged, completed: item.completed, sessionId: item.sessionId || undefined });

/** Translate Agent arguments to the same mutations the GUI uses. */
export async function runTool(service, args, exec = {}) {
  const action = args?.action, signal = exec.signal;
  const sessionId = exec.agent?.id;
  await service.ready;
  const link = flag => flag === false ? { sessionId: null } : flag === true || flag === undefined ? (sessionId ? { sessionId } : {}) : {};
  switch (action) {
    case 'list': return service.query({ view: args.view, listId: resolveList(service, args.list), query: args.query, includeCompleted: args.includeCompleted, limit: args.limit ?? 50 });
    case 'lists': { const value = service.query({ view: 'all', limit: 1 }); return { ok: true, today: value.today, counts: value.counts, lists: value.lists }; }
    case 'add': {
      const value = await service.execute(strip({ action: 'create', title: args.title, notes: args.notes, listId: resolveList(service, args.list), due: args.due ?? undefined, flagged: args.flagged, ...link(args.linkSession) }), signal);
      return { ok: true, item: brief(value.item) };
    }
    case 'update': {
      const value = await service.execute(strip({ action: 'update', id: args.id, title: args.title, notes: args.notes, listId: resolveList(service, args.list), due: args.due, flagged: args.flagged, ...(args.linkSession === undefined ? {} : link(args.linkSession)) }), signal);
      return { ok: true, item: brief(value.item) };
    }
    case 'complete': { const value = await service.execute(strip({ action: 'complete', id: args.id, completed: args.completed }), signal); return { ok: true, changed: value.changed, item: brief(value.item) }; }
    case 'delete': return service.execute({ action: 'delete', id: args.id }, signal);
    case 'add_list': return service.execute(strip({ action: 'createList', name: args.name, color: args.color }), signal);
    case 'update_list': return service.execute(strip({ action: 'updateList', listId: args.listId, name: args.name, color: args.color }), signal);
    case 'delete_list': return service.execute({ action: 'deleteList', listId: args.listId }, signal);
    default: throw fail('invalid_action');
  }
}

export function apply(ctx) {
  const service = createTodoService(ctx);
  ctx.effect(() => () => service.dispose());
  ctx.effect(() => ctx.connection.fetch.register({ path: ROUTE, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service) }));
  ctx.inject(['sessionQuery'], child => child.effect(() => service.setTitleReader(async (ids, signal) => {
    const results = await child.sessionQuery.readTitleSnapshots(ids, signal);
    return new Map(results.filter(result => result.status === 'fulfilled').map(result => [result.sessionId ?? result.value?.session?.id, result.value?.title?.title || '']));
  })));
  ctx.inject(['tools'], child => child.effect(() => child.tools.register({
    name: TOOL,
    description: 'Read and change the user\'s persistent 待办 reminders (the iPhone-Reminders-style 待办 page and right-side card), not this session\'s plan. Use when the user asks to remember, schedule, check or finish something. Timed reminders pop up in the GUI when due.',
    parameters: toolParameters,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: args => args?.action === 'list' || args?.action === 'lists',
    execute: (args, exec) => runTool(service, args, exec),
  })));
}
