import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { createIsolatedHost } from './integration-host.mjs';
import { NOTE_SOURCE } from '../lib/history.js';

async function source(h) {
  const { sessionId } = await h.ctx.sessionController.create({ cwd: h.cwd });
  const agent = h.ctx.agents.get(sessionId);
  await h.workspace.attachSession(sessionId);
  await h.ctx.sessionController.rename({ sessionId, title: 'Five-turn source' });
  h.ctx.sessionController.agents.selectForNextRequest(agent, { provider: 'offline-test', model: 'source-model', reasoningEffort: 'high' });
  agent.session.append('sandbox/mode', { mode: 'read-only' });
  const prompts = ['Remember the first requirements.', 'Use Python to implement a limiter.', 'Secret excluded turn ZEBRA-42.', 'Continue implementation.', 'Finish implementation.'];
  for (const text of prompts) await h.turn(agent, text);
  h.ctx.permissionPresets.set(agent.session, 'danger-full-access');
  await h.ctx.sessions.flush(agent.session);
  return agent;
}

function messages(request) { return JSON.stringify(request.messages); }

test('actual native fork keeps prefix, current model and permissions, and source untouched', async () => {
  const h = await createIsolatedHost();
  try {
    const a = await source(h);
    const original = JSON.stringify(a.session.snapshotEvents());
    const defaults = h.ctx.agentDefaultModel.currentSelection();
    const calls = h.adapter.requests.length;
    const args = { requestId: 'edit-second', sourceSessionId: a.id, mode: 'edit', turn: 2 };
    const [first, repeated] = await Promise.all([h.ctx.sideBranch.create(args), h.ctx.sideBranch.create(args)]);
    assert.equal(first.branch.sessionId, repeated.branch.sessionId);
    const b = h.ctx.agents.get(first.branch.sessionId);
    assert.equal(b.session.header.parentSession, a.id);
    assert.equal(b.session.header.cwd, a.session.header.cwd);
    assert.deepEqual(b.session.snapshotEvents().slice(0, first.branch.inheritedEventCount), a.session.snapshotEvents().slice(0, first.branch.inheritedEventCount));
    assert.equal(first.branch.originalPrompt, 'Use Python to implement a limiter.');
    assert.equal(first.branch.inheritedTurns, 1);
    assert.equal(first.branch.laterTurns, 4);
    assert.equal(h.ctx.permissionPresets.current(b.session), 'danger-full-access');
    assert.equal(h.ctx.sandboxPolicy.resolve({ session: b.session }).mode, 'danger-full-access');
    assert.equal(h.adapter.requests.length, calls, 'creating a branch never wakes a model');
    assert.deepEqual(h.ctx.agentDefaultModel.currentSelection(), defaults, 'initializing child model must not save global defaults');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
    await h.turn(b, 'Use Go to implement a limiter.');
    const request = h.adapter.requests.at(-1);
    assert.equal(request.model, 'source-model');
    assert.equal(request.reasoningEffort, 'high');
    assert.match(messages(request), /Remember the first requirements/);
    assert.match(messages(request), /Use Go/);
    assert.doesNotMatch(messages(request), /ZEBRA-42|Use Python|Finish implementation/);
    assert.equal(b.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.kind === NOTE_SOURCE).length, 1);
    await h.turn(b, 'Continue the independent branch.');
    assert.equal(b.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.kind === NOTE_SOURCE).length, 1, 'later turns never duplicate the branch notice');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
    assert.equal((await h.ctx.sideBranch.close({ sessionId: b.id, action: 'auto' })).status, 'needs-choice');
    assert.equal((await h.ctx.sideBranch.close({ sessionId: b.id, action: 'archive' })).status, 'archived');
    assert.ok(h.ctx.workspaceRegistry.archivedSessionIds.includes(b.id));
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
  } finally { await h.close(); }
});

