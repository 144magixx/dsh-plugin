import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoritesService, createFetchHandler, INITIAL, validate } from '../lib/service.js';
import { ATTENTION_KEY, initialAttention, applyAttention, attentionFor } from '../lib/attention.js';

function fixture() {
  let state = structuredClone(INITIAL), failWrite = false;
  const sessions = new Map([
    ['a', { session: { id: 'a', cwd: '/work/a', createdAt: 3 }, title: { title: 'Alpha 登录' } }],
    ['b', { session: { id: 'b', cwd: '/work/b', createdAt: 2 }, title: { title: 'Beta 报表' } }],
    ['child', { session: { id: 'child', origin: 'subagent', cwd: '/work/a', createdAt: 1 }, title: { title: 'Child' } }],
  ]);
  const statuses = new Map([...sessions.keys()].map(id => [id, { [ATTENTION_KEY]: initialAttention(), userQuestions: { active: [] } }]));
  const ctx = {
    agents: { get: () => ({ id: 'live' }) },
    storageDomain: { async open() { return { global: { get: () => structuredClone(state), async set(next) { if (failWrite) throw new Error('disk unavailable'); state = structuredClone(next); } }, async close() {} }; } },
    workspaceRegistry: { list: () => [{ title: '项目 A', sessionIds: ['a'] }, { title: '项目 B', sessionIds: ['b'] }] },
    sessionQuery: {
      async observeSession(id) { if (!sessions.has(id)) throw new Error('not found'); return { projections: { values: structuredClone(statuses.get(id)) }, [Symbol.dispose]() {} }; },
      async listSessions() { return [...sessions.values()].map(value => ({ header: value.session })); },
      async readTitleSnapshot(id) { if (!sessions.has(id)) throw new Error('not found'); return structuredClone(sessions.get(id)); },
      async readTitleSnapshots(ids) { return ids.map(id => sessions.has(id) ? { sessionId: id, status: 'fulfilled', value: structuredClone(sessions.get(id)) } : { sessionId: id, status: 'rejected', reason: new Error('not found') }); },
    },
  };
  return { ctx, sessions, statuses, state: () => state, fail: value => { failWrite = value; } };
}

test('concurrent additions preserve both entries, deduplicate, and survive a fresh service', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx);
  await Promise.all([service.execute({ action: 'add', sessionId: 'a' }), service.execute({ action: 'add', sessionId: 'b' }), service.execute({ action: 'add', sessionId: 'a' })]);
  assert.deepEqual(f.state().items.map(item => item.sessionId), ['a', 'b']); assert.equal(f.state().revision, 2);
  await service.dispose();
  const restored = createFavoritesService(f.ctx);
  assert.deepEqual((await restored.execute({ action: 'list' })).items.map(item => item.sessionId), ['a', 'b']);
  const removed = await restored.execute({ action: 'remove', sessionId: 'a' });
  assert.equal(removed.changed, true); assert.equal(f.sessions.size, 3);
  assert.equal((await restored.execute({ action: 'remove', sessionId: 'a' })).changed, false);
  await restored.dispose();
});

test('failed persistence cannot falsely report success or remove existing bookmarks', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx);
  await service.execute({ action: 'add', sessionId: 'a' }); f.fail(true);
  await assert.rejects(service.execute({ action: 'add', sessionId: 'b' }), /disk unavailable/);
  await assert.rejects(service.execute({ action: 'remove', sessionId: 'a' }), /disk unavailable/);
  assert.deepEqual(f.state().items.map(item => item.sessionId), ['a']); assert.equal(f.state().revision, 1);
  f.fail(false); await service.execute({ action: 'add', sessionId: 'b' }); assert.equal(f.state().revision, 2);
  await service.dispose();
});

test('search pagination, workspace matching, renamed titles, and unavailable favorites', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx);
  const page = await service.execute({ action: 'search', limit: 1 }); assert.equal(page.total, 2); assert.equal(page.nextOffset, 1);
  const next = await service.execute({ action: 'search', offset: 1, limit: 1 }); assert.equal(next.items[0].sessionId, 'b'); assert.equal(next.nextOffset, null);
  assert.equal((await service.execute({ action: 'search', query: '项目 A' })).items[0].sessionId, 'a');
  await assert.rejects(service.execute({ action: 'add', sessionId: 'child' }), /ordinary_sessions_only/);
  await assert.rejects(service.execute({ action: 'add', sessionId: 'missing' }), /not found/);
  await service.execute({ action: 'add', sessionId: 'a' }); f.sessions.get('a').title.title = '新标题';
  assert.equal((await service.execute({ action: 'list' })).items[0].title, '新标题');
  f.sessions.delete('a'); const missing = await service.execute({ action: 'list' });
  assert.equal(missing.items.length, 1); assert.equal(missing.items[0].unavailable, true);
  await service.execute({ action: 'remove', sessionId: 'a' }); assert.equal(f.state().items.length, 0);
  await service.dispose();
});

