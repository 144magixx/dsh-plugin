import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { branchAddress, parseBranchAddress, retryBranchAddress, nativeCapabilities, requiresNewRequest, createApi, nativeTurnState, eligible, preview, createRuntime, branchResourceProvider, ZH, EN, CSS, STORAGE_KEY, client } from '../lib/client-core.js'

const branch = { sessionId: 'child/a ?汉', sourceSessionId: 'source?#汉', turn: 2, mode: 'edit', ready: true, originalPrompt: 'Complete original\n第二行', attachmentCount: 2, drift: { files: ['a.js'], unknown: true, laterTurns: 4 }, totalTurns: 5 }
const plain = (value) => JSON.parse(JSON.stringify(value))
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
function runtime(api, options = {}) { return createRuntime({ api, storage: storage(), makeId: () => 'stable-request', log: { warn() {} }, ...options }) }

test('resource addresses round trip opaque ordinary Session ids', () => {
  const address = branchAddress(branch)
  assert.deepEqual(plain(parseBranchAddress(address)), { sessionId: branch.sessionId, sourceSessionId: branch.sourceSessionId, mode: 'edit', turn: 2 })
  for (const invalid of ['https://side-branch/session/id?source=s&mode=edit&turn=1', 'dsh-resource://side-chat/session/id?source=s&mode=edit&turn=1', 'dsh-resource://side-branch/session/id?source=s&mode=edit&turn=0', 'dsh-resource://side-branch/session/id?source=s&mode=edit&turn=1.5', 'dsh-resource://side-branch/session/%E0%A4?source=s&mode=edit&turn=1', 'dsh-resource://side-branch/session/id?mode=edit&turn=1']) assert.equal(parseBranchAddress(invalid), null)
  assert.throws(() => branchAddress({ ...branch, turn: -1 }))
})

test('native capability probe refuses missing factory or draft setter', () => {
  const ctx = { sessions: { retain() {} }, conversation: { input: { requestDraftInitialization() {} } }, slots: { snapshot: (key) => key === 'factory:conversation.content' ? [{}] : [] } }
  assert.equal(nativeCapabilities(ctx), true)
  assert.equal(nativeCapabilities({ ...ctx, slots: { snapshot: () => [] } }), false)
  assert.equal(nativeCapabilities({ ...ctx, conversation: {} }), false)
  assert.equal(nativeCapabilities({ ...ctx, slots: { snapshot() { throw new Error('unsupported') } } }), false)
})

test('API uses authenticated POST routes and keeps host failure recovery id', async () => {
  let call
  const api = createApi(async (...args) => { call = args; return { ok: true, json: async () => ({ ok: true, branch }) } })
  const signal = new AbortController().signal
  assert.equal((await api('create', { requestId: 'r' }, signal)).branch, branch)
  assert.equal(call[0], '/api/side-branch/create')
  assert.equal(call[1].credentials, 'same-origin')
  assert.equal(call[1].method, 'POST')
  assert.equal(call[1].signal, signal)
  assert.deepEqual(JSON.parse(call[1].body), { requestId: 'r' })
  const failed = createApi(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'configuration-failed', message: 'retry configuration', sessionId: 'recover-me' }) }))
  await assert.rejects(failed('create', {}), (error) => error.sessionId === 'recover-me' && error.code === 'configuration-failed')
  await assert.rejects(api('delete', {}), /Unknown/)
})

function chat({ unavailable = false, later = false } = {}) {
  const tail = { kind: 'turn-tail', data: { branchUnavailable: unavailable, seq: 9, closing: { finalNode: { messageId: 'm', seq: 8 } } } }
  const nodes = new Map([['answer', { kind: 'assistant-step', anchorSeq: 8 }], ['tail', tail]])
  if (later) nodes.set('after', { kind: 'user-message', anchorSeq: 10 })
  return { timeline: { turnOrder: [2] }, locations: { getTurn: () => [...nodes.keys()] }, nodes }
}
test('per-turn eligibility reproduces native footer gating without folding events', () => {
  assert.equal(nativeTurnState(chat(), 'm'), '2:ready')
  assert.equal(nativeTurnState(chat({ unavailable: true }), 'm'), '2:blocked')
  assert.equal(nativeTurnState(chat({ later: true }), 'm'), '2:blocked')
  assert.equal(nativeTurnState(chat(), 'other'), '')
  assert.equal(nativeTurnState({}, 'm'), '')
  assert.equal(eligible({ completed: true, editable: false }, 'edit'), false)
  assert.equal(eligible({ completed: true, branchable: false, editable: true }, 'continue'), false)
  assert.equal(eligible({ completed: true, editable: true }, 'edit'), true)
})

