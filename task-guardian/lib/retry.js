const LOCAL_MAX_DELAY_MS = 300_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// This key format intentionally matches @deepseek-ai/dsh-llm-retry 0.2.1-rc.3
// (llmRetry projection stateVersion 1). Recheck it when upgrading the host.
export const NATIVE_RETRY_COMPATIBILITY = '@deepseek-ai/dsh-llm-retry@0.2.1-rc.3;llmRetry@1';

/** Parse a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value, { nowMs = Date.now() } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    const milliseconds = Number(text) * 1000;
    return Number.isFinite(milliseconds) && milliseconds <= Number.MAX_SAFE_INTEGER
      ? Math.ceil(milliseconds) : undefined;
  }
  // Date.parse also accepts things such as "-1" and "1e3". Only HTTP date
  // forms may reach it; a negative/invalid numeric header is not a date.
  if (!/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/u.test(text)) return undefined;
  const timestamp = Date.parse(text.endsWith('GMT') ? text : `${text} GMT`);
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) return undefined;
  return Math.max(0, Math.ceil(timestamp - nowMs));
}

const PERMANENT_CODES = new Map([
  ['AUTH', 'authentication'], ['UNAUTHORIZED', 'authentication'],
  ['AUTHENTICATION_ERROR', 'authentication'], ['INVALID_API_KEY', 'authentication'],
  ['PERMISSION_ERROR', 'permission'], ['PERMISSION_DENIED', 'permission'],
  ['QUOTA', 'quota'], ['INSUFFICIENT_QUOTA', 'quota'], ['QUOTA_EXCEEDED', 'quota'],
  ['INSUFFICIENT_BALANCE', 'quota'], ['BILLING_HARD_LIMIT_REACHED', 'quota'],
  ['INVALID_REQUEST', 'invalid-request'], ['INVALID_REQUEST_ERROR', 'invalid-request'],
  ['BAD_REQUEST', 'invalid-request'], ['INVALID_ARGUMENT', 'invalid-request'], ['EINVAL', 'invalid-request'],
  ['CONTEXT_WINDOW_EXCEEDED', 'context-window'], ['CONTEXT_LENGTH_EXCEEDED', 'context-window'],
  ['MAX_CONTEXT_LENGTH_EXCEEDED', 'context-window'],
  ['UNKNOWN_MODEL', 'model-unavailable'], ['MODEL_NOT_FOUND', 'model-unavailable'],
  ['INVALID_MODEL', 'model-unavailable'], ['MODEL_UNSUPPORTED', 'model-unavailable'],
  ['CLIENT_UPGRADE_REQUIRED', 'client-upgrade-required'],
  ['UNSUPPORTED_CONTENT', 'unsupported-content'], ['UNSUPPORTED_REASONING_EFFORT', 'unsupported-reasoning-effort'],
  ['INVALID_REPLAY_STATE', 'invalid-replay-state'], ['REQUEST_EXTENSION', 'request-configuration'],
  ['ENOTFOUND', 'endpoint-configuration'], ['ERR_INVALID_URL', 'endpoint-configuration'],
  ['CERT_HAS_EXPIRED', 'tls-configuration'], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls-configuration'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'tls-configuration'], ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls-configuration'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls-configuration'], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls-configuration'],
]);
const TRANSIENT_CODES = new Map([
  ['SERVER', 'server-error'], ['SERVER_ERROR', 'server-error'], ['INTERNAL_SERVER_ERROR', 'server-error'],
  ['API_ERROR', 'server-error'], ['OVERLOADED_ERROR', 'server-error'], ['SERVICE_UNAVAILABLE', 'server-error'],
  ['TIMEOUT', 'timeout'], ['ETIMEDOUT', 'timeout'], ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
  ['UND_ERR_HEADERS_TIMEOUT', 'timeout'], ['UND_ERR_BODY_TIMEOUT', 'timeout'],
  ['ECONNRESET', 'transport-reset'], ['EPIPE', 'transport-reset'], ['EAI_AGAIN', 'temporary-dns'],
  ['UND_ERR_SOCKET', 'transport-reset'], ['EMPTY_RESPONSE', 'empty-response'], ['STREAM_CLOSED', 'stream-closed'],
]);
const CODE_FIELDS = ['code', 'type', 'error_code', 'error_type'];
const TEXT_FIELDS = ['message', 'detail', 'description', 'error_description', 'reason'];
const normalizedCode = code => code.trim().toUpperCase().replace(/[\s.-]+/gu, '_');

/**
 * The native LlmFailure discards raw headers/causes. Inspect only the retained
 * fields, including provider JSON embedded in message. Bound the inspection;
 * incomplete evidence must never grant an automatic retry.
 */
