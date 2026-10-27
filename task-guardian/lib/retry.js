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
  ['AUTHENTICATION_ERROR', 'authentication'], ['AUTHENTICATION_FAILED', 'authentication'], ['INVALID_API_KEY', 'authentication'], ['API_KEY_EXPIRED', 'authentication'],
  ['PERMISSION_ERROR', 'permission'], ['PERMISSION_DENIED', 'permission'],
  ['QUOTA', 'quota'], ['INSUFFICIENT_QUOTA', 'quota'], ['QUOTA_EXCEEDED', 'quota'],
  ['INSUFFICIENT_BALANCE', 'quota'], ['BILLING_HARD_LIMIT_REACHED', 'quota'], ['USAGE_LIMIT_EXCEEDED', 'quota'], ['QUOTA_EXHAUSTED', 'quota'],
  ['API_KEY_RATE_5H_EXCEEDED', 'quota'], ['API_KEY_RATE_1D_EXCEEDED', 'quota'], ['API_KEY_RATE_7D_EXCEEDED', 'quota'],
  ['API_KEY_QUOTA_EXHAUSTED', 'quota'], ['USER_PLATFORM_DAILY_QUOTA_EXHAUSTED', 'quota'], ['USER_PLATFORM_WEEKLY_QUOTA_EXHAUSTED', 'quota'], ['USER_PLATFORM_MONTHLY_QUOTA_EXHAUSTED', 'quota'],
  ['INVALID_REQUEST', 'invalid-request'], ['INVALID_REQUEST_ERROR', 'invalid-request'],
  ['BAD_REQUEST', 'invalid-request'], ['INVALID_ARGUMENT', 'invalid-request'], ['EINVAL', 'invalid-request'],
  ['CONTEXT_WINDOW_EXCEEDED', 'context-window'], ['CONTEXT_LENGTH_EXCEEDED', 'context-window'],
  ['MAX_CONTEXT_LENGTH_EXCEEDED', 'context-window'],
  ['UNKNOWN_MODEL', 'model-unavailable'], ['MODEL_NOT_FOUND', 'model-unavailable'],
  ['INVALID_MODEL', 'model-unavailable'], ['MODEL_UNSUPPORTED', 'model-unavailable'],
  ['CLIENT_UPGRADE_REQUIRED', 'client-upgrade-required'],
  ['UNSUPPORTED_CONTENT', 'unsupported-content'], ['UNSUPPORTED_REASONING_EFFORT', 'unsupported-reasoning-effort'],
  ['CONTENT_FILTER', 'content-restriction'], ['CONTENT_POLICY_VIOLATION', 'content-restriction'],
  ['CONTENT_POLICY_ERROR', 'content-restriction'], ['POLICY_VIOLATION', 'content-restriction'],
  ['SAFETY_REFUSAL', 'content-restriction'], ['SAFETY_VIOLATION', 'content-restriction'],
  ['PROHIBITED_CONTENT', 'content-restriction'],
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
  const codes = new Set(), temporaryCodes = new Set(), texts = new Set(), temporaryTexts = new Set(), statuses = new Set();
  const seen = new WeakMap(), analysedTexts = new Set();
  const containers = new Set(['error', 'errors', 'response', 'cause', 'inner', 'detail', 'details', 'data']);
  let remaining = 65_536, nodes = 0, incomplete = false;
  const retainStatus = value => { if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) statuses.add(value); };
  function code(value, trusted) {
    const normalized = normalizedCode(value); codes.add(normalized);
    if (trusted) {
      temporaryCodes.add(normalized);
      const statusCode = /^(?:HTTP_)?([1-5]\d{2})$/u.exec(normalized);
      if (statusCode) retainStatus(Number(statusCode[1]));
    }
  }
  function text(value, depth, trusted) {
    const analysisKey = `${trusted ? 1 : 0}:${value}`;
    if (analysedTexts.has(analysisKey)) return;
    analysedTexts.add(analysisKey);
    if (!texts.has(value)) {
      if (value.length > remaining) { incomplete = true; return; }
      remaining -= value.length; texts.add(value);
    }
    if (/\[truncated(?:\s+\d+\s+chars)?\]/iu.test(value)) incomplete = true;
    const trimmed = value.trim();
    // These are the two prefix styles produced by pi-ai response.failed/error.
    const prefix = /^(?:Error Code\s+)?([A-Za-z][A-Za-z0-9_.-]{0,95})\s*:/iu.exec(trimmed);
    if (prefix) code(prefix[1], trusted);
    if (trusted) {
      // The SDK HTTP formatter preserves `503: body` or `Provider API error (503): body`.
      const status = /^(?:HTTP(?:\/\d(?:\.\d)?)?\s+)?([1-5]\d{2})(?:\s*:|\s+[A-Za-z])/iu.exec(trimmed)
        ?? /^[^()\n]{1,100} API error\s*\(([1-5]\d{2})\)\s*:/iu.exec(trimmed);
      if (status) retainStatus(Number(status[1]));
    }
    const start = trimmed.search(/[{[]/u);
    const json = start >= 0 ? trimmed.slice(start) : undefined;
    if (json) {
      try { visit(JSON.parse(json), depth + 1, trusted); }
      catch { incomplete = true; }
    } else if (trusted) temporaryTexts.add(prefix ? trimmed.slice(prefix[0].length).trim() : value);
  }
  function visit(value, depth, trusted) {
    if (!value || typeof value !== 'object') return;
    const mask = trusted ? 2 : 1;
    if ((seen.get(value) ?? 0) & mask) return;
    if (depth > 8 || ++nodes > 256) { incomplete = true; return; }
    seen.set(value, (seen.get(value) ?? 0) | mask);
    if (trusted) for (const key of ['status', 'status_code', 'statusCode', 'http_status', 'httpStatusCode']) retainStatus(value[key]);
    for (const key of CODE_FIELDS) if (typeof value[key] === 'string') {
      text(value[key], depth, false); code(value[key], trusted);
    }
    for (const key of TEXT_FIELDS) if (typeof value[key] === 'string') text(value[key], depth, trusted);
    for (const [key, nested] of Object.entries(value)) {
      const childTrusted = trusted && (containers.has(key) || Array.isArray(value));
      if (nested && typeof nested === 'object') visit(nested, depth + 1, childTrusted);
      else if (childTrusted && typeof nested === 'string') text(nested, depth + 1, true);
    }
  }
  visit({ code: failure.code, message: failure.message, type: failure.type, status: failure.status }, 0, true);
  const normalizeTexts = values => [...values].map(value => value.toLowerCase().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ')).join('\n');
  return { codes, temporaryCodes, text: normalizeTexts(texts), temporaryText: normalizeTexts(temporaryTexts), statuses, incomplete };
}

function permanentTextReason(text) {
  if (/api key\s*(?:(?:5小时|日|7天)限额已用完|额度已用完)/u.test(text)) return 'quota';
  if (/\b(?:(?:daily|weekly|monthly|annual|yearly|5h|1d|7d) (?:usage|spending|consumption|quota|budget) (?:limit )?(?:exceeded|exhausted|reached)|(?:usage|spending) (?:hard )?limit (?:exceeded|exhausted|reached))\b/u.test(text)) return 'quota';
  if (/\b(?:image generation is not (?:enabled|allowed) for (?:this|the) group|feature (?:is )?disabled for (?:this|the) group)\b/u.test(text)) return 'permission';
  if (/\b(?:(?:oauth|access|refresh|bearer) token (?:is |has )?(?:invalid|expired|revoked|missing)|upstream auth(?:entication|orization)? (?:has |is )?(?:failed|expired|denied|invalid))\b/u.test(text)) return 'authentication';
  if (/\b(?:not implemented|http version not supported|unsupported api (?:endpoint|version))\b/u.test(text)) return 'request-configuration';
  if (/\b(?:content policy (?:violation|error)|policy violation|safety (?:policy violation|refusal|violation)|prohibited content|(?:blocked|rejected|refused) (?:by|due to|under) (?:(?:the|a|our) )?(?:content filter|content policy)|content filter\s*:\s*(?:blocked|rejected|refused))\b|内容(?:审核|审查|过滤|安全(?:策略|政策)?)[^\n]{0,16}(?:拦截|阻止|拒绝|不通过|未通过)|(?:违反|触发)[^\n]{0,12}(?:内容政策|内容安全策略|安全政策)|违规内容|内容不合规/u.test(text)) return 'content-restriction';
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

function providerOverloadEvidence(evidence) {
  const text = evidence.temporaryText;
  if (/\b(?:not overloaded|no overload|overload protection is disabled)\b/u.test(text)) return false;
  if (['OVERLOADED_ERROR', 'SERVER_IS_OVERLOADED', 'SLOW_DOWN'].some(code => evidence.temporaryCodes.has(code))) return true;
  return evidence.temporaryCodes.has('SERVER_ERROR')
    && /\b(?:our servers? (?:are|is) (?:(?:currently|temporarily) )?overloaded|(?:the )?(?:servers?|service) (?:are|is) (?:(?:currently|temporarily) )?overloaded|(?:^|\n)\s*(?:temporarily overloaded|(?:please )?slow down(?: your requests)?))(?:[.!,:;\s]|$)/u.test(text);
}

const NON_MODEL_ERROR_CODES = new Set(['REQUEST_ERROR', 'SCHEMA_ERROR', 'SCHEMA_VALIDATION_ERROR', 'VALIDATION_ERROR', 'TOOL_ERROR', 'TOOL_EXECUTION_ERROR', 'BUSINESS_ERROR', 'BUSINESS_RULE_ERROR', 'PENDING', 'DEFERRED', 'INCOMPLETE']);
const SPECIFIC_TRANSIENT_CODES = new Map([
  ['TIMEOUT', 'timeout'], ['TIMEOUT_ERROR', 'timeout'], ['REQUEST_TIMEOUT', 'timeout'],
  ['GATEWAY_TIMEOUT', 'timeout'], ['STREAM_IDLE_TIMEOUT', 'timeout'], ['STREAM_TIMEOUT', 'timeout'], ['FIRST_OUTPUT_TIMEOUT', 'timeout'], ['ETIMEDOUT', 'timeout'],
  ['UND_ERR_CONNECT_TIMEOUT', 'timeout'], ['UND_ERR_HEADERS_TIMEOUT', 'timeout'], ['UND_ERR_BODY_TIMEOUT', 'timeout'],
  ['ECONNRESET', 'transport-reset'], ['EPIPE', 'transport-reset'], ['UND_ERR_SOCKET', 'transport-reset'],
  ['EAI_AGAIN', 'temporary-dns'], ['EMPTY_RESPONSE', 'empty-response'], ['STREAM_CLOSED', 'stream-closed'],
  ['UPSTREAM_HTTP2_STREAM_ERROR', 'transport-reset'], ['UPSTREAM_STREAM_READ_ERROR', 'transport-reset'], ['UPSTREAM_STREAM_TRUNCATED', 'transport-reset'],
]);

function positiveMilliseconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? Math.ceil(value) : undefined;
}

/** Classify structured provider failures conservatively; ambiguous failures stop. */
export function classifyFailure(failure, { nowMs = Date.now() } = {}) {
  // Native failures retain only these normalized fields, not SDK headers/cause.
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
  if (permanentReason === 'model-unavailable' && /\bpi ai deferred response[^\n]*not supported\b/u.test(evidence.text)) return result('unknown', 'non-model-or-unsupported-failure');
  if (permanentReason) return result('permanent', permanentReason);
  const statuses = evidence.statuses;
  if (statuses.has(401) || statuses.has(403) || statuses.has(407)) return result('permanent', statuses.has(403) ? 'permission' : 'authentication');
  if (statuses.has(402)) return result('permanent', 'quota');
  if ([400, 413, 415, 422].some(status => statuses.has(status))) return result('permanent', 'invalid-request');
  if (statuses.has(404) || statuses.has(410)) return result('permanent', 'model-or-endpoint-not-found');
  if (statuses.has(501) || statuses.has(505)) return result('permanent', 'request-configuration');
  if (evidence.incomplete) return result('unknown', 'incomplete-failure-details');
  if (['ABORTED', 'ABORT_ERR', 'CANCELED', 'CANCELLED', 'CONTEXT_CANCELED'].some(value => evidence.codes.has(value)) || failure.name === 'AbortError' || /\bcontext cancel(?:l)?ed\b/u.test(evidence.text)) return result('unknown', 'aborted');
  if ([...evidence.codes].some(value => NON_MODEL_ERROR_CODES.has(value))
    || /\b(?:pi ai (?:stream[^\n]*ended pending|deferred response[^\n]*not supported)|(?:stream|response|request) (?:is |was |ended )?(?:pending|deferred)|deferred response|request error|schema (?:validation )?(?:error|failed)|tool (?:execution|call) (?:error|failed)|business (?:rule )?(?:error|failed))\b/u.test(evidence.text)) return result('unknown', 'non-model-or-unsupported-failure');
  // An explicit incompatible HTTP response cannot be overridden by a broad
  // SERVER code, a gateway prefix or words such as "please retry later".
  if ([...statuses].some(status => status >= 400 && ![408, 429, 500, 502, 503, 504].includes(status))) return result('unknown', 'unrecognized-http-status');
  if (/\b(?:econnrefused|connection refused|enetunreach|ehostunreach|certificate|tls certificate|ssl certificate)\b/u.test(evidence.text)) return result('unknown', 'ambiguous-transport-failure');
  const text = evidence.temporaryText;
  const hasCode = (...values) => values.some(value => evidence.temporaryCodes.has(value));
  const temporaryBillingService = hasCode('BILLING_SERVICE_ERROR') && /\bbilling service (?:is )?temporarily unavailable\b/u.test(text);
  const temporaryAuthService = hasCode('API_KEY_AUTH_OVERLOADED') && /\bapi key authentication (?:is )?temporarily unavailable\b/u.test(text);
  const rateWindow = hasCode('GATEWAY_RATE_LIMIT', 'RATE_LIMIT', 'RATE_LIMIT_ERROR', 'RATE_LIMIT_EXCEEDED') && /\b(?:per (?:second|minute)|rpm|tpm)\b/u.test(text);
  const quotaHint = /\b(?:quota|billing|credits?|balance|budget)\b|额度|配额|余额|计费/u.test(evidence.text);
  if (quotaHint && !temporaryBillingService && !rateWindow) return result('unknown', 'ambiguous-quota-failure');
  if (temporaryBillingService || temporaryAuthService) return result('transient', 'server-error');
  const retryHint = /\b(?:please )?(?:retry|try again)(?: later| shortly| after| soon)?\b|稍后重试|临时|暂时/u.test(text);
  const concurrency = /\b(?:too many (?:concurrent|simultaneous|pending) requests|concurr(?:ent|ency) (?:request )?limit (?:exceeded|reached)|concurr(?:ent|ency) (?:request )?capacity (?:exceeded|reached))\b|并发(?:数|请求)?[^\n]{0,20}(?:限制|过多|超限)/u.test(text);
  const gatewayConcurrency = hasCode('GATEWAY_CONCURRENCY_LIMIT', 'GATEWAY_QUEUE_FULL');
  if (concurrency && (retryHint || gatewayConcurrency || hasCode('RATE_LIMIT', 'RATE_LIMIT_ERROR', 'RATE_LIMIT_EXCEEDED') || /\btoo many (?:concurrent|simultaneous) requests\b/u.test(text))) return result('transient', 'concurrency-limit');
  const temporaryRate = /\b(?:rate limit (?:exceeded|error)|requests per (?:second|minute))\b|\b(?:temporary|temporarily)\b[^\n]{0,80}\b(?:rate limit|too many requests)\b|\b(?:rate limit|too many requests)\b[^\n]{0,80}\b(?:temporary|temporarily|try again|retry|per second|per minute)\b|请求频率过高|临时限流/u.test(text);
  if (statuses.has(429) || hasCode('RATE_LIMIT', 'RATE_LIMIT_ERROR', 'RATE_LIMIT_EXCEEDED', 'GATEWAY_RATE_LIMIT')) {
    return temporaryRate || retryAfterMs > 0 ? result('transient', 'rate-limit') : result('unknown', 'ambiguous-rate-limit');
  }
  if (statuses.has(408) || statuses.has(504)) return result('transient', 'timeout');
  if ((statuses.has(502) || statuses.has(503)) && !hasCode('UPSTREAM_ERROR')) return result('transient', 'server-error');
  if (statuses.has(500)) {
    return hasCode('SERVER', 'SERVER_ERROR', 'INTERNAL_SERVER_ERROR', 'API_ERROR')
      ? result('transient', 'server-error') : result('unknown', 'unclassified-http-500');
  }
  if (hasCode('OPENAI_SILENT_REFUSAL') && /\bempty completion without usage\b/u.test(text)) return result('transient', 'empty-response');
  if (providerOverloadEvidence(evidence)) return result('transient', 'server-overloaded');
  if (temporaryRate) return result('transient', 'rate-limit');
  for (const [specific, reason] of SPECIFIC_TRANSIENT_CODES) if (evidence.temporaryCodes.has(specific)) return result('transient', reason);
  if (TRANSIENT_CODES.has(code)) return result('transient', TRANSIENT_CODES.get(code));
  if (/\b(?:(?:stream|socket|read|response|request|connection|connect) (?:idle )?(?:timeout|timed out)|etimedout|stream idle timeout)\b/u.test(text)) return result('transient', 'timeout');
  if (/\b(?:econnreset|epipe|connection reset by peer|broken pipe|socket hang ?up|(?:stream|connection) (?:closed|ended) (?:unexpectedly|prematurely))\b/u.test(text)) return result('transient', 'transport-reset');
  if (/\beai again\b|\btemporary failure in name resolution\b/u.test(text)) return result('transient', 'temporary-dns');
  if (hasCode('UPSTREAM_ERROR')) return result('unknown', 'unclassified-upstream-failure');
  if (/\b(?:temporarily unavailable|server overloaded|service unavailable|bad gateway|gateway timeout)\b/u.test(text)) return result('transient', 'server-error');
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

/** Read the current-version native policy/projection without changing its budget. */
function nativeRetrySnapshot(ctx, payload) {
  const policy = payload?.retryPolicy;
  const unavailable = reason => ({ available: false, reason, nativeRetryCount: null, maxRetries: Number.isSafeInteger(policy?.maxRetries) && policy.maxRetries >= 0 ? policy.maxRetries : null });
  if (policy === undefined || policy === null) return unavailable('native-policy-missing');
  if (policy.mode !== 'normal') return unavailable('native-policy-unsupported');
  if (!Number.isSafeInteger(policy.maxRetries) || policy.maxRetries < 0
    || !Array.isArray(policy.retryableCodes) || policy.retryableCodes.length === 0
    || !policy.retryableCodes.every(code => typeof code === 'string' && code.length > 0)
    || new Set(policy.retryableCodes).size !== policy.retryableCodes.length
    || !Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs <= 0 || policy.initialDelayMs > MAX_TIMER_DELAY_MS
    || !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs <= 0 || policy.maxDelayMs > MAX_TIMER_DELAY_MS
    || policy.initialDelayMs > policy.maxDelayMs
    || !Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) return unavailable('native-policy-invalid');
  if (typeof payload.provider !== 'string' || !payload.agent?.session) return unavailable('native-state-unavailable');
  const policyKey = JSON.stringify([
    policy.mode, policy.maxRetries, [...policy.retryableCodes].sort(),
    policy.initialDelayMs, policy.maxDelayMs, policy.jitterRatio,
  ]);
  const stateKey = JSON.stringify([payload.provider, policyKey]);
  try {
    const state = ctx.sessionProjections.stateOf(payload.agent.session, 'llmRetry');
    if (!state || typeof state !== 'object' || Array.isArray(state)) return unavailable('native-state-unavailable');
    const prototype = Object.getPrototypeOf(state);
    if (prototype !== Object.prototype && prototype !== null) return unavailable('native-state-unavailable');
    // The v1 native projection is Record<string, { retry: nonnegative int, retryId: string }>.
    // Do not interpret a partial/newer/malformed object as a registered empty budget.
    for (const entry of Object.values(state)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(entry))
        || !Object.hasOwn(entry, 'retry') || !Number.isSafeInteger(entry.retry) || entry.retry < 0
        || !Object.hasOwn(entry, 'retryId') || typeof entry.retryId !== 'string'
        || Object.keys(entry).some(key => key !== 'retry' && key !== 'retryId')) return unavailable('native-state-unavailable');
    }
    const entry = Object.hasOwn(state, stateKey) ? state[stateKey] : undefined;
    return { available: true, policy, nativeRetryCount: entry?.retry ?? 0, maxRetries: policy.maxRetries };
  } catch {
    return unavailable('native-state-unavailable');
  }
}

/** Strict budget-only API: a native early delegation is not exhaustion. */
export function nativeExhausted(ctx, payload) {
  const native = nativeRetrySnapshot(ctx, payload);
  return native.available && native.nativeRetryCount >= native.maxRetries;
}

/**
 * Explain whether an unhandled normal-policy failure has reached a guardian
 * handoff boundary. Callers must await next() first and preserve any decision.
 * This is intentionally coupled to NATIVE_RETRY_COMPATIBILITY, not an inferred
 * promise that every downstream next() means the native budget was exhausted.
 */
export function nativeRetryDisposition(ctx, payload) {
  const native = nativeRetrySnapshot(ctx, payload);
  const decision = (eligible, reason) => ({ eligible, reason, nativeRetryCount: native.nativeRetryCount, maxRetries: native.maxRetries });
  if (!native.available) return decision(false, native.reason);
  if (typeof payload.failure?.code !== 'string' || payload.failure.code.length === 0) return decision(false, 'native-failure-invalid');
  if (native.nativeRetryCount >= native.maxRetries) return decision(true, 'native-budget-exhausted');
  // Match raw code membership, exactly as native normal does; normalization here
  // could accidentally claim a code the original strategy would still handle.
  if (!native.policy.retryableCodes.includes(payload.failure.code)) return decision(true, 'native-code-not-retryable');
  const retryAfter = payload.failure.providerRetryAfterMs;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter > native.policy.maxDelayMs) return decision(true, 'native-retry-after-delegated');
  return decision(false, 'native-budget-remaining');
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
 * Install an outer request-error middleware that always delegates first.
 * Notification hooks may be asynchronous; isEnabled must return a synchronous
 * boolean. isEnabled(sessionId, payload) is rechecked after downstream recovery,
 * durable scheduling and waiting. onSchedule({sessionId, attempt, delayMs,
 * retryAt, failure, reason, handoff, nativeRetryCount, maxRetries, payload,
 * signal}) must persist before resolving. An async host hook must respect signal
 * or its own task revision before committing. onBlocked receives the same native
 * handoff metadata plus {sessionId, kind, reason, failure, payload, signal}; kind
 * 'not-handled' reports an unhandled failure the native boundary cannot yet
 * authorize. Disabled/aborted calls and a non-undefined downstream decision do
 * not publish a guardian observation. onReset receives {sessionId}.
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
    if (decision !== undefined || !sessionId || signal.aborted || !isEnabled(sessionId, payload)) return decision;
    const disposition = nativeRetryDisposition(ctx, payload);
    const handoff = { handoff: disposition.reason, nativeRetryCount: disposition.nativeRetryCount, maxRetries: disposition.maxRetries };
    if (!disposition.eligible) {
      await untilAbort(onBlocked({ sessionId, kind: 'not-handled', reason: disposition.reason, ...handoff, failure: payload.failure, payload, signal }), signal);
      return decision;
    }
    const failure = classifyFailure(payload.failure, { nowMs: now() });
    if (failure.kind !== 'transient') {
      await untilAbort(onBlocked({ sessionId, ...failure, ...handoff, failure: payload.failure, payload, signal }), signal);
      return decision;
    }
    const attempt = (attempts.get(sessionId) ?? 0) + 1;
    attempts.set(sessionId, attempt);
    const delayMs = computeBackoffMs(attempt, { random, retryAfterMs: failure.retryAfterMs });
    const scheduled = await untilAbort(onSchedule({
      sessionId, attempt, delayMs, retryAt: now() + delayMs,
      failure: payload.failure, reason: failure.reason, ...handoff, payload, signal,
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
