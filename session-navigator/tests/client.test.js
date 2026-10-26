import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let plugin
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load(definition) { plugin = definition.factory(name => { assert.equal(name, 'react'); return {} }) } } },
  AbortController, TextDecoder, setTimeout, clearTimeout,
})
const { secondLine, summaryBehind, createStore, currentMainSession, trackVisits, requestJSON, readChanges, createController, ZH, EN } = plugin.__test
const plain = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setTimeout(resolve, 8))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const row = (id, patch = {}) => ({ sessionId: id, title: id, sourceSeq: 10, summarySeq: 10, latestQuestionSeq: 8, recentTopic: 'Earlier topic', latestQuestion: 'Latest question', status: 'ready', paused: false, ...patch })
const page = (items, extra = {}) => ({ ok: true, items, total: items.length, workspaces: [], settings: { model: 'gpt-6-luna', autoSummarize: true }, ...extra })
const controller = request => createController({ request, fetchImpl: async () => { throw new Error('unused stream') }, navigate: () => {}, debounceMs: 0, pageSize: 2 })

test('latest question replaces stale topics even during generation or error', () => {
  for (const status of ['ready', 'queued', 'generating', 'error', 'empty', 'stale']) {
    const item = row('s', { latestQuestionSeq: 12, sourceSeq: 12, summarySeq: 10, status })
    assert.deepEqual(plain(secondLine(item)), { kind: 'questionLabel', text: 'Latest question' })
    assert.equal(summaryBehind(item), true)
  }
  assert.equal(secondLine(row('s')).kind, 'recent')
  assert.equal(secondLine(row('s', { sourceSeq: 11 })).kind, 'questionLabel')
  assert.equal(secondLine(row('s', { status: 'stale', latestQuestion: '' })).kind, 'oldTopic')
  assert.equal(secondLine({}).text, '')
})

test('visits follow only main retention, including native navigation and dedup', async () => {
  let clock = 10000
  const source = createStore({ byId: {
    a: { id: 'a', retainedBy: { mainView: 1 } },
    b: { id: 'b', retainedBy: { sidebar: 1 } },
  } })
  const visits = []
  const stop = trackVisits(source, id => visits.push(id), { now: () => clock })
  await tick()
  source.set({ irrelevant: 1 })
  await tick()
  assert.deepEqual(visits, ['a'])
  assert.equal(currentMainSession(source.getSnapshot()), 'a')
  source.set({ byId: {} })
  source.set({ byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } })
  await tick()
  assert.deepEqual(visits, ['a'])
  clock += 2000
  source.set({ byId: { b: { id: 'b', retainedBy: { mainView: 1 } } } })
  await tick()
  source.set({ byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } })
  await tick()
  assert.deepEqual(visits, ['a', 'b', 'a'])
  stop()
  source.set({ byId: { c: { id: 'c', retainedBy: { mainView: 1 } } } })
  await tick()
  assert.deepEqual(visits, ['a', 'b', 'a'])
})

test('JSON requests use the authenticated same-origin transport and return failures', async () => {
  const abort = new AbortController()
  const value = await requestJSON(async (url, options) => {
    assert.equal(url, '/api/session-navigator/get')
    assert.equal(options.method, 'POST')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.signal, abort.signal)
    assert.deepEqual(JSON.parse(options.body), { sessionId: 's' })
    return { ok: true, json: async () => ({ ok: true, item: row('s') }) }
  }, 'get', { sessionId: 's' }, abort.signal)
  assert.equal(value.item.sessionId, 's')
  await assert.rejects(() => requestJSON(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: { message: 'temporary failure' } }) }), 'list', {}), /temporary failure/)
  await assert.rejects(() => requestJSON(async () => ({ ok: false, status: 429, json: async () => ({ ok: false, code: 'queue-full', message: '摘要队列繁忙，请稍后重试。' }) }), 'refresh', { sessionId: 's' }), error => error.code === 'queue-full' && error.message === '摘要队列繁忙，请稍后重试。')
})

test('NDJSON stream handles partial UTF-8, CRLF, blank lines and final frame', async () => {
  const bytes = new TextEncoder().encode('{"revision":0}\r\n\n{"revision":1,"sessionId":"会话"}\n{"revision":2}')
  const stream = new ReadableStream({ start(control) { for (let i = 0; i < bytes.length; i += 2) control.enqueue(bytes.slice(i, i + 2)); control.close() } })
  const frames = []
  await readChanges(stream, new AbortController().signal, frame => frames.push(plain(frame)))
  assert.deepEqual(frames, [{ revision: 0 }, { revision: 1, sessionId: '会话' }, { revision: 2 }])
  await assert.rejects(() => readChanges(null, new AbortController().signal, () => {}), /STREAM_UNAVAILABLE/)
})