test('native UUID user prompts branch through turn-based HTTP requests without changing the source', async () => {
  const h = await createIsolatedHost();
  try {
    const a = await source(h);
    const events = a.session.snapshotEvents();
    const original = JSON.stringify(events);
    const prompts = events.filter(e => e.type === 'user/message' && e.surfaceOp === 'append' && e.data.source?.kind === 'user');
    const calls = h.adapter.requests.length;
    const post = async (operation, args) => {
      const route = h.routes.get(`/api/side-branch/${operation}`).fetch;
      const response = await route(new Request('http://offline.invalid', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args)
      }));
      assert.equal(response.status, 200);
      return response.json();
    };
    for (const intent of ['fork', 'revise']) {
      const turn = 2;
      const mode = intent === 'fork' ? 'continue' : 'edit';
      const inheritedTurns = intent === 'fork' ? turn : turn - 1;
      const prompt = prompts[turn - 1];
      const originalPrompt = intent === 'fork' ? '' : prompt.data.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      assert.match(prompt.data.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, 'the native LLM message factory supplies the raw UUID');
      const start = events.find(e => e.type === 'turn/start' && e.data.turn === turn);
      const end = events.find(e => e.type === 'turn/end' && e.data.turn === turn);
      const nextEnd = events.find(e => e.type === 'turn/end' && e.data.turn === turn + 1);
      const answer = events.find(e => e.type === 'assistant/message' && e.seq > start.seq && e.seq < end.seq && e.surfaceOp === 'append');
      const nextAnswer = events.find(e => e.type === 'assistant/message' && e.seq > end.seq && e.seq < nextEnd.seq && e.surfaceOp === 'append');
      assert.ok(answer?.data.message.id, 'the selected turn has a completed native answer');
      assert.ok(nextAnswer?.data.message.id, 'the following turn has an answer to exclude');
      assert.ok(start.seq < prompt.seq, 'fixture records the native start-before-admission ordering');
      const expectedBoundary = events.find(e => e.type === 'turn/end' && e.data.turn === inheritedTurns).seq;
      const args = { sourceSessionId: a.id, mode, turn, expectedPromptMessageId: prompt.data.id, intent };
      assert.equal('messageId' in args, false, 'legacy servers must receive their supported turn anchor');
      const inspected = await post('anchor-info', args);
      assert.equal(inspected.ok, true);
      assert.equal(inspected.anchor.mode, mode);
      assert.equal(inspected.anchor.intent, intent);
      assert.equal(inspected.anchor.turn, turn);
      assert.equal(inspected.anchor.atSeq, expectedBoundary);
      assert.equal(inspected.anchor.originalPrompt, originalPrompt);
      assert.equal(inspected.anchor.inheritedTurns, inheritedTurns);
      const created = await post('create', { ...args, requestId: `native-prompt-${intent}-${turn}` });
      assert.equal(created.ok, true);
      assert.equal(created.branch.ready, true);
      assert.equal(created.branch.mode, mode);
      assert.equal(created.branch.intent, intent);
      assert.equal(created.branch.turn, turn);
      assert.equal(created.branch.atSeq, expectedBoundary);
      assert.equal(created.branch.originalPrompt, originalPrompt, 'only revise supplies the original prompt as a draft');
      assert.equal(created.branch.inheritedTurns, inheritedTurns);
      const child = h.ctx.agents.get(created.branch.sessionId);
      assert.equal(created.branch.inheritedEventCount, expectedBoundary + 1);
      const prefix = child.session.snapshotEvents().slice(0, created.branch.inheritedEventCount);
      assert.deepEqual(prefix, events.slice(0, created.branch.inheritedEventCount));
      const hasPrompt = messageId => prefix.some(e => e.type === 'user/message' && e.data.id === messageId);
      const hasAnswer = messageId => prefix.some(e => e.type === 'assistant/message' && e.data.message.id === messageId);
      assert.equal(hasPrompt(prompt.data.id), intent === 'fork', 'fork preserves the selected question; revise cuts before it');
      assert.equal(hasAnswer(answer.data.message.id), intent === 'fork', 'fork preserves the selected answer; revise cuts before it');
      assert.equal(hasPrompt(prompts[turn].data.id), false, 'the next question never enters the branch prefix');
      assert.equal(hasAnswer(nextAnswer.data.message.id), false, 'the next answer never enters the branch prefix');
      assert.equal(child.status, 'idle');
      assert.equal(h.adapter.requests.length, calls, 'neither user action wakes a model');
      assert.equal(JSON.stringify(a.session.snapshotEvents()), original, 'each user action leaves the source unchanged');
    }
    const mismatch = { sourceSessionId: a.id, mode: 'edit', turn: 2, expectedPromptMessageId: prompts[0].data.id, intent: 'revise' };
    for (const operation of ['anchor-info', 'create']) {
      const rejected = await post(operation, { ...mismatch, requestId: 'native-prompt-mismatch' });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.code, 'anchor-mismatch');
    }
    assert.equal(h.ctx.sideBranch.table.get('native-prompt-mismatch'), undefined, 'mismatched anchors fail before branch metadata or children are created');
    assert.equal((await h.ctx.sessionQuery.listSessions()).length, 3);
    assert.equal(h.adapter.requests.length, calls, 'inspection and creation never wake a model');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
  } finally { await h.close(); }
});

