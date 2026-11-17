import { AnnotationError, checkAbort, saveAnnotations } from './storage.js';

export const name = 'dsh-page-annotate';
export const inject = ['connection', 'workspaceRegistry'];
export const SAVE_ROUTE = '/api/page-annotate/save';
// 24 MiB of decoded images -> 32 MiB base64 plus bounded Markdown/JSON.
export const MAX_BODY_BYTES = 33 * 1024 * 1024;
export const REQUEST_DEADLINE_MS = 2500;
export const MAX_IN_FLIGHT = 2;

function aborted(signal) {
  return signal.reason instanceof AnnotationError ? signal.reason : new AnnotationError('aborted', 'Annotation saving was cancelled.', 499);
}
/** Races even streams whose cancel callback refuses to settle. */
export function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted(signal)); };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}
export async function readBody(request, signal) {
  checkAbort(signal);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AnnotationError('invalid-content-type', 'Send application/json.', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new AnnotationError('request-too-large', 'Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AnnotationError('invalid-request', 'A JSON request body is required.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await abortable(reader.read(), signal);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new AnnotationError('request-too-large', 'Request is too large.', 413);
      chunks.push(result.value);
    }
    checkAbort(signal);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new AnnotationError('invalid-json', 'Invalid JSON request.'); }
  } finally {
    // Do not await a remote producer's cancel; it cannot extend the deadline.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* pending read will settle on cancel */ }
  }
}
function errorResponse(error) {
  const known = error instanceof AnnotationError;
  return Response.json({ ok: false, code: known ? error.code : 'save-failed', message: known ? error.message : 'Unable to save annotations in this workspace.' }, { status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}

/** Finite upload route; no subscriptions, polling, or persistent HTTP responses. */
export function createSaveRoute(registry, options = {}) {
  const lifetime = new AbortController();
  const pending = new Set();
  const save = options.save ?? saveAnnotations;
  const deadlineMs = Math.min(REQUEST_DEADLINE_MS, options.deadlineMs ?? REQUEST_DEADLINE_MS);
  let closed = false;
  const route = {
    path: SAVE_ROUTE, methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      if (closed) return errorResponse(new AnnotationError('unloading', 'Page Annotate is unloading.', 503));
      if (request.method !== 'POST') return errorResponse(new AnnotationError('method-not-allowed', 'Use POST.', 405));
      if (pending.size >= MAX_IN_FLIGHT) return errorResponse(new AnnotationError('busy', 'Another annotation upload is in progress. Try again shortly.', 429));
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new AnnotationError('timeout', 'Annotation saving exceeded the request deadline.', 408)), deadlineMs);
      const signal = AbortSignal.any([request.signal, lifetime.signal, deadline.signal]);
      const work = (async () => {
        const args = await readBody(request, signal);
        checkAbort(signal);
        return save(registry, args, signal);
      })();
      pending.add(work);
      // Track actual writes until completion, including cleanup after a timeout.
      void work.then(() => pending.delete(work), () => pending.delete(work));
      try {
        const result = await abortable(work, signal);
        checkAbort(signal);
        return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) { return errorResponse(error); }
      finally { clearTimeout(timer); }
    },
  };
  return {
    route,
    get pendingCount() { return pending.size; },
    async dispose() {
      closed = true;
      lifetime.abort(new AnnotationError('unloading', 'Page Annotate is unloading.', 503));
      // The route response already settles on abort. Normal filesystem cleanup
      // is awaited, but a stalled OS write cannot block Host shutdown forever.
      let timer;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise(resolve => { timer = setTimeout(resolve, REQUEST_DEADLINE_MS); }),
      ]);
      clearTimeout(timer);
    },
  };
}

export function apply(ctx) {
  const service = createSaveRoute(ctx.workspaceRegistry);
  ctx.effect(() => {
    const unregister = ctx.connection.fetch.register(service.route);
    return async () => {
      // Abort uploads before unregister waits for active requests to drain.
      await service.dispose();
      await unregister();
    };
  }, 'page-annotate: bounded save route');
}
