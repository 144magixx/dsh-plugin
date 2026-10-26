import { NavigatorService, NavigatorError, DOMAIN, resolveConfig } from './service.js';
import { projectionDefinition } from './core.js';

export const name = 'dsh-session-navigator';
export const inject = ['sessionQuery', 'sessionProjections', 'sessions', 'workspaceRegistry', 'storageDomain', 'llm', 'connection', 'tools'];
const ACTIONS = ['list', 'get', 'refresh', 'pause', 'touch'];
export async function readBody(request, signal) {
  signal.throwIfAborted();
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new NavigatorError('invalid-content-type', 'Send application/json.', 415);
  if (Number(request.headers.get('content-length')) > 16384) throw new NavigatorError('request-too-large', 'Request exceeds 16 KiB.', 413);
  const reader = request.body?.getReader(); if (!reader) throw new NavigatorError('invalid-request', 'A JSON object is required.');
  let bytes = 0; const chunks = []; const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 16384) { await reader.cancel(); throw new NavigatorError('request-too-large', 'Request exceeds 16 KiB.', 413); } chunks.push(value); }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  signal.throwIfAborted();
  let args; try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new NavigatorError('invalid-json', 'Invalid JSON request.'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new NavigatorError('invalid-request', 'A JSON object is required.');
  return args;
}
export function errorResponse(error) { return Response.json({ ok: false, code: error?.code ?? 'operation-failed', message: String(error?.message ?? error).slice(0, 500) }, { status: error?.status ?? (error?.name === 'AbortError' ? 499 : 500), headers: { 'Cache-Control': 'no-store' } }); }
export function routeHandler(service, action) {
  return async request => {
    try {
      const signal = AbortSignal.any([request.signal, service.lifetime.signal]);
      const args = await readBody(request, signal);
      const value = await service[action](args, signal);
      return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return errorResponse(error); }
  };
}
export function watchHandler(service) {
  return async request => {
    try {
      const signal = AbortSignal.any([request.signal, service.lifetime.signal]);
      await readBody(request, signal);
      const encoder = new TextEncoder(); let cleanup = () => {};
      const stream = new ReadableStream({
        start(controller) {
          let closed = false; let heartbeat;
          const emit = frame => { if (closed) return; try { controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n')); } catch { cleanup(); } };
          const unsubscribe = service.subscribe(emit);
          cleanup = () => { if (closed) return; closed = true; unsubscribe(); clearInterval(heartbeat); signal.removeEventListener('abort', cleanup); try { controller.close(); } catch {} };
          signal.addEventListener('abort', cleanup, { once: true });
          if (signal.aborted) cleanup();
          else { emit({ revision: service.revision }); heartbeat = setInterval(() => emit({ heartbeat: true, revision: service.revision }), 25000); }
        },
        cancel() { cleanup(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
    } catch (error) { return errorResponse(error); }
  };
}
export function createTool(service) {
  return {
    name: 'session_navigator',
    description: 'Find conversations by title, recent topic or latest question. Read cached summaries, request a background refresh, pause automatic summaries, or record a visit. Returns session IDs and summary status; never renames or modifies conversations.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ACTIONS, description: 'list finds sessions; get reads details; refresh queues a model summary; pause controls automatic updates; touch records a visit.' },
      sessionId: { type: 'string', description: 'For get/refresh/pause/touch. Omit to use the calling session.' },
      query: { type: 'string', description: 'For list: literal match against titles, topics, summaries and latest questions, up to 512 characters.' },
      workspaceId: { type: 'string', description: 'For list: optional workspace filter.' },
      includeArchived: { type: 'boolean', description: 'For list: include archived sessions; default false.' },
      offset: { type: 'integer', minimum: 0, description: 'For list: first result offset; default 0.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'For list: result count; default 50.' },
      sort: { type: 'string', enum: ['visited', 'updated'], description: 'For list: order by last visit or conversation update; default visited.' },
      paused: { type: 'boolean', description: 'For pause: true pauses automatic summaries; explicit refresh remains available.' },
    }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      if (!ACTIONS.includes(args?.action)) throw new NavigatorError('invalid-action', 'Unknown navigator action.');
      const input = {};
      for (const key of args.action === 'list' ? ['query', 'workspaceId', 'includeArchived', 'offset', 'limit', 'sort'] : ['sessionId', ...(args.action === 'pause' ? ['paused'] : [])]) {
        if (args[key] !== undefined && args[key] !== '') input[key] = args[key];
      }
      if (args.action !== 'list' && !input.sessionId) input.sessionId = exec.agent?.id;
      const signal = exec.signal ? AbortSignal.any([exec.signal, service.lifetime.signal]) : service.lifetime.signal;
      return service[args.action](input, signal);
    },
  };
}
export async function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const domain = await ctx.storageDomain.open(DOMAIN);
  const service = new NavigatorService(ctx, domain.table('summaries'), config);
  ctx.provide('sessionNavigator', service);
  ctx.effect(() => () => service.lifetime.abort());
  ctx.sessionProjections.register(projectionDefinition);
  ctx.sessionProjections.onChanged((session, key) => service.onProjection(session, key));
  for (const action of ACTIONS) ctx.connection.fetch.register({ path: `/api/session-navigator/${action}`, methods: ['POST'], requestBody: 'streaming', fetch: routeHandler(service, action) });
  ctx.connection.fetch.register({ path: '/api/session-navigator/watch', methods: ['POST'], requestBody: 'streaming', fetch: watchHandler(service) });
  ctx.tools.register(createTool(service));
  ctx.effect(() => async () => { await service.dispose(); await domain.close(); });
  void service.start();
}