test('pending branch notice and native session persist across a fresh in-memory host', async () => {
  let h = await createIsolatedHost();
  let closed = false;
  try {
    const a = await source(h);
    const original = JSON.stringify(a.session.snapshotEvents());
    const { branch } = await h.ctx.sideBranch.create({ requestId: 'recover-edit', sourceSessionId: a.id, mode: 'edit', turn: 2 });
    const root = h.root;
    await h.close(); closed = true;
    h = await createIsolatedHost({ root, reopen: true }); closed = false;
    assert.equal(h.ctx.agents.get(a.id), undefined, 'source must remain cold');
    const state = await h.ctx.sideBranch.branch({ sessionId: branch.sessionId });
    assert.equal(state.ownUserMessages, 0);
    assert.equal(state.branch.originalPrompt, 'Use Python to implement a limiter.');
    assert.equal(h.ctx.agents.get(branch.sessionId), undefined, 'branch observation does not activate');
    assert.equal(JSON.stringify((await h.ctx.sessionQuery.readSession(a.id)).events), original);
    const found = await h.ctx.sessionController.resolveAgent(branch.sessionId);
    assert.ok(found.agent, String(found.error));
    await h.turn(found.agent, 'Revised after host restart.');
    assert.equal(h.adapter.requests.length, 1);
    assert.equal(h.adapter.requests[0].model, 'source-model');
    assert.match(messages(h.adapter.requests[0]), /Revised after host restart/);
    assert.doesNotMatch(messages(h.adapter.requests[0]), /ZEBRA-42|Use Python/);
    const notes = found.agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.kind === NOTE_SOURCE);
    assert.equal(notes.length, 1);
    assert.equal(h.ctx.agents.get(a.id), undefined);
    assert.equal(JSON.stringify((await h.ctx.sessionQuery.readSession(a.id)).events), original);
  } finally { if (!closed) await h.close(); }
});

