import test from 'node:test';
import assert from 'node:assert/strict';
import { SideBranchService } from '../lib/service.js';
import { routeHandler } from '../lib/index.js';

function fixture({ failModel = false, failCreate = false, failFlush = false } = {}) {
  const events = [
    ['permission/preset', { preset: 'workspace-write' }], ['sandbox/mode', { mode: 'workspace-write' }], ['approval/policy', { policy: 'ask' }],
    ['model/selection', { provider: 'test', model: 'selected', reasoningEffort: 'high' }], ['session/title', { title: 'Source' }],
    ['turn/start', { turn: 1 }], ['user/message', { id: 'q1', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] }, 'append'],
    ['assistant/message', { message: { id: 'a1', content: [{ type: 'text', text: 'answer' }] } }, 'append'], ['turn/end', { turn: 1 }],
    ['turn/start', { turn: 2 }], ['user/message', { id: 'q2', source: { kind: 'user' }, content: [{ type: 'text', text: 'wrong question' }] }, 'append'],
    ['assistant/message', { message: { id: 'a2', content: [{ type: 'text', text: 'wrong answer' }] } }, 'append'], ['turn/end', { turn: 2 }]
  ].map(([type, data, surfaceOp], seq) => ({ type, data, seq, ...(surfaceOp ? { surfaceOp } : {}) }));
  const source = { id: 'source', header: { id: 'source', cwd: 'E:/fixture' }, events, inheritedEventCount: 0, append(type, data, options) { this.events.push({ seq: this.events.length, type, data, ...options }); } };
  const sessions = new Map([['source', source]]); const agents = new Map(); const records = new Map(); const table = { get: key => records.get(key), put: async (key, v) => records.set(key, v), entries: () => records.entries() };
  const calls = { fork: 0, create: 0, flush: 0, injected: 0, resolved: [], globalDefaults: 0, release: 0 };
  const archivedSessionIds = []; let service;
  const mint = async atSeq => {
    if (failCreate) throw new Error('native create failed');
    const id = `child-${sessions.size}`; const seed = atSeq === null ? [] : structuredClone(events.slice(0, atSeq + 1));
    const session = { ...source, id, header: { ...source.header, id, parentSession: 'source' }, events: seed, inheritedEventCount: seed.length };
    const agent = { id, session, inbox: { clear() {} }, status: 'idle', inject(message) { calls.injected++; session.append('agent/inbox/spliced', { target: 'next-step', messages: [message] }); } };
    sessions.set(id, session); agents.set(id, agent); service.onCreated({ agent });
    assert.deepEqual(await service.guard({ agent }, () => ({ kind: 'enter' })), { kind: 'reject' });
    return { sessionId: id };
  };
  const ctx = {
    get(name) { return this[name]; }, logger: { info() {}, warn() {} },
    sessions: { get: id => sessions.get(id), async flush() { calls.flush++; if (failFlush) throw new Error('disk full'); return true; } },
    agents: { get: id => agents.get(id) },
    sessionQuery: { async observeSession(id) { const s = sessions.get(id); if (!s) throw new Error('missing'); return { header: s.header, events: s.events, inheritedEventCount: s.inheritedEventCount, projections: { values: { permissions: { currentValue: 'workspace-write' } } }, [Symbol.dispose]() { calls.release++; } }; } },
    sessionController: {
      async fork({ atSeq }) { calls.fork++; return mint(atSeq); }, async create() { calls.create++; return mint(null); },
      async resolveAgent(id) { calls.resolved.push(id); return { agent: agents.get(id) }; },
      async rename({ sessionId, title }) { sessions.get(sessionId).append('session/title', { title }); },
      agents: { selectForNextRequest(agent, model) { agent.session.append('model/selection', model); } }
    },
    permissionPresets: { current: () => 'workspace-write', set(session, preset) { session.append('permission/preset', { preset }); } },
    approval: { config: { policy: 'never' } },
    llm: { async resolveCallConfig(model) { if (failModel) throw new Error('unknown model'); return model; } },
    workspaceRegistry: { archivedSessionIds, async archiveSession(id) { if (agents.get(id)?.status === 'running') throw new Error('session is active'); if (!archivedSessionIds.includes(id)) archivedSessionIds.push(id); }, async unarchiveSession(id) { const n = archivedSessionIds.indexOf(id); if (n >= 0) archivedSessionIds.splice(n, 1); } }
  };
  service = new SideBranchService(ctx, table);
  return { ctx, service, calls, source, sessions, agents, records };
}
const request = { sourceSessionId: 'source', mode: 'edit', turn: 2, requestId: 'request-1' };
test('native creation is idempotent and fenced until configured; no source writes or source resume', async () => {
  const f = fixture(); const before = structuredClone(f.source.events);
  const [a, b] = await Promise.all([f.service.create(request), f.service.create(request)]);
  assert.equal(a.branch.sessionId, b.branch.sessionId); assert.equal(f.calls.fork, 1); assert.equal(f.calls.injected, 0);
  assert.deepEqual(f.source.events, before); assert.deepEqual(f.calls.resolved, [a.branch.sessionId]);
  const child = f.agents.get(a.branch.sessionId);
  assert.equal(child.session.events.findLast(e => e.type === 'sandbox/mode').data.mode, 'workspace-write');
  assert.equal(child.session.events.findLast(e => e.type === 'model/selection').data.model, 'selected');
  assert.equal((await f.service.guard({ agent: child }, () => ({ kind: 'enter', extra: 42 }))).extra, 42);
  assert.equal((await f.service.guard({ agent: { id: 'unrelated' } }, () => ({ kind: 'enter', extra: 42 }))).extra, 42);
  await f.service.create(request); assert.equal(f.calls.fork, 1);
});
test('same request id cannot adopt different source or anchor', async () => {
  const f = fixture(); await f.service.create(request);
  await assert.rejects(f.service.create({ ...request, turn: 1 }), e => e.code === 'request-conflict');
});
test('validation fails before native creation', async () => {
  const f = fixture({ failModel: true }); await assert.rejects(f.service.create(request), /unknown model/); assert.equal(f.calls.fork, 0);
});
test('failed initialization retries the same child without a duplicate fork', async () => {
  const f = fixture({ failFlush: true }); await assert.rejects(f.service.create(request), /disk full/);
  assert.equal(f.records.get(request.requestId).state, 'failed');
  await assert.rejects(f.service.create(request), /disk full/); assert.equal(f.calls.fork, 1);
  const id = f.records.get(request.requestId).sessionId;
  assert.ok(f.ctx.workspaceRegistry.archivedSessionIds.includes(id));
  assert.deepEqual(await f.service.guard({ agent: f.agents.get(id) }, () => ({ kind: 'enter' })), { kind: 'reject' });
  f.ctx.sessions.flush = async () => true;
  const recovered = await f.service.create(request);
  assert.equal(recovered.branch.sessionId, id); assert.equal(f.calls.fork, 1);
  assert.ok(!f.ctx.workspaceRegistry.archivedSessionIds.includes(id));
});
test('first-turn edit uses native blank creation without original question', async () => {
  const f = fixture(); const { branch } = await f.service.create({ ...request, turn: 1 });
  assert.equal(f.calls.create, 1); assert.equal(f.calls.fork, 0); assert.equal(branch.inheritedEventCount, 0);
});
test('close auto archives empty branches, never stops a running branch or modifies another session', async () => {
  const f = fixture(); const { branch } = await f.service.create(request); const id = branch.sessionId;
  f.agents.get(id).status = 'running'; assert.equal((await f.service.close({ sessionId: id, action: 'archive' })).status, 'needs-stop');
  assert.equal(f.agents.get(id).status, 'running');
  f.agents.get(id).status = 'idle'; assert.equal((await f.service.close({ sessionId: id, action: 'auto' })).status, 'archived');
  await assert.rejects(f.service.close({ sessionId: 'source', action: 'archive' }), e => e.code === 'not-owned');
});
test('accepted but uncommitted human input prevents silent archive', async () => {
  const f = fixture(); const { branch } = await f.service.create(request);
  f.sessions.get(branch.sessionId).append('agent/inbox/spliced', { messages: [{ source: { kind: 'user' }, content: [] }] });
  assert.equal((await f.service.close({ sessionId: branch.sessionId, action: 'auto' })).status, 'needs-choice');
});
test('metadata reload recognizes only plugin branches and retains edit content', async () => {
  const f = fixture(); const { branch } = await f.service.create(request);
  const fresh = new SideBranchService(f.ctx, { get: k => f.records.get(k), entries: () => f.records.entries() });
  const reloaded = await fresh.branch({ sessionId: branch.sessionId });
  assert.equal(reloaded.branch.originalPrompt, 'wrong question'); assert.equal(reloaded.ownUserMessages, 0);
});
test('HTTP shape rejects malformed, oversized and non-JSON bodies without invoking operation', async () => {
  let called = 0; const handler = routeHandler({ async create() { called++; return {}; } }, 'create');
  const req = (body, type = 'application/json') => new Request('http://offline/api/side-branch/create', { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal((await handler(req('x', 'text/plain'))).status, 415);
  assert.equal((await handler(req('x'.repeat(65537)))).status, 413);
  assert.equal((await (await handler(req('[]'))).json()).code, 'invalid-request');
  assert.equal((await (await handler(req('{'))).json()).code, 'invalid-request');
  assert.equal(called, 0);
});
