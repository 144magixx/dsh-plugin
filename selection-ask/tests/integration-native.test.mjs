import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createIsolatedHost, createSource } from './integration-host.mjs';
import { BOUNDARY_SOURCE } from '../lib/context.js';
import { VIEW_WAIT_MAX_MS } from '../lib/service.js';

const fileSelection = { kind: 'file', text: 'const resolved = await resolve(config.model);', path: 'lib/service.js', startLine: 42, endLine: 46, before: 'async function x() {', after: 'return resolved;' };
const hiddenOf = (h, threadId) => h.ctx.selectionAsk.table.get(threadId).sessionId;
const boundaries = agent => agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.kind === BOUNDARY_SOURCE).length;
const allWorkspaceSessions = h => h.ctx.workspaceRegistry.list().flatMap(w => w.sessionIds);

async function ask(h, source, extra = {}) {
  const { status, body } = await h.post('create', { requestId: extra.requestId ?? `r-${Math.random()}`, sourceSessionId: source.id, selection: extra.selection ?? fileSelection, question: extra.question ?? 'Why is the model resolved here?' });
  assert.equal(status, 200, JSON.stringify(body));
  const sessionId = hiddenOf(h, body.thread.id);
  await h.waitIdle(sessionId);
  return { thread: body.thread, sessionId, agent: h.ctx.agents.get(sessionId) };
}

test('a selection thread is a hidden seeded session that inherits context, model and permissions', async () => {
  const h = await createIsolatedHost();
  try {
    const source = await createSource(h);
    h.ctx.permissionPresets.set(source.session, 'danger-full-access');
    const original = JSON.stringify(source.session.snapshotEvents());
    const defaults = h.ctx.agentDefaultModel.currentSelection();
    const args = { requestId: 'same-click', sourceSessionId: source.id, selection: fileSelection, question: 'Why is the model resolved here?' };
    const [first, repeated] = await Promise.all([h.post('create', args), h.post('create', args)]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.thread.id, repeated.body.thread.id, 'a repeated click reuses one thread');
    const sessionId = hiddenOf(h, first.body.thread.id);
    await h.waitIdle(sessionId);
    const hidden = h.ctx.agents.get(sessionId);
    assert.equal(hidden.session.header.origin, 'subagent');
    assert.equal(hidden.session.header.parentSession, undefined, 'no parent: never listed in a subagent catalog');
    assert.equal(hidden.session.header.cwd, source.session.header.cwd);
    assert.ok(!allWorkspaceSessions(h).includes(sessionId), 'never attached to a workspace');
    assert.ok(!h.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId));
    assert.equal(h.ctx.permissionPresets.current(hidden.session), 'danger-full-access');
    assert.deepEqual(h.ctx.agentDefaultModel.currentSelection(), defaults, 'global default model is untouched');
    assert.equal(JSON.stringify(source.session.snapshotEvents()), original, 'source log is untouched');

    const request = h.adapter.requests.at(-1);
    const text = JSON.stringify(request.messages);
    assert.equal(request.model, 'source-model');
    assert.equal(request.reasoningEffort, 'high');
    assert.match(text, /Explain the limiter design/, 'inherits completed source turns');
    assert.match(text, /Selection Ask boundary/);
    assert.match(text, /lib\/service\.js lines 42-46/);
    assert.match(text, /resolve\(config\.model\)/);
    assert.match(text, /Why is the model resolved here\?/);
    assert.equal(boundaries(hidden), 1);

    const view = await h.post('view', { threadId: first.body.thread.id });
    assert.equal(view.status, 200);
    assert.deepEqual(view.body.messages.map(m => [m.role, m.text]), [['user', 'Why is the model resolved here?'], ['assistant', 'Offline fake answer.']]);
    assert.equal(view.body.messages[1].reasoning, true);
    assert.equal(view.body.running, false);

    assert.equal((await h.post('prompt', { threadId: first.body.thread.id, question: 'And a follow-up?' })).status, 200);
    await h.waitIdle(sessionId);
    assert.equal(boundaries(hidden), 1, 'the boundary is delivered exactly once');
    const second = await h.post('view', { threadId: first.body.thread.id });
    assert.equal(second.body.messages.length, 4);
    const listed = await h.post('list', { sourceSessionId: source.id });
    assert.deepEqual(listed.body.threads.map(t => t.id), [first.body.thread.id]);
    assert.equal(listed.body.threads[0].title, 'Why is the model resolved here?');
    assert.equal(JSON.stringify(source.session.snapshotEvents()), original);
  } finally { await h.close(); }
});