test('first-turn edit is native empty session; unused branch archives without a model call', async () => {
  const h = await createIsolatedHost();
  try {
    const a = await source(h);
    const original = JSON.stringify(a.session.snapshotEvents());
    const { branch } = await h.ctx.sideBranch.create({ requestId: 'first-edit', sourceSessionId: a.id, mode: 'edit', turn: 1 });
    const b = h.ctx.agents.get(branch.sessionId);
    assert.equal(branch.inheritedEventCount, 0);
    assert.ok(h.workspace.sessionIds.includes(a.id), 'source has explicit native workspace membership');
    assert.ok(h.workspace.sessionIds.includes(b.id), 'first-turn edit belongs to the same native workspace');
    assert.equal(h.workspace.sessionIds.indexOf(b.id), h.workspace.sessionIds.indexOf(a.id) - 1, 'child appears immediately before its source');
    assert.equal(b.session.header.cwd, a.session.header.cwd);
    assert.equal(h.ctx.permissionPresets.current(b.session), 'danger-full-access');
    assert.equal(h.adapter.requests.length, 5);
    assert.deepEqual((await h.ctx.sideBranch.turns({ sourceSessionId: b.id })).turns, []);
    assert.equal((await h.ctx.sideBranch.close({ sessionId: b.id, action: 'auto' })).status, 'archived');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
  } finally { await h.close(); }
});

test('native fork excludes a future human input queued before the inherited turn ends', async () => {
  const h = await createIsolatedHost();
  try {
    const { sessionId } = await h.ctx.sessionController.create({ cwd: h.cwd });
    const a = h.ctx.agents.get(sessionId);
    h.adapter.onRequest = () => {
      h.adapter.onRequest = undefined;
      a.followup(h.llm.createUserMessage({ content: [{ type: 'text', text: 'QUEUED-FUTURE-SECRET original second question.' }], source: { kind: 'user' } }));
    };
    await h.turn(a, 'First retained turn.');
    assert.equal(h.adapter.requests.length, 2);
    const before = JSON.stringify(a.session.snapshotEvents());
    const { branch } = await h.ctx.sideBranch.create({ requestId: 'queued-edit', sourceSessionId: a.id, mode: 'edit', turn: 2 });
    const b = h.ctx.agents.get(branch.sessionId);
    assert.equal(h.adapter.requests.length, 2, 'fork must not wake the inherited queue');
    assert.ok(a.session.snapshotEvents().slice(0, branch.inheritedEventCount).some(e => e.type === 'agent/inbox/spliced' && JSON.stringify(e).includes('QUEUED-FUTURE-SECRET')), 'fixture exercises the queue-before-boundary edge');
    await h.turn(b, 'Corrected second question.');
    assert.equal(h.adapter.requests.length, 3, 'one human prompt must produce one fake request');
    assert.doesNotMatch(messages(h.adapter.requests.at(-1)), /QUEUED-FUTURE-SECRET/);
    assert.match(messages(h.adapter.requests.at(-1)), /Corrected second question/);
    assert.equal(JSON.stringify(a.session.snapshotEvents()), before);
  } finally { await h.close(); }
});

test('branching an earlier turn leaves an actively running source undisturbed', async () => {
  const h = await createIsolatedHost();
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let running;
  try {
    const { sessionId } = await h.ctx.sessionController.create({ cwd: h.cwd });
    const a = h.ctx.agents.get(sessionId);
    await h.turn(a, 'Completed first turn.');
    h.adapter.onRequest = async () => { h.adapter.onRequest = undefined; entered.resolve(); await gate.promise; };
    running = h.turn(a, 'Active second turn.');
    await entered.promise;
    assert.equal(a.status, 'running');
    const before = JSON.stringify(a.session.snapshotEvents());
    const { branch } = await h.ctx.sideBranch.create({ requestId: 'while-active', sourceSessionId: a.id, mode: 'continue', turn: 1 });
    assert.equal(a.status, 'running');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), before);
    assert.equal(h.ctx.agents.get(branch.sessionId).status, 'idle');
    assert.equal(h.adapter.requests.length, 2);
    const state = await h.ctx.sideBranch.branch({ sessionId: branch.sessionId });
    assert.equal(state.sourceRunning, true);
    assert.equal((await h.ctx.sideBranch.close({ sessionId: branch.sessionId, action: 'auto' })).status, 'archived');
    assert.equal(a.status, 'running');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), before);
  } finally { gate.resolve(); if (running) await running; await h.close(); }
});