function failureEvidence(failure) {
  const codes = new Set(), texts = new Set(), seen = new WeakSet();
  let remaining = 65_536, nodes = 0, incomplete = false;
  function text(value, depth) {
    if (texts.has(value)) return;
    if (value.length > remaining) { incomplete = true; return; }
    remaining -= value.length;
    texts.add(value);
    const trimmed = value.trim();
    const start = trimmed.indexOf('{');
    const json = /^[{[]/u.test(trimmed) ? trimmed
      : start >= 0 && trimmed.endsWith('}') ? trimmed.slice(start) : undefined;
    if (json) {
      try { visit(JSON.parse(json), depth + 1); }
      catch { /* Plain provider text is still examined conservatively below. */ }
    }
  }
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (depth > 8 || ++nodes > 256) { incomplete = true; return; }
    seen.add(value);
    for (const key of CODE_FIELDS) if (typeof value[key] === 'string') {
      text(value[key], depth);
      codes.add(normalizedCode(value[key]));
    }
    for (const key of TEXT_FIELDS) if (typeof value[key] === 'string') text(value[key], depth);
    for (const nested of Object.values(value)) if (nested && typeof nested === 'object') visit(nested, depth + 1);
  }
  visit({ code: failure.code, message: failure.message, type: failure.type }, 0);
  return {
    codes,
    text: [...texts].map(value => value.toLowerCase().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ')).join('\n'),
    incomplete,
  };
}

function permanentTextReason(text) {
  if (/\b(?:insufficient (?:quota|balance|credits?)|quota (?:exceeded|exhausted)|billing hard limit|credit balance (?:is )?(?:too low|insufficient)|(?:account |credit )?balance (?:is )?(?:insufficient|exhausted)|(?:run out of|out of) credits?)\b|余额不足|额度(?:不足|耗尽|用尽)|欠费|配额(?:不足|耗尽|用尽)/u.test(text)) return 'quota';
  if (/\b(?:invalid|missing|expired|incorrect|revoked) (?:api )?(?:key|token|credentials?)\b|\b(?:api key|access token) (?:is |has )?(?:invalid|expired|missing|revoked)\b|\b(?:unauthorized|authentication (?:failed|required|error))\b|认证失败|鉴权失败|密钥(?:无效|过期)|无效的?(?:密钥|api.?key)/u.test(text)) return 'authentication';
  if (/\b(?:permission denied|access denied|forbidden)\b|权限不足|没有权限|未授权/u.test(text)) return 'permission';
  if (/\b(?:(?:unknown|invalid|unsupported|unrecognized) model|model (?:not found|does not exist|is (?:invalid|unsupported)|is not (?:available|supported)))\b|\bmodel\b[^\n]{0,100}\b(?:does not exist|not found|not supported)\b|模型[^\n]{0,40}(?:不存在|未找到|无效|不支持|不可用)|(?:未知|无效)模型/u.test(text)) return 'model-unavailable';
  if (/\b(?:context (?:length|window) (?:exceeded|limit)|maximum context (?:length|window)|context length exceeded|prompt too long|input too long)\b|\b(?:context|token)\b[^\n]{0,60}\b(?:exceed(?:ed|s)?|too (?:long|large))\b|上下文[^\n]{0,30}(?:过长|超出|超过)/u.test(text)) return 'context-window';
  if (/\b(?:invalid request|bad request|invalid argument|malformed request|unsupported (?:parameter|reasoning effort)|unrecognized request argument|einval)\b|参数(?:无效|错误)|请求格式错误/u.test(text)) return 'invalid-request';
  if (/\b(?:(?:invalid|missing|incorrect|unsupported) (?:provider )?(?:configuration|config|baseurl|base url)|configuration (?:error|is invalid|missing)|provider (?:not found|not configured|is not configured|does not exist))\b|配置(?:错误|无效|缺失)|未配置(?:模型|密钥|地址)/u.test(text)) return 'request-configuration';
  if (/\b(?:invalid url|unsupported (?:url |uri )?protocol|failed to parse url|invalid endpoint|enotfound|hostname not found)\b|域名不存在|地址配置错误/u.test(text)) return 'endpoint-configuration';
  if (/\b(?:cert has expired|self signed certificate|certificate (?:has expired|verify failed|verification failed|is not valid)|unable to verify (?:the )?(?:first |leaf )?certificate|err tls cert|unable to get (?:local )?issuer)\b|证书(?:过期|无效|校验失败|验证失败)/u.test(text)) return 'tls-configuration';
  if (/\b(?:econnrefused|connection refused)\b/u.test(text) && /\blocalhost\b|\b127(?:\.\d{1,3}){3}\b|\[?::1\]?/u.test(text)) return 'endpoint-configuration';
  return undefined;
}

function positiveMilliseconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? Math.ceil(value) : undefined;
}

/** Classify structured provider failures conservatively; ambiguous failures stop. */
export function classifyFailure(failure, { nowMs = Date.now() } = {}) {
  // nowMs is accepted for callers sharing the parseRetryAfter clock contract.
  // LlmFailure already carries a parsed millisecond delay, not raw headers.
  void nowMs;
  if (!failure || typeof failure !== 'object') return { kind: 'unknown', reason: 'unrecognized-failure' };
  const code = typeof failure.code === 'string' ? normalizedCode(failure.code) : '';
  const retryAfterMs = positiveMilliseconds(failure.providerRetryAfterMs);
  const result = (kind, reason) => ({ kind, reason, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
  const evidence = failureEvidence(failure);
  for (const embeddedCode of evidence.codes) {
    if (PERMANENT_CODES.has(embeddedCode)) return result('permanent', PERMANENT_CODES.get(embeddedCode));
  }
  const permanentReason = permanentTextReason(evidence.text);
  if (permanentReason) return result('permanent', permanentReason);
  const encodedStatus = /^HTTP_(\d{3})$/u.exec(code);
  const status = Number.isInteger(failure.status) ? failure.status : encodedStatus ? Number(encodedStatus[1]) : undefined;
  if (status === 401 || status === 403) return result('permanent', status === 401 ? 'authentication' : 'permission');
  if (status === 402) return result('permanent', 'quota');
  if (status === 400 || status === 413 || status === 415 || status === 422) return result('permanent', 'invalid-request');
  if (status === 404) return result('permanent', 'model-or-endpoint-not-found');
  if (evidence.incomplete) return result('unknown', 'incomplete-failure-details');
  if (code === 'ABORTED' || code === 'ABORT_ERR' || failure.name === 'AbortError') return result('unknown', 'aborted');
  // Refused/unreachable connections and TLS/DNS configuration failures are
  // not evidence of a temporary outage, even when wrapped in a SERVER error.
  if (/\b(?:econnrefused|connection refused|enetunreach|ehostunreach|certificate|tls certificate|ssl certificate)\b/u.test(evidence.text)) return result('unknown', 'ambiguous-transport-failure');
  const quotaHint = /\b(?:quota|billing|credits?|balance)\b|额度|配额|余额|计费/u.test(evidence.text);
  if (quotaHint) return result('unknown', 'ambiguous-quota-failure');
  const temporaryRate = /\b(?:too many (?:concurrent|simultaneous) requests|concurr(?:ent|ency) (?:request )?(?:limit|capacity)|rate limit (?:exceeded|error))\b|\b(?:temporary|temporarily)\b[^\n]{0,80}\b(?:rate limit|too many requests)\b|\b(?:rate limit|too many requests)\b[^\n]{0,80}\b(?:temporary|temporarily|try again|retry|per second|per minute)\b|\brequests per (?:second|minute)\b|并发(?:数|请求)?[^\n]{0,20}(?:限制|过多|超限)|请求频率过高|临时限流/u.test(evidence.text);
  if (status === 429 || /^RATE_LIMIT(?:_ERROR|_EXCEEDED)?$/u.test(code)) {
    return temporaryRate || retryAfterMs > 0
      ? result('transient', 'rate-limit') : result('unknown', 'ambiguous-rate-limit');
  }
  if (status === 408 || status === 504) return result('transient', 'timeout');
  if (status >= 500 && status <= 599) return result('transient', 'server-error');
  if (status >= 400 && status <= 499) return result('unknown', 'unrecognized-http-status');
  if (temporaryRate) return result('transient', 'rate-limit');
  if (TRANSIENT_CODES.has(code)) return result('transient', TRANSIENT_CODES.get(code));
  if (/\b(?:(?:stream|socket|read|response|request|connection|connect) (?:idle )?(?:timeout|timed out)|etimedout|stream idle timeout)\b/u.test(evidence.text)) return result('transient', 'timeout');
  if (/\b(?:econnreset|epipe|connection reset by peer|broken pipe|socket hang up|(?:stream|connection) (?:closed|ended) (?:unexpectedly|prematurely))\b/u.test(evidence.text)) return result('transient', 'transport-reset');
  if (/\b(?:temporarily unavailable|server overloaded|service unavailable|bad gateway|gateway timeout)\b/u.test(evidence.text)) return result('transient', 'server-error');
  return result('unknown', 'unrecognized-failure');
}

/** 1-based exponential backoff, ±10% jitter, and a provider-owned lower bound. */
export function computeBackoffMs(attempt, { random = Math.random, retryAfterMs } = {}) {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive safe integer');
  const base = Math.min(30_000 * 2 ** Math.min(attempt - 1, 4), LOCAL_MAX_DELAY_MS);
  const sample = random();
  const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  const local = Math.min(LOCAL_MAX_DELAY_MS, Math.ceil(base * (0.9 + 0.2 * fraction)));
  return Math.max(local, positiveMilliseconds(retryAfterMs) ?? 0);
}

/** Resolve true on expiry and false on abort, removing timers and listeners. */
export function abortableWait(delayMs, signal) {
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > Number.MAX_SAFE_INTEGER) throw new RangeError('delayMs must be a non-negative finite duration');
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let remaining = delayMs;
    let timer;
    function finish(completed) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    }
    function onAbort() { finish(false); }
    function schedule() {
      const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
      timer = setTimeout(() => {
        remaining -= chunk;
        if (remaining > 0) schedule();
        else finish(true);
      }, chunk);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    schedule();
  });
}

