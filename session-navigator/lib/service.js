import { createHash } from 'node:crypto';
import { projectionDefinition, foldProjection, buildSummaryInput, parseSummary, SUMMARY_PROMPT, isSubstantiveInput } from './core.js';

export const DEFAULTS = Object.freeze({ provider: 'codex-relay', model: 'gpt-6-luna', autoSummarize: true, debounceMs: 1200, timeoutMs: 20000, concurrency: 2, initialSummaries: 12, failureThreshold: 3, cooldownMs: 60000, maxQueue: 48 });
export class NavigatorError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function resolveConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NavigatorError('invalid-config', 'Expected a configuration object.');
  const c = { ...DEFAULTS, ...value };
  for (const key of Object.keys(c)) if (!(key in DEFAULTS)) throw new NavigatorError('invalid-config', `Unknown setting: ${key}`);
  for (const key of ['provider', 'model']) if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 160) throw new NavigatorError('invalid-config', `Invalid ${key}`);
  if (typeof c.autoSummarize !== 'boolean') throw new NavigatorError('invalid-config', 'autoSummarize must be boolean.');
  for (const [key, min, max] of [['debounceMs', 0, 60000], ['timeoutMs', 100, 120000], ['concurrency', 1, 3], ['initialSummaries', 0, 30], ['failureThreshold', 1, 10], ['cooldownMs', 100, 300000], ['maxQueue', 1, 200]]) {
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) throw new NavigatorError('invalid-config', `Invalid ${key}`);
  }
  return Object.freeze(c);
}
const emptyCache = () => ({ summarySeq: -1, resetSeq: -1, recentTopic: '', recentSummary: '', pastTopics: [], summaryUpdatedAt: 0, lastVisitedAt: 0, paused: false, model: '', fingerprint: '', error: '', errorSeq: -1 });
export function validateCache(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid navigator cache');
  const c = { ...emptyCache(), ...value };
  for (const key of ['summarySeq', 'resetSeq', 'errorSeq']) if (!Number.isSafeInteger(c[key]) || c[key] < -1) throw new Error(`Invalid ${key}`);
  for (const key of ['summaryUpdatedAt', 'lastVisitedAt']) if (!Number.isSafeInteger(c[key]) || c[key] < 0) throw new Error(`Invalid ${key}`);
  if (typeof c.paused !== 'boolean' || !Array.isArray(c.pastTopics) || c.pastTopics.length > 12 || c.pastTopics.some(t => typeof t !== 'string' || t.length > 100)) throw new Error('Invalid navigator cache fields');
  for (const key of ['recentTopic', 'recentSummary', 'model', 'fingerprint', 'error']) if (typeof c[key] !== 'string' || c[key].length > 1200) throw new Error(`Invalid ${key}`);
  return c;
}
export const DOMAIN = { name: 'session_navigator', version: 1, layout: 'per-record', invalidRecords: 'backup-and-skip', tables: { summaries: { valueSchema: { parse: validateCache } } } };
function idOf(args) { const id = args?.sessionId; if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new NavigatorError('invalid-session', 'A sessionId is required.'); return id; }
const keyOf = state => state ? `${state.sourceSeq}:${state.resetSeq ?? -1}` : 'missing';
const summaryValid = (cache, state) => cache.resetSeq === (state.resetSeq ?? -1) && cache.summarySeq <= state.sourceSeq;
const textError = e => String(e?.message || e || 'Summary generation failed').slice(0, 240);

