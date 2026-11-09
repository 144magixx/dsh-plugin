import { AskError } from './context.js';
import { DOMAIN, SelectionAskService, VIEW_WAIT_MAX_MS } from './service.js';

export const name = 'dsh-selection-ask';
export const inject = ['connection', 'agents', 'sessionQuery', 'storageDomain', 'llm'];
export const ROUTES = Object.freeze({
  create: 'create', prompt: 'prompt', cancel: 'cancel', view: 'view', list: 'list',
  delete: 'remove', clear: 'clear', answer: 'answer', models: 'models', model: 'selectModel',
});
export const MAX_BODY_BYTES = 256 * 1024;
/** Routes that may carry base64 images (8 images, 20 MB decoded per message). */
export const UPLOAD_ROUTES = Object.freeze(['create', 'prompt']);
export const MAX_UPLOAD_BYTES = 28 * 1024 * 1024;
/** Request bodies must arrive well inside the Desktop drain window. */
export const BODY_DEADLINE_MS = 2000;

export async function readBody(request, signal, maxBytes = MAX_BODY_BYTES) {
  if (signal.aborted) throw new AskError('aborted', 'The request was cancelled.', 499);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AskError('invalid-content-type', 'Send application/json.', 415);
  if (Number(request.headers.get('content-length')) > maxBytes) throw new AskError('request-too-large', 'Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AskError('invalid-request', 'A JSON object is required.');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(BODY_DEADLINE_MS)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  deadline.addEventListener('abort', cancel, { once: true });
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      if (deadline.aborted) throw new AskError('aborted', 'The request body did not arrive in time.', 499);
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel().catch(() => {}); throw new AskError('request-too-large', 'Request is too large.', 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AskError) throw error;
    throw new AskError('aborted', 'The request body did not arrive in time.', 499);
  } finally {
    deadline.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch {}
  }
  if (deadline.aborted) throw new AskError('aborted', 'The request body did not arrive in time.', 499);
  let args;
  try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AskError('invalid-json', 'Invalid JSON request.'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AskError('invalid-request', 'A JSON object is required.');
  return args;
}

export function errorResponse(error) {
  const status = Number.isSafeInteger(error?.status) ? error.status : 500;
  return Response.json({ ok: false, code: error?.code ?? 'operation-failed', message: String(error?.message ?? error).slice(0, 1200) }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Wrap a service method. Every response is a finite JSON body; the only
 * waiting route (`view`) is bounded by VIEW_WAIT_MAX_MS and by request/plugin abort.
 */
export function routeHandler(service, method, maxBytes = MAX_BODY_BYTES) {
  return async request => {
    try {
      if (service.closed) throw new AskError('unloading', 'Selection Ask is unloading.', 503);
      const signal = AbortSignal.any([request.signal, service.lifetime.signal]);
      const args = await readBody(request, signal, maxBytes);
      if (service.closed) throw new AskError('unloading', 'Selection Ask is unloading.', 503);
      const value = await service[method](args, signal);
      return Response.json({ ok: true, ...value }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return errorResponse(error); }
  };
}

export async function apply(ctx, config = {}) {
  const domain = await ctx.storageDomain.open(DOMAIN);
  const service = new SelectionAskService(ctx, domain.table('threads'), config);
  ctx.effect(() => ctx.provide('selectionAsk', service), 'selection-ask: service');
  ctx.on('session/event', session => service.onSessionEvent(session));
  ctx.on('agent/status', payload => service.onStatus(payload));
  ctx.on('agent/assistant-stream', payload => service.onStream(payload));
  ctx.on('agent/error', payload => service.onError(payload));
  ctx.on('agent/disposed', payload => service.onDisposed(payload));
  ctx.on('agent/pre-step', (payload, next) => service.preStep(payload, next), { prepend: true });
  ctx.on('approval/request', (request, next) => service.approvalRequest(request, next), { prepend: true });
  ctx.on('user-questions/request', (request, next) => service.questionRequest(request, next), { prepend: true });
  for (const [path, method] of Object.entries(ROUTES)) {
    // Authenticated owner transport; never a raw web-server route.
    ctx.effect(() => ctx.connection.fetch.register({ path: `/api/selection-ask/${path}`, methods: ['POST'], requestBody: 'streaming', fetch: routeHandler(service, method, UPLOAD_ROUTES.includes(path) ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES) }), `selection-ask: ${path}`);
  }
  ctx.effect(() => async () => { await service.dispose(); await domain.close(); }, 'selection-ask: lifecycle');
  ctx.logger?.info?.(`[selection-ask] ready; view wait ≤ ${VIEW_WAIT_MAX_MS} ms`);
}
