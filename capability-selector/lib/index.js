import { createDiscoveryService, DiscoveryError, validateConfig } from './discovery.js';

export const name = 'dsh-capability-selector';
export const inject = ['connection', 'sessionQuery', 'workspaceRegistry'];
const MAX_BODY = 8192;

/** Optional services are read through Cordis get(), so they do not block activation. */
function optional(ctx, key) { try { return ctx.get?.(key); } catch { return undefined; } }
export function runtimeSkillReader(ctx) {
  return async ({ sessionId, cwd, signal }) => {
    const skills = optional(ctx, 'skills');
    if (!skills) throw new DiscoveryError('RUNTIME_SKILLS_UNAVAILABLE', 'The runtime skill registry is unavailable.');
    const scope = optional(ctx, 'agents')?.get(sessionId);
    const options = { cwd, signal, ...(scope ? { scope } : {}) };
    return typeof skills.snapshot === 'function' ? skills.snapshot(options) : skills.list(options);
  };
}

/** DSH profiles compose bundle patches, profile patches and overlays into Loader entries.
 * Reading this already-composed tree honors the active profile without parsing YAML or
 * importing/executing external configuration. No configuration field is returned to clients.
 */
export function profileMcpReader(ctx) {
  return async ({ signal }) => {
    signal?.throwIfAborted();
    const loader = optional(ctx, 'loader');
    if (!loader?.entries) throw new DiscoveryError('DSH_MCP_UNAVAILABLE', 'The current profile loader is unavailable.');
    const profile = optional(ctx, 'profileContext'); const rows = [];
    for (const entry of loader.entries()) {
      signal?.throwIfAborted();
      const pluginName = entry.options?.name;
      if (pluginName !== '@deepseek-ai/dsh-mcp-client' && pluginName !== 'mcp-client') continue;
      const config = entry.fiber?.config ?? entry.options?.config;
      if (!config || typeof config !== 'object' || typeof config.serverName !== 'string') continue;
      // Deliberately retain transport/config differences only inside the server-side fingerprint.
      rows.push({ name: config.serverName, config: { ...config, ...(entry.options?.disabled === true ? { disabled: true } : {}) }, path: typeof profile?.patchPath === 'string' ? profile.patchPath : 'profile:active' });
      if (rows.length >= 200) break;
    }
    return rows;
  };
}

export function errorResult(error) {
  const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'SESSION_QUERY_ABORTED';
  const code = aborted ? error?.name === 'TimeoutError' ? 'SCAN_TIMEOUT' : 'CANCELLED' : error instanceof DiscoveryError ? error.code : 'DISCOVERY_FAILED';
  const message = aborted ? 'The discovery request was cancelled or timed out.' : error instanceof DiscoveryError ? error.message : 'Capability discovery failed. No configuration or command output was returned.';
  return { ok: false, error: { code, message } };
}
async function readJSON(request, signal) {
  if (request.method !== 'POST') throw new DiscoveryError('METHOD_NOT_ALLOWED', 'POST is required.', 405);
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new DiscoveryError('INVALID_CONTENT_TYPE', 'Send application/json.', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new DiscoveryError('REQUEST_TOO_LARGE', 'Request body exceeds 8 KiB.', 413);
  signal.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader) throw new DiscoveryError('INVALID_REQUEST', 'A JSON request body is required.');
  const chunks = []; let bytes = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel(); throw new DiscoveryError('REQUEST_TOO_LARGE', 'Request body exceeds 8 KiB.', 413); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DiscoveryError('INVALID_JSON', 'The request body is not valid JSON.'); }
}
export function createFetchHandler(service, action, lifetimeSignal) {
  return async request => {
    try {
      const signal = lifetimeSignal ? AbortSignal.any([request.signal, lifetimeSignal]) : request.signal;
      const input = await readJSON(request, signal);
      const result = await service[action](input, signal);
      return Response.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      const result = errorResult(error);
      const status = error?.status ?? (result.error.code === 'CANCELLED' ? 499 : result.error.code === 'SCAN_TIMEOUT' ? 504 : 500);
      return Response.json(result, { status, headers: { 'cache-control': 'no-store' } });
    }
  };
}
export function createCapabilityTool(service, lifetimeSignal) {
  return {
    name: 'capability_list',
    description: 'Read the current session’s installed local Skills, enterprise CLI commands and configured MCP capabilities. Deduplicates Skills by full bundle content and keeps differing versions. This is read-only discovery: it does not connect MCP, log in or execute business tasks. Read the selected Skill before using it.',
    parameters: { type: 'object', properties: { refresh: { type: 'boolean', description: 'Refresh the bounded discovery cache; default false.' } }, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'refresh'))) throw new DiscoveryError('INVALID_REQUEST', 'Only the optional refresh flag is supported.');
      const sessionId = exec.agent?.id;
      if (!sessionId) throw new DiscoveryError('SESSION_REQUIRED', 'A calling session is required.');
      const signal = lifetimeSignal ? AbortSignal.any([exec.signal, lifetimeSignal]) : exec.signal;
      return service.scan({ sessionId, ...(args?.refresh === undefined ? {} : { refresh: args.refresh }) }, signal);
    },
  };
}

export function apply(ctx, input = {}) {
  const config = validateConfig(input);
  const service = createDiscoveryService({ sessionQuery: ctx.sessionQuery, workspaceRegistry: ctx.workspaceRegistry, workingDirectory: optional(ctx, 'workingDirectory'), config, runtimeSkills: runtimeSkillReader(ctx), dshMcp: profileMcpReader(ctx) });
  const lifetime = new AbortController();
  const stop = () => { lifetime.abort(new DOMException('Plugin disposed.', 'AbortError')); service.dispose(); };
  ctx.effect(() => stop);
  for (const action of ['scan', 'detail']) ctx.effect(() => {
    const unregister = ctx.connection.fetch.register({ path: `/api/capability-selector/${action}`, methods: ['POST'], requestBody: 'streaming', fetch: createFetchHandler(service, action, lifetime.signal) });
    return async () => { stop(); await unregister(); };
  });
  if (config.enableAgentTool) ctx.inject(['tools'], child => {
    child.effect(() => child.tools.register(createCapabilityTool(service, lifetime.signal)));
  });
}