test('NDJSON stream cancellation releases a pending reader', async () => {
  let cancelled = false
  const stream = new ReadableStream({ cancel() { cancelled = true } })
  const abort = new AbortController()
  const pending = readChanges(stream, abort.signal, () => assert.fail('no frame expected'))
  abort.abort()
  await pending
  assert.equal(cancelled, true)
})

test('late list response cannot replace a newer filter result', async () => {
  const calls = []
  const api = controller((action, payload, signal) => { const result = deferred(); calls.push({ action, payload, signal, ...result }); return result.promise })
  const stop = api.activate()
  api.change({ query: 'new', workspaceId: 'project', sort: 'updated' })
  await tick()
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(calls[1].payload.query, 'new')
  assert.equal(calls[1].payload.workspaceId, 'project')
  assert.equal(calls[1].payload.sort, 'updated')
  calls[1].resolve(page([row('new')]))
  await tick()
  calls[0].resolve(page([row('old')]))
  await tick()
  assert.deepEqual(plain(api.getSnapshot().items.map(item => item.sessionId)), ['new'])
  stop(); api.dispose()
})

test('hover reads are deduplicated and never enqueue a summary', async () => {
  const calls = []
  const result = deferred()
  const api = controller((action, payload) => { calls.push({ action, payload }); return result.promise })
  const stopA = api.retainItem('a')
  const stopB = api.retainItem('a')
  assert.deepEqual(calls.map(call => call.action), ['get'])
  result.resolve({ ok: true, item: row('a') })
  await tick()
  stopA(); stopB()
  const stopC = api.retainItem('a')
  await tick()
  assert.equal(calls.length, 1)
  assert.equal(api.getSnapshot().byId.a.recentTopic, 'Earlier topic')
  stopC(); api.dispose()
})

test('a forced detail refresh cancels stale reads and ignores late arrivals', async () => {
  const calls = []
  const api = controller((action, payload, signal) => { const result = deferred(); calls.push({ action, payload, signal, ...result }); return result.promise })
  const stop = api.retainItem('a')
  const force = api.retryItem('a')
  assert.equal(calls[0].signal.aborted, true)
  calls[1].resolve({ ok: true, item: row('a', { recentTopic: 'New topic' }) })
  await force
  calls[0].resolve({ ok: true, item: row('a', { recentTopic: 'Old topic' }) })
  await tick()
  assert.equal(api.getSnapshot().byId.a.recentTopic, 'New topic')
  stop(); api.dispose()
})

test('aborted hover reads are not reused when hovering again', async () => {
  const calls = []
  const api = controller((action, payload, signal) => { const result = deferred(); calls.push({ action, signal, ...result }); return result.promise })
  api.retainItem('a')()
  const stop = api.retainItem('a')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].signal.aborted, true)
  calls[1].resolve({ ok: true, item: row('a') })
  calls[0].resolve({ ok: true, item: row('a', { recentTopic: 'Stale' }) })
  await tick()
  assert.equal(api.getSnapshot().byId.a.recentTopic, 'Earlier topic')
  stop(); api.dispose()
})

test('late list data cannot overwrite a refresh mutation', async () => {
  const listing = deferred()
  const api = controller(async action => action === 'list' ? listing.promise : { ok: true, status: 'queued', item: row('a', { status: 'queued' }) })
  const stop = api.activate()
  await api.refresh('a')
  listing.resolve(page([row('a', { status: 'ready' })]))
  await tick()
  assert.equal(api.getSnapshot().items[0].status, 'queued')
  assert.equal(api.getSnapshot().byId.a.status, 'queued')
  stop(); api.dispose()
})

test('late detail data cannot overwrite a pause mutation', async () => {
  const detail = deferred()
  const api = controller(async action => action === 'get' ? detail.promise : { ok: true, item: row('a', { paused: true }) })
  const stop = api.retainItem('a')
  await api.pause('a', true)
  detail.resolve({ ok: true, item: row('a', { paused: false }) })
  await tick()
  assert.equal(api.getSnapshot().byId.a.paused, true)
  stop(); api.dispose()
})

test('pagination merges overlapping rows without losing the selected session', async () => {
  const api = controller(async (action, payload) => payload.offset === 0 ? page([row('a'), row('b')], { nextOffset: 2, total: 3 }) : page([row('b'), row('c')], { total: 3 }))
  const stop = api.activate()
  await tick()
  api.select('b')
  await api.more()
  assert.deepEqual(plain(api.getSnapshot().items.map(item => item.sessionId)), ['a', 'b', 'c'])
  assert.equal(api.getSnapshot().selectedId, 'b')
  assert.equal(api.getSnapshot().nextOffset, undefined)
  stop(); api.dispose()
})