test('user message eligibility follows its exact initial prompt without needing a final answer', () => {
  const node = { kind: 'user', id: 'q2', data: { seq: 4, source: { kind: 'user' } }, location: { kind: 'step', turn: { turn: 2 } } };
  const later = { ...node, id: 'later', data: { ...node.data, seq: 6 } };
  const snapshot = (ended) => ({ timeline: { turns: new Map([[2, ended ? { end: { seq: 10 } } : {}]]) }, locations: { getTurn: () => ['later', 'q2'] }, nodes: new Map([['q2', node], ['later', later]]) });
  const ready = snapshot(true);
  assert.equal(client.nativeUserTurnState(ready, node), '2:ready');
  assert.equal(client.nativeUserTurnState(snapshot(false), node), '2:blocked');
  assert.equal(client.nativeUserTurnState(ready, later), '');
  assert.equal(client.nativeUserTurnState({}, node), '');
  assert.equal(client.nativeUserTurnState(ready, { ...node, kind: 'steering' }), '');
  assert.equal(client.nativeUserTurnState(ready, { ...node, data: { source: { kind: 'runtime-context' } } }), '');
  assert.equal(client.nativeUserTurnState(ready, { ...node, id: undefined }), '');
  assert.equal(client.nativeUserTurnState(ready, { ...node, location: { kind: 'root' } }), '');
  assert.equal(client.nativeUserTurnState(ready, { ...node, location: { kind: 'turn', turn: { turn: 0 } } }), '');
  assert.equal(client.nativeUserTurnState({ ...ready, timeline: undefined }, { ...node, location: { kind: 'turn', turn: { turn: 2, end: { seq: 10 } } } }), '2:ready');
});
test('all footer selectors share one traversal per immutable Chat snapshot', () => {
  const snapshot = chat()
  let traversals = 0
  const getTurn = snapshot.locations.getTurn
  snapshot.locations.getTurn = (turn) => { traversals++; return getTurn(turn) }
  assert.equal(nativeTurnState(snapshot, 'm'), '2:ready')
  assert.equal(nativeTurnState(snapshot, 'other'), '')
  assert.equal(nativeTurnState(snapshot, 'm'), '2:ready')
  assert.equal(traversals, 1)
  const next = { ...snapshot }
  nativeTurnState(next, 'm')
  assert.equal(traversals, 2)
})

test('create retries reuse the durable id and deduplicate concurrent clicks', async () => {
  const requests = []
  let resolve
  let fail = true
  const store = storage()
  const api = async (_operation, request) => {
    requests.push(request)
    if (fail) { fail = false; throw new Error('lost response') }
    return new Promise((done) => { resolve = done })
  }
  const first = runtime(api, { storage: store })
  const request = { sourceSessionId: 'source', mode: 'edit', turn: 2 }
  await assert.rejects(first.create(request), /lost response/)
  first.dispose()
  const second = runtime(api, { storage: store, makeId: () => 'must-not-replace' })
  const a = second.create(request)
  const b = second.create(request)
  assert.equal(a, b)
  resolve({ branch })
  assert.equal(await a, branch)
  assert.equal(requests[0].requestId, requests[1].requestId)
  assert.equal(requests.length, 2)
  assert.equal(Object.values(second.getSnapshot().requests)[0], 'stable-request')
  second.createdOpened(request)
  assert.equal(Object.keys(second.getSnapshot().requests).length, 0)
})

test('only uncertain creation and existing work offer an explicit new request', () => {
  assert.equal(requiresNewRequest({ code: 'creation-uncertain' }), true)
  assert.equal(requiresNewRequest({ code: 'branch-has-work' }), true)
  for (const code of ['disk-full', 'creation-incomplete', 'create-failed', undefined]) assert.equal(requiresNewRequest({ code }), false)
})

test('explicit reset creates nothing, preserves recovery, and next create gets a new id', async () => {
  let serial = 0
  const calls = []
  const store = storage()
  const request = { sourceSessionId: branch.sourceSessionId, mode: 'edit', turn: branch.turn }
  const value = runtime(async (_name, body) => {
    calls.push(body)
    if (calls.length === 1) throw Object.assign(new Error('inspect sessions'), { code: 'creation-uncertain' })
    return { branch: { ...branch, sessionId: 'new-child' } }
  }, { storage: store, makeId: () => `request-${++serial}` })
  await assert.rejects(value.create(request), error => error.code === 'creation-uncertain')
  const requestKey = Object.keys(value.getSnapshot().requests)[0]
  value.record(branch, { pendingClose: true, requestKey })
  value.newRequest(request)
  assert.equal(calls.length, 1)
  assert.equal(Object.keys(JSON.parse(store.getItem(STORAGE_KEY)).requests).length, 0)
  assert.equal(value.getSnapshot().records[0].sessionId, branch.sessionId)
  assert.equal(value.getSnapshot().records[0].pendingClose, true)
  assert.equal(value.getSnapshot().records[0].requestKey, undefined)
  await value.create(request)
  assert.notEqual(calls[0].requestId, calls[1].requestId)
  value.opened(branch)
  assert.equal(Object.values(value.getSnapshot().requests)[0], calls[1].requestId)
})

