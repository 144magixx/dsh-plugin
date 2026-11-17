/** Pure, dependency-free logic for 上行瘦身 · Upload Slim. */

export const SETTINGS_NS = 'llm-pi-ai';
export const FIELDS = Object.freeze(['requestImagePixelBudget', 'requestImageMaxBytes']);

/** DSH's own llm-pi-ai defaults (dsh-llm-pi-ai DEFAULT_REQUEST_IMAGE_*). */
export const DSH_DEFAULT = Object.freeze({ requestImagePixelBudget: 2048 * 2048, requestImageMaxBytes: 1024 * 1024 });

/**
 * Presets only touch the two per-image fields, which are fully reversible.
 * Request-wide caps (maxRequestImageBytes / maxRequestImages) are left alone on
 * purpose: lowering them makes DSH offload old images permanently.
 */
export const STRATEGIES = Object.freeze([
  { id: 'fidelity', pixels: 2048 * 1152, maxBytes: 400 * 1024 },
  { id: 'balanced', pixels: 1600 * 900, maxBytes: 200 * 1024 },
  { id: 'saver', pixels: 1280 * 720, maxBytes: 120 * 1024 },
  { id: 'minimal', pixels: 960 * 540, maxBytes: 60 * 1024 },
].map(Object.freeze));
export const DEFAULT_STRATEGY = 'balanced';
export const BASELINE = 'dsh-default';

export function fail(code, status = 400, message = code) {
  return Object.assign(new Error(message), { code, status });
}

export function strategyById(id) {
  return STRATEGIES.find(strategy => strategy.id === id);
}

/** Field values a strategy (or the DSH baseline) writes. */
export function strategyFields(id) {
  if (id === BASELINE) return { ...DSH_DEFAULT };
  const strategy = strategyById(id);
  if (!strategy) throw fail('unknown_strategy');
  return { requestImagePixelBudget: strategy.pixels, requestImageMaxBytes: strategy.maxBytes };
}

/**
 * Copy of dsh-attachment requestImageDimensions: inward-rounded, aspect-preserving,
 * never enlarges. Keeping it identical makes previews byte-exact with real requests.
 */
export function requestImageDimensions(width, height, maxPixels) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  if (scale === 1) return { width, height };
  if (width >= height) {
    let w = Math.max(1, Math.floor(width * scale));
    let hh = Math.max(1, Math.round(w * height / width));
    while (w * hh > maxPixels && w > 1) { w -= 1; hh = Math.max(1, Math.round(w * height / width)); }
    return { width: w, height: hh };
  }
  let hh = Math.max(1, Math.floor(height * scale));
  let w = Math.max(1, Math.round(hh * width / height));
  while (w * hh > maxPixels && hh > 1) { hh -= 1; w = Math.max(1, Math.round(hh * width / height)); }
  return { width: w, height: hh };
}

export function requestTarget(ref, fields) {
  return { ...requestImageDimensions(ref.width, ref.height, fields.requestImagePixelBudget), maxBytes: fields.requestImageMaxBytes };
}

/** Bytes an inline image adds to the request body (base64 expansion). */
export const base64Bytes = bytes => Math.ceil(bytes / 3) * 4;

export const DEFAULT_STATE = Object.freeze({
  version: 1, enabled: false, strategy: DEFAULT_STRATEGY, routes: null, uplinkKBps: 80, originals: {},
});

/** Validate and normalize persisted or user-supplied state. */
export function normalizeState(value) {
  const input = value && typeof value === 'object' ? value : {};
  const strategy = strategyById(input.strategy) ? input.strategy : DEFAULT_STRATEGY;
  const routes = Array.isArray(input.routes) ? [...new Set(input.routes.filter(route => typeof route === 'string' && route))].sort() : null;
  const uplink = Number(input.uplinkKBps);
  const originals = {};
  if (input.originals && typeof input.originals === 'object') {
    for (const [route, fields] of Object.entries(input.originals)) {
      if (!fields || typeof fields !== 'object') continue;
      const record = {};
      for (const field of FIELDS) {
        const entry = fields[field];
        if (entry && typeof entry === 'object' && typeof entry.present === 'boolean') {
          record[field] = entry.present ? { present: true, value: entry.value } : { present: false };
        }
      }
      if (Object.keys(record).length === FIELDS.length) originals[route] = record;
    }
  }
  return {
    version: 1,
    enabled: input.enabled === true,
    strategy,
    routes,
    uplinkKBps: Number.isFinite(uplink) && uplink >= 1 && uplink <= 1e6 ? Math.round(uplink) : DEFAULT_STATE.uplinkKBps,
    originals,
  };
}