/**
 * Match the native llmRetry projection's exact provider and resolved policy.
 * Missing/unsupported projection state is not evidence that the native budget
 * is exhausted. Intentionally version coupled; see NATIVE_RETRY_COMPATIBILITY.
 */
export function nativeExhausted(ctx, payload) {
  const policy = payload?.retryPolicy;
  if (policy?.mode !== 'normal' || !Number.isSafeInteger(policy.maxRetries) || policy.maxRetries < 0
    || !Array.isArray(policy.retryableCodes) || !policy.retryableCodes.every(code => typeof code === 'string')
    || ![policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio].every(Number.isFinite)
    || typeof payload.provider !== 'string' || !payload.agent?.session) return false;
  const policyKey = JSON.stringify([
    policy.mode, policy.maxRetries, [...policy.retryableCodes].sort(),
    policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio,
  ]);
  const stateKey = JSON.stringify([payload.provider, policyKey]);
  try {
    const state = ctx.sessionProjections.stateOf(payload.agent.session, 'llmRetry');
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    const prototype = Object.getPrototypeOf(state);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const entry = state[stateKey];
    const retry = entry === undefined ? 0 : entry?.retry;
    return Number.isSafeInteger(retry) && retry >= policy.maxRetries;
  } catch {
    return false;
  }
}

