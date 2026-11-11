import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import {
  AskError, BOUNDARY_SOURCE, applyStreamFrame, boundaryText, captureConfig, foldMessages, forkSeed,
  normalizeAnswer, normalizeImages, normalizeModel, normalizeQuestion, normalizeSelection, publicQuestions, publicThread, requiredId, titleFrom, clip,
} from './context.js';

export const SESSION_PREFIX = 'selection-ask-';
/** Hard upper bound of one long-poll view request; far below the Desktop 10 s drain wait. */
export const VIEW_WAIT_MAX_MS = 2500;
export const DEFAULTS = Object.freeze({ idleMs: 10 * 60_000, maxThreadsPerSource: 50, streamThrottleMs: 120 });

export function validateThread(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid selection-ask thread');
  for (const key of ['id', 'requestId', 'sourceSessionId', 'sessionId', 'title']) if (typeof value[key] !== 'string') throw new Error(`Invalid ${key}`);
  if (!value.sessionId.startsWith(SESSION_PREFIX)) throw new Error('Invalid hidden session id');
  if (!Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) throw new Error('Invalid thread timestamps');
  if (value.cwd !== undefined && value.cwd !== null && typeof value.cwd !== 'string') throw new Error('Invalid cwd');
  if (value.model !== null && value.model !== undefined && (typeof value.model?.provider !== 'string' || typeof value.model?.model !== 'string')) throw new Error('Invalid model');
  return { ...value, selection: normalizeSelection(value.selection) };
}

export const DOMAIN = Object.freeze({
  name: 'selection_ask', version: 1, layout: 'per-record', invalidRecords: 'backup-and-skip',
  tables: { threads: { valueSchema: { parse: validateThread } } },
});

/** Resolve the persisted session directory only when it is exactly this hidden session. */
export function artifactDirectory(sessionId, location) {
  const path = location?.path;
  if (typeof path !== 'string' || !isAbsolute(path) || typeof sessionId !== 'string' || !sessionId.startsWith(SESSION_PREFIX)) return undefined;
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return undefined;
  const dir = dirname(path);
  return basename(dir) === sessionId ? dir : undefined;
}

const modelOptions = model => model ? { provider: model.provider, model: model.model, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) } : {};
const errorText = error => clip(String(error?.message ?? error ?? 'Unknown error'), 600);

/**
 * Select a Session-local model for the agent's next request.
 * DSH >= 0.2.2 exposes `agent.model.select`; 0.2.1 records the choice through
 * the session controller (`model/selection` event). Global defaults are untouched.
 * @returns true when a selection was installed, false when this runtime offers neither.
 */
export function selectAgentModel(ctx, agent, model) {
  if (typeof agent?.model?.select === 'function') { agent.model.select(model); return true; }
  const controller = ctx.get?.('sessionController')?.agents;
  if (typeof controller?.selectForNextRequest === 'function') { controller.selectForNextRequest(agent, model); return true; }
  return false;
}

/** The agent's Session-local model choice ({provider, model, reasoningEffort?}) on DSH 0.2.1 and 0.2.2+, or undefined. */
export function currentAgentModel(ctx, agent) {
  try {
    if (typeof agent?.model?.current === 'function') return agent.model.current() ?? undefined;
    const current = ctx.get?.('sessionController')?.agents?.selectionFor?.(agent)?.current;
    return current?.provider && current?.model ? current : undefined;
  } catch { return undefined; }
}

/**
 * Owns hidden selection threads. Each thread is a persisted session with
 * `origin: 'subagent'` and no parent, so neither the workspace list nor a
 * parent's subagent catalog shows it; this plugin's table is its only index.
 */
export class SelectionAskService {
  constructor(ctx, table, options = {}) {
    this.ctx = ctx; this.table = table; this.options = { ...DEFAULTS, ...options };
    this.lifetime = new AbortController(); this.closed = false;
    this.epoch = randomUUID().slice(0, 8);
    this.live = new Map(); this.starting = new Map(); this.creating = new Map();
    this.revisions = new Map(); this.waiters = new Map(); this.coldViews = new Map();
    this.streams = new Map(); this.streamTimers = new Map();
    this.interactions = new Map(); this.errors = new Map();
    this.bySession = new Map(); this.byRequest = new Map();
    this.delivered = new WeakSet();
    for (const [id, record] of table.entries()) this.index(id, record);
  }