/** Routes the plugin should slim: explicit selection limited to existing routes, or every route. */
export function targetRoutes(state, available) {
  const existing = new Set(available);
  return (state.routes ?? available).filter(route => existing.has(route)).sort();
}

/**
 * Plan settings ops that move the profile from its current user layer to the
 * desired state. Returns ops for ctx.settings.mutate plus the next originals map.
 * - Enabling a route records whether each field was set by the user, and its value.
 * - Disabling restores exactly that: set the old value back, or unset it.
 */
export function planChanges(state, { available, userProviders = {} }) {
  const desired = state.enabled ? targetRoutes(state, available) : [];
  const fields = strategyFields(state.strategy);
  const originals = structuredClone(state.originals);
  const ops = [];
  for (const route of desired) {
    if (!originals[route]) {
      const current = userProviders[route] ?? {};
      originals[route] = Object.fromEntries(FIELDS.map(field => [field, Object.hasOwn(current, field) ? { present: true, value: current[field] } : { present: false }]));
    }
    for (const field of FIELDS) {
      if (userProviders[route]?.[field] !== fields[field]) ops.push({ op: 'set', path: ['providers', route, field], value: fields[field] });
    }
  }
  const restored = [];
  for (const route of Object.keys(originals).sort()) {
    if (desired.includes(route)) continue;
    // A route that disappeared from the profile has nothing left to restore.
    if (available.includes(route)) {
      for (const field of FIELDS) {
        const entry = originals[route][field];
        if (entry.present) {
          if (userProviders[route]?.[field] !== entry.value) ops.push({ op: 'set', path: ['providers', route, field], value: entry.value });
        } else if (Object.hasOwn(userProviders[route] ?? {}, field)) {
          ops.push({ op: 'unset', path: ['providers', route, field] });
        }
      }
    }
    delete originals[route];
    restored.push(route);
  }
  return { ops, originals, desired, restored };
}

/** Routes whose effective values differ from what the plugin applied (edited elsewhere). */
export function driftedRoutes(state, { available, effectiveProviders = {} }) {
  if (!state.enabled) return [];
  const fields = strategyFields(state.strategy);
  return targetRoutes(state, available).filter(route => FIELDS.some(field => effectiveProviders[route]?.[field] !== fields[field]));
}

const kb = bytes => `${Math.round(bytes / 1024)} KB`;

/** Fixed system-prompt text for one strategy: constant per strategy so the prompt prefix stays cacheable. */
export function noticeText(strategyId) {
  const strategy = strategyById(strategyId);
  if (!strategy) return '';
  const side = Math.round(Math.sqrt(strategy.pixels));
  return [
    '# Upload slimming',
    `Images in this conversation are sent to you as lossy previews to save upload bandwidth: each image is downscaled to at most ${strategy.pixels.toLocaleString('en-US')} pixels (about ${side}x${side}, e.g. ${Math.round(Math.sqrt(strategy.pixels * 16 / 9))}x${Math.round(Math.sqrt(strategy.pixels * 9 / 16))} for 16:9) and re-encoded as JPEG near ${kb(strategy.maxBytes)}.`,
    'Small text, thin lines, subscripts and exact colors may be blurred or shifted. When such a detail matters, do not guess from the preview: crop the region you need from the image\'s "Normalized copy" path given next to the image (for example with Pillow) and view that crop, which keeps far more detail within the same budget.',
    'Prefer viewing only the regions or pages that changed instead of re-reading whole screenshots.',
  ].join('\n');
}

/** Image blocks in raw session events, newest first, as [{ref, seq}]. */
export function imagesFromEvents(events) {
  const found = [];
  for (const event of events ?? []) {
    let content;
    if (event?.type === 'user/message') content = event.data?.content;
    else if (event?.type === 'tool/result') content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const ref = block?.type === 'image' ? block.attachment : undefined;
      if (validRef(ref)) found.push({ ref, seq: event.seq });
    }
  }
  return found.reverse();
}

export function validRef(ref) {
  return !!ref && typeof ref === 'object' && /^sha256:[a-f0-9]{64}$/.test(String(ref.attachmentId))
    && Number.isSafeInteger(ref.width) && ref.width > 0 && Number.isSafeInteger(ref.height) && ref.height > 0;
}
