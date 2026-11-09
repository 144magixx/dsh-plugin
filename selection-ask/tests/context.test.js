import test from 'node:test';
import assert from 'node:assert/strict';
import { toolFilePaths, AskError, applyStreamFrame, normalizeImages, normalizeModel, normalizeQuestion, boundaryText, captureConfig, fence, foldMessages, forkSeed, normalizeAnswer, normalizeSelection, publicQuestions, titleFrom } from '../lib/context.js';
import { artifactDirectory, validateThread, SESSION_PREFIX, VIEW_WAIT_MAX_MS } from '../lib/service.js';
import { readBody, routeHandler, BODY_DEADLINE_MS } from '../lib/index.js';

const json = (body, init = {}) => new Request('http://x.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init });

test('selection validation keeps known, bounded fields only', () => {
  const s = normalizeSelection({ kind: 'file', text: 'abc', path: 'a.js', startLine: 5, endLine: 2, role: 'boss', before: 'b', extra: 1 });
  assert.deepEqual(s, { kind: 'file', text: 'abc', path: 'a.js', startLine: 5, endLine: 5, before: 'b' });
  assert.throws(() => normalizeSelection({ kind: 'secret', text: 'x' }), AskError);
  assert.throws(() => normalizeSelection({ kind: 'chat', text: '   ' }), /empty/);
  assert.throws(() => normalizeSelection({ kind: 'chat', text: 'x'.repeat(20001) }), /limited/);
  assert.throws(() => normalizeSelection({ kind: 'file', text: 'x', startLine: 0 }), /positive/);
  assert.equal(normalizeSelection({ kind: 'chat', text: 'x', turn: 0, role: 'tool' }).role, 'tool');
  assert.equal(titleFrom('  hello\n  world  '), 'hello world');
  assert.equal(titleFrom('x'.repeat(200)).length, 80);
});

test('boundary message names the source and fences hostile text', () => {
  const text = boundaryText({ sourceSessionId: 's1', selection: { kind: 'file', path: 'lib/a.js', startLine: 3, endLine: 9, text: 'a ``` b', before: 'x', after: 'y' } });
  assert.match(text, /^Selection Ask boundary\./);
  assert.match(text, /file lib\/a\.js lines 3-9/);
  assert.match(text, /````\na ``` b\n````/);
  assert.match(text, /just before[\s\S]*x[\s\S]*just after[\s\S]*y/);
  assert.match(boundaryText({ sourceSessionId: 's', selection: { kind: 'chat', text: 'q', turn: 2, role: 'user' } }), /a user message in the conversation \(turn 2\)/);
  assert.equal(fence('no ticks'), '```');
});

test('fork seed mirrors a native fork prefix', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }, { type: 'turn/end', seq: 1, time: 2, data: { turn: 1 } },
    { type: 'turn/start', seq: 2, time: 3, data: { turn: 2 } },
  ];
  const { seed, inheritedEventCount } = forkSeed(events);
  assert.equal(inheritedEventCount, 2);
  assert.deepEqual(seed.at(-1), { type: 'session/end-seed', seq: 2, time: 2, data: { inherited: true } });
  assert.deepEqual(forkSeed(events.slice(2)), { seed: [], inheritedEventCount: 0 });
  assert.deepEqual(forkSeed([{ type: 'turn/end', seq: 5 }]), { seed: [], inheritedEventCount: 0 }, 'non-contiguous logs are not seeded');
});

test('captured config prefers an unconsumed model choice and live permission identity', () => {
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'old', reasoningEffort: 'low' } } } },
    { type: 'model/selection', data: { provider: 'p', model: 'new', reasoningEffort: 'high' } },
    { type: 'sandbox/mode', data: { mode: 'read-only' } }, { type: 'approval/policy', data: { policy: 'never' } },
    { type: 'permission/preset', data: { preset: 'read-only' } },
  ];
  assert.deepEqual(captureConfig(events, { permissions: { currentValue: 'danger-full-access' }, workingDirectory: '/w' }, {}),
    { model: { provider: 'p', model: 'new', reasoningEffort: 'high' }, sandbox: 'read-only', approval: 'never', permissionPreset: 'danger-full-access', cwd: '/w' });
  assert.deepEqual(captureConfig([], {}, { model: { provider: 'd', model: 'm' }, sandbox: 'workspace-write', approval: 'ask' }).model, { provider: 'd', model: 'm' });
  assert.equal(captureConfig([], {}, {}).model, undefined);
});

