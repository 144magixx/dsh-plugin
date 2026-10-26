import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Extract pure helpers from the real classic bundle; no React/DOM rendering is simulated.
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let registration
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { registration = value } } },
  AbortController, setTimeout, clearTimeout, console,
})
const core = registration.factory(name => {
  assert.equal(name, 'react')
  return Object.freeze({})
})
const plain = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let n = 0; n < 3; n++) await new Promise(resolve => setImmediate(resolve)) }
const hit = (sessionId, seq, extra = {}) => ({ sessionId, seq, kind: 'message', title: sessionId, snippet: 'find', ...extra })
const page = (items = [], extra = {}) => ({ ok: true, items, complete: true, warnings: [], scannedSessions: 1, totalSessions: 1, ...extra })
function controller(t, request, navigate = () => {}) {
  const api = core.createController({ request, navigate, debounceMs: 1000, maxEmptyPages: 3 })
  t.after(() => api.dispose())
  api.open('current', 's1')
  return api
}
function search(api, query = 'find') { api.change({ query }); api.retry() }

test('highlights Chinese and literal regex characters while preserving text', () => {
  const original = '查询 A+B [a+b] <script>中文</script> 中文'
  const parts = core.highlightParts(original, 'a+b')
  assert.equal(parts.map(p => p.text).join(''), original)
  assert.deepEqual(plain(parts.filter(p => p.match).map(p => p.text)), ['A+B', 'a+b'])
  assert.equal(core.highlightParts(original, '中文').filter(p => p.match).length, 2)
  assert.equal(core.highlightParts('abc', '.*').some(p => p.match), false)
  assert.deepEqual(plain(core.highlightParts('abc', ' ')), [{ text: 'abc', match: false }])
})

test('selects main-view session without confusing other references', () => {
  const snapshot = { byId: {
    other: { id: 'other', retainedBy: { controllerOperation: 2 } },
    active: { id: 'active', retainedBy: { mainView: 1 } },
  } }
  assert.equal(core.currentSessionId(snapshot), 'active')
  assert.equal(core.currentSessionId({ byId: {} }), undefined)
})

test('current search omits workspace filters; global search omits current identity', () => {
  const state = { query: ' find ', mode: 'current', currentSessionId: 's1', workspaceId: 'w1', includeTools: false, includeArchived: true }
  assert.deepEqual(plain(core.searchPayload(state)), { query: 'find', mode: 'current', sessionId: 's1', includeTools: false, includeArchived: true, limit: 40 })
  assert.deepEqual(plain(core.searchPayload({ ...state, mode: 'all' }, 'cursor')), { query: 'find', mode: 'all', workspaceId: 'w1', includeTools: false, includeArchived: true, cursor: 'cursor', limit: 40 })
})

test('follows empty cursor pages until it finds results and loads exact message context', async t => {
  const requests = []
  const api = controller(t, async (action, payload) => {
    requests.push([action, payload])
    if (action === 'context') return { items: [{ seq: 4, text: 'find' }], targetSeq: 4 }
    return payload.cursor ? page([hit('s1', 4, { matchOffset: 25000 })]) : page([], { complete: false, nextCursor: 'next' })
  })
  search(api)
  await flush()
  assert.equal(api.getSnapshot().status, 'ready')
  assert.equal(api.getSnapshot().items[0].seq, 4)
  assert.equal(requests[1][1].cursor, 'next')
  assert.equal(requests[2][0], 'context')
  assert.equal(requests[2][1].offset, 24800)
  assert.equal(api.getSnapshot().context.status, 'ready')
})

test('bounded empty scanning remains incomplete and Continue follows saved cursor', async t => {
  let count = 0
  const api = controller(t, async () => {
    count++
    return count < 4 ? page([], { complete: false, nextCursor: `c${count}` }) : page([])
  })
  search(api)
  await flush()
  assert.equal(count, 3)
  assert.equal(api.getSnapshot().complete, false)
  assert.equal(api.getSnapshot().nextCursor, 'c3')
  await api.more()
  assert.equal(api.getSnapshot().complete, true)
})