/** Race even an injected asynchronous hook against cancellation. */
function untilAbort(operation, signal) {
  if (signal.aborted) {
    // The caller may have synchronously aborted while creating this promise.
    Promise.resolve(operation).catch(() => {});
    return Promise.resolve({ aborted: true });
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); resolve({ aborted: true }); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(value => {
      signal.removeEventListener('abort', onAbort);
      resolve({ value, aborted: false });
    }, error => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

/**
 * Install the outermost request-error middleware. Notification hooks may be
 * asynchronous; isEnabled must return a synchronous boolean.
 * isEnabled(sessionId, payload) is rechecked after downstream recovery, durable
 * scheduling and waiting. onSchedule({sessionId, attempt, delayMs, retryAt,
 * failure, reason, payload, signal}) must persist before resolving. An async
 * host hook must respect signal or its own task revision before committing.
 * onBlocked receives {sessionId, kind, reason, failure, payload, signal};
 * onReset receives {sessionId}.
 *
 * Host calls cancel(id) when the feature is disabled, the session is closed or
 * its task is cancelled. It only cancels guardian work; native recovery retains
 * its original signal. Call reset(id) after a successful request/step to cancel
 * stale work and start the next failure chain at attempt 1.
 * wait(delayMs, signal) resolves true (or void) on expiry and false on abort.
 */
export function registerRetryMiddleware(ctx, {
  isEnabled = () => false,
  onSchedule = () => {},
  onReset = () => {},
  onBlocked = () => {},
  lifetimeSignal,
  random = Math.random,
  now = Date.now,
  wait = abortableWait,
} = {}) {
  const lifetime = new AbortController();
  const attempts = new Map();
  const operations = new Map();
  const active = new Set();
  let disposed = false;
  let disposal;

  function cancel(sessionId) {
    const pending = operations.get(sessionId);
    if (!pending) return false;
    for (const controller of pending) controller.abort();
    return true;
  }
  async function reset(sessionId) {
    cancel(sessionId);
    attempts.delete(sessionId);
    await onReset({ sessionId });
  }

  async function recover(payload, next, controller) {
    // Always preserve downstream decisions/errors, including native retry.
    const decision = await next();
    const sessionId = payload.agent?.session?.id;
    const signals = [controller.signal, lifetime.signal, lifetimeSignal, payload.signal].filter(Boolean);
    const signal = AbortSignal.any(signals);
    if (decision !== undefined || !sessionId || signal.aborted || !isEnabled(sessionId, payload)
      || payload.retryPolicy?.mode === 'always') return decision;
    if (!nativeExhausted(ctx, payload)) return decision;
    const failure = classifyFailure(payload.failure, { nowMs: now() });
    if (failure.kind !== 'transient') {
      await untilAbort(onBlocked({ sessionId, ...failure, failure: payload.failure, payload, signal }), signal);
      return decision;
    }
    const attempt = (attempts.get(sessionId) ?? 0) + 1;
    attempts.set(sessionId, attempt);
    const delayMs = computeBackoffMs(attempt, { random, retryAfterMs: failure.retryAfterMs });
    const scheduled = await untilAbort(onSchedule({
      sessionId, attempt, delayMs, retryAt: now() + delayMs,
      failure: payload.failure, reason: failure.reason, payload, signal,
    }), signal);
    if (scheduled.aborted || signal.aborted || !isEnabled(sessionId, payload)) return decision;
    const waited = await untilAbort(wait(delayMs, signal), signal);
    if (waited.aborted || waited.value === false || signal.aborted || !isEnabled(sessionId, payload)) return decision;
    return { kind: 'retry' };
  }

  const off = ctx.on('agent/request-error', (payload, next) => {
    const sessionId = payload.agent?.session?.id;
    const controller = new AbortController();
    const pending = operations.get(sessionId) ?? new Set();
    // Agent-loop normally serializes a session. If dispatches overlap, only
    // the newest may schedule guardian work; native decisions remain intact.
    for (const previous of pending) previous.abort();
    pending.add(controller);
    operations.set(sessionId, pending);
    const operation = recover(payload, next, controller).finally(() => {
      pending.delete(controller);
      if (pending.size === 0) operations.delete(sessionId);
      active.delete(operation);
    });
    active.add(operation);
    return operation;
  }, { prepend: true });

  function dispose() {
    if (disposed) return disposal;
    disposed = true;
    off();
    lifetime.abort();
    attempts.clear();
    disposal = Promise.allSettled([...active]).then(() => {});
    return disposal;
  }
  return { dispose, cancel, reset };
}