test('new request reset refuses an in-flight creation', async () => {
  let finish
  const value = runtime(async () => new Promise(resolve => { finish = resolve }))
  const request = { sourceSessionId: branch.sourceSessionId, mode: 'edit', turn: branch.turn }
  const pending = value.create(request)
  assert.throws(() => value.newRequest(request), /still pending/)
  finish({ branch }); await pending
})

test('opening a recovered creation clears its retry identity and pending navigation', async () => {
  const value = runtime(async () => ({ branch }))
  const request = { sourceSessionId: branch.sourceSessionId, mode: 'edit', messageId: 'm' }
  await value.create(request)
  value.record(branch, { pendingOpen: true })
  value.opened(branch)
  assert.equal(Object.keys(value.getSnapshot().requests).length, 0)
  assert.equal(value.getSnapshot().records[0].pendingOpen, false)
})

test('creation does not return an unconfigured native composer', async () => {
  const value = runtime(async () => ({ branch: { ...branch, ready: false } }))
  await assert.rejects(value.create({ sourceSessionId: 'source', mode: 'continue', turn: 1 }), /incomplete/)
  assert.equal(value.getSnapshot().records.length, 0)
})

test('native close persists recovery before asynchronous host response', async () => {
  let finish
  const store = storage()
  const recovered = []
  const value = runtime(async () => new Promise((resolve) => { finish = resolve }), { storage: store, onRecover: (item) => recovered.push(item) })
  const pending = value.closeFromTab(branchAddress(branch))
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).records[0].pendingClose, true)
  finish({ status: 'needs-choice', running: true })
  await pending
  assert.equal(recovered.length, 1)
  const reloaded = runtime(async () => ({}), { storage: store })
  assert.equal(reloaded.getSnapshot().records[0].running, true)
})

test('an empty branch archives silently; failed close remains recoverable', async () => {
  let recoveries = 0
  const empty = runtime(async () => ({ status: 'archived' }), { onRecover: () => recoveries++ })
  await empty.closeFromTab(branchAddress(branch))
  assert.equal(empty.getSnapshot().records.length, 0)
  assert.equal(recoveries, 0)
  const failed = runtime(async () => { throw new Error('offline') }, { onRecover: () => recoveries++ })
  await failed.closeFromTab(branchAddress(branch))
  assert.equal(failed.getSnapshot().records[0].error, 'offline')
  assert.equal(recoveries, 1)
})

test('remembered archive never stops a running branch; keep can be applied', async () => {
  const calls = []
  const value = runtime(async (_name, request) => { calls.push(request.action); return { status: request.action === 'auto' ? 'needs-choice' : 'kept', running: true } })
  value.setPreference('archive')
  await value.closeFromTab(branchAddress(branch))
  assert.deepEqual(calls, ['auto'])
  value.setPreference('keep')
  await value.closeFromTab(branchAddress(branch))
  assert.deepEqual(calls, ['auto', 'auto', 'keep'])
  assert.equal(value.getSnapshot().records.length, 0)
})

test('explicitly resolved close does not invoke native cleanup twice', async () => {
  let calls = 0
  const value = runtime(async () => { calls++; return { status: 'kept' } })
  await value.resolveClose(branch, 'keep')
  value.closeResolved(branch.sessionId)
  value.closeFromTab(branchAddress(branch))
  assert.equal(calls, 1)
})

function resourceHarness({ ownUserMessages = 0, hasPendingHumanInput = false, initializeResult = 'applied', failReady = false, resourceBranch = branch } = {}) {
  const calls = []
  const binding = { sessionId: branch.sessionId }
  const reference = { binding, ready: failReady ? Promise.reject(new Error('open failed')) : Promise.resolve(binding), release() { calls.push(['release']) } }
  const ctx = {
    sessions: { retain(target, options) { calls.push(['retain', target, options]); return reference } },
    conversation: { input: { requestDraftInitialization(target, options) { calls.push(['draft', target, options]); return initializeResult } } },
  }
  const api = async () => ({ branch: resourceBranch, ownUserMessages, hasPendingHumanInput, running: false })
  return { provider: branchResourceProvider(ctx, api), calls, reference, ctx }
}
test('native resource retains ordinary child id, initializes only its draft, then releases', async () => {
  const { provider, calls, reference } = resourceHarness()
  const controller = new AbortController()
  const iterator = provider.open(branchAddress(branch), { signal: controller.signal })
  const result = await iterator.next()
  assert.equal(result.value.value.reference, reference)
  assert.equal(calls[0][0], 'retain')
  assert.equal(calls[0][1], branch.sessionId)
  assert.equal(typeof calls[0][1], 'string')
  assert.equal(calls[1][1], reference.binding)
  assert.deepEqual(plain(calls[1][2]), { prompt: branch.originalPrompt })
  assert.equal('clearPreviousDraft' in calls[1][2], false)
  controller.abort()
  await iterator.next()
  assert.equal(calls.at(-1)[0], 'release')
})