test('archived sessions cannot open, and explicit refresh is allowed while paused', async () => {
  const navigated = [], calls = []
  const api = createController({
    request: async (action, payload) => { calls.push({ action, payload }); return { ok: true, status: 'queued', item: row('a', { paused: true, status: 'queued' }) } },
    fetchImpl: async () => {}, navigate: id => navigated.push(id),
  })
  await api.open(row('a', { archived: true }))
  assert.deepEqual(navigated, [])
  await api.open(row('a'))
  assert.deepEqual(navigated, ['a'])
  await api.refresh('a')
  assert.equal(calls[0].action, 'refresh')
  assert.equal(api.getSnapshot().byId.a.paused, true)
  api.dispose()
})

test('live invalidations refresh retained details and list without data polling', async () => {
  const actions = []
  let streamControl, cancelled = false, fetchCount = 0, topic = 'Before'
  const stream = new ReadableStream({ start(control) { streamControl = control }, cancel() { cancelled = true } })
  const api = createController({
    request: async action => { actions.push(action); return action === 'list' ? page([row('a', { recentTopic: topic })]) : { ok: true, item: row('a', { recentTopic: topic }) } },
    fetchImpl: async (url, options) => { fetchCount++; assert.equal(url, '/api/session-navigator/watch'); assert.equal(options.credentials, 'same-origin'); return { ok: true, body: stream } },
    navigate: () => {}, debounceMs: 0,
  })
  const stopPage = api.activate()
  const watching = api.start()
  streamControl.enqueue(new TextEncoder().encode('{"revision":0}\n'))
  await tick()
  const stopHover = api.retainItem('a')
  const before = actions.length
  topic = 'After'
  streamControl.enqueue(new TextEncoder().encode('{"revision":1,"sessionId":"a"}\n{"revision":2,"sessionId":"a"}\n'))
  await tick()
  assert.equal(api.getSnapshot().byId.a.recentTopic, 'After')
  assert.equal(fetchCount, 1)
  assert.ok(actions.slice(before).includes('list'))
  assert.ok(actions.slice(before).includes('get'))
  assert.equal(actions.some(action => ['refresh', 'touch'].includes(action)), false)
  stopHover(); stopPage(); api.dispose()
  await watching
  assert.equal(cancelled, true)
})

test('streaming-unavailable connections show a recoverable state without polling', async () => {
  let count = 0
  const api = createController({ request: async () => assert.fail('No view requests expected'), fetchImpl: async () => { count++; return { ok: true, body: null } }, navigate: () => {} })
  await api.start()
  assert.equal(api.getSnapshot().watchState, 'unsupported')
  await tick()
  assert.equal(count, 1)
  api.dispose()
})

test('disposal aborts outstanding work and prevents late state mutation', async () => {
  let signal
  const pending = deferred()
  const api = controller((action, payload, received) => { signal = received; return pending.promise })
  api.activate()
  const snapshot = api.getSnapshot()
  api.dispose()
  assert.equal(signal.aborted, true)
  pending.resolve(page([row('late')]))
  await tick()
  assert.equal(api.getSnapshot(), snapshot)
})

test('pending or failed model updates keep raw questions visible without clearing summaries', () => {
  for (const status of ['queued', 'generating', 'error']) {
    const item = row('s', { status, recentSummary: 'Earlier useful summary' })
    assert.equal(secondLine(item).kind, 'questionLabel')
    assert.equal(item.recentSummary, 'Earlier useful summary')
  }
})

test('native navigation remains available while a refresh request is pending', async () => {
  const pending = deferred(), opened = []
  const api = createController({ request: () => pending.promise, fetchImpl: async () => {}, navigate: id => opened.push(id) })
  const refreshing = api.refresh('s')
  assert.equal(api.getSnapshot().actions.s.busy, 'refresh')
  await api.open(row('s'))
  assert.deepEqual(opened, ['s'])
  assert.equal(api.getSnapshot().actions.s.busy, 'refresh')
  pending.resolve({ ok: true, status: 'queued', item: row('s', { status: 'queued' }) })
  await refreshing
  assert.equal(api.getSnapshot().actions.s.opening, false)
  api.dispose()
})

test('Chinese and English locale dictionaries expose the same complete key set', () => {
  assert.deepEqual(Object.keys(ZH).sort(), Object.keys(EN).sort())
  assert.ok(Object.values(ZH).every(value => typeof value === 'string' && value.length > 0))
  assert.ok(Object.values(EN).every(value => typeof value === 'string' && value.length > 0))
})
