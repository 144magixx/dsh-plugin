/* Offline shared-DOM integration fixture. Real installed React, theme, native
 * InputHub/Lexical, plus the shipped summary and capability clients. No live DSH.
 */
(function () {
  const errors = []
  window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
  const originalError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args) }
  const shared = window.__shared
  const React = shared.react, h = React.createElement
  const require = id => { if (!(id in shared)) throw new Error('Unavailable installed module: ' + id); return shared[id] }
  const summary = window.__registrations['dsh-session-summary'].factory(require)
  const capability = window.__registrations['dsh-capability-selector'].factory(require)
  const native = window.__registrations['@deepseek-ai/dsh-client-ui-conversation'].factory(require)
  const translate = dictionary => (key, values = {}) => String(dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') === 'en' ? 'en' : 'zh'
  const st = translate(language === 'en' ? summary.EN : summary.ZH), ct = translate(language === 'en' ? capability.EN : capability.ZH)
  const stable = value => ({ getSnapshot: () => value, subscribe: () => () => {} })
  const copies = [], appendCalls = [], cleanupCalls = []
  const scopeEffects = []
  const bindings = new Map()
  function scope(id) {
    const actx = {
      effect(fn) { const off = fn(); if (typeof off === 'function') scopeEffects.push(off); return off },
      on() { return () => {} },
      inject() {},
    }
    const session = {
      sessionId: id,
      ...stable({ sessionId: id, blank: false, running: false }),
      projections: { faceOf: key => stable(key === 'inbox' ? { 'next-turn': [], 'next-step': [] } : undefined) },
    }
    const binding = { sessionId: id, session, ctx: actx }
    bindings.set(id, binding)
    return binding
  }
  scope('session-main'); scope('session-other')
  const sessions = {
    binding: id => bindings.get(id),
    sessionOf: actx => [...bindings.values()].find(binding => binding.ctx === actx)?.session,
    scopeOf: actx => [...bindings.values()].find(binding => binding.ctx === actx)?.sessionId,
    refreshProjections: async () => {},
  }
  const inputHub = new native.__BrowserTestInputHub({ get: name => name === 'sessions' ? sessions : undefined }, ct)
  const nativeInput = {
    requestDraftInitialization(binding, options) {
      appendCalls.push({ sessionId: binding.sessionId, sameBinding: sessions.binding(binding.sessionId) === binding, options: { ...options } })
      return inputHub.requestDraftInitialization(binding, options)
    },
  }
  const initialBinding = bindings.get('session-main')
  const current = capability.createStore({ key: 'session-main', ctx: initialBinding.ctx })
  const uiSession = { current }
  const view = capability.createStore({ withSummary: true, installed: true })
  const registrations = new Map(), effects = []
  const registry = capability.createStore({ revision: 0 })
  const publishRegistry = () => registry.set({ revision: registry.getSnapshot().revision + 1 })
  const dictionaries = new Map()
  const ctx = {
    uiSession, sessions, conversation: { input: nativeInput },
    get: name => name === 'clipboard' ? { writeText: async text => copies.push(text) } : undefined,
    locale: {
      register(namespace, dictionary) { dictionaries.set(namespace, dictionary); return () => dictionaries.delete(namespace) },
      bind(namespace) { return (key, values) => translate(dictionaries.get(namespace)[language])(key, values) },
    },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return dispose },
    slots: {
      inject(name, factory) { return factory() },
      register(options, component) { registrations.set(options.name, { options, component }); publishRegistry(); return () => { registrations.delete(options.name); publishRegistry() } },
    },
  }
  const baseItems = [
    { id: 'skill:digger-main', kind: 'skill', name: 'digger-main', description: '仅用于用户明确要求的接口或业务异常原因诊断、源码机制验证和具体问题修复，由诊断主流程分派。'.repeat(8), status: 'installed', sources: [{ agent: 'DSH', path: '/fixture/dsh/skills/digger-main/SKILL.md' }, { agent: 'Codex', path: '/fixture/codex/skills/digger-main/SKILL.md' }, { agent: 'Claude Code', path: '/fixture/claude/skills/digger-main/SKILL.md' }], selectionText: '- Skill: digger-main；读取 /fixture/dsh/skills/digger-main/SKILL.md' },
    { id: 'skill:server-trace', kind: 'skill', name: 'server-trace-rca', description: 'TraceAnalysisWithoutSpacesAndWithExtremelyLongDescriptions'.repeat(12), status: 'installed', sources: [{ agent: 'DSH', path: '/fixture/skills/server-trace/SKILL.md' }], selectionText: '- Skill: server-trace-rca' },
    { id: 'cli:digger', kind: 'cli', name: 'digger', description: '企业日志、关键词与 TraceId 检索', status: 'installed', sources: [{ agent: '本机 CLI', path: '/fixture/bin/digger' }], selectionText: '- CLI: digger；先核对 digger --help' },
    { id: 'cli:o2', kind: 'cli', name: 'o2 · webcli:xingyun', description: '行云平台与内部研发工具', status: 'limited', sources: [{ agent: 'o2', path: '/fixture/bin/o2' }], selectionText: '- CLI: o2；先发现已安装能力' },
    { id: 'mcp:sgm', kind: 'mcp', name: 'sgm-server-log', description: '调用链、热点代码与 Profiler 查询', status: 'configured', sources: [{ agent: 'DSH', path: '/fixture/dsh/mcp.json' }], selectionText: '- MCP: sgm-server-log；确认当前会话工具可用' },
    { id: 'mcp:docs', kind: 'mcp', name: '企业文档', description: '文档搜索、读取与知识检索', status: 'disabled', sources: [{ agent: 'Claude Code', path: '/fixture/claude/mcp.json' }], selectionText: '- MCP: 企业文档' },
    { id: 'cli:missing', kind: 'cli', name: 'missing-cli', description: '缺少本机命令', status: 'missing', sources: [{ agent: '本机 CLI', path: '/fixture/bin/missing' }] },
  ]
  const items = [...baseItems, ...Array.from({ length: 45 }, (_, i) => ({
    id: 'skill:fixture-' + i, kind: 'skill',
    name: i < 2 ? 'very-long-skill-name-with-multiple-content-versions-'.repeat(5) : '能力示例 ' + String(i + 1).padStart(2, '0'),
    description: i < 2 ? 'Long English description with 中文说明 and multiple installation sources. '.repeat(12) : '用于验证列表滚动、筛选与底部操作区可见性',
    status: 'installed', ...(i < 2 ? { contentHash: String(i + 1).repeat(64) } : {}),
    sources: [{ agent: i % 2 ? 'Codex' : 'DSH', path: `/fixture/skills/example-${i}/SKILL.md` }, ...(i < 2 ? [{ agent: 'Additional source with an extremely long display name', path: `/fixture/shared/example-${i}/SKILL.md` }] : [])],
    selectionText: `- Skill: example-${i}`,
  }))]
  const scanRequests = [], pendingScans = []
  let scanMode = params.get('scan') || 'ready'
  const transport = async (url, init = {}) => {
    const payload = JSON.parse(init.body ?? '{}')
    if (String(url).endsWith('/scan')) {
      scanRequests.push({ ...payload })
      if (scanMode === 'hold') await new Promise((resolve, reject) => {
        pendingScans.push(resolve)
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (scanMode === 'fail') return { ok: false, status: 503, json: async () => ({ ok: false, error: { code: 'FIXTURE_OFFLINE', message: 'Fixture discovery temporarily unavailable' } }) }
      return { ok: true, status: 200, json: async () => ({ ok: true, items, complete: true, warnings: [], scannedAt: Date.now() }) }
    }
    if (String(url).endsWith('/detail')) return { ok: true, status: 200, json: async () => ({ ok: true, id: payload.id, content: '# 使用说明\n\n按当前任务读取能力说明与核对依赖。\n'.repeat(70) }) }
    throw new Error('Unexpected fixture request ' + url)
  }
  window.__DSH_TRANSPORT__ = { fetch: transport }
  function install() { capability.apply(ctx); view.set({ installed: true }); return registrations.get('shell.overlay').options.inject().api }
  let api = install()
  const summaryApi = summary.createApi({ get: name => name === 'sessions' ? sessions : undefined }, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ turn: 1, total: 48, added: 890, deleted: 17, files: Array.from({ length: 48 }, (_, i) => ({ path: `src/feature-${i + 1}/component.js`, display: `src/feature-${i + 1}/component.js`, added: 10 + i, deleted: i % 3 })) }) }),
    transportFetch: async () => ({ json: async () => ({ ok: false }) }),
    clipboard: { writeText: async text => copies.push(text) },
    openWindow() {},
  })
  const turn = { changes: { seq: 11 }, presented: [] }
  const chat = { order: [], nodes: { values: () => [], get: () => undefined }, timeline: { turnOrder: [1], turns: new Map([[1, { turn: 1, data: { get: key => key === 'deliverables' ? turn : undefined } }]]) } }
  const list = { phase: 'ready', ids: ['session-main', 'session-other'], byId: { 'session-main': { id: 'session-main', title: '订单接口日志排查', cwd: '/fixture/dsh-plugin' }, 'session-other': { id: 'session-other', title: '另一个会话', cwd: '/fixture/other' } } }
  const projections = { subagentCatalog: [], todos: [], workingDirectory: '/fixture/dsh-plugin' }
  const hooks = {
    useSession: select => select({ sessionId: current.getSnapshot().key, blank: false, running: false, hasMore: false, loadingOlder: false }),
    useSessions: select => select(list),
    useSessionStatus: select => select(new Map()),
    useWorkspaces: select => select({ items: [{ workspaceId: 'fixture', path: '/fixture/dsh-plugin', title: 'dsh-plugin', sessionIds: ['session-main', 'session-other'] }], archivedSessionIds: [], pinnedSessionIds: [] }),
    useChat: select => select(chat),
    useProjection: key => projections[key] ?? null,
  }
  const summaryStyle = document.createElement('style'); summaryStyle.textContent = summary.CSS; summaryStyle.dataset.fixtureSummary = ''; document.head.appendChild(summaryStyle)
  const frameStyle = document.createElement('style')
  frameStyle.textContent = `html,body,#root{margin:0;height:100%;font-family:var(--dsh-font-family-text-default,system-ui,sans-serif)}body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}*{box-sizing:border-box}.fixture-frame{height:100vh;display:flex;overflow:hidden}.fixture-sidebar{width:200px;flex:none;border-right:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);padding:25px 17px;color:var(--dsw-alias-label-secondary);font-size:13px}.fixture-logo{font-size:20px;font-weight:650;margin-bottom:35px}.fixture-sidebar p{margin:22px 0}.fixture-current{padding:10px 8px;background:var(--dsw-alias-interactive-bg-hover);border-radius:8px}.fixture-column{min-width:0;flex:1;display:flex;flex-direction:column;height:100%;position:relative}.fixture-header{min-height:52px;display:flex;align-items:center;gap:10px;padding:10px 22px;border-bottom:1px solid var(--dsw-alias-border-l3);flex:none}.fixture-title{font-size:14px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fixture-utilities{display:flex;align-items:center;gap:7px}.fixture-content{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto}.fixture-transcript{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:25px 26px;font-size:14px;line-height:1.8}.fixture-message{max-width:650px;margin:12px auto}.fixture-bubble{margin-left:auto;padding:12px 17px;border-radius:15px;max-width:540px;background:var(--dsw-alias-interactive-bg-hover)}.fixture-muted{color:var(--dsw-alias-label-secondary)}.fixture-composer{flex:none;max-width:720px;width:calc(100% - 32px);margin:10px auto 18px;padding:15px 17px;border:1px solid var(--dsw-alias-border-l3);border-radius:15px;min-height:100px;color:var(--dsw-alias-label-secondary);font-size:13px}.fixture-composer pre{font:inherit;white-space:pre-wrap;margin:0}.fixture-composer-footer{margin-top:18px;font-size:11px;color:var(--dsw-alias-label-tertiary)}.fixture-overlay{position:absolute;inset:0;pointer-events:none;z-index:20}.fixture-overlay>*{pointer-events:auto}.fixture-caption{position:absolute;bottom:5px;left:22px;font-size:10px;color:var(--dsw-alias-label-tertiary);pointer-events:none}@media(max-width:1100px){.fixture-sidebar{display:none}}@media(max-width:500px){.fixture-header{padding:8px 14px}.fixture-transcript{padding:12px}.fixture-composer{padding:10px;min-height:60px;margin:7px auto}.fixture-composer-footer{display:none}}.dss-tip{animation:none!important}`
  document.head.appendChild(frameStyle)
  function Slot({ name, sessionId }) {
    React.useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
    const entry = registrations.get(name)
    return entry ? h(entry.component, { ...entry.options.inject(), sessionId, t: ct }) : null
  }
  const useStore = store => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  function Draft({ sessionId }) {
    const shell = inputHub.shell(sessionId), state = useStore(shell.state)
    return h('div', { className: 'fixture-composer', 'data-conversation-region': 'composer' }, h('pre', { 'data-fixture-draft': sessionId }, state.draft || '发送消息，或选择本机能力…'), state.attachmentIds.length ? h('span', { 'data-fixture-attachments': '' }, '附件 ' + state.attachmentIds.length) : null, h('div', { className: 'fixture-composer-footer' }, '＋　完全权限', h('span', { style: { float: 'right' } }, 'GPT-6.1 Sol High　↑')))
  }
  function Page() {
    const active = useStore(current), state = useStore(view), sessionId = active.key
    return h('div', { className: 'fixture-frame' },
      h('aside', { className: 'fixture-sidebar' }, h('div', { className: 'fixture-logo' }, 'deepseek HARNESS'), h('p', null, '＋ 新会话'), h('p', null, '插件'), h('p', null, '自动化任务'), h('p', null, '会话导航'), h('p', null, 'dsh-plugin'), h('div', { className: 'fixture-current' }, '本机外部能力选择插件')),
      h('main', { className: 'fixture-column', 'data-phase': 'active' },
        h('header', { className: 'fixture-header' }, h('div', { className: 'fixture-title' }, '本机外部能力选择插件'), h('div', { className: 'fixture-utilities' }, state.withSummary ? h(summary.SummaryToggle, { sessionId, api: summaryApi, t: st, ...hooks }) : null, h(Slot, { name: 'conversation.session.header.utilities', sessionId }), h('span', null, '⋯'))),
        h('div', { className: 'fixture-content', 'data-conversation-content': '', 'data-conversation-session': sessionId },
          h('div', { className: 'fixture-transcript', 'data-fixture-scroll': '' }, h('div', { className: 'fixture-message fixture-bubble' }, '帮我排查订单接口超时，优先使用本机已经安装的能力。'), h('div', { className: 'fixture-message fixture-muted' }, '可以从会话摘要下方打开「外部能力」，选择本次任务需要的 Skill、CLI 或 MCP。'), ...Array.from({ length: 18 }, (_, i) => h('p', { key: i, className: 'fixture-message fixture-muted' }, i ? '在这里继续查看对话内容。能力面板与摘要各自滚动。' : '选中后添加到输入框，原有草稿和附件会保留。'))),
          h(Draft, { key: sessionId, sessionId })),
        h('div', { className: 'fixture-overlay', 'data-shell-overlay': '' }, state.withSummary ? h(summary.SummaryOverlay, { api: summaryApi, t: st }) : null, state.installed ? h(Slot, { name: 'shell.overlay', sessionId }) : null),
        h('div', { className: 'fixture-caption' }, '离线界面验证 · 示例数据')))
  }
  const root = shared['react-dom/client'].createRoot(document.getElementById('root'))
  root.render(h(Page))
  window.__capabilityBrowser = {
    errors, native: true, api, summaryApi, appendCalls, copies, current, inputHub,
    scanRequests, language,
    releaseScan() { scanMode = 'ready'; for (const resolve of pendingScans.splice(0)) resolve() },
    setScanMode(mode) { scanMode = mode },
    seedDraft(text = '保留这段未发送的草稿', attachments = ['attachment-existing']) { const shell = inputHub.shell(current.getSnapshot().key); shell.actions.setDraft(text); shell.actions.pruneAttachments([]); shell.actions.addAttachments(attachments) },
    seedReferenceDraft() { const prefix = '保留这段未发送的草稿 ', token = '@existing.txt'; const shell = inputHub.shell(current.getSnapshot().key); shell.actions.setDraft({ text: prefix + token, references: [{ source: 'fixture-file', ref: 'file:///fixture/existing.txt', offset: prefix.length, length: token.length, label: 'existing.txt', appearance: 'file', clipboardText: token }] }); shell.actions.pruneAttachments([]); shell.actions.addAttachments(['attachment-existing']) },
    snapshot(id = current.getSnapshot().key) { return JSON.parse(JSON.stringify(inputHub.shell(id).state.getSnapshot())) },
    busy(on) { const shell = inputHub.shell(current.getSnapshot().key); if (on) shell.detachedDrafts.set('test-pending', {}); else shell.detachedDrafts.delete('test-pending') },
    activeWithoutRender(id) { const binding = bindings.get(id); current.getSnapshot().key = id; current.getSnapshot().ctx = binding.ctx },
    switchSession(id) { const binding = bindings.get(id); current.set({ key: id, ctx: binding.ctx, fixtureRevision: (current.getSnapshot().fixtureRevision ?? 0) + 1 }) },
    replaceBinding() { const id = current.getSnapshot().key; const binding = scope(id); return binding.sessionId },
    summaryPresent(value) { view.set({ withSummary: value }) },
    summaryLong() { summaryApi.prefs.set({ collapsed: { ...summaryApi.prefs.getSnapshot().collapsed, subagents: false, sources: false } }); document.querySelector('[data-section="changes"] .dss-more')?.click() },
    growSummary() { const currentView = summaryApi.view.getSnapshot().view; const files = Array.from({ length: 64 }, (_, i) => ({ path: `src/growth-${i}/component.js`, display: `src/growth-${i}/component.js`, added: 10, deleted: 0, latest: { seq: 11, turn: 1, index: i } })); summaryApi.publish(current.getSnapshot().key, { model: { ...currentView.model, changes: { ...currentView.model.changes, files, total: files.length, added: 640, deleted: 0 } } }); document.querySelector('[data-section="changes"] .dss-more')?.click() },
    resetSummary() { summaryApi.setPosition(null); summaryApi.prefs.set({ pinned: true }); summaryApi.open(current.getSnapshot().key) },
    async uninstall() { for (const off of effects.splice(0).reverse()) { const result = off(); if (result?.then) await result } view.set({ installed: false }); cleanupCalls.push('uninstall') },
    reinstall() { api = install(); this.api = api },
    dark(on) { document.body.toggleAttribute('data-ds-dark-theme', on) },
    unmount() { root.unmount(); summaryApi.dispose(); for (const off of scopeEffects.splice(0).reverse()) off(); summaryStyle.remove(); frameStyle.remove(); cleanupCalls.push('unmount') },
    cleanupCalls,
  }
})()