  records() { return [...this.table.entries()].map(([, record]) => record); }
  index(id, record) { this.bySession.set(record.sessionId, id); this.byRequest.set(record.requestId, id); }
  unindex(record) { this.bySession.delete(record.sessionId); if (this.byRequest.get(record.requestId) === record.id) this.byRequest.delete(record.requestId); }
  threadOfSession(sessionId) { return typeof sessionId === 'string' ? this.bySession.get(sessionId) : undefined; }
  record(threadId) {
    const record = this.table.get(requiredId(threadId, 'threadId'));
    if (!record) throw new AskError('not-found', 'This selection thread no longer exists.', 404);
    return record;
  }
  assertOpen() { if (this.closed) throw new AskError('unloading', 'Selection Ask is unloading.', 503); }
  token(id) { return `${this.epoch}:${this.revisions.get(id) ?? 0}`; }

  bump(id) {
    if (!id) return;
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    this.coldViews.delete(id);
    const waiters = this.waiters.get(id);
    if (!waiters) return;
    this.waiters.delete(id);
    for (const wake of waiters) wake();
  }

  /** Wait for one change, the deadline, cancellation, or unload; always cleans up. */
  waitChange(id, waitMs, signal) {
    return new Promise((resolve, reject) => {
      let timer;
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      const finish = (error) => {
        clearTimeout(timer);
        set.delete(wake);
        if (set.size === 0 && this.waiters.get(id) === set) this.waiters.delete(id);
        signal?.removeEventListener('abort', onAbort);
        this.lifetime.signal.removeEventListener('abort', wake);
        if (error) reject(error); else resolve();
      };
      const wake = () => finish();
      const onAbort = () => finish(new AskError('aborted', 'The request was cancelled.', 499));
      set.add(wake);
      timer = setTimeout(wake, Math.min(VIEW_WAIT_MAX_MS, Math.max(0, waitMs)));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.lifetime.signal.addEventListener('abort', wake, { once: true });
      if (signal?.aborted) onAbort(); else if (this.lifetime.signal.aborted) wake();
    });
  }

  // ---- Host event hooks (must stay synchronous and never throw) -------------
  onSessionEvent(session) { const id = this.threadOfSession(session?.id); if (id) this.bump(id); }
  onStatus({ agent, status } = {}) {
    const id = this.threadOfSession(agent?.id);
    if (!id) return;
    if (status === 'running') { this.errors.delete(agent.id); clearTimeout(this.live.get(id)?.timer); }
    else { this.streams.delete(agent.id); this.cancelStreamBump(id); this.scheduleIdle(id); }
    this.bump(id);
  }
  onStream({ agent, frame } = {}) {
    const id = this.threadOfSession(agent?.id);
    if (!id) return;
    const next = applyStreamFrame(this.streams.get(agent.id) ?? null, frame);
    if (next) this.streams.set(agent.id, next); else this.streams.delete(agent.id);
    if (frame?.type !== 'chunk') { this.cancelStreamBump(id); this.bump(id); return; }
    if (this.streamTimers.has(id)) return;
    const timer = setTimeout(() => { this.streamTimers.delete(id); this.bump(id); }, this.options.streamThrottleMs);
    timer.unref?.();
    this.streamTimers.set(id, timer);
  }
  cancelStreamBump(id) { clearTimeout(this.streamTimers.get(id)); this.streamTimers.delete(id); }
  onError({ agent, error } = {}) {
    const id = this.threadOfSession(agent?.id);
    if (!id) return;
    this.errors.set(agent.id, errorText(error));
    this.bump(id);
  }
  onDisposed({ agent } = {}) {
    const id = this.threadOfSession(agent?.id);
    if (!id) return;
    const entry = this.live.get(id);
    if (entry?.handle.agent === agent) { clearTimeout(entry.timer); this.live.delete(id); }
    this.streams.delete(agent.id);
    this.bump(id);
  }