test('view folding hides inherited history and the boundary, and summarizes tools', () => {
  const events = [
    { type: 'user/message', seq: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'inherited' }] } },
    { type: 'turn/start', seq: 3, data: { turn: 1 } },
    { type: 'user/message', seq: 4, data: { source: { kind: 'plugin:selection-ask' }, content: [{ type: 'text', text: 'boundary' }] } },
    { type: 'user/message', seq: 5, data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Why?' }] } },
    { type: 'assistant/message', seq: 6, data: { turn: 1, message: { content: [{ type: 'reasoning', text: 'hmm' }, { type: 'tool-call', id: 'c1', name: 'read' }] } } },
    { type: 'tool/result', seq: 7, data: { message: { toolCallId: 'c1', isError: false } } },
    { type: 'assistant/message', seq: 8, data: { turn: 1, message: { content: [{ type: 'tool-call', id: 'c2', name: 'edit' }] } } },
    { type: 'tool/result', seq: 9, data: { message: { toolCallId: 'c2', isError: true } } },
    { type: 'assistant/message', seq: 10, data: { turn: 1, message: { content: [{ type: 'text', text: 'Because.' }] } } },
    { type: 'turn/end', seq: 11, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 12, data: { turn: 2 } },
    { type: 'user/message', seq: 13, data: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'Again' }] } },
    { type: 'turn/end', seq: 14, data: { turn: 2, reason: { kind: 'error', error: { message: 'quota' } } } },
  ];
  const { messages, turnOpen } = foldMessages(events, 3);
  assert.equal(turnOpen, false);
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(messages[0].text, 'Why?');
  assert.equal(messages[1].text, 'Because.');
  assert.equal(messages[1].reasoning, true);
  assert.deepEqual(messages[1].tools.map(tool => [tool.name, tool.status]), [['read', 'done'], ['edit', 'error']]);
  assert.equal(messages[3].error, 'quota');
  assert.equal(foldMessages(events, 3, 0).messages.some(m => m.text === 'inherited'), false);
});

test('stream frames accumulate per attempt and reset on end', () => {
  let state = applyStreamFrame(null, { type: 'start', attemptId: 'a' });
  state = applyStreamFrame(state, { type: 'chunk', attemptId: 'a', chunk: { type: 'reasoning-delta', text: 'x' } });
  state = applyStreamFrame(state, { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', text: 'Hel' } });
  state = applyStreamFrame(state, { type: 'chunk', attemptId: 'b', chunk: { type: 'text-delta', text: 'ignored' } });
  state = applyStreamFrame(state, { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', text: 'lo' } });
  assert.deepEqual(state, { attemptId: 'a', text: 'Hello', reasoning: true });
  assert.equal(applyStreamFrame(state, { type: 'end' }), null);
});

test('interaction answers are validated against the original request', () => {
  assert.equal(normalizeAnswer({ kind: 'approval' }, { outcome: 'allowed-once' }), 'allowed-once');
  assert.throws(() => normalizeAnswer({ kind: 'approval' }, { outcome: 'allowed-always' }), /outcome/);
  const pending = { kind: 'question', questions: [{ id: 'a', multiSelect: false, options: [{ label: 'X' }, { label: 'Y' }] }, { id: 'b', multiSelect: true, options: [{ label: 'P' }, { label: 'Q' }] }] };
  assert.deepEqual(normalizeAnswer(pending, { answers: [{ id: 'a', selected: ['X', 'forged'] }] }), { answers: [{ id: 'a', selected: ['X'] }, { id: 'b', selected: [] }] });
  assert.deepEqual(normalizeAnswer(pending, { answers: [{ id: 'a', selected: ['X'], custom: 'mine' }, { id: 'b', selected: ['P', 'Q'] }] }).answers, [{ id: 'a', selected: [], custom: 'mine' }, { id: 'b', selected: ['P', 'Q'] }]);
  assert.throws(() => normalizeAnswer(pending, { answers: [{ id: 'a', selected: ['X', 'Y'] }] }), /one choice/);
  assert.throws(() => normalizeAnswer(pending, { answers: [{ id: 'zzz' }] }), /Unknown/);
  assert.equal(publicQuestions([{ id: 1, question: 'q', options: [{ label: 'a', description: 'd' }] }])[0].id, '1');
});

test('stored records and artifact deletion are guarded', () => {
  const base = { id: 't', requestId: 'r', sourceSessionId: 's', sessionId: `${SESSION_PREFIX}abc`, title: 'q', createdAt: 1, updatedAt: 2, cwd: '/w', model: null, selection: { kind: 'chat', text: 'x' } };
  assert.equal(validateThread(base).sessionId, `${SESSION_PREFIX}abc`);
  assert.throws(() => validateThread({ ...base, sessionId: 'session-abc' }), /hidden/);
  assert.equal(artifactDirectory(`${SESSION_PREFIX}abc`, { path: `/root/cwd/${SESSION_PREFIX}abc/v4.jsonl` }), `/root/cwd/${SESSION_PREFIX}abc`);
  assert.equal(artifactDirectory(`${SESSION_PREFIX}abc`, { path: '/root/cwd/other/v4.jsonl' }), undefined);
  assert.equal(artifactDirectory('session-abc', { path: '/root/cwd/session-abc/v4.jsonl' }), undefined, 'never deletes ordinary sessions');
  assert.equal(artifactDirectory(`${SESSION_PREFIX}../x`, { path: `/root/${SESSION_PREFIX}../x/v4.jsonl` }), undefined);
  assert.equal(artifactDirectory(`${SESSION_PREFIX}abc`, { path: `relative/${SESSION_PREFIX}abc/v4.jsonl` }), undefined);
});

test('routes enforce JSON, size, and a bounded body deadline', async () => {
  const service = { lifetime: new AbortController(), closed: false, async list(args) { return { threads: [], args }; } };
  const handler = routeHandler(service, 'list');
  const ok = await handler(json({ sourceSessionId: 's' }));
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).args, { sourceSessionId: 's' });
  assert.equal((await handler(new Request('http://x', { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await handler(json('['))).status, 400);
  assert.equal((await handler(json('[]'))).status, 400);
  assert.equal((await handler(json('x'.repeat(300 * 1024)))).status, 413);
  service.closed = true;
  assert.equal((await handler(json({}))).status, 503, 'unloading service refuses new work');
  assert.ok(VIEW_WAIT_MAX_MS <= 2500 && BODY_DEADLINE_MS <= 2500, 'both waits stay far below the 10 s Desktop drain');
  // A stalled request body cannot hold the route beyond its deadline.
  const stalled = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } });
  const started = performance.now();
  const response = await routeHandler({ lifetime: new AbortController(), closed: false }, 'list')(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stalled, duplex: 'half' }));
  assert.equal(response.status, 499);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= BODY_DEADLINE_MS - 100 && elapsed < BODY_DEADLINE_MS + 800, `${elapsed}ms`);
  await assert.rejects(readBody(json('{}'), AbortSignal.abort()), error => error.status === 499);
});

