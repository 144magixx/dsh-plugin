/* Offline preview fixture: drives the shipped SummaryToggle -> SummaryData ->
 * SummaryOverlay chain with fake session hooks, using the installed shell's
 * React, react-dom and theme CSS. Loaded only by scripts/build-preview.mjs. */
(function () {
  const errors = []
  const report = () => { const pre = document.getElementById('selftest'); if (pre && errors.length) pre.textContent = 'ERRORS\n' + errors.join('\n') + '\n' + pre.textContent }
  window.addEventListener('error', (event) => { errors.push(String(event.error && event.error.stack || event.message)); report() })
  const consoleError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ').slice(0, 600)); report(); consoleError.apply(console, args) }
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode') || 'light'
  if (mode === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
  const shared = window.__shared
  const React = shared.react
  const { createRoot } = shared['react-dom/client']
  const client = window.__registration.factory((id) => {
    if (!(id in shared)) throw new Error('unexpected import ' + id)
    return shared[id]
  })
  const h = React.createElement
  const dict = client.ZH
  const t = (key, values = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
  const log = []
  const now = Date.now()
  const sessionId = 'sess-paper'
  const cwd = 'E:\\research\\paper'
  const tabs = new Map([['browser', {}], ['files', {}]])
  const services = {
    sidebarRight: { openResource: (address, options) => log.push(['openResource', address, options ?? null]), openTab: (kind, options) => log.push(['openTab', kind, options ?? null]) },
    sidebarRightTabs: { get: (kind) => tabs.get(kind) },
    uiWorkspace: { openSession: (id) => log.push(['openSession', id]) },
    sessions: { binding: () => ({ session: { loadOlder: () => log.push(['loadOlder']) } }), refreshProjections: (id) => { log.push(['refreshProjections', id]); return Promise.resolve() } },
    jobs: {
      // Like the native ObservableSnapshot, getSnapshot returns a stable value.
      state: (() => { const value = { rows: { [sessionId]: [
        { id: 'pwsh-1', kind: 'pwsh', label: 'python scripts/eval_tabu.py --remote gpu-node-01', status: 'running', startedAt: now - 754000 },
        { id: 'bash-2', kind: 'bash', label: 'pytest tests/', status: 'completed', startedAt: now - 3600000, finishedAt: now - 3540000 },
      ] } }; return { getSnapshot: () => value, subscribe: () => () => {} } })(),
      watchRows: (id) => { log.push(['watchRows', id]); return () => log.push(['releaseRows', id]) },
    },
  }
  const summaries = {
    11: { turn: 1, files: [
      { path: 'docs/第二阶段/方案/33_纯禁忌搜索与贪心加禁忌搜索配对评价.md', display: 'docs/第二阶段/方案/33_纯禁忌搜索与贪心加禁忌搜索配对评价.md', added: 57, deleted: 0 },
      { path: 'scripts/pure_tabu_docs/sync_markdown.py', display: 'scripts/pure_tabu_docs/sync_markdown.py', added: 129, deleted: 0 },
      { path: 'docs/第二阶段/实验报告/25_纯禁忌搜索与贪心加禁忌搜索配对评价.md', display: 'docs/第二阶段/实验报告/25_纯禁忌搜索与贪心加禁忌搜索配对评价.md', added: 10, deleted: 0 },
    ], total: 3, added: 196, deleted: 0 },
    21: { turn: 2, files: [
      { path: 'web/index.html', display: 'web/index.html', added: 212, deleted: 4 },
      { path: 'slides/stage2.pptx', display: 'slides/stage2.pptx', added: 0, deleted: 0, binary: true },
      { path: 'docs/README.md', display: 'docs/README.md', added: 88, deleted: 2 },
      { path: 'scripts/pure_tabu_docs/sync_markdown.py', display: 'scripts/pure_tabu_docs/sync_markdown.py', added: 21, deleted: 0 },
    ], total: 4, added: 321, deleted: 6 },
  }
  const api = client.createApi({ get: (name) => services[name] }, {
    storage: undefined,
    fetchImpl: async (url) => {
      const seq = Number(new URL(url, 'http://x/').searchParams.get('seq'))
      if (seq === 31) return { status: 404, ok: false }
      return { status: 200, ok: true, json: async () => summaries[seq] }
    },
    transportFetch: async () => ({ json: async () => ({ ok: false }) }),
    clipboard: { writeText: async (text) => log.push(['copy', text]) },
    openWindow: (url) => log.push(['window', url]),
  })
  const call = (seq, root) => ({ key: 'n' + seq, kind: 'tool-call', anchorSeq: seq, data: { root } })
  const result = (name, args, meta, extra) => Object.assign({ kind: 'tool-result', name, callId: 'c' + Math.random(), args, call: { name, argsRaw: JSON.stringify(args) }, content: [], isError: false, meta, subCalls: [] }, extra || {})
  const nodes = [
    { key: 'u1', kind: 'user', anchorSeq: 1, data: { content: [{ type: 'text', text: '评估纯禁忌搜索的指标，参考 @docs/第二阶段/方案/README.md 和 @实验记录 会话' }], referenceLabels: ['实验记录'], skillNames: [] } },
    { key: 'ctx1', kind: 'context', anchorSeq: 2, data: { source: { kind: 'session-reference', references: [{ sessionId: 'sess-log', label: '实验记录' }] } } },
    call(3, result('web_search', { queries: ['tabu search greedy hybrid benchmark'] }, { sources: [{ url: 'https://en.wikipedia.org/wiki/Tabu_search', title: 'Tabu search - Wikipedia' }, { url: 'https://arxiv.org/abs/2101.00001', title: 'Hybrid greedy-tabu heuristics' }] })),
    call(4, result('web_fetch', { url: 'https://en.wikipedia.org/wiki/Tabu_search' }, { url: 'https://en.wikipedia.org/wiki/Tabu_search', statusCode: 200 })),
    call(5, result('mcp__chatgpt_apps__search', { q: 'x' }, undefined)),
    call(6, result('mcp__chatgpt_apps__fetch', { id: 1 }, undefined)),
    call(7, { phase: 'start', callId: 'sk', name: 'skill', argsRaw: JSON.stringify({ name: 'office-pptx' }) }),
    { key: 'plan', kind: 'submitted-plan', anchorSeq: 8, data: { callId: 'plan-1', title: '统一禁忌搜索结果到所有文档' } },
  ]
  const turnData = { 1: { changes: { seq: 11 }, presented: [{ path: 'E:\\research\\paper\\docs\\第二阶段\\实验报告\\25_纯禁忌搜索与贪心加禁忌搜索配对评价.md', seq: 12, index: 0 }] }, 2: { changes: { seq: 21 }, presented: [{ path: 'E:\\research\\paper\\slides\\stage2.pptx', description: '第二阶段汇报 PPT', seq: 22, index: 0 }] }, 3: { changes: { seq: 31 } } }
  const snapshot = { order: [], nodes: { values: () => nodes, get: () => undefined }, timeline: { turnOrder: [1, 2, 3], turns: new Map([1, 2, 3].map((turn) => [turn, { turn, data: { get: (key) => (key === 'deliverables' ? turnData[turn] : undefined) } }])) } }
  const children = ['sub-1', 'sub-2', 'sub-3', 'sub-4', 'sub-5']
  const byId = {
    [sessionId]: { id: sessionId, title: '评估并统一禁忌搜索结果', cwd, running: true },
    'sess-log': { id: 'sess-log', title: '实验记录' },
    'fork-1': { id: 'fork-1', parentId: sessionId, title: '评估并统一禁忌搜索结果 · 自第 2 轮' },
  }
  children.forEach((id, index) => { byId[id] = { id, origin: 'subagent', parentId: sessionId, title: ['核对报告指标', '同步 PPT 数据', '检查网页表格', '复跑远端评测', '校对引用'][index], running: index === 3, projectionValues: { subagentTiming: index === 3 ? { settledMs: 30000, active: { since: now - 95000, through: now } } : { settledMs: 61000 + index * 47000, lastTurnCompleted: true }, tokenUsage: { uncachedInputTokens: 12000 + index * 3000, outputTokens: 2100, cacheReadTokens: 40000, cacheWriteTokens: 0 } } } })
  const listState = { ids: Object.keys(byId), byId, phase: 'ready', projectionsBySession: {} }
  const statuses = new Map([['sub-4', { running: true }]])
  const projections = {
    subagentCatalog: children.map((id, index) => ({ id, mode: index === 1 ? 'continuable' : 'one-shot', label: ['metrics-audit', 'pptx-sync', 'web-table', 'remote-eval', 'citations'][index], createdAt: index })),
    todos: [{ content: '汇总纯禁忌搜索指标', status: 'completed' }, { content: '更新报告与 PPT', status: 'completed' }, { content: '同步网页表格', status: 'in_progress' }, { content: '标注两种方法的区别', status: 'pending' }],
    plan: { active: false, pending: false },
    goal: { goal: { objective: '把纯禁忌搜索结果统一到项目所有文档', phase: 'active' }, roundsStarted: 3 },
    workingDirectory: cwd,
  }
  const hooks = {
    useSession: (select) => select({ sessionId, running: true, blank: false, hasMore: true, loadingOlder: false, subagent: null }),
    useSessions: (select) => select(listState),
    useSessionStatus: (select) => select(statuses),
    useWorkspaces: (select) => select({ items: [{ workspaceId: 'w', path: cwd, title: 'paper', sessionIds: [sessionId] }], archivedSessionIds: [], pinnedSessionIds: [] }),
    useChat: (select) => select(snapshot),
    useProjection: (key) => projections[key],
  }
  if (params.get('open') !== 'no') api.prefs.set({ pinned: mode !== 'selftest' })
  if (mode === 'selftest') api.open(sessionId)

  function Page() {
    return h('div', { className: 'pv-frame' },
      h('div', { className: 'pv-column' },
        h('header', { className: 'pv-header' },
          h('div', { className: 'pv-title' }, '评估并统一禁忌搜索结果'),
          h('div', { className: 'pv-utilities' }, h('span', { className: 'pv-native' }, '⋯'), h(client.SummaryToggle, { sessionId, api, t, ...hooks })),
          h('div', { className: 'pv-corner' })),
        h('div', { className: 'pv-transcript' },
          h('div', { className: 'pv-bubble' }, '评估一下纯禁忌搜索（非贪心+禁忌搜索）的指标和性能，把相关结果统一到项目所有文档（报告、ppt、网页等）有关的地方，并要标明纯禁忌搜索和贪心+禁忌搜索。'),
          h('p', null, '这里是对话内容。卡片悬浮在对话上方，不占用对话宽度。'))),
      h('div', { className: 'pv-overlay', 'data-shell-overlay': '' }, h('div', { 'data-slot': 'shell.overlay', style: { display: 'contents' } }, h(client.SummaryOverlay, { api, t }))))
  }
  const pluginStyle = document.createElement('style')
  pluginStyle.textContent = client.CSS
  document.head.appendChild(pluginStyle)
  const style = document.createElement('style')
  style.textContent = `.pv-frame{position:relative;height:100vh;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.pv-column{height:100%;display:flex;flex-direction:column}
.pv-header{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:50px;padding:10px 28px 10px 20px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.pv-title{flex:1;font-weight:600;font-size:14px}
.pv-utilities{display:flex;align-items:center;gap:8px}
.pv-native{width:28px;text-align:center;color:var(--dsw-alias-label-secondary)}
.pv-corner{width:28px;height:28px;margin-right:-16px;margin-left:8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}
.pv-transcript{flex:1;padding:40px 0;max-width:720px;margin:0 auto;font-size:14px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.pv-bubble{margin-left:auto;max-width:520px;padding:10px 14px;border-radius:16px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pv-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}.pv-overlay>*{pointer-events:auto}
/* Headless virtual time freezes CSS animations at their first frame. */
.dss-tip{animation:none!important}`
  document.head.appendChild(style)
  const root = document.createElement('div')
  document.getElementById('root').replaceWith(root)
  createRoot(root).render(h(Page))

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function selftest() {
    const results = []
    const check = (name, ok, detail) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''))
    const card = () => document.querySelector('[data-dsh-session-summary]')
    await wait(700)
    check('card opens from toggle state', !!card())
    const text = card()?.textContent ?? ''
    check('project name', text.includes('paper'))
    check('changes merged', text.includes('+517') && text.includes('−6'), text.match(/[+−]\d+/g)?.slice(0, 4).join(' '))
    check('missing turn note', text.includes('1 轮的改动记录已不可用'))
    check('subagents summary', text.includes('1 运行中') && text.includes('4 完成'))
    check('sources listed', text.includes('Tabu search - Wikipedia') && text.includes('Hybrid greedy-tabu heuristics') && text.includes('chatgpt_apps') && text.includes('office-pptx') && text.includes('README.md'))
    const sourcesMore = card().querySelector('[data-section="sources"] .dss-more')
    const sourcesMoreText = sourcesMore?.textContent ?? ''
    sourcesMore?.click(); await wait(50)
    const session = [...card().querySelectorAll('[data-section="sources"] .dss-row')].find((row) => row.textContent.includes('实验记录'))
    check('show all reveals the referenced session', sourcesMoreText.includes('查看全部（6）') && !!session, sourcesMoreText)
    session?.click()
    check('referenced session navigates', JSON.stringify(log.at(-1)) === '["openSession","sess-log"]', JSON.stringify(log.at(-1)))
    check('plan section', text.includes('2/4 已完成') && text.includes('统一禁忌搜索结果到所有文档'))
    check('generated files', text.includes('stage2.pptx'))
    check('jobs section', text.includes('后台任务') && text.includes('pytest tests/'))
    check('related fork', text.includes('侧栏分支'))
    check('partial note', text.includes('加载更早的记录'))
    check('watched jobs', log.some((entry) => entry[0] === 'watchRows'))
    const rect = card().getBoundingClientRect()
    const header = document.querySelector('.pv-header').getBoundingClientRect()
    check('anchored below header right edge', Math.abs(rect.top - (header.bottom + 8)) < 1.5 && Math.abs(rect.right - (header.right - 12)) < 1.5, `${rect.top},${rect.right} vs ${header.bottom + 8},${header.right - 12}`)
    card().querySelector('[data-section="changes"] .dss-row').click()
    check('change opens native review', JSON.stringify(log.at(-1)).includes('dsh-resource://changes-review/session/sess-paper/21/2') && JSON.stringify(log.at(-1)).includes('"index":2'), JSON.stringify(log.at(-1)))
    const sub = [...card().querySelectorAll('[data-section="subagents"] .dss-row')][0]
    sub.click()
    check('subagent opens in sidebar', JSON.stringify(log.at(-1)).includes('subagentchat/session/sub-4?parent=sess-paper&mode=one-shot'), JSON.stringify(log.at(-1)))
    const web = [...card().querySelectorAll('[data-section="sources"] .dss-row')].find((row) => row.textContent.includes('Wikipedia'))
    web.click()
    check('web source opens browser tab', JSON.stringify(log.at(-1)).includes('"openTab","browser"'), JSON.stringify(log.at(-1)))
    const more = card().querySelector('[data-section="changes"] .dss-more')
    const before = card().querySelectorAll('[data-section="changes"] .dss-row').length
    const moreText = more.textContent
    more.click(); await wait(50)
    check('show more expands changes', card().querySelectorAll('[data-section="changes"] .dss-row').length === 6 && before === 3 && moreText.includes('再显示 3 项'), `${before} -> ${card().querySelectorAll('[data-section="changes"] .dss-row').length} (${moreText})`)
    card().querySelector('[data-section="sources"] .dss-sec-head').click(); await wait(50)
    check('section collapses and is remembered', !card().querySelector('[data-section="sources"] .dss-row') && api.prefs.getSnapshot().collapsed.sources === true)
    card().querySelector('[data-section="sources"] .dss-sec-head').click(); await wait(50)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wait(50)
    check('outside press closes unpinned card', !card())
    document.querySelector('[data-dsh-session-summary-toggle] button').click(); await wait(400)
    check('toggle reopens', !!card())
    card().querySelector('[data-dss-pin]').click(); await wait(50)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(50)
    check('pinned card ignores outside press and Escape', !!card() && api.prefs.getSnapshot().pinned === true)
    card().querySelector('[data-dss-close]').click(); await wait(50)
    check('close button closes and unpins', !card() && api.prefs.getSnapshot().pinned === false)
    document.querySelector('[data-dsh-session-summary-toggle] button').click(); await wait(400)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(escape); await wait(50)
    check('Escape closes unpinned card and is consumed', !card() && escape.defaultPrevented)
    check('job stream released after close', log.some((entry) => entry[0] === 'releaseRows'))
    document.getElementById('selftest').textContent = results.join('\n')
  }
  const out = document.createElement('pre')
  out.id = 'selftest'
  out.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;font:12px monospace;color:var(--dsw-alias-label-tertiary)'
  document.body.appendChild(out)
  if (mode === 'selftest') selftest().catch((error) => { out.textContent = 'FAIL selftest crashed :: ' + (error && error.stack || error) })
  else setTimeout(() => {
    if (params.get('scroll') === 'bottom') { const body = document.querySelector('.dss-body'); if (body) body.scrollTop = body.scrollHeight }
    if (params.get('debug') === '1') out.textContent = JSON.stringify({ view: { ...api.view.getSnapshot().view, model: undefined }, prefs: api.prefs.getSnapshot(), ui: api.ui.getSnapshot() })
    const pin = document.querySelector('[data-dss-pin]')
    if (pin && params.get('tip') !== 'no') api.showTip({ id: -1, text: t('unpin'), rect: pin.getBoundingClientRect(), side: 'bottom' })
  }, 700)
})()