test('failed initialization retries the same child after host restart without reforking', async () => {
  let h = await createIsolatedHost();
  let closed = false;
  try {
    const a = await source(h);
    const original = JSON.stringify(a.session.snapshotEvents());
    const args = { requestId: 'retry-native-rename', sourceSessionId: a.id, mode: 'edit', turn: 2 };
    const nativeRename = h.ctx.sessionController.rename.bind(h.ctx.sessionController);
    let failRename = true;
    h.ctx.sessionController.rename = async request => {
      if (request.sessionId !== a.id && failRename) { failRename = false; throw new Error('Transient native rename test failure'); }
      return nativeRename(request);
    };
    let childId;
    await assert.rejects(h.ctx.sideBranch.create(args), error => {
      assert.match(error.message, /Transient native rename test failure/);
      assert.ok(error.sessionId); childId = error.sessionId;
      return true;
    });
    assert.ok(h.ctx.workspaceRegistry.archivedSessionIds.includes(childId));
    assert.equal(h.adapter.requests.length, 5);
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
    const root = h.root;
    await h.close(); closed = true;
    h = await createIsolatedHost({ root, reopen: true }); closed = false;
    assert.equal(h.ctx.agents.get(a.id), undefined);
    let unexpectedForks = 0;
    h.ctx.sessionController.fork = async () => { unexpectedForks++; throw new Error('Retry must not fork a second child'); };
    const { branch } = await h.ctx.sideBranch.create(args);
    assert.equal(branch.sessionId, childId);
    assert.equal(branch.ready, true);
    assert.equal(unexpectedForks, 0);
    assert.equal((await h.ctx.sessionQuery.listSessions()).length, 2);
    assert.equal(h.ctx.workspaceRegistry.archivedSessionIds.includes(childId), false);
    assert.equal(h.ctx.permissionPresets.current(h.ctx.agents.get(childId).session), 'danger-full-access');
    assert.equal(h.adapter.requests.length, 0, 'retry initializes configuration without model execution');
    assert.equal(h.ctx.agents.get(a.id), undefined);
    assert.equal(JSON.stringify((await h.ctx.sessionQuery.readSession(a.id)).events), original);
    const again = await h.ctx.sideBranch.create(args);
    assert.equal(again.branch.sessionId, childId);
    await h.turn(h.ctx.agents.get(childId), 'Corrected question after recovery.');
    assert.equal(h.adapter.requests.length, 1);
    assert.equal(h.adapter.requests[0].model, 'source-model');
    assert.equal(h.adapter.requests[0].reasoningEffort, 'high');
    assert.doesNotMatch(messages(h.adapter.requests[0]), /ZEBRA-42|Use Python/);
    assert.equal(JSON.stringify((await h.ctx.sessionQuery.readSession(a.id)).events), original);
  } finally { if (!closed) await h.close(); }
});

test('current custom permissions replace historical Auto identity in the fork', async () => {
  const h = await createIsolatedHost();
  try {
    let autoAdmissions = 0;
    h.ctx.permissionPresets.registerAuto(() => { autoAdmissions++; });
    const { sessionId } = await h.ctx.sessionController.create({ cwd: h.cwd });
    const a = h.ctx.agents.get(sessionId);
    await h.workspace.attachSession(a.id);
    h.ctx.permissionPresets.set(a.session, 'auto');
    await h.turn(a, 'Historical Auto first turn.');
    await h.turn(a, 'Historical second prompt to revise.');
    h.ctx.permissionPresets.set(a.session, 'danger-full-access');
    a.session.append('approval/policy', { policy: 'ask' });
    assert.equal(h.ctx.permissionPresets.current(a.session), 'custom');
    const original = JSON.stringify(a.session.snapshotEvents());
    const { branch } = await h.ctx.sideBranch.create({ requestId: 'custom-after-auto', sourceSessionId: a.id, mode: 'edit', turn: 2 });
    const b = h.ctx.agents.get(branch.sessionId);
    assert.ok(autoAdmissions > 0, 'native Auto admission hook was exercised without review/model plugins');
    assert.equal(h.ctx.permissionPresets.current(b.session), 'custom');
    const state = h.ctx.sessionProjections.stateOf(b.session, 'permissions');
    assert.notEqual(state.preset, 'auto', 'historical Auto identity must not survive current custom settings');
    assert.equal(state.sandbox, 'danger-full-access');
    assert.equal(state.approval, 'ask');
    assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
    assert.equal(h.adapter.requests.length, 2);
  } finally { await h.close(); }
});