test('image uploads and model choices are validated', () => {
  const png = Buffer.from('fake').toString('base64');
  assert.deepEqual(normalizeImages([{ data: png, mediaType: 'image/png', name: 'a.png' }]), [{ type: 'image', data: png, mediaType: 'image/png', name: 'a.png' }]);
  assert.deepEqual(normalizeImages(undefined), []);
  assert.throws(() => normalizeImages([{ data: png, mediaType: 'image/svg+xml' }]), /PNG/);
  assert.throws(() => normalizeImages([{ data: 'not base64!', mediaType: 'image/png' }]), /base64/);
  assert.throws(() => normalizeImages(Array.from({ length: 9 }, () => ({ data: png, mediaType: 'image/png' }))), /At most 8/);
  assert.throws(() => normalizeImages([{ data: 'A'.repeat(14 * 1024 * 1024), mediaType: 'image/png' }]), /10 MB/);
  assert.equal(normalizeQuestion('', { allowEmpty: true }), '');
  assert.throws(() => normalizeQuestion(''), /question/);
  assert.deepEqual(normalizeModel({ provider: 'p', model: 'm', reasoningEffort: 'high', extra: 1 }), { provider: 'p', model: 'm', reasoningEffort: 'high' });
  assert.equal(normalizeModel(undefined), undefined);
  assert.throws(() => normalizeModel({ provider: 'p' }), /model/);
});

test('file paths named by deliverable and edit tools become clickable references', () => {
  assert.deepEqual(toolFilePaths('present', JSON.stringify({ files: [{ path: 'out/a.png', description: 'x' }, 'b.md'] })), ['out/a.png', 'b.md']);
  assert.deepEqual(toolFilePaths('fs.write', { file_path: '/w/c.js' }), ['/w/c.js']);
  assert.deepEqual(toolFilePaths('bash', { command: 'rm -rf /' }), []);
  assert.deepEqual(toolFilePaths('present', '{bad json'), []);
  const { messages } = foldMessages([
    { type: 'assistant/message', seq: 1, data: { turn: 1, message: { content: [{ type: 'tool-call', id: 'c', name: 'present', arguments: '{"files":[{"path":"ledger.png"}]}' }, { type: 'text', text: '![图](ledger.png)' }] } } },
  ]);
  assert.deepEqual(messages[0].files, ['ledger.png']);
});
