import { AsyncLocalStorage } from 'node:async_hooks';
import { BranchError, NOTE_SOURCE, branchNotice, currentConfig, driftAfter, hasPendingHumanInput, ownHumanMessages, requiredString, resolveAnchor, turnRows } from './history.js';

export const DOMAIN = Object.freeze({ name: 'side_branch', version: 1, layout: 'per-record', tables: { branches: { valueSchema: { parse: validateRecord } } } });
export function validateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid side-branch record');
  requiredString(value.requestId, 'requestId'); requiredString(value.sourceSessionId, 'sourceSessionId');
  if (!['creating', 'initializing', 'ready', 'failed'].includes(value.state)) throw new Error('Invalid branch state');
  if (!['continue', 'edit'].includes(value.mode) || !Number.isSafeInteger(value.turn) || value.turn < 0) throw new Error('Invalid branch origin');
  if (!Number.isSafeInteger(value.createdAt)) throw new Error('Invalid branch timestamp');
  if (value.sessionId != null) requiredString(value.sessionId, 'sessionId');
  if (value.state === 'ready') {
    requiredString(value.sessionId, 'sessionId');
    if (value.atSeq !== null && (!Number.isSafeInteger(value.atSeq) || value.atSeq < 0)) throw new Error('Invalid branch boundary');
    if (!Array.isArray(value.drift?.files) || !value.drift.files.every(p => typeof p === 'string') || !Number.isSafeInteger(value.drift.laterTurns)) throw new Error('Invalid branch drift');
    if (typeof value.originalPrompt !== 'string' || !Number.isSafeInteger(value.inheritedEventCount)) throw new Error('Invalid branch content');
    requiredString(value.model?.provider, 'provider'); requiredString(value.model?.model, 'model');
  }
  return value;
}
const publicBranch = record => { const { state, error, fingerprint, configuration, archivedByPlugin, ...branch } = record; return { ...branch, ready: state === 'ready' }; };
function fail(code, message, sessionId) { throw new BranchError(code, message, sessionId); }