test('view long-poll is bounded, wakes on change, and ends on cancel or unload', async () => {
  const h = await createIsolatedHost();
  try {
    const source = await createSource(h, ['One completed turn.']);
    const { thread } = await ask(h, source);
    await h.post('view', { threadId: thread.id });
    await new Promise(resolve => setTimeout(resolve, 100)); // the model catalog loads once in the background
    const current = (await h.post('view', { threadId: thread.id })).body.revision;

    let started = performance.now();
    const idle = await h.post('view', { threadId: thread.id, since: current, waitMs: 60000 });
    const idleMs = performance.now() - started;
    assert.equal(idle.status, 200);
    assert.ok(idleMs >= VIEW_WAIT_MAX_MS - 100 && idleMs < VIEW_WAIT_MAX_MS + 600, `wait was ${idleMs}ms`);

    started = performance.now();
    const woken = h.post('view', { threadId: thread.id, since: current, waitMs: 2500 });
    setTimeout(() => void h.post('prompt', { threadId: thread.id, question: 'Wake up' }), 50);
    const changed = await woken;
    assert.ok(performance.now() - started < 1500);
    assert.notEqual(changed.body.revision, current);
    for (let index = 0; index < 50; index++) {
      const view = await h.post('view', { threadId: thread.id });
      if (!view.body.running && view.body.messages.length === 4) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await new Promise(resolve => setTimeout(resolve, 200));

    const latest = (await h.post('view', { threadId: thread.id })).body.revision;
    const abort = new AbortController();
    started = performance.now();
    const cancelled = h.post('view', { threadId: thread.id, since: latest, waitMs: 2500 }, { signal: abort.signal });
    setTimeout(() => abort.abort(), 30);
    assert.equal((await cancelled).status, 499);
    assert.ok(performance.now() - started < 500);
    assert.equal(h.ctx.selectionAsk.waiters.size, 0, 'cancelled waits leave no waiter');

    const service = h.ctx.selectionAsk;
    started = performance.now();
    const pending = h.post('view', { threadId: thread.id, since: latest, waitMs: 2500 });
    await new Promise(resolve => setTimeout(resolve, 30));
    await h.plugin.dispose();
    const ended = await pending;
    assert.ok([200, 499, 503].includes(ended.status));
    assert.ok(performance.now() - started < 1000, 'unload ends a waiting request promptly');
    assert.equal(service.waiters.size, 0);
    assert.equal(service.live.size, 0, 'unload disposes live hidden agents');
  } finally { await h.close(); }
});

test('streaming text is visible while the hidden agent runs', async () => {
  const h = await createIsolatedHost();
  try {
    const source = await createSource(h, ['One completed turn.']);
    h.adapter.reply = 'A considerably longer streamed answer that arrives in many small pieces.';
    h.adapter.delay = () => new Promise(resolve => setTimeout(resolve, 25));
    const { body } = await h.post('create', { requestId: 'stream', sourceSessionId: source.id, selection: { kind: 'chat', text: 'selected chat text', turn: 1, role: 'assistant' }, question: 'Stream please' });
    let since; let sawPartial = false;
    for (let index = 0; index < 40 && !sawPartial; index++) {
      const view = await h.post('view', { threadId: body.thread.id, since, waitMs: 400 });
      since = view.body.revision;
      if (view.body.running && view.body.stream?.text && view.body.stream.text.length < h.adapter.reply.length) sawPartial = true;
    }
    assert.ok(sawPartial, 'a partial stream was observed');
    await h.waitIdle(hiddenOf(h, body.thread.id));
    const done = await h.post('view', { threadId: body.thread.id });
    assert.equal(done.body.stream, null);
    assert.equal(done.body.messages.at(-1).text, h.adapter.reply);
  } finally { await h.close(); }
});

test('approval and ask-user requests from a hidden thread are answered by its own view', async () => {
  const h = await createIsolatedHost();
  try {
    const source = await createSource(h, ['One completed turn.']);
    const outcomes = {};
    let step = 0;
    h.adapter.onRequest = async options => {
      const live = [...h.ctx.selectionAsk.live.values()].map(entry => entry.handle.agent).find(agent => agent.status === 'running');
      if (!live || step++ > 0) return;
      outcomes.approval = await h.ctx.approval.request({ agent: live, toolName: 'write', reason: 'Write lib/service.js', signal: options.signal });
      outcomes.question = await h.ctx.userQuestions.ask({ agent: live, questions: [{ id: 'q1', question: 'Which fallback?', options: [{ label: 'Default model' }, { label: 'Fail' }] }], signal: options.signal });
    };
    const { body } = await h.post('create', { requestId: 'interactive', sourceSessionId: source.id, selection: fileSelection, question: 'Add a fallback' });
    const threadId = body.thread.id;
    const waitPending = async kind => {
      let since;
      for (let index = 0; index < 50; index++) {
        const view = await h.post('view', { threadId, since, waitMs: 300 });
        since = view.body.revision;
        const pending = view.body.pending.find(item => item.kind === kind);
        if (pending) return pending;
      }
      assert.fail(`No pending ${kind}`);
    };
    const approval = await waitPending('approval');
    assert.equal(approval.toolName, 'write');
    assert.equal(approval.reason, 'Write lib/service.js');
    assert.equal((await h.post('answer', { threadId, interactionId: approval.id, outcome: 'maybe' })).status, 400);
    assert.equal((await h.post('answer', { threadId, interactionId: approval.id, outcome: 'allowed-once' })).status, 200);
    const question = await waitPending('question');
    assert.equal(question.questions[0].question, 'Which fallback?');
    assert.equal((await h.post('answer', { threadId, interactionId: question.id, answers: [{ id: 'q1', selected: ['Default model'] }] })).status, 200);
    assert.equal((await h.post('answer', { threadId, interactionId: question.id, answers: [] })).status, 409, 'an answered request is gone');
    await h.waitIdle(hiddenOf(h, threadId));
    assert.equal(outcomes.approval, 'allowed-once');
    assert.deepEqual(outcomes.question.answers, [{ id: 'q1', selected: ['Default model'] }]);
    const audit = h.ctx.agents.get(hiddenOf(h, threadId)).session.snapshotEvents().filter(e => e.type === 'approval/decided');
    assert.equal(audit.at(-1).data.outcome, 'allowed-once');
  } finally { await h.close(); }
});

test('threads survive plugin reload, reopen cold, and delete removes only their own files', async () => {
  const h = await createIsolatedHost();
  try {
    const source = await createSource(h);
    const { thread, sessionId } = await ask(h, source);
    const location = h.ctx.sessionPersistence.locate({ id: sessionId, cwd: h.cwd });
    const dir = path.dirname(location.path);
    assert.ok((await stat(dir)).isDirectory());
    await h.plugin.dispose();
    assert.equal(h.ctx.agents.get(sessionId), undefined, 'reload released the hidden agent');
    await h.mountPlugin();
    const listed = await h.post('list', { sourceSessionId: source.id });
    assert.deepEqual(listed.body.threads.map(t => t.id), [thread.id]);
    const cold = await h.post('view', { threadId: thread.id });
    assert.equal(cold.body.live, false);
    assert.equal(cold.body.messages.length, 2);
    const calls = h.adapter.requests.length;
    assert.equal((await h.post('prompt', { threadId: thread.id, question: 'Cold follow-up' })).status, 200);
    await h.waitIdle(sessionId);
    assert.equal(h.adapter.requests.length, calls + 1);
    const text = JSON.stringify(h.adapter.requests.at(-1).messages);
    assert.match(text, /Explain the limiter design/);
    assert.match(text, /Cold follow-up/);
    assert.equal(boundaries(h.ctx.agents.get(sessionId)), 1);
    assert.ok(!allWorkspaceSessions(h).includes(sessionId));

    const sourceDir = path.dirname(h.ctx.sessionPersistence.locate(source.session.header).path);
    assert.equal((await h.post('delete', { threadId: thread.id })).status, 200);
    assert.equal(h.ctx.agents.get(sessionId), undefined);
    await assert.rejects(stat(dir), { code: 'ENOENT' });
    assert.ok((await stat(sourceDir)).isDirectory(), 'source files are kept');
    assert.equal((await h.post('view', { threadId: thread.id })).status, 404);
    assert.deepEqual((await h.post('list', { sourceSessionId: source.id })).body.threads, []);
  } finally { await h.close(); }
});

test('a source without completed turns starts a fresh hidden thread; clear removes all', async () => {
  const h = await createIsolatedHost();
  try {
    const { sessionId: sourceId } = await h.ctx.sessionController.create({ cwd: h.cwd });
    const source = h.ctx.agents.get(sourceId);
    const a = await ask(h, source, { selection: { kind: 'html', text: 'drain limit 2.5s', path: 'docs/report.html', heading: '结论' } });
    assert.equal(a.agent.session.inheritedEventCount, 0);
    assert.match(JSON.stringify(h.adapter.requests.at(-1).messages), /rendered HTML document docs\/report\.html, section \\"结论\\"/);
    await ask(h, source, { selection: { kind: 'chat', text: 'chat text', turn: 3, role: 'user' } });
    assert.equal((await h.post('list', { sourceSessionId: sourceId })).body.threads.length, 2);
    const cleared = await h.post('clear', { sourceSessionId: sourceId });
    assert.equal(cleared.body.removed, 2);
    assert.equal((await h.post('list', { sourceSessionId: sourceId })).body.threads.length, 0);
    assert.equal((await h.post('create', { requestId: 'x', sourceSessionId: sourceId, selection: { kind: 'file', text: ' ' }, question: 'q' })).status, 400);
    assert.equal((await h.post('create', { requestId: 'y', sourceSessionId: 'missing-session', selection: fileSelection, question: 'q' })).status, 409);
  } finally { await h.close(); }
});

test('images are stored as attachments, refused for text-only models, and the model can be switched per thread', async () => {
  const h = await createIsolatedHost();
  try {
    const stored = [];
    h.ctx.attachments.admitPromptContent = async content => content.map(part => part.type === 'image' ? (stored.push(part), { type: 'image', attachment: { id: `att-${stored.length}` } }) : part);
    const source = await createSource(h, ['One completed turn.']);
    const png = Buffer.from('png-bytes').toString('base64');
    const models = await h.post('models', { sourceSessionId: source.id });
    assert.equal(models.status, 200);
    assert.deepEqual(models.body.groups.map(g => g.id), ['offline-test']);
    assert.deepEqual(models.body.groups[0].models.map(m => m.id), ['source-model', 'global-model']);
    assert.equal(models.body.current.model, 'source-model');
    assert.equal(models.body.current.reasoningEffort, 'high');
    assert.equal(models.body.current.effortName, 'High');

    const created = await h.post('create', { requestId: 'img', sourceSessionId: source.id, selection: fileSelection, question: '', images: [{ data: png, mediaType: 'image/png', name: 'shot.png' }], model: { provider: 'offline-test', model: 'global-model', reasoningEffort: 'low' } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = hiddenOf(h, created.body.thread.id);
    await h.waitIdle(sessionId);
    assert.equal(stored.length, 1, 'image went through attachment admission');
    assert.equal(stored[0].mediaType, 'image/png');
    const request = h.adapter.requests.at(-1);
    assert.equal(request.model, 'global-model', 'the model picked before asking is used');
    assert.equal(request.reasoningEffort, 'low');
    const view = await h.post('view', { threadId: created.body.thread.id });
    assert.equal(view.body.messages[0].images, 1);
    assert.equal(view.body.model.model, 'global-model');
    assert.equal(view.body.thread.title, fileSelection.text.slice(0, 80), 'an image-only question is titled by the selection');

    const defaults = h.ctx.agentDefaultModel.currentSelection();
    const switched = await h.post('model', { threadId: created.body.thread.id, model: { provider: 'offline-test', model: 'source-model', reasoningEffort: 'high' } });
    assert.equal(switched.status, 200, JSON.stringify(switched.body));
    assert.equal(switched.body.model.name, 'source-model');
    assert.equal((await h.post('model', { threadId: created.body.thread.id, model: { provider: 'nope', model: 'x' } })).status, 409);
    await h.post('prompt', { threadId: created.body.thread.id, question: 'after switch' });
    await h.waitIdle(sessionId);
    assert.equal(h.adapter.requests.at(-1).model, 'source-model');
    assert.deepEqual(h.ctx.agentDefaultModel.currentSelection(), defaults, 'switching never saves the global default');

    // A text-only model refuses images before anything is stored.
    const original = h.ctx.llm.resolveModelInfo.bind(h.ctx.llm);
    h.ctx.llm.resolveModelInfo = async (provider, model) => ({ ...(await original(provider, model)), inputModalities: ['text'] });
    const refused = await h.post('prompt', { threadId: created.body.thread.id, question: 'look', images: [{ data: png, mediaType: 'image/png' }] });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'model-no-images');
    assert.equal(stored.length, 1);
    assert.equal((await h.post('prompt', { threadId: created.body.thread.id, question: 'x', images: [{ data: png, mediaType: 'image/bmp' }] })).status, 400);
  } finally { await h.close(); }
});