test('superseded search cannot replace new results even if transport ignores abort', async t => {
  const pending = []
  const api = controller(t, (action, payload, signal) => action === 'context' ? Promise.resolve({ items: [] }) : new Promise(resolve => pending.push({ payload, signal, resolve })))
  search(api, 'old')
  search(api, 'new')
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve(page([hit('new', 9)]))
  await flush()
  pending[0].resolve(page([hit('old', 1)]))
  await flush()
  assert.equal(api.getSnapshot().items[0].sessionId, 'new')
})

test('context selection aborts stale requests and does not publish late context', async t => {
  const pending = []
  const api = controller(t, (action, payload, signal) => action === 'search'
    ? Promise.resolve(page([hit('s1', 1), hit('s1', 2)]))
    : new Promise(resolve => pending.push({ payload, signal, resolve })))
  search(api)
  await flush()
  api.select(1)
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve({ items: [{ seq: 2, text: 'second' }], targetSeq: 2 })
  await flush()
  pending[0].resolve({ items: [{ seq: 1, text: 'first' }], targetSeq: 1 })
  await flush()
  assert.equal(api.getSnapshot().context.items[0].text, 'second')
})

test('closing aborts context and in-flight pagination and blocks late updates', async t => {
  let searchSignal, contextSignal, resolveMore
  const api = controller(t, (action, payload, signal) => {
    if (action === 'context') { contextSignal = signal; return new Promise(() => {}) }
    if (!payload.cursor) return Promise.resolve(page([hit('s1', 1)], { complete: false, nextCursor: 'more' }))
    searchSignal = signal
    return new Promise(resolve => { resolveMore = resolve })
  })
  search(api)
  await flush()
  const extending = api.more()
  api.close()
  assert.equal(contextSignal.aborted, true)
  assert.equal(searchSignal.aborted, true)
  resolveMore(page([hit('s1', 2)]))
  await extending
  assert.equal(api.getSnapshot().open, false)
  assert.equal(api.getSnapshot().items.length, 1)
})

test('stale cursor displays retryable failure and retry restarts without cursor', async t => {
  const payloads = []
  const api = controller(t, async (action, payload) => {
    if (action === 'context') return { items: [] }
    payloads.push(payload)
    if (payload.cursor) throw Object.assign(new Error('changed'), { code: 'STALE_CURSOR' })
    return page([hit('s1', 1)], { complete: false, nextCursor: 'old' })
  })
  search(api)
  await flush()
  await api.more()
  assert.equal(api.getSnapshot().error.code, 'STALE_CURSOR')
  api.retry()
  await flush()
  assert.equal(payloads.at(-1).cursor, undefined)
  assert.equal(api.getSnapshot().error, null)
})

test('pagination deduplicates and groups sessions while keeping selected result identity', async t => {
  const api = controller(t, async (action, payload) => {
    if (action === 'context') return { items: [] }
    return payload.cursor ? page([hit('a', 1), hit('a', 3), hit('c', 1)]) : page([hit('a', 1), hit('b', 2)], { complete: false, nextCursor: 'next' })
  })
  search(api)
  await flush()
  api.select(1)
  await api.more()
  assert.deepEqual(plain(api.getSnapshot().items.map(core.resultKey)), ['a:message:1', 'a:message:3', 'b:message:2', 'c:message:1'])
  assert.equal(api.getSnapshot().items[api.getSnapshot().selected].sessionId, 'b')
})

test('title matches avoid context reads; archived results never navigate', async t => {
  const operations = []
  const navigations = []
  const api = controller(t, async action => {
    operations.push(action)
    return page([{ sessionId: 'archived', title: 'find', kind: 'title', archived: true }])
  }, id => navigations.push(id))
  search(api)
  await flush()
  await api.openSelected()
  assert.deepEqual(operations, ['search'])
  assert.deepEqual(navigations, [])
  assert.equal(api.getSnapshot().open, true)
})