test('current-turn fork opens with no historical prompt draft', async () => {
  const continued = { ...branch, mode: 'continue', intent: 'fork', originalPrompt: '', attachmentCount: 0 }
  const { provider, calls } = resourceHarness({ resourceBranch: continued })
  const controller = new AbortController()
  const iterator = provider.open(branchAddress(continued), { signal: controller.signal })
  const result = await iterator.next()
  assert.equal(result.value.ok, true)
  assert.equal(result.value.value.branch.mode, 'continue')
  assert.equal(calls.some(([name]) => name === 'draft'), false)
  controller.abort(); await iterator.next()
})

test('reopened branch with own messages never replays historical draft', async () => {
  const { provider, calls } = resourceHarness({ ownUserMessages: 1 })
  const controller = new AbortController()
  const iterator = provider.open(branchAddress(branch), { signal: controller.signal })
  await iterator.next()
  assert.equal(calls.some(([name]) => name === 'draft'), false)
  controller.abort(); await iterator.next()
})

test('preserved native draft is accepted; blocked initialization releases and refuses rendering', async () => {
  const preserved = resourceHarness({ initializeResult: 'preserved' })
  const controller = new AbortController()
  const iterator = preserved.provider.open(branchAddress(branch), { signal: controller.signal })
  assert.equal((await iterator.next()).value.ok, true)
  controller.abort(); await iterator.next()
  const blocked = resourceHarness({ initializeResult: 'blocked' })
  const failure = await blocked.provider.open(branchAddress(branch), { signal: new AbortController().signal }).next()
  assert.equal(failure.value.ok, false)
  assert.match(failure.value.error.message, /blocked/)
  assert.equal(blocked.calls.at(-1)[0], 'release')
})

test('failed open releases ownership and abort before open does not retain', async () => {
  const failed = resourceHarness({ failReady: true })
  const failure = await failed.provider.open(branchAddress(branch), { signal: new AbortController().signal }).next()
  assert.equal(failure.value.ok, false)
  assert.match(failure.value.error.message, /open failed/)
  assert.equal(failed.calls.at(-1)[0], 'release')
  const cancelled = resourceHarness()
  const controller = new AbortController(); controller.abort()
  assert.equal((await cancelled.provider.open(branchAddress(branch), { signal: controller.signal }).next()).done, true)
  assert.equal(cancelled.calls.length, 0)
})

test('resource identity mismatch never retains an unrelated session', async () => {
  let retained = false
  const provider = branchResourceProvider({ sessions: { retain() { retained = true } } }, async () => ({ branch: { ...branch, sourceSessionId: 'wrong' } }))
  const failure = await provider.open(branchAddress(branch), { signal: new AbortController().signal }).next()
  assert.equal(failure.value.ok, false)
  assert.match(failure.value.error.message, /identity/)
  assert.equal(retained, false)
})

test('pending human input prevents original draft reinsertion before commit', async () => {
  const { provider, calls } = resourceHarness({ hasPendingHumanInput: true })
  const controller = new AbortController()
  const iterator = provider.open(branchAddress(branch), { signal: controller.signal })
  await iterator.next()
  assert.equal(calls.some(([name]) => name === 'draft'), false)
  controller.abort(); await iterator.next()
})

test('resource retries change registry key while preserving branch identity', () => {
  const original = branchAddress(branch)
  const retried = retryBranchAddress(original, 'attempt-2')
  assert.notEqual(retried, original)
  assert.deepEqual(plain(parseBranchAddress(retried)), plain(parseBranchAddress(original)))
})

test('editing a completed failed response only requires an editable human prompt', () => {
  const row = { completed: true, editable: true, branchable: false }
  assert.equal(eligible(row, 'edit'), true)
  assert.equal(eligible(row, 'continue'), false)
})

test('locale keys match and previews do not split surrogate pairs', () => {
  assert.deepEqual(Object.keys(ZH).sort(), Object.keys(EN).sort())
  assert.equal(preview('a😀b', 2), 'a😀')
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(CSS), false)
})

test('browser artifact has only registry imports and no direct DOM decorations', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(/document\.|querySelector|createElement\(['"]style|appendChild|innerHTML/.test(source), false)
  assert.equal(/require\(['"]@deepseek-ai\//.test(source), false)
  assert.equal(/^\s*(import|export)\s/m.test(source), false)
  assert.equal(client.inject.includes('sessions'), true)
  assert.equal(client.inject.includes('conversation'), true)
})
