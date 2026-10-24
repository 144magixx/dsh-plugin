import { BranchError } from './history.js';
import { DOMAIN, SideBranchService } from './service.js';

export const name = 'dsh-side-branch';
export const inject = ['connection', 'sessionController', 'agents', 'sessions', 'sessionQuery', 'storageDomain', 'permissionPresets', 'approval', 'llm', 'workspaceRegistry'];
const MAX_BODY = 64 * 1024;

export function routeHandler(service, method) {
  return async request => {
    try {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return new Response('JSON required', { status: 415 });
      if (Number(request.headers.get('content-length')) > MAX_BODY) return new Response('Request too large', { status: 413 });
      const reader = request.body?.getReader(); let length = 0; const chunks = [];
      if (reader) {
        try {
          while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BODY) { await reader.cancel(); return new Response('Request too large', { status: 413 }); } chunks.push(value); }
        } finally { reader.releaseLock(); }
      }
      let args;
      try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BranchError('invalid-request', 'Invalid JSON request.'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new BranchError('invalid-request', 'A JSON object is required.');
      const value = await service[method](args);
      return Response.json({ ok: true, ...value }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ ok: false, code: error.code ?? 'operation-failed', message: String(error.message ?? error).slice(0, 1200), ...(error.sessionId ? { sessionId: error.sessionId } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
    }
  };
}

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(DOMAIN);
  const service = new SideBranchService(ctx, domain.table('branches'));
  // This operation surface is shared by the UI and isolated integration tests.
  // No global configuration, existing session mutation, or active-profile writes.
  ctx.provide('sideBranch', service);
  ctx.on('agent/created', payload => service.onCreated(payload));
  ctx.on('agent/pre-step', (payload, next) => service.guard(payload, next), { prepend: true });
  ctx.effect(() => async () => { await service.dispose(); await domain.close(); }, 'side-branch: lifecycle');
  const routes = { turns: 'turns', 'anchor-info': 'anchorInfo', create: 'create', branch: 'branch', close: 'close' };
  for (const [path, method] of Object.entries(routes)) {
    // Connection enforces authenticated owner peers and Host/Origin trust on
    // HTTP and the native Desktop IPC transport. Never use a raw webServer route.
    ctx.connection.fetch.register({ path: `/api/side-branch/${path}`, methods: ['POST'], requestBody: 'buffered', fetch: routeHandler(service, method) });
  }
}