  /** Add the selection boundary before the first model request of a thread, exactly once. */
  async preStep(payload, next) {
    const agent = payload?.agent;
    const id = this.threadOfSession(agent?.id);
    if (!id) return next();
    const decision = await next();
    if (decision?.kind !== 'enter' || payload.signal?.aborted || !decision.messages?.length || this.delivered.has(agent.session)) return decision;
    const record = this.table.get(id);
    if (!record) return decision;
    const floor = agent.session.inheritedEventCount ?? 0;
    const events = agent.session.snapshotEvents?.(floor) ?? [];
    if (events.some(event => event.seq >= floor && event.type === 'user/message' && event.data?.source?.kind === BOUNDARY_SOURCE)) {
      this.delivered.add(agent.session);
      return decision;
    }
    if (decision.messages.some(message => message.source?.kind === BOUNDARY_SOURCE)) return decision;
    const note = { id: `selection-ask-boundary-${agent.id}`, role: 'user', source: { kind: BOUNDARY_SOURCE }, content: [{ type: 'text', text: boundaryText(record) }] };
    return { ...decision, messages: [note, ...decision.messages] };
  }

  approvalRequest(request, next) {
    const id = this.threadOfSession(request?.agent?.id);
    if (!id) return next();
    return this.park(request.agent.id, id, {
      kind: 'approval', toolName: clip(String(request.toolName ?? ''), 200),
      reason: clip(String(request.displayReason ?? request.reason ?? ''), 2000),
    }, request.signal, { value: 'cancelled' });
  }

  questionRequest(request, next) {
    const id = this.threadOfSession(request?.agent?.id);
    if (!id) return next();
    return this.park(request.agent.id, id, { kind: 'question', questions: publicQuestions(request.questions), raw: request.questions }, request.signal,
      { error: () => Object.assign(new Error('ask_user_question was aborted before the user answered'), { name: 'AbortError' }) });
  }

  /** Hold a human interaction until the thread UI answers it or the request ends. */
  park(sessionId, threadId, info, signal, onAbort) {
    return new Promise((resolve, reject) => {
      const interactionId = randomUUID();
      const map = this.interactions.get(sessionId) ?? new Map();
      this.interactions.set(sessionId, map);
      let settled = false;
      const settle = (value, error) => {
        if (settled) return;
        settled = true;
        map.delete(interactionId);
        if (map.size === 0) this.interactions.delete(sessionId);
        signal?.removeEventListener('abort', aborted);
        this.bump(threadId);
        if (error) reject(error); else resolve(value);
      };
      const aborted = () => onAbort.error ? settle(undefined, onAbort.error()) : settle(onAbort.value);
      const questions = info.raw ? info.raw.map(q => ({ id: String(q.id), multiSelect: q.multiSelect === true, options: q.options ?? [] })) : undefined;
      map.set(interactionId, { id: interactionId, kind: info.kind, toolName: info.toolName, reason: info.reason, questions, display: info.questions, settle, cancel: aborted });
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted(); else this.bump(threadId);
    });
  }

  // ---- Routes ----------------------------------------------------------------
  async create(args) {
    this.assertOpen();
    const requestId = requiredId(args.requestId, 'requestId');
    const known = this.byRequest.get(requestId);
    if (known && this.table.get(known)) return { thread: publicThread(this.table.get(known)) };
    const inflight = this.creating.get(requestId);
    if (inflight) return inflight;
    const sourceSessionId = requiredId(args.sourceSessionId, 'sourceSessionId');
    if (sourceSessionId.startsWith(SESSION_PREFIX)) throw new AskError('invalid-source', 'Ask from an ordinary conversation.');
    const selection = normalizeSelection(args.selection);
    const images = normalizeImages(args.images);
    const question = normalizeQuestion(args.question, { allowEmpty: images.length > 0 });
    const model = normalizeModel(args.model);
    if (model) await this.assertModel(model);
    const promise = this.createThread({ requestId, sourceSessionId, selection, question, images, model });
    this.creating.set(requestId, promise);
    try { return await promise; } finally { this.creating.delete(requestId); }
  }

  async captureSource(sourceSessionId) {
    const ctx = this.ctx;
    const live = ctx.agents.get(sourceSessionId);
    let observed;
    try { observed = await ctx.sessionQuery.observeSession(sourceSessionId); }
    catch (error) { if (!live) throw new AskError('source-unavailable', `The current conversation is unavailable: ${errorText(error)}`, 409); }
    try {
      const events = live?.session?.snapshotEvents?.() ?? observed?.events ?? [];
      const header = live?.session?.header ?? observed?.header ?? {};
      const values = observed?.projections?.values ?? {};
      const fallback = {
        model: ctx.get?.('agentDefaultModel')?.currentSelection?.(),
        sandbox: ctx.get?.('shell')?.sandboxMode,
        approval: ctx.get?.('approval')?.config?.policy,
      };
      const config = captureConfig(events, values, fallback);
      let presetId = values.agentPreset ?? header.agentPreset;
      try { if (observed) presetId = ctx.get?.('sessionController')?.agents?.presetForObservation?.(observed) ?? presetId; } catch {}
      return { ...forkSeed(events), config, cwd: config.cwd ?? header.cwd, presetId: typeof presetId === 'string' ? presetId : undefined };
    } finally { observed?.[Symbol.dispose]?.(); }
  }

