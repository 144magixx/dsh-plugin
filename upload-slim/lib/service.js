import {
  BASELINE, DEFAULT_STATE, FIELDS, SETTINGS_NS, STRATEGIES, base64Bytes, driftedRoutes, fail, imagesFromEvents,
  normalizeState, noticeText, planChanges, requestTarget, strategyFields, targetRoutes, validRef,
} from './core.js';

export const DOMAIN = 'dsh_upload_slim';
export const MAX_BODY = 16384;
export const MAX_SAMPLES = 24;
const MAX_SESSIONS_SCANNED = 12;
const MAX_REFS = 400;
const MAX_VERSIONS = 2000;
const VARIANTS = [BASELINE, ...STRATEGIES.map(strategy => strategy.id)];

const stateSchema = { parse: value => normalizeState(value) };
const plain = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const timeOf = value => (typeof value === 'number' ? value : Date.parse(value ?? '') || 0);

/**
 * Upload Slim service. Every request is a finite JSON or image exchange: no
 * stream is held open, so Host update draining is never blocked. Profile config
 * is only written on explicit user actions, never from apply/dispose.
 */
export function createSlimService(ctx, { now = Date.now } = {}) {
  const lifetime = new AbortController();
  const deps = { settings: undefined, attachments: undefined, sessionQuery: undefined };
  const refs = new Map(), versions = new Map();
  let closed = false, domain, queue = Promise.resolve();
  const ready = ctx.storageDomain.open({ name: DOMAIN, version: 1, layout: 'single', global: { schema: stateSchema, initial: { ...DEFAULT_STATE } }, tables: {} }).then(value => { domain = value; });
  void ready.catch(() => {});

  const stored = () => (domain ? normalizeState(domain.global.get()) : normalizeState(DEFAULT_STATE));
  const remember = (map, key, value, limit) => { map.delete(key); map.set(key, value); while (map.size > limit) map.delete(map.keys().next().value); };

  function bind(name, service) {
    deps[name] = service;
    return () => { if (deps[name] === service) deps[name] = undefined; };
  }

  /** The llm-pi-ai settings descriptor, or undefined when the service or entry is missing. */
  function descriptor() {
    const settings = deps.settings;
    if (!settings) return undefined;
    const all = settings.describe();
    return all.find(item => item.ns === SETTINGS_NS) ?? all.find(item => String(item.ns).endsWith(SETTINGS_NS));
  }

  function routeFacts(desc) {
    const effective = plain(plain(desc?.value).providers);
    const user = plain(plain(desc?.user).providers);
    const available = Object.keys(effective).sort();
    return { effective, user, available };
  }

  function snapshot() {
    const state = stored();
    const desc = descriptor();
    const { effective, available } = routeFacts(desc);
    const targets = targetRoutes(state, available);
    return {
      ok: true,
      enabled: state.enabled,
      strategy: state.strategy,
      routes: state.routes,
      uplinkKBps: state.uplinkKBps,
      targets,
      applied: Object.keys(state.originals).sort(),
      drift: driftedRoutes(state, { available, effectiveProviders: effective }),
      available: available.map(id => ({
        id,
        displayName: typeof effective[id]?.displayName === 'string' ? effective[id].displayName : id,
        api: typeof effective[id]?.api === 'string' ? effective[id].api : undefined,
        pixels: effective[id]?.requestImagePixelBudget ?? strategyFields(BASELINE).requestImagePixelBudget,
        maxBytes: effective[id]?.requestImageMaxBytes ?? strategyFields(BASELINE).requestImageMaxBytes,
        managed: Object.hasOwn(state.originals, id),
      })),
      strategies: STRATEGIES,
      notice: noticeText(state.strategy),
      capabilities: { settings: !!desc, attachments: !!deps.attachments, sessions: !!deps.sessionQuery },
    };
  }

  function serialize(work) {
    const operation = queue.then(async () => {
      if (closed) throw fail('plugin_closed', 503);
      await ready;
      return work();
    });
    queue = operation.catch(() => {});
    return operation;
  }

  /** Persist preferences, then move llm-pi-ai config to match them. */
  function update(input) {
    return serialize(async () => {
      const current = stored();
      const patch = {};
      if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw fail('invalid_enabled'); patch.enabled = input.enabled; }
      if (input.strategy !== undefined) { if (!STRATEGIES.some(strategy => strategy.id === input.strategy)) throw fail('unknown_strategy'); patch.strategy = input.strategy; }
      if (input.routes !== undefined) { if (input.routes !== null && (!Array.isArray(input.routes) || input.routes.some(route => typeof route !== 'string'))) throw fail('invalid_routes'); patch.routes = input.routes; }
      if (input.uplinkKBps !== undefined) { const value = Number(input.uplinkKBps); if (!Number.isFinite(value) || value < 1 || value > 1e6) throw fail('invalid_uplink'); patch.uplinkKBps = value; }
      const next = normalizeState({ ...current, ...patch, originals: current.originals });
      const touchesConfig = input.reapply === true || next.enabled !== current.enabled || next.strategy !== current.strategy
        || JSON.stringify(next.routes) !== JSON.stringify(current.routes);
      if (!touchesConfig) {
        await domain.global.set(next);
        return snapshot();
      }
      const desc = descriptor();
      if (!desc) {
        if (next.enabled || Object.keys(next.originals).length) throw fail('settings_unavailable', 503, 'DSH settings service or llm-pi-ai entry is unavailable.');
        await domain.global.set(next);
        return snapshot();
      }
      const { user, available } = routeFacts(desc);
      const plan = planChanges(next, { available, userProviders: user });
      // Keep originals of routes being restored until the write succeeds, so a failed write can be retried.
      const union = { ...next.originals, ...plan.originals };
      await domain.global.set({ ...next, originals: union });
      if (plan.ops.length) {
        try { await deps.settings.mutate(desc.ns, plan.ops, desc.revision); }
        catch (error) {
          // Config is unchanged: keep the previous preferences, but remember any newly recorded originals.
          await domain.global.set({ ...current, originals: union });
          throw fail(error?.name === 'SettingsConflictError' ? 'settings_conflict' : 'settings_write_failed', 409, error?.message || String(error));
        }
      }
      await domain.global.set({ ...next, originals: plan.originals });
      return { ...snapshot(), changedFields: plan.ops.length };
    });
  }

  function requireImages() {
    if (!deps.attachments) throw fail('attachments_unavailable', 503, 'DSH attachment service is unavailable.');
  }

  /** Recent real images: the given session first, then the newest sessions. */
  async function samples(input, signal) {
    requireImages();
    if (!deps.sessionQuery) throw fail('sessions_unavailable', 503, 'DSH session query service is unavailable.');
    const limit = Math.min(MAX_SAMPLES, Math.max(1, Number(input.limit) || MAX_SAMPLES));
    const order = [];
    if (typeof input.sessionId === 'string' && input.sessionId) order.push(input.sessionId);
    try {
      const listed = await deps.sessionQuery.listSessions(signal);
      const sorted = [...(listed ?? [])].map(record => record?.header).filter(header => header?.id)
        .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
      for (const header of sorted) if (!order.includes(header.id)) order.push(header.id);
    } catch (error) { signal?.throwIfAborted(); if (!order.length) throw error; }
    const items = [], seen = new Set();
    for (const sessionId of order.slice(0, MAX_SESSIONS_SCANNED)) {
      signal?.throwIfAborted();
      let events;
      try { events = (await deps.sessionQuery.readSurface(sessionId)).events; } catch { continue; }
      for (const { ref } of imagesFromEvents(events)) {
        if (seen.has(ref.attachmentId)) continue;
        seen.add(ref.attachmentId);
        remember(refs, ref.attachmentId, ref, MAX_REFS);
        items.push({ id: ref.attachmentId, width: ref.width, height: ref.height, bytes: ref.bytes, mediaType: ref.mediaType, name: typeof ref.name === 'string' ? ref.name.slice(0, 200) : undefined, sessionId, current: sessionId === input.sessionId });
        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }
    return { ok: true, images: items };
  }

  async function version(ref, variant, signal) {
    const key = `${ref.attachmentId}|${variant}`;
    const cached = versions.get(key);
    if (cached) return cached;
    const value = await deps.attachments.readImageRequest(ref, requestTarget(ref, strategyFields(variant)), signal);
    const meta = { bytes: value.bytes ?? value.data?.byteLength, width: value.width, height: value.height, mediaType: value.mediaType };
    remember(versions, key, meta, MAX_VERSIONS);
    return meta;
  }

  function refOf(id) {
    const ref = refs.get(id);
    if (!ref || !validRef(ref)) throw fail('unknown_image', 404, 'Image is not in the sampled set; reload samples.');
    return ref;
  }

  /** Request-version sizes for each image under DSH default and every preset. */
  async function estimate(input, signal) {
    requireImages();
    const ids = Array.isArray(input.ids) ? [...new Set(input.ids.filter(id => typeof id === 'string'))].slice(0, MAX_SAMPLES) : [];
    const images = [], totals = Object.fromEntries(VARIANTS.map(variant => [variant, 0]));
    const failures = [];
    for (const id of ids) {
      signal?.throwIfAborted();
      const ref = refs.get(id);
      if (!ref) { failures.push({ id, error: 'unknown_image' }); continue; }
      const entry = { id, versions: {} };
      try {
        for (const variant of VARIANTS) {
          const meta = await version(ref, variant, signal);
          entry.versions[variant] = meta;
          totals[variant] += base64Bytes(meta.bytes);
        }
        images.push(entry);
      } catch (error) {
        signal?.throwIfAborted();
        failures.push({ id, error: error?.code || 'version_failed' });
        for (const variant of VARIANTS) if (entry.versions[variant]) totals[variant] -= base64Bytes(entry.versions[variant].bytes);
      }
    }
    return { ok: true, images, totals, failures, uplinkKBps: stored().uplinkKBps };
  }

  /** Bytes of the stored normalized image ('source') or of one request version. */
  async function image(params, signal) {
    requireImages();
    const ref = refOf(params.get('id') ?? '');
    const variant = params.get('variant') ?? '';
    let data, mediaType;
    if (variant === 'source') {
      const value = await deps.attachments.readImage(ref, signal);
      data = value?.data ?? value;
      mediaType = value?.mediaType ?? ref.mediaType;
    } else if (VARIANTS.includes(variant)) {
      const value = await deps.attachments.readImageRequest(ref, requestTarget(ref, strategyFields(variant)), signal);
      data = value.data; mediaType = value.mediaType;
    } else throw fail('unknown_variant', 400);
    if (!(data instanceof Uint8Array)) throw fail('image_unavailable', 500);
    return new Response(data, { status: 200, headers: { 'content-type': mediaType || 'application/octet-stream', 'cache-control': 'private, max-age=600', 'x-image-bytes': String(data.byteLength) } });
  }

  /** Synchronous: the system-prompt section asks once per model step. */
  function noticeFor(provider) {
    if (!domain || closed || typeof provider !== 'string') return '';
    const state = stored();
    return state.enabled && Object.hasOwn(state.originals, provider) ? noticeText(state.strategy) : '';
  }

  async function execute(input, signal = lifetime.signal) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid_request');
    await ready;
    switch (input.action) {
      case 'state': return snapshot();
      case 'update': return update(input);
      case 'samples': return samples(input, signal);
      case 'estimate': return estimate(input, signal);
      default: throw fail('invalid_action');
    }
  }

  return {
    ready, lifetime, bind, execute, image, noticeFor, snapshot, update,
    async dispose() { if (closed) return; closed = true; lifetime.abort(); await ready.catch(() => {}); await queue; await domain?.close(); refs.clear(); versions.clear(); },
  };
}

export async function readInput(request) {
  if (request.method !== 'POST') throw fail('post_required', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw fail('json_required', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw fail('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw fail('invalid_request');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel().catch(() => {}); throw fail('request_too_large', 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('invalid_json'); }
}

export const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const errorJSON = error => json({ ok: false, error: error?.code || 'operation_failed', message: error?.message || String(error) }, error?.status || 500);

export function createFetchHandler(service) {
  return async request => {
    const signal = AbortSignal.any([request.signal, service.lifetime.signal]);
    try { return json(await service.execute(await readInput(request), signal)); }
    catch (error) { return errorJSON(error); }
  };
}

export function createImageHandler(service) {
  return async request => {
    const signal = AbortSignal.any([request.signal, service.lifetime.signal]);
    try { return await service.image(new URL(request.url, 'http://localhost').searchParams, signal); }
    catch (error) { return errorJSON(error); }
  };
}

export { FIELDS };
