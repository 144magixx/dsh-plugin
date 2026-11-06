import { createFavoritesService, createFetchHandler } from './service.js';
import { ATTENTION_KEY, attentionSchema, initialAttention, applyAttention } from './attention.js';

export const name = 'dsh-session-favorites';
export const inject = ['connection', 'storageDomain', 'sessionQuery', 'workspaceRegistry', 'tools', 'sessionProjections', 'agents'];
export function apply(ctx) {
  ctx.effect(() => ctx.sessionProjections.register({ key: ATTENTION_KEY, stateVersion: 1, stateSchema: attentionSchema, init: initialAttention, apply: applyAttention, wire: { viewSchema: attentionSchema, view: state => state } }));
  const service = createFavoritesService(ctx);
  ctx.effect(() => ctx.sessionProjections.onChanged((session, key) => { if (key === ATTENTION_KEY || key === 'userQuestions') service.notify(session.id); }));
  ctx.on('user-questions/request', async (request, next) => {
    const finish = request.agent ? service.beginQuestion(request.agent.id) : () => {};
    try { return await next(); } finally { finish(); }
  }, { prepend: true });
  ctx.on('agent/disposed', ({ agent }) => service.notify(agent.id));
  ctx.effect(() => () => service.dispose());
  ctx.effect(() => ctx.provide('sessionFavorites', service));
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/session-favorites/action', methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service) }));
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/session-favorites/changes', methods: ['GET'], requestBody: 'buffered', fetch: request => service.watch(request.signal) }));
  ctx.effect(() => ctx.tools.register({
    name: 'session_favorites',
    description: 'List, search, add, or remove favorite conversations shown in the right-hand card. Removing a favorite keeps the conversation and its history.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'search', 'add', 'remove'] },
      sessionId: { type: 'string', description: 'Exact conversation ID; required for add and remove.' },
      query: { type: 'string', description: 'For search: match titles, workspaces, or IDs; up to 200 characters. Omit to browse.' },
      offset: { type: 'integer', minimum: 0, description: 'For search: zero-based result offset; default 0.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'For search: results per page; default 30.' },
    }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: args => args?.action === 'list' || args?.action === 'search',
    execute: (args, exec) => service.execute(args, exec.signal),
  }));
}