  async compose(presetId) {
    const composer = this.ctx.get?.('sessionController')?.agents;
    if (typeof composer?.composeAgent === 'function') return composer.composeAgent(presetId);
    return { ...(presetId ? { agentPreset: presetId } : {}), setup: undefined };
  }

  async createThread({ requestId, sourceSessionId, selection, question, images = [], model }) {
    const source = await this.captureSource(sourceSessionId);
    this.assertOpen();
    if (model) source.config = { ...source.config, model };
    const composition = await this.compose(source.presetId);
    const now = Date.now();
    const record = {
      id: randomUUID(), requestId, sourceSessionId, sessionId: `${SESSION_PREFIX}${randomUUID()}`,
      cwd: source.cwd ?? null, title: titleFrom(question || selection.text), selection, model: source.config.model ?? null,
      agentPreset: composition.agentPreset ?? null, createdAt: now, updatedAt: now,
    };
    await this.table.put(record.id, record);
    this.index(record.id, record);
    let handle;
    try {
      handle = await this.ctx.agents.create({
        sessionId: record.sessionId,
        meta: {
          ...(record.cwd ? { cwd: record.cwd } : {}),
          ...(record.agentPreset ? { agentPreset: record.agentPreset } : {}),
          ...(source.inheritedEventCount > 0 ? { isSeeded: true } : {}),
          origin: 'subagent',
        },
        ...(source.inheritedEventCount > 0 ? { seed: source.seed, inheritedEventCount: source.inheritedEventCount } : {}),
        agentOptions: modelOptions(record.model),
        setup: composition.setup,
      });
      if (this.closed) throw new AskError('unloading', 'Selection Ask is unloading.', 503);
      this.applyConfig(handle.agent, source.config);
      this.live.set(record.id, { handle });
      handle.agent.followup(await this.userMessage(handle.agent, question, images));
    } catch (error) {
      if (handle) await handle.dispose().catch(() => {});
      this.live.delete(record.id);
      this.unindex(record);
      await this.table.delete(record.id).catch(() => {});
      await this.removeArtifact(record);
      throw error instanceof AskError ? error : new AskError('create-failed', `Could not start the side question: ${errorText(error)}`, 500);
    }
    this.ctx.logger?.info?.(`[selection-ask] thread ${record.id} → ${record.sessionId} from ${sourceSessionId} (${selection.kind}, inherited ${source.inheritedEventCount} events)`);
    this.bump(record.id);
    void this.prune(sourceSessionId).catch(error => this.ctx.logger?.warn?.(`[selection-ask] prune failed: ${errorText(error)}`));
    return { thread: publicThread(record) };
  }

  /** Reproduce the source's current model and permission settings on a new idle thread. */
  applyConfig(agent, config) {
    try { agent.inbox?.clear?.(); } catch {}
    const ctx = this.ctx;
    if (config.model) {
      try { selectAgentModel(ctx, agent, config.model); }
      catch (error) { ctx.logger?.warn?.(`[selection-ask] model selection kept default: ${errorText(error)}`); }
    }
    const presets = ctx.get?.('permissionPresets');
    if (config.permissionPreset && presets?.current?.(agent.session) !== config.permissionPreset) presets?.set?.(agent.session, config.permissionPreset);
    if (['read-only', 'workspace-write', 'danger-full-access'].includes(config.sandbox)) agent.session.append('sandbox/mode', { mode: config.sandbox });
    if (['ask', 'never'].includes(config.approval)) agent.session.append('approval/policy', { policy: config.approval });
  }

