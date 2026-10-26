import { createSearchService, errorResult, LIMITS, SearchError } from './service.js';

export const name = 'dsh-session-search';
export const inject = ['sessionQuery', 'workspaceRegistry', 'connection', 'tools'];

async function readJSON(request, signal) {
  signal.throwIfAborted();
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new SearchError('INVALID_CONTENT_TYPE', 'Send application/json.', 415);
  const length = Number(request.headers.get('content-length'));
  if (length > LIMITS.bodyBytes) throw new SearchError('REQUEST_TOO_LARGE', 'Request body exceeds 16 KiB.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SearchError('INVALID_REQUEST', 'A JSON request body is required.');
  const chunks = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMITS.bodyBytes) { await reader.cancel(); throw new SearchError('REQUEST_TOO_LARGE', 'Request body exceeds 16 KiB.', 413); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SearchError('INVALID_JSON', 'The request body is not valid JSON.'); }
}

export function createFetchHandler(service, action, lifetimeSignal) {
  return async request => {
    try {
      const signal = lifetimeSignal ? AbortSignal.any([request.signal, lifetimeSignal]) : request.signal;
      const args = await readJSON(request, signal);
      const result = await service[action](args, signal);
      return Response.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      const result = errorResult(error);
      const status = error?.status ?? (error?.name === 'AbortError' ? 499 : /NOT_FOUND/.test(error?.code ?? '') ? 404 : 500);
      return Response.json(result, { status, headers: { 'cache-control': 'no-store' } });
    }
  };
}

export function createTool(service, lifetimeSignal) {
  return {
    name: 'session_find',
    description: 'Search session titles or literal message text, or read bounded context around a hit. Returns message identifiers, snippets, and an optional cursor to continue through history.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'context'], description: 'search finds hits; context reads a hit and nearby visible messages.' },
        query: { type: 'string', description: 'For search: literal text, 1–512 characters; case insensitive.' },
        mode: { type: 'string', enum: ['current', 'titles', 'all'], description: 'For search: current conversation, all titles, or all message text. Default current.' },
        sessionId: { type: 'string', description: 'For current search or context. Current search defaults to the calling session.' },
        workspaceId: { type: 'string', description: 'For search: limit results to this workspace.' },
        includeTools: { type: 'boolean', description: 'Include tool calls and results. Default false; reasoning and system text are always excluded.' },
        includeArchived: { type: 'boolean', description: 'For search: include archived sessions. Default false.' },
        cursor: { type: 'string', description: 'For search: opaque nextCursor from the previous page, with the same query and filters. An empty page may still have a cursor.' },
        limit: { type: 'integer', description: 'For search: maximum hits per page, 1–100; default 40.' },
        seq: { type: 'integer', description: 'For context: exact event sequence number from a message hit.' },
        offset: { type: 'integer', description: 'For context: target text offset, default 0; use nextOffset to continue a truncated message.' },
        length: { type: 'integer', description: 'For context: target text length, 1–20000; default 20000.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new SearchError('INVALID_REQUEST', 'Expected an object.');
      const { action } = args;
      if (!['search', 'context'].includes(action)) throw new SearchError('INVALID_REQUEST', 'action must be search or context.');
      const searchFields = ['query', 'mode', 'sessionId', 'workspaceId', 'includeTools', 'includeArchived', 'cursor', 'limit'];
      const contextFields = ['sessionId', 'seq', 'includeTools', 'offset', 'length'];
      const knownFields = new Set(['action', ...searchFields, ...contextFields]);
      for (const key of Object.keys(args)) if (!knownFields.has(key)) throw new SearchError('INVALID_REQUEST', `Unknown field: ${key}.`);
      // Some model adapters require every union field; ignore fields for the other action.
      const input = {};
      for (const key of action === 'search' ? searchFields : contextFields) {
        const value = args[key];
        if (value === undefined || (['cursor', 'sessionId', 'workspaceId'].includes(key) && typeof value === 'string' && !value.trim())) continue;
        input[key] = value;
      }
      if (action === 'search' && (input.mode ?? 'current') === 'current' && input.sessionId === undefined) input.sessionId = exec.agent?.id;
      const signal = lifetimeSignal ? AbortSignal.any([exec.signal, lifetimeSignal]) : exec.signal;
      return service[action](input, signal);
    },
  };
}

export function apply(ctx) {
  const service = createSearchService({ sessionQuery: ctx.sessionQuery, workspaceRegistry: ctx.workspaceRegistry });
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  for (const action of ['search', 'context']) {
    ctx.effect(() => {
      const unregister = ctx.connection.fetch.register({ path: `/api/session-search/${action}`, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service, action, lifetime.signal) });
      return async () => { lifetime.abort(); await unregister(); };
    });
  }
  // Abort first even when the framework disposes effects in reverse order.
  ctx.effect(() => {
    const unregister = ctx.tools.register(createTool(service, lifetime.signal));
    return () => { lifetime.abort(); return unregister(); };
  });
}