test('navigation failure retains panel and exposes retryable error', async t => {
  const api = controller(t, async action => action === 'context' ? { items: [] } : page([hit('s1', 1)]), () => { throw new Error('Unavailable') })
  search(api)
  await flush()
  await api.openSelected()
  assert.equal(api.getSnapshot().open, true)
  assert.equal(api.getSnapshot().openError.message, 'Unavailable')
  assert.equal(api.getSnapshot().opening, false)
})

test('no current session uses global mode; switching active session cancels current search', async t => {
  const pending = []
  const api = controller(t, (_action, payload, signal) => new Promise(resolve => pending.push({ payload, signal, resolve })))
  search(api)
  api.setCurrent('s2')
  assert.equal(pending[0].signal.aborted, true)
  assert.equal(pending[1].payload.sessionId, 's2')
  api.open('current', undefined)
  assert.equal(api.getSnapshot().mode, 'all')
  assert.equal(api.getSnapshot().noSession, true)
})

test('requestJSON preserves business errors and uses authenticated cancellable POST', async () => {
  const signal = new AbortController().signal
  let call
  const response = await core.requestJSON(async (...args) => { call = args; return { ok: true, json: async () => ({ ok: true, items: [] }) } }, 'search', { query: 'text' }, signal)
  assert.equal(response.ok, true)
  assert.equal(call[0], '/api/session-search/search')
  assert.equal(call[1].credentials, 'same-origin')
  assert.equal(call[1].signal, signal)
  assert.equal(call[1].method, 'POST')
  await assert.rejects(core.requestJSON(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: { code: 'STALE_CURSOR', message: 'Retry' } }) }), 'search', {}, signal), { code: 'STALE_CURSOR', message: 'Retry' })
})

test('shortcut gesture ignores IME, repeats, wrong modifiers and unrelated keys', () => {
  const base = { code: 'KeyF', metaKey: true }
  assert.equal(core.shortcutGesture(base), true)
  assert.equal(core.shortcutGesture({ code: 'KeyF', ctrlKey: true, shiftKey: true }), true)
  for (const patch of [{ isComposing: true }, { repeat: true }, { altKey: true }, { ctrlKey: true }, { code: 'KeyG' }])
    assert.equal(core.shortcutGesture({ ...base, ...patch }), false)
})

test('unknown subagents open their parent without misrouting ordinary forks', () => {
  assert.deepEqual(plain(core.navigationTarget({ sessionId: 'child', origin: 'subagent', parentSession: 'parent' }, { byId: {} })), { target: 'parent', kind: 'parent' })
  assert.deepEqual(plain(core.navigationTarget({ sessionId: 'child', origin: 'subagent', parentSession: 'parent' }, { byId: { child: {} } })), { target: 'child', kind: 'session' })
  assert.deepEqual(plain(core.navigationTarget({ sessionId: 'fork', parentSession: 'parent' }, { byId: {} })), { target: 'fork', kind: 'session' })
  assert.equal(core.navigationTarget({ sessionId: 'child', origin: 'subagent' }, { byId: {} }).target, undefined)
})

test('late navigation settlement cannot close a changed result selection', async t => {
  let finish
  const api = controller(t, async action => action === 'context' ? { items: [] } : page([hit('s1', 1), hit('s1', 2)]), () => new Promise(resolve => { finish = resolve }))
  search(api)
  await flush()
  const opening = api.openSelected()
  api.select(1)
  finish()
  await opening
  assert.equal(api.getSnapshot().open, true)
  assert.equal(api.getSnapshot().selected, 1)
  assert.equal(api.getSnapshot().opening, false)
})

test('locale keys align and UI colors use verified theme tokens', () => {
  assert.deepEqual(Object.keys(core.ZH).sort(), Object.keys(core.EN).sort())
  const allowed = new Set(['bg-base', 'bg-layer-1', 'bg-layer-2', 'bg-overlay', 'border-l1', 'border-l2', 'brand-primary', 'label-primary', 'label-secondary'])
  for (const [, token] of core.CSS.matchAll(/--dsw-alias-([a-z0-9-]+)/g)) assert.ok(allowed.has(token), token)
})