  /** Build one user message; images are checked against the model and stored like native prompt images. */
  async userMessage(agent, text, images = []) {
    let content = [...(text ? [{ type: 'text', text }] : []), ...images];
    if (images.length) {
      const current = currentAgentModel(this.ctx, agent);
      if (current) {
        const info = await this.ctx.llm?.resolveModelInfo?.(current.provider, current.model).catch(() => undefined);
        if (info?.inputModalities && !info.inputModalities.includes('image')) throw new AskError('model-no-images', `Model "${info.name ?? current.model}" does not support image input.`, 409);
      }
      const attachments = this.ctx.get?.('attachments');
      if (typeof attachments?.admitPromptContent !== 'function') throw new AskError('images-unavailable', 'Image attachments are unavailable in this DSH composition.', 409);
      try { content = await attachments.admitPromptContent(content); }
      catch (error) { throw new AskError('invalid-image', `Image refused: ${errorText(error)}`, 400); }
    }
    return { id: `selection-ask-message-${randomUUID()}`, role: 'user', source: { kind: 'user' }, content };
  }

  /** Native model catalog (cached briefly); failures of one provider never hide the others. */
  catalog() {
    if (this.catalogCache && Date.now() - this.catalogCache.at < 30_000) return Promise.resolve(this.catalogCache.value);
    this.catalogLoading ??= this.loadCatalog().finally(() => { this.catalogLoading = undefined; });
    return this.catalogLoading;
  }
  async loadCatalog() {
    const llm = this.ctx.llm ?? this.ctx.get?.('llm');
    const groups = [];
    if (!llm?.listProviders) { this.catalogCache = { at: Date.now(), value: { groups } }; return { groups }; }
    for (const provider of llm.listProviders()) {
      try {
        const models = await llm.listModels(provider.id);
        const entries = [];
        for (const model of models) {
          let info;
          try { info = await llm.resolveModelInfo(provider.id, model.id); } catch { info = undefined; }
          entries.push({ id: model.id, name: model.name ?? info?.name ?? model.id,
            ...(info?.reasoning ? { efforts: info.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })), defaultEffort: info.reasoning.defaultEffort } : {}),
            images: info?.inputModalities ? info.inputModalities.includes('image') : true });
        }
        if (entries.length) groups.push({ id: provider.id, name: provider.name ?? provider.id, models: entries });
      } catch {}
    }
    const value = { groups };
    this.catalogCache = { at: Date.now(), value };
    return value;
  }
  describeModel(model, catalog) {
    if (!model) return null;
    const entry = catalog?.groups.find(group => group.id === model.provider)?.models.find(item => item.id === model.model);
    const effort = model.reasoningEffort ? entry?.efforts?.find(item => item.id === model.reasoningEffort)?.name ?? model.reasoningEffort : undefined;
    return { ...model, name: entry?.name ?? model.model, ...(effort ? { effortName: effort } : {}), images: entry?.images ?? true };
  }
  async assertModel(model) {
    const catalog = await this.catalog();
    const entry = catalog.groups.find(group => group.id === model.provider)?.models.find(item => item.id === model.model);
    if (!entry) throw new AskError('model-unavailable', `Model ${model.provider}/${model.model} is not available.`, 409);
    if (model.reasoningEffort && entry.efforts && !entry.efforts.some(effort => effort.id === model.reasoningEffort)) throw new AskError('model-unavailable', 'This reasoning effort is not offered by the model.', 409);
  }

  async models(args = {}) {
    const catalog = await this.catalog();
    let current = null;
    if (typeof args.sourceSessionId === 'string' && args.sourceSessionId) {
      try { current = (await this.captureSource(args.sourceSessionId)).config.model ?? null; } catch { current = null; }
    }
    return { ...catalog, current: this.describeModel(current, catalog) };
  }

  /** Switch one thread's model for its next request (session-local; global defaults are untouched). */
  async selectModel(args) {
    this.assertOpen();
    const record = this.record(args.threadId);
    const model = normalizeModel(args.model);
    if (!model) throw new AskError('invalid-request', 'model is required.');
    await this.assertModel(model);
    const agent = await this.ensureAgent(record);
    if (!selectAgentModel(this.ctx, agent, model)) throw new AskError('unsupported-runtime', 'This DSH version cannot switch a session model.', 409);
    await this.table.put(record.id, { ...this.table.get(record.id), model, updatedAt: Date.now() });
    this.bump(record.id);
    return { model: this.describeModel(model, await this.catalog()) };
  }

  liveAgent(record) {
    return this.live.get(record.id)?.handle.agent ?? this.ctx.agents.get(record.sessionId);
  }

  async ensureAgent(record) {
    const live = this.liveAgent(record);
    if (live) return live;
    const pending = this.starting.get(record.id);
    if (pending) return pending;
    const promise = (async () => {
      const composition = await this.compose(record.agentPreset ?? undefined);
      let handle;
      try {
        handle = await this.ctx.agents.resume({ resumeSessionId: record.sessionId, agentOptions: modelOptions(record.model), setup: composition.setup });
      } catch (error) { throw new AskError('thread-unavailable', `Could not reopen this side question: ${errorText(error)}`, 409); }
      if (this.closed) { await handle.dispose().catch(() => {}); throw new AskError('unloading', 'Selection Ask is unloading.', 503); }
      this.live.set(record.id, { handle });
      return handle.agent;
    })();
    this.starting.set(record.id, promise);
    try { return await promise; } finally { this.starting.delete(record.id); }
  }

  scheduleIdle(id) {
    const entry = this.live.get(id);
    if (!entry || this.closed) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.release(id), this.options.idleMs);
    entry.timer.unref?.();
  }

  /** Dispose an idle live thread; its persisted session reopens on the next question. */
  async release(id) {
    const entry = this.live.get(id);
    if (!entry) return;
    const agent = entry.handle.agent;
    if (agent.status === 'running' || this.interactions.get(agent.id)?.size) { this.scheduleIdle(id); return; }
    this.live.delete(id);
    await entry.handle.dispose().catch(error => this.ctx.logger?.warn?.(`[selection-ask] idle release failed: ${errorText(error)}`));
    this.bump(id);
  }

  async prompt(args) {
    this.assertOpen();
    const record = this.record(args.threadId);
    const images = normalizeImages(args.images);
    const question = normalizeQuestion(args.question, { allowEmpty: images.length > 0 });
    const agent = await this.ensureAgent(record);
    agent.followup(await this.userMessage(agent, question, images));
    const updated = { ...record, updatedAt: Date.now() };
    await this.table.put(record.id, updated);
    this.bump(record.id);
    return { ok: true };
  }

  async cancel(args) {
    const record = this.record(args.threadId);
    const agent = this.liveAgent(record);
    if (agent?.status === 'running') agent.cancel({ kind: 'user' });
    return { ok: true };
  }

  async coldFold(record) {
    const token = this.token(record.id);
    const cached = this.coldViews.get(record.id);
    if (cached?.token === token) return cached.fold;
    const observed = await this.ctx.sessionQuery.observeSession(record.sessionId);
    try {
      const floor = observed.inheritedEventCount ?? 0;
      const fold = foldMessages(observed.events, floor);
      this.coldViews.set(record.id, { token, fold });
      return fold;
    } finally { observed[Symbol.dispose]?.(); }
  }

  async snapshot(record) {
    const agent = this.liveAgent(record);
    let fold;
    if (agent) {
      const floor = agent.session.inheritedEventCount ?? 0;
      fold = foldMessages(agent.session.snapshotEvents?.(floor) ?? [], floor);
    } else {
      try { fold = await this.coldFold(record); }
      catch (error) { fold = { messages: [], trimmed: false, turnOpen: false, unavailable: errorText(error) }; }
    }
    const running = agent?.status === 'running';
    const stream = running ? this.streams.get(record.sessionId) : undefined;
    let model = record.model ?? null;
    if (agent) model = currentAgentModel(this.ctx, agent) ?? model;
    // Never let provider model listing delay a long-poll answer; names fill in on the next change.
    const catalog = this.catalogCache?.value;
    if (!catalog && !this.catalogLoading && !this.closed) void this.catalog().then(() => this.bump(record.id), () => {});
    const pending = [...(this.interactions.get(record.sessionId)?.values() ?? [])].map(item => item.kind === 'approval'
      ? { id: item.id, kind: 'approval', toolName: item.toolName, reason: item.reason }
      : { id: item.id, kind: 'question', questions: item.display });
    return {
      revision: this.token(record.id), thread: publicThread(record), running, live: Boolean(agent),
      stream: stream ? { text: stream.text, reasoning: stream.reasoning } : null,
      model: this.describeModel(model, catalog),
      cwd: (() => { try { return agent?.session?.header?.cwd ?? record.cwd ?? null; } catch { return record.cwd ?? null; } })(),
      messages: fold.messages, trimmed: fold.trimmed, pending,
      error: this.errors.get(record.sessionId) ?? fold.unavailable ?? null,
    };
  }

  /** Long-poll: wait at most VIEW_WAIT_MAX_MS for a change after `since`. */
  async view(args, signal) {
    const record = this.record(args.threadId);
    const waitMs = Number.isFinite(args.waitMs) ? Math.min(VIEW_WAIT_MAX_MS, Math.max(0, args.waitMs)) : 0;
    if (waitMs > 0 && args.since === this.token(record.id) && !this.closed) {
      await this.waitChange(record.id, waitMs, signal);
      if (!this.table.get(record.id)) throw new AskError('not-found', 'This selection thread no longer exists.', 404);
    }
    return this.snapshot(this.table.get(record.id) ?? record);
  }

  async list(args = {}) {
    const source = args.sourceSessionId === undefined ? undefined : requiredId(args.sourceSessionId, 'sourceSessionId');
    const rows = this.records()
      .filter(record => source === undefined || record.sourceSessionId === source)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100)
      .map(record => publicThread(record, { running: this.liveAgent(record)?.status === 'running' }));
    return { threads: rows };
  }

  async remove(args) {
    const record = this.record(args.threadId);
    await this.deleteThread(record);
    return { ok: true };
  }

  async clear(args) {
    const source = requiredId(args.sourceSessionId, 'sourceSessionId');
    const records = this.records().filter(record => record.sourceSessionId === source);
    for (const record of records) await this.deleteThread(record);
    return { ok: true, removed: records.length };
  }

  async answer(args) {
    const record = this.record(args.threadId);
    const pending = this.interactions.get(record.sessionId)?.get(requiredId(args.interactionId, 'interactionId'));
    if (!pending) throw new AskError('interaction-gone', 'This request was already answered or withdrawn.', 409);
    pending.settle(normalizeAnswer(pending, args));
    return { ok: true };
  }

  async deleteThread(record) {
    const entry = this.live.get(record.id);
    const agent = entry?.handle.agent ?? this.ctx.agents.get(record.sessionId);
    for (const pending of [...(this.interactions.get(record.sessionId)?.values() ?? [])]) pending.cancel();
    if (agent?.status === 'running') { try { agent.cancel({ kind: 'user' }); } catch {} }
    if (entry) {
      clearTimeout(entry.timer);
      this.live.delete(record.id);
      await entry.handle.dispose().catch(error => this.ctx.logger?.warn?.(`[selection-ask] dispose failed: ${errorText(error)}`));
    }
    await this.table.delete(record.id);
    this.unindex(record);
    this.streams.delete(record.sessionId); this.errors.delete(record.sessionId);
    this.cancelStreamBump(record.id);
    this.bump(record.id); this.revisions.delete(record.id);
    // A foreign live writer must keep its files; only plugin-owned, disposed threads are removed.
    if (entry || !agent) await this.removeArtifact(record);
  }

  async removeArtifact(record) {
    const persistence = this.ctx.get?.('sessionPersistence');
    let dir;
    try { dir = artifactDirectory(record.sessionId, persistence?.locate?.({ id: record.sessionId, cwd: record.cwd ?? undefined })); } catch { dir = undefined; }
    if (!dir) return;
    try { await rm(dir, { recursive: true, force: true }); }
    catch (error) { this.ctx.logger?.warn?.(`[selection-ask] could not remove ${record.sessionId}: ${errorText(error)}`); }
  }

  async prune(sourceSessionId) {
    const records = this.records().filter(record => record.sourceSessionId === sourceSessionId).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const record of records.slice(this.options.maxThreadsPerSource)) {
      if (this.liveAgent(record)?.status === 'running') continue;
      await this.deleteThread(record);
    }
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    for (const timer of this.streamTimers.values()) clearTimeout(timer);
    this.streamTimers.clear();
    for (const map of [...this.interactions.values()]) for (const pending of [...map.values()]) pending.cancel();
    await Promise.allSettled([...this.creating.values(), ...this.starting.values()]);
    const entries = [...this.live.values()];
    this.live.clear();
    for (const entry of entries) clearTimeout(entry.timer);
    await Promise.allSettled(entries.map(entry => entry.handle.dispose()));
    for (const waiters of this.waiters.values()) for (const wake of waiters) wake();
    this.waiters.clear();
  }
}