test('native working-directory projection follows source while workspace ownership uses original header', async () => {
  const h = await createIsolatedHost();
  try {
    const nested = path.join(h.cwd, 'nested');
    await mkdir(nested);
    const inspectPath = candidate => {
      const full = path.resolve(candidate);
      assert.ok(full === h.cwd || full.startsWith(h.cwd + path.sep), 'directory fixture cannot access outside its workspace');
      return full;
    };
    h.ctx.fs.resolve = async (candidate, options = {}) => inspectPath(path.resolve(options.cwd ?? h.cwd, candidate));
    h.ctx.fs.stat = async candidate => ({ type: (await stat(inspectPath(candidate))).isDirectory() ? 'directory' : 'file' });
    h.ctx.fs.processPath = candidate => inspectPath(candidate);
    await h.mount('dsh-working-directory', { defaultDirectory: h.cwd });
    const a = await source(h);
    await h.ctx.workingDirectory.set(a, nested);
    await h.ctx.sessions.flush(a.session);
    const original = JSON.stringify(a.session.snapshotEvents());
    for (const turn of [1, 2]) {
      const { branch } = await h.ctx.sideBranch.create({ requestId: `cwd-edit-${turn}`, sourceSessionId: a.id, mode: 'edit', turn });
      const b = h.ctx.agents.get(branch.sessionId);
      assert.equal(b.session.header.cwd, h.cwd, 'immutable project identity is preserved');
      assert.ok(h.workspace.sessionIds.includes(b.id), 'both modes retain source workspace membership');
      assert.equal(h.ctx.workingDirectory.get(b.session), nested, 'effective current directory is inherited independently');
      assert.equal(h.ctx.sessionProjections.snapshot(b.session, ['workingDirectory']).values.workingDirectory, nested);
      assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
      await h.turn(b, `Edited question ${turn}.`);
      const requestText = h.adapter.requests.at(-1).messages.flatMap(message => message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      assert.ok(requestText.includes(`Current working directory: ${JSON.stringify(nested)}.`), 'native request context reports the effective working directory');
      assert.equal(JSON.stringify(a.session.snapshotEvents()), original);
    }
  } finally { await h.close(); }
});

test('plugin registers only authenticated connection routes and enforces bounded JSON requests', async () => {
  const h = await createIsolatedHost();
  try {
    const pluginRoutes = [...h.routes.entries()].filter(([path]) => path.startsWith('/api/side-branch/'));
    assert.deepEqual(pluginRoutes.map(([path]) => path).sort(), ['anchor-info', 'branch', 'close', 'create', 'turns'].map(s => '/api/side-branch/' + s).sort());
    for (const [, route] of pluginRoutes) { assert.deepEqual(route.methods, ['POST']); assert.equal(route.requestBody, 'buffered'); }
    const route = h.routes.get('/api/side-branch/create').fetch;
    assert.equal((await route(new Request('http://offline.invalid', { method: 'GET' }))).status, 405);
    assert.equal((await route(new Request('http://offline.invalid', { method: 'POST', body: '{}' }))).status, 415);
    assert.equal((await route(new Request('http://offline.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) }))).status, 413);
    const invalid = await route(new Request('http://offline.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' }));
    assert.equal((await invalid.json()).code, 'invalid-request');
    assert.equal(h.adapter.requests.length, 0);
  } finally { await h.close(); }
});