export async function collectSummary(llm, options, timeoutMs, ownerSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([ownerSignal, controller.signal]);
  let timer; let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => reject(signal.reason ?? new Error('Summary request cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => controller.abort(new NavigatorError('summary-timeout', '摘要生成超时，已保留原摘要；可以稍后重试。', 504)), timeoutMs);
    if (signal.aborted) abort();
  });
  const consume = (async () => {
    let text = ''; let finish;
    for await (const chunk of llm.stream({ ...options, signal })) {
      signal.throwIfAborted();
      if (chunk.type === 'text-delta') { text += chunk.text; if (text.length > 10000) throw new Error('Summary output is too long'); }
      else if (chunk.type === 'finish') finish = chunk.reason;
    }
    signal.throwIfAborted();
    if (!finish || finish.kind !== 'stop') throw new Error(finish?.failure?.message || `Summary did not finish normally: ${finish?.kind ?? 'missing finish'}`);
    return text;
  })();
  try { return await Promise.race([consume, deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
}

export class NavigatorService {
  constructor(ctx, table, config = {}) {
    this.ctx = ctx; this.table = table; this.config = resolveConfig(config);
    this.states = new Map(); this.headers = new Map(); this.readErrors = new Map();
    this.timers = new Map(); this.queue = new Map(); this.active = new Map(); this.writes = new Map();
    this.listeners = new Set(); this.revision = 0; this.closed = false; this.lifetime = new AbortController();
    this.catalogAt = 0; this.catalogPromise = null; this.ready = null;
    this.failures = 0; this.cooldownUntil = 0; this.cooldownTimer = null;
  }
  cache(id) { return this.table.get(id) ?? emptyCache(); }
  changed(sessionId) { const frame = { revision: ++this.revision, ...(sessionId ? { sessionId } : {}) }; for (const fn of this.listeners) { try { fn(frame); } catch {} } }
  subscribe(fn) { if (this.closed) throw new NavigatorError('unloading', 'Plugin is unloading.', 503); this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async write(id, mutate) {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => { const value = validateCache(mutate(this.cache(id))); await this.table.put(id, value); return value; });
    this.writes.set(id, next);
    try { return await next; } finally { if (this.writes.get(id) === next) this.writes.delete(id); }
  }
  metadata() {
    const workspaces = this.ctx.workspaceRegistry.list();
    const bySession = new Map();
    for (const w of workspaces) for (const id of w.sessionIds) bySession.set(id, { workspaceId: w.id, workspaceTitle: w.title });
    return { workspaces: workspaces.map(w => ({ id: w.id, title: w.title })), bySession, archived: new Set(this.ctx.workspaceRegistry.archivedSessionIds ?? []) };
  }
  async state(id, signal = this.lifetime.signal) {
    signal.throwIfAborted();
    const live = this.ctx.sessions.get(id);
    if (live) {
      if (live.header.origin === 'subagent') throw new NavigatorError('unsupported-session', 'Choose an ordinary session.');
      const state = this.ctx.sessionProjections.stateOf(live, projectionDefinition.key);
      if (state) { this.states.set(id, state); this.headers.set(id, live.header); return state; }
    }
    if (this.states.has(id)) return this.states.get(id);
    const observed = await this.ctx.sessionQuery.observeSession(id, { signal, projectionMode: 'none' });
    try {
      if (observed.header.origin === 'subagent') throw new NavigatorError('unsupported-session', 'Choose an ordinary session.');
      const state = foldProjection(observed.events, observed.header, observed.inheritedEventCount);
      this.states.set(id, state); this.headers.set(id, observed.header); return state;
    } finally { observed[Symbol.dispose](); }
  }
  async catalog() {
    if (this.closed) throw new NavigatorError('unloading', 'Plugin is unloading.', 503);
    if (this.catalogPromise) return this.catalogPromise;
    if (this.catalogAt && Date.now() - this.catalogAt < 5000) return;
    this.catalogPromise = (async () => {
      const records = await this.ctx.sessionQuery.listSessions(this.lifetime.signal);
      const retained = new Set();
      const cold = [];
      for (const record of records) {
        if (record.header.origin === 'subagent') continue;
        const id = record.header.id; retained.add(id); this.headers.set(id, record.header);
        if (!this.states.has(id) && !this.readErrors.has(id)) cold.push(id);
      }
      for (const id of this.headers.keys()) if (!retained.has(id) && !this.ctx.sessions.get(id)) { this.headers.delete(id); this.states.delete(id); }
      const worker = async () => { while (cold.length && !this.closed) { const id = cold.shift(); try { await this.state(id); } catch (e) { if (!this.closed) this.readErrors.set(id, textError(e)); } } };
      await Promise.all([worker(), worker(), worker()]);
      this.catalogAt = Date.now();
    })();
    try { await this.catalogPromise; } finally { this.catalogPromise = null; }
  }
  start() {
    this.ready = this.catalog().then(() => {
      if (!this.config.autoSummarize || this.closed) return;
      const meta = this.metadata();
      const ids = [...this.states.keys()].filter(id => !meta.archived.has(id)).sort((a, b) => (this.states.get(b).updatedAt ?? 0) - (this.states.get(a).updatedAt ?? 0)).slice(0, this.config.initialSummaries);
      for (const id of ids) this.schedule(id);
      this.changed();
    }).catch(e => { if (!this.closed) { this.startError = textError(e); this.changed(); } });
    return this.ready;
  }
  row(id, meta = this.metadata()) {
    const state = this.states.get(id); const header = this.headers.get(id); if (!header) return null;
    const cache = this.cache(id); const valid = state && summaryValid(cache, state);
    const hasSummary = valid && Boolean(cache.recentTopic);
    let status = hasSummary ? cache.summarySeq < state.sourceSeq ? 'stale' : 'ready' : 'empty';
    if (this.timers.has(id) || this.queue.has(id)) status = 'queued';
    if (this.active.has(id)) status = 'generating';
    const error = this.readErrors.get(id) || ((cache.errorSeq === state?.sourceSeq) ? cache.error : '');
    if (error && status !== 'generating' && status !== 'queued') status = 'error';
    return {
      sessionId: id, title: state?.title || state?.latestQuestion?.slice(0, 60) || '', ...meta.bySession.get(id),
      createdAt: header.createdAt, updatedAt: state?.updatedAt || header.createdAt, lastVisitedAt: cache.lastVisitedAt,
      latestQuestion: state?.latestQuestion || '', latestQuestionAt: state?.latestQuestionAt || 0, latestQuestionSeq: state?.latestQuestionSeq ?? -1,
      sourceSeq: state?.sourceSeq ?? -1, summarySeq: hasSummary ? cache.summarySeq : -1,
      recentTopic: hasSummary ? cache.recentTopic : '', recentSummary: hasSummary ? cache.recentSummary : '',
      pastTopics: hasSummary ? cache.pastTopics.slice(0, 3) : [], summaryUpdatedAt: hasSummary ? cache.summaryUpdatedAt : 0,
      status, ...(error ? { error } : {}), paused: cache.paused, archived: meta.archived.has(id), model: this.config.model,
    };
  }
  async list(args = {}, signal = this.lifetime.signal) {
    signal.throwIfAborted(); await this.catalog(); signal.throwIfAborted();
    const query = typeof args.query === 'string' ? args.query.trim().toLocaleLowerCase() : '';
    if (query.length > 512) throw new NavigatorError('invalid-query', 'Query exceeds 512 characters.');
    const offset = args.offset ?? 0; const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new NavigatorError('invalid-page', 'Invalid offset or limit.');
    if (args.sort && !['visited', 'updated'].includes(args.sort)) throw new NavigatorError('invalid-sort', 'Unknown sort.');
    const meta = this.metadata();
    let rows = [...this.headers.keys()].map(id => this.row(id, meta)).filter(row => row && (args.includeArchived || !row.archived) && (!args.workspaceId || row.workspaceId === args.workspaceId));
    if (query) rows = rows.filter(row => [row.title, row.latestQuestion, row.recentTopic, row.recentSummary, ...row.pastTopics].some(v => v.toLocaleLowerCase().includes(query)));
    rows.sort((a, b) => ((args.sort ?? 'visited') === 'visited' ? b.lastVisitedAt - a.lastVisitedAt : 0) || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    return { ok: true, items: rows.slice(offset, offset + limit), total: rows.length, ...(offset + limit < rows.length ? { nextOffset: offset + limit } : {}), workspaces: meta.workspaces, settings: { provider: this.config.provider, model: this.config.model, autoSummarize: this.config.autoSummarize }, ...(this.startError ? { warning: this.startError } : {}) };
  }
  async get(args, signal = this.lifetime.signal) {
    const id = idOf(args); await this.state(id, signal);
    return { ok: true, item: this.row(id) };
  }
  async touch(args, signal = this.lifetime.signal) {
    const id = idOf(args); await this.state(id, signal);
    if (Date.now() - this.cache(id).lastVisitedAt > 1000) { await this.write(id, c => ({ ...c, lastVisitedAt: Date.now() })); this.changed(id); }
    if (this.config.autoSummarize) this.schedule(id);
    return { ok: true, item: this.row(id) };
  }
  async pause(args, signal = this.lifetime.signal) {
    const id = idOf(args); if (typeof args.paused !== 'boolean') throw new NavigatorError('invalid-pause', 'paused must be boolean.');
    await this.state(id, signal); await this.write(id, c => ({ ...c, paused: args.paused }));
    if (args.paused) { clearTimeout(this.timers.get(id)); this.timers.delete(id); this.queue.delete(id); this.active.get(id)?.controller.abort(); }
    else if (this.config.autoSummarize) this.schedule(id);
    this.changed(id); return { ok: true, item: this.row(id) };
  }
  async refresh(args, signal = this.lifetime.signal) {
    const id = idOf(args); this.readErrors.delete(id); await this.state(id, signal);
    const queued = this.schedule(id, true);
    return { ok: true, item: this.row(id), status: queued ? 'queued' : 'unchanged' };
  }
  onProjection(session, key) {
    if (this.closed || key !== projectionDefinition.key || session.header.origin === 'subagent') return;
    const state = this.ctx.sessionProjections.stateOf(session, key); if (!state) return;
    const old = this.states.get(session.id);
    this.headers.set(session.id, session.header); this.states.set(session.id, state); this.catalogAt = 0;
    this.changed(session.id);
    if (this.config.autoSummarize && state.turnEnded && state.lastTurnEndSeq !== old?.lastTurnEndSeq) this.schedule(session.id);
  }
  schedule(id, force = false) {
    if (this.closed) return false;
    const state = this.states.get(id); const cache = this.cache(id);
    if (!state || !state.latestQuestion || (cache.paused && !force) || this.metadata().archived.has(id)) return false;
    if (!force && summaryValid(cache, state) && cache.summarySeq >= state.sourceSeq && cache.model === this.config.model) return false;
    if (!force && cache.errorSeq === state.sourceSeq) return false;
    if (!force && cache.recentTopic && !isSubstantiveInput(state.latestQuestion)) return false;
    if (this.active.has(id)) {
      const active = this.active.get(id);
      if (active.version !== keyOf(state) || active.controller.signal.aborted) {
        if (!this.queue.has(id) && this.queue.size >= this.config.maxQueue) {
          if (force) throw new NavigatorError('queue-full', '摘要队列繁忙，请稍后重试。', 429);
          return false;
        }
        this.queue.set(id, { force: force || this.queue.get(id)?.force || false });
      }
      return true;
    }
    if (!this.queue.has(id) && this.queue.size >= this.config.maxQueue) {
      if (force) throw new NavigatorError('queue-full', '摘要队列繁忙，请稍后重试。', 429);
      return false;
    }
    const existing = this.queue.get(id); this.queue.set(id, { force: force || existing?.force || false });
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.pump(); }, force ? 0 : this.config.debounceMs));
    this.changed(id); return true;
  }
  pump() {
    if (this.closed) return;
    for (const [id, options] of this.queue) {
      if (this.active.size >= this.config.concurrency) break;
      if (this.timers.has(id) || this.active.has(id)) continue;
      if (Date.now() < this.cooldownUntil && !options.force) continue;
      this.queue.delete(id);
      const controller = new AbortController();
      const job = { controller, promise: null, version: keyOf(this.states.get(id)) }; this.active.set(id, job);
      job.promise = this.generate(id, controller, options.force).catch(error => {
        if (!this.closed) this.readErrors.set(id, textError(error));
      }).finally(() => { this.active.delete(id); this.changed(id); this.pump(); });
      this.changed(id);
    }
  }
  async generate(id, controller, force = false) {
    const state = this.states.get(id); if (!state || (this.cache(id).paused && !force)) return;
    const version = keyOf(state); const previous = this.cache(id);
    const input = buildSummaryInput(state, summaryValid(previous, state) ? { ...previous, sessionId: id, sourceSeq: previous.summarySeq } : undefined);
    const fingerprint = createHash('sha256').update(JSON.stringify([this.config.provider, this.config.model, input])).digest('hex');
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal]);
    try {
      const text = await collectSummary(this.ctx.llm, { provider: this.config.provider, model: this.config.model, system: SUMMARY_PROMPT, messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(input) }] }], tools: [], maxTokens: 2048 }, this.config.timeoutMs, signal);
      const parsed = parseSummary(text);
      this.failures = 0; this.cooldownUntil = 0; clearTimeout(this.cooldownTimer);
      // Never publish an older request over a newer question, reset, pause or unload.
      if (this.closed || (this.cache(id).paused && !force) || keyOf(this.states.get(id)) !== version) return;
      await this.write(id, c => {
        if ((c.paused && !force) || this.closed || keyOf(this.states.get(id)) !== version) return c;
        return { ...c, ...parsed, summarySeq: state.sourceSeq, resetSeq: state.resetSeq ?? -1, summaryUpdatedAt: Date.now(), model: this.config.model, fingerprint, error: '', errorSeq: -1 };
      });
    } catch (error) {
      if (!this.closed && !controller.signal.aborted) {
        this.failures++;
        if (this.failures >= this.config.failureThreshold) {
          this.cooldownUntil = Date.now() + this.config.cooldownMs;
          clearTimeout(this.cooldownTimer);
          this.cooldownTimer = setTimeout(() => { this.cooldownUntil = 0; this.pump(); this.changed(); }, this.config.cooldownMs);
        }
        if ((force || !this.cache(id).paused) && keyOf(this.states.get(id)) === version) {
          await this.write(id, c => ({ ...c, error: textError(error), errorSeq: state.sourceSeq })).catch(() => {});
        }
      }
    }
  }
  async dispose() {
    this.closed = true; this.lifetime.abort(); clearTimeout(this.cooldownTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.queue.clear();
    for (const job of this.active.values()) job.controller.abort();
    this.changed(); this.listeners.clear();
    await Promise.allSettled([this.ready, this.catalogPromise, ...[...this.active.values()].map(j => j.promise), ...this.writes.values()].filter(Boolean));
  }
}