/** All mutations target newly created branch sessions or their own metadata. */
export class SideBranchService {
  constructor(ctx, table) {
    this.ctx = ctx; this.table = table; this.pending = new Map(); this.owned = new Map();
    this.initializing = new Set(); this.creation = new AsyncLocalStorage(); this.closed = false;
    this.notedSessions = new WeakSet();
    for (const [key, record] of table.entries()) if (record.sessionId) this.owned.set(record.sessionId, key);
  }
  checkCapabilities() {
    const c = this.ctx;
    if (typeof c.sessionController?.fork !== 'function' || typeof c.sessionController?.agents?.selectForNextRequest !== 'function' || typeof c.sessionQuery?.observeSession !== 'function' || typeof c.sessions?.flush !== 'function') {
      fail('unsupported-runtime', 'Native fork/model/persistence interfaces required by DSH 0.2.1-rc.2 are unavailable.');
    }
  }
  onCreated({ agent }) {
    // Native fork publishes its Agent before its async command resolves. Fence
    // only the exact async creation initiated by this plugin, never source work.
    const operation = this.creation.getStore();
    if (operation && agent?.id) { operation.sessionId = agent.id; this.initializing.add(agent.id); this.owned.set(agent.id, operation.requestId); }
  }
  async guard({ agent, signal }, next) {
    const key = this.owned.get(agent.id);
    if (!key) return next();
    const record = this.table.get(key);
    if (this.initializing.has(agent.id) || record?.state !== 'ready') return { kind: 'reject' };
    const decision = await next();
    if (decision.kind !== 'enter' || signal?.aborted || !decision.messages?.length || this.notedSessions.has(agent.session)) return decision;
    const events = agent.session.snapshotEvents?.(agent.session.inheritedEventCount) ?? agent.session.events ?? [];
    const delivered = events.some(e => e.seq >= agent.session.inheritedEventCount && e.type === 'user/message' && e.surfaceOp === 'append' && e.data?.source?.kind === NOTE_SOURCE);
    if (delivered) { this.notedSessions.add(agent.session); return decision; }
    if (decision.messages.some(m => m.source?.kind === NOTE_SOURCE)) return decision;
    // A queued injection is canceled on native graceful shutdown. Reconstruct
    // from durable metadata at admission instead. The native loop commits this
    // message, retries it if admission aborts, and owns all event invariants.
    const note = { id: `side-branch-context-${agent.id}`, role: 'user', source: { kind: NOTE_SOURCE }, content: [{ type: 'text', text: branchNotice(record) }] };
    return { ...decision, messages: [note, ...decision.messages] };
  }
  async observe(id, fn) {
    requiredString(id, 'sessionId');
    // Inspect migration without resuming, importing, or migrating the source.
    if (!this.ctx.sessions.get(id)) {
      const stat = await this.ctx.get?.('sessionPersistence')?.stat(id);
      if (stat?.formatStatus === 'migration-required') fail('migration-required', 'Open the source in DSH to migrate it before branching.');
    }
    const observed = await this.ctx.sessionQuery.observeSession(id);
    try {
      if (observed.header.origin === 'subagent') fail('unsupported-source', 'Choose an ordinary conversation, not an owned subagent.');
      return await fn(observed);
    } finally { observed[Symbol.dispose](); }
  }
  async turns(args) {
    return this.observe(args.sourceSessionId, o => {
      const turns = turnRows(o.events);
      return { turns, totalTurns: turns.filter(t => t.completed).length };
    });
  }
  anchorFrom(o, args) {
    const anchor = resolveAnchor(o.events, args);
    const changes = this.ctx.get?.('workspaceChanges');
    anchor.drift = driftAfter(o.events, anchor.atSeq, seq => changes?.summary(args.sourceSessionId, seq));
    return anchor;
  }
  async anchorInfo(args) { return this.observe(args.sourceSessionId, o => ({ anchor: this.anchorFrom(o, args) })); }
  async create(args) {
    if (this.closed) fail('unloading', 'The plugin is unloading.');
    requiredString(args.requestId, 'requestId');
    this.checkCapabilities();
    // Deduplicate the click before any asynchronous I/O. Same key, changed input
    // is rejected rather than silently adopting another branch.
    const fingerprint = JSON.stringify([args.sourceSessionId, args.mode, args.turn ?? null, args.messageId ?? null]);
    const ongoing = this.pending.get(args.requestId);
    if (ongoing) {
      if (ongoing.fingerprint !== fingerprint) fail('request-conflict', 'This request ID belongs to another branch request.');
      return ongoing.promise;
    }
    const saved = this.table.get(args.requestId);
    if (saved) {
      if (saved.fingerprint !== fingerprint) fail('request-conflict', 'This request ID belongs to another branch request.');
      if (saved.state === 'ready') return { branch: publicBranch(saved) };
      if (saved.state === 'creating' && !saved.sessionId) fail('creation-uncertain', 'Creation was interrupted before the child identity was saved. Inspect the native session list before starting a fresh request.');
    }
    const promise = saved?.sessionId ? this.initialize(saved, true) : this.createNew(args, fingerprint);
    this.pending.set(args.requestId, { fingerprint, promise });
    try { return await promise; } finally { this.pending.delete(args.requestId); }
  }
  async createNew(args, fingerprint) {
    // Capture anchor + current settings from one source observation, with no
    // agent resume, no source event writes, and no model request.
    const captured = await this.observe(args.sourceSessionId, o => {
      const anchor = this.anchorFrom(o, args);
      const config = currentConfig(o.events, o.projections?.values ?? {}, {
        model: this.ctx.get?.('agentDefaultModel')?.currentSelection(),
        sandbox: this.ctx.get?.('shell')?.sandboxMode,
        approval: this.ctx.approval.config?.policy ?? 'ask'
      });
      const sourceAgent = this.ctx.agents.get(args.sourceSessionId);
      if (sourceAgent) config.permissionPreset = this.ctx.permissionPresets.current(sourceAgent.session);
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(config.sandbox) || !['ask', 'never'].includes(config.approval)) fail('permission-unavailable', 'Cannot resolve current source permissions.');
      return { anchor, config, header: o.header, agentPreset: o.projections?.values?.agentPreset ?? o.header.agentPreset };
    });
    const { anchor, config, header } = captured;
    // Validation does not call a provider or change a setting.
    const resolved = await this.ctx.llm.resolveCallConfig(config.model);
    if (resolved.provider !== config.model.provider || resolved.model !== config.model.model) fail('model-unavailable', 'The source model is no longer available.');
    const workspaceId = this.ctx.workspaceRegistry.list?.().find(w => w.sessionIds.includes(args.sourceSessionId))?.id;
    let record = { ...anchor, requestId: args.requestId, fingerprint, state: 'creating', createdAt: Date.now(), model: config.model, permissionPreset: config.permissionPreset,
      configuration: { ...config, workspaceId: workspaceId ?? null } };
    await this.table.put(args.requestId, record);
    const operation = { requestId: args.requestId, sessionId: undefined };
    try {
      const result = await this.creation.run(operation, () => anchor.atSeq === null
        ? this.ctx.sessionController.create({ ...(workspaceId ? { workspaceId } : { cwd: header.cwd ?? config.cwd }), ...(captured.agentPreset ? { agentPreset: captured.agentPreset } : {}) })
        : this.ctx.sessionController.fork({ sessionId: args.sourceSessionId, atSeq: anchor.atSeq, allowMigration: false }));
      operation.sessionId = result.sessionId;
      this.owned.set(result.sessionId, args.requestId); this.initializing.add(result.sessionId);
      record = { ...record, sessionId: result.sessionId, state: 'initializing' };
      await this.table.put(args.requestId, record);
    } catch (error) {
      return this.creationFailed({ ...record, sessionId: operation.sessionId ?? error?.details?.sessionId }, error);
    }
    return this.initialize(record, false);
  }
  async initialize(saved, retry) {
    let record = saved;
    const config = record.configuration;
    if (!config) fail('creation-incomplete', 'The saved initialization settings are unavailable. Inspect this branch before creating another.', record.sessionId);
    this.initializing.add(record.sessionId);
    try {
      // Retrying initialization may never erase input a user submitted through
      // the ordinary session list while the sidebar was unavailable.
      if (retry) await this.observe(record.sessionId, o => {
        if (ownHumanMessages(o.events, o.inheritedEventCount) || hasPendingHumanInput(o.events, o.inheritedEventCount)) fail('branch-has-work', 'This branch already received input; initialization will not overwrite it.', record.sessionId);
      });
      const found = await this.ctx.sessionController.resolveAgent(record.sessionId);
      if (found.error) throw found.error;
      const child = found.agent;
      if (!child || child.id === record.sourceSessionId || child.status === 'running') fail('invalid-child', 'The branch is not an idle independent native session.');
      if (this.closed) fail('unloading', 'The plugin unloaded during branch creation.');
      record = { ...record, state: 'initializing' };
      await this.table.put(record.requestId, record);
      if (typeof child.inbox?.clear !== 'function') fail('unsupported-runtime', 'Native branch inbox reset is unavailable.');
      // Native fork inherits any future question accepted before turn/end. Reset
      // only the new child's queue, not the completed prefix or source inbox.
      child.inbox.clear();
      const resolved = await this.ctx.llm.resolveCallConfig(config.model);
      if (resolved.provider !== config.model.provider || resolved.model !== config.model.model) fail('model-unavailable', 'The captured source model is no longer available.');
      this.ctx.sessionController.agents.selectForNextRequest(child, config.model);
      const presetIdentity = config.permissionPreset === 'custom' ? config.recordedPermissionPreset : config.permissionPreset;
      if (!presetIdentity || presetIdentity === 'custom') fail('permission-unavailable', 'Cannot reconstruct the source permission preset identity.');
      this.ctx.permissionPresets.set(child.session, presetIdentity);
      // Restore the captured effective knobs after setting its real identity;
      // otherwise historical Auto identity could silently change custom mode.
      child.session.append('sandbox/mode', { mode: config.sandbox });
      child.session.append('approval/policy', { policy: config.approval });
      if (this.ctx.permissionPresets.current(child.session) !== config.permissionPreset) fail('permission-mismatch', 'The branch cannot reproduce the current source permission mode.');
      const directory = this.ctx.get?.('workingDirectory');
      if (config.cwd && directory?.set) await directory.set(child, config.cwd);
      // Repair native attach failure and attach empty-history first-turn edits
      // to the original project. The immutable cwd remains the project root.
      if (config.workspaceId) {
        const workspace = this.ctx.workspaceRegistry.get(config.workspaceId);
        if (!workspace) fail('workspace-unavailable', 'The source workspace is no longer registered.');
        await workspace.attachSession(child.id);
        if (workspace.sessionIds.includes(record.sourceSessionId)) await workspace.insertSessionBefore(child.id, record.sourceSessionId);
      }
      const suffix = record.mode === 'edit' ? `改第 ${record.turn} 轮` : `自第 ${record.turn} 轮`;
      await this.ctx.sessionController.rename({ sessionId: child.id, title: `${config.title || '会话'} · ${suffix}`.slice(0, 200) });
      if (await this.ctx.sessions.flush(child.session) === false) fail('persistence-unavailable', 'Native session persistence is required for sidebar branches.');
      // Keep the admission fence up while restoring archive state. A failure
      // here remains retryable against this same child and captured config.
      if (record.archivedByPlugin) await this.ctx.workspaceRegistry.unarchiveSession(child.id);
      record = { ...record, state: 'ready', archivedByPlugin: false, inheritedEventCount: child.session.inheritedEventCount };
      delete record.error;
      await this.table.put(record.requestId, record);
      this.initializing.delete(child.id);
      this.ctx.logger?.info?.(`[side-branch] ready ${child.id} from ${record.sourceSessionId}, mode=${record.mode}, turn=${record.turn}, model=${config.model.provider}/${config.model.model}, permission=${config.permissionPreset}`);
      return { branch: publicBranch(record) };
    } catch (error) { return this.creationFailed(record, error); }
  }
  async creationFailed(record, error) {
    const id = record.sessionId;
    record = { ...record, state: 'failed', error: String(error.message ?? error) };
    if (id) this.owned.set(id, record.requestId);
    // Never delete logs or cancel work. Native archive rejects active work.
    if (id && !this.ctx.workspaceRegistry.archivedSessionIds.includes(id)) {
      try { await this.ctx.workspaceRegistry.archiveSession(id); record.archivedByPlugin = true; } catch {}
    }
    try { await this.table.put(record.requestId, record); }
    catch (storageError) { this.ctx.logger?.warn?.(`[side-branch] could not save failed creation: ${String(storageError)}`); }
    if (id) this.initializing.delete(id);
    fail(error.code ?? 'create-failed', String(error.message ?? error), id);
  }
  recordFor(sessionId) {
    requiredString(sessionId, 'sessionId');
    const key = this.owned.get(sessionId);
    const record = key && this.table.get(key);
    if (!record || record.sessionId !== sessionId) fail('not-owned', 'This session was not created by Side Branch.');
    return record;
  }
  async branch(args) {
    const record = this.recordFor(args.sessionId);
    if (record.state !== 'ready') fail('creation-incomplete', 'Branch initialization did not complete. Retry the original create action to finish configuring this same branch.', record.sessionId);
    return this.observe(record.sessionId, o => ({ branch: publicBranch(record),
      ownUserMessages: ownHumanMessages(o.events, o.inheritedEventCount),
      hasPendingHumanInput: hasPendingHumanInput(o.events, o.inheritedEventCount),
      running: this.ctx.agents.get(record.sessionId)?.status === 'running',
      sourceRunning: this.ctx.agents.get(record.sourceSessionId)?.status === 'running',
      archived: this.ctx.workspaceRegistry.archivedSessionIds.includes(record.sessionId),
      sourceArchived: this.ctx.workspaceRegistry.archivedSessionIds.includes(record.sourceSessionId) }));
  }
  async close(args) {
    this.recordFor(args.sessionId);
    if (!['auto', 'keep', 'archive'].includes(args.action)) fail('invalid-action', 'action must be auto, keep, or archive.');
    if (args.action === 'keep') return { status: 'kept' };
    const state = await this.branch(args);
    if (state.archived) return { status: 'archived', running: false };
    if (state.running) return { status: args.action === 'auto' ? 'needs-choice' : 'needs-stop', running: true };
    if (args.action === 'auto' && (state.ownUserMessages > 0 || state.hasPendingHumanInput)) return { status: 'needs-choice', running: false };
    try { await this.ctx.workspaceRegistry.archiveSession(args.sessionId); }
    catch (error) {
      if (Array.isArray(error.activity) || String(error.code).includes('ACTIVE') || /session is active/.test(error.message)) return { status: 'needs-stop', running: true };
      throw error;
    }
    return { status: 'archived', running: false };
  }
  async dispose() { this.closed = true; await Promise.allSettled([...this.pending.values()].map(p => p.promise)); }
}