test('HTTP and agent caller share semantics; invalid input does not mutate', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx), fetchHandler = createFetchHandler(service);
  const request = input => new Request('http://localhost/api/session-favorites/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const response = await fetchHandler(request({ action: 'add', sessionId: 'a' })); assert.equal(response.status, 200);
  assert.equal((await service.execute({ action: 'list' })).items[0].sessionId, 'a');
  await service.execute({ action: 'remove', sessionId: 'a' }); assert.equal((await (await fetchHandler(request({ action: 'list' }))).json()).items.length, 0);
  for (const input of [{ action: 'add' }, { action: 'remove', sessionId: '\n' }, { action: 'search', limit: 0 }, { action: 'search', offset: -1 }, { action: 'list', extra: true }]) assert.throws(() => validate(input));
  assert.equal((await service.execute({ action: 'list', sessionId: '', query: '', offset: 0, limit: 30 })).items.length, 0);
  assert.equal((await fetchHandler(request({ action: 'search', query: 'x'.repeat(5000) }))).status, 413);
  assert.equal(f.state().items.length, 0); await service.dispose();
});

test('change stream reports committed revisions and closes on unload', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx), abort = new AbortController();
  const response = await service.watch(abort.signal), reader = response.body.getReader(), decoder = new TextDecoder();
  assert.equal(JSON.parse(decoder.decode((await reader.read()).value)).revision, 0);
  await service.execute({ action: 'add', sessionId: 'a' });
  assert.equal(JSON.parse(decoder.decode((await reader.read()).value)).revision, 1);
  await service.dispose(); assert.equal((await reader.read()).done, true); reader.releaseLock();
});

test('green follows successful completion; yellow wins and is not cleared by reading', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx, { now: () => 100 });
  const status = f.statuses.get('a');
  status[ATTENTION_KEY] = { ...initialAttention(), completedSeq: 10, completedAt: 50 };
  await service.execute({ action: 'add', sessionId: 'a' });
  const view = async () => (await service.execute({ action: 'list' })).items[0];
  assert.equal((await view()).attention, 'none');
  status[ATTENTION_KEY] = applyAttention(status[ATTENTION_KEY], { type: 'turn/end', seq: 20, time: 150, data: { reason: { kind: 'completed' } } });
  assert.equal((await view()).attention, 'completed');
  status.userQuestions.active = [{ callId: 'q1', state: 'continued' }];
  assert.equal((await view()).attention, 'question');
  await service.execute({ action: 'seen', sessionId: 'a', throughSeq: 20 });
  assert.equal((await view()).attention, 'question');
  status.userQuestions.active = [];
  assert.equal((await view()).attention, 'none');
  status[ATTENTION_KEY] = applyAttention(status[ATTENTION_KEY], { type: 'turn/end', seq: 40, time: 200, data: { reason: { kind: 'completed' } } });
  await service.execute({ action: 'seen', sessionId: 'a', throughSeq: 20 });
  assert.equal((await view()).attention, 'completed');
  await service.execute({ action: 'seen', sessionId: 'a', throughSeq: 999 });
  assert.equal(f.state().items[0].seenSeq, 40);
  await service.dispose();
  const reopened = createFavoritesService(f.ctx);
  assert.equal((await reopened.execute({ action: 'list' })).items[0].attention, 'none');
  await reopened.dispose();
});

test('live blocking question and plan review raise yellow without approving anything', async () => {
  const f = fixture(), service = createFavoritesService(f.ctx);
  await service.execute({ action: 'add', sessionId: 'a' });
  const finish = service.beginQuestion('a');
  assert.equal((await service.execute({ action: 'list' })).items[0].attention, 'question');
  finish(); assert.equal((await service.execute({ action: 'list' })).items[0].attention, 'none');
  const status = f.statuses.get('a');
  status[ATTENTION_KEY] = applyAttention(initialAttention(), { type: 'turn/start', seq: 1, data: {} });
  status[ATTENTION_KEY] = applyAttention(status[ATTENTION_KEY], { type: 'tool/call', seq: 2, data: { name: 'exit_plan_mode', callId: 'p1' } });
  assert.equal((await service.execute({ action: 'list' })).items[0].attention, 'question');
  status[ATTENTION_KEY] = applyAttention(status[ATTENTION_KEY], { type: 'tool/result', seq: 3, data: { message: { toolCallId: 'p1' } } });
  assert.equal((await service.execute({ action: 'list' })).items[0].attention, 'none');
  await service.dispose();
});

test('errors, stops, forked history, and historical completion do not create new green dots', () => {
  const original = initialAttention({}, 10);
  assert.equal(applyAttention(original, { type: 'turn/end', seq: 9, time: 10, data: { reason: { kind: 'completed' } } }), original);
  for (const kind of ['error', 'aborted', 'blocked', 'interrupted', 'max-tokens']) {
    const next = applyAttention(initialAttention(), { type: 'turn/end', seq: 10, time: 20, data: { reason: { kind } } });
    assert.equal(next.completedSeq, -1);
  }
  const item = { addedAt: 100, seenSeq: -1 };
  assert.equal(attentionFor(item, { completedSeq: 10, completedAt: 50, question: false, running: false }).attention, 'none');
  assert.equal(attentionFor(item, undefined).attention, 'unknown');
  const live = attentionFor(item, { completedSeq: 10, completedAt: 50, question: false, running: true });
  assert.equal(live.running, true, 'a live turn is exposed for the spinner');
  assert.equal(attentionFor(item, { completedSeq: 10, completedAt: 50, question: true, running: true }).attention, 'question', 'a question still outranks progress');
  assert.equal(attentionFor(item, undefined).running, false);
});
