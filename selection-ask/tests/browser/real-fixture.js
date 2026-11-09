// Mounts the plugin overlay and sidebar tab with the shell's real React and primitives.
(function () {
  const shared = window.__shared
  const React = shared.react
  const ReactDOM = shared['react-dom']
  const ReactDOMClient = shared['react-dom/client']
  const h = React.createElement
  window.calls = []
  const thread = { id: 't1', sourceSessionId: 'sess-main', title: '画图说明', selection: { kind: 'chat', role: 'tool', turn: 2, text: 'npm test passed' } }
  const real = window.__REAL_VIEW
  const view = () => real ? ({ ok: true, revision: 'e:' + window.calls.length, running: false, live: false, stream: null, pending: [], error: null, trimmed: !!real.trimmed, cwd: real.cwd, thread,
    model: { provider: 'claude-relay', model: 'claude-opus-5-5', name: 'Claude Opus 5.5', images: true }, messages: real.messages }) : ({ ok: true, revision: 'e:' + window.calls.length, running: false, live: true, stream: null, pending: [], error: null, trimmed: false, cwd: '/repo/work', thread,
    model: { provider: 'claude-relay', model: 'claude-opus-5-5', name: 'Claude Opus 5.5', reasoningEffort: 'high', effortName: 'High', images: true },
    messages: [{ id: 'u1', role: 'user', text: '画图说明', images: 1 },
      { id: 'a1', role: 'assistant', text: '![暴力枚举树 vs. 最短路节点账本](brute_force_vs_shortest_path_ledger.png)\n\n如上图（`brute_force_vs_shortest_path_ledger.png`）所示，**粗体**与表格：\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[链接](https://example.com) 与 [文件](docs/a.md)', files: ['brute_force_vs_shortest_path_ledger.png'], tools: [{ id: 'c', name: 'present', status: 'done' }], status: 'done' }] })
  const catalog = { ok: true, current: { provider: 'claude-relay', model: 'claude-opus-5-5', name: 'Claude Opus 5.5', images: true }, groups: [{ id: 'claude-relay', name: 'Claude Relay', models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', images: true }] }] }
  window.__DSH_TRANSPORT__ = { async fetch(path, init) {
    const op = path.split('/').pop(); const body = JSON.parse(init.body); window.calls.push({ op, body })
    let data
    if (op === 'models') data = catalog
    else if (op === 'create') data = { ok: true, thread }
    else if (op === 'view') { if (body.since) await new Promise(r => setTimeout(r, 500)); data = view() }
    else if (op === 'list') data = { ok: true, threads: [{ ...thread, updatedAt: Date.now(), createdAt: Date.now() }] }
    else data = { ok: true }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  } }
  const mod = window.__registration.factory((id) => { if (id in shared) return shared[id]; throw new Error('missing ' + id) })
  const registered = []; const dictionaries = {}
  const ctx = {
    effect(fn) { fn() },
    get: () => undefined,
    locale: { register(ns, dict) { dictionaries[ns] = dict; return () => {} }, bind: (ns) => (key, params = {}) => String(dictionaries[ns]?.zh?.[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '') },
    slots: { inject(_, fn) { return fn() }, register(options, component) { registered.push({ options, component }); return () => {} }, entries: () => [], subscribe: () => () => {} },
    sidebarRight: { mounted: { getSnapshot: () => 'sess-main' }, openTab(kind, options) { window.pinned = { kind, options } }, openResource(address, options) { window.opened = { address, options } } },
    sidebarRightTabs: { register: () => () => {} },
    sessions: { binding: () => undefined },
    uiConversation: { interactions: { register: () => () => {} } },
  }
  class Boundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(error) { return { error } }
    componentDidCatch(error) { window.__errors.push('render: ' + String(error?.stack || error)) }
    render() { return this.state.error ? h('pre', { id: this.props.id + '-error' }, String(this.state.error)) : this.props.children }
  }
  try {
    mod.apply(ctx)
    const overlay = registered.find((entry) => entry.options.name === 'shell.overlay')
    ReactDOMClient.createRoot(document.getElementById('overlay')).render(h(Boundary, { id: 'overlay' }, h(overlay.component, overlay.options.inject())))
    const tab = registered.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
    const tabInfo = { tab: { visible: true, navigation: { params: { threadId: 't1' }, revision: 1 } } }
    ReactDOMClient.createRoot(document.getElementById('tab')).render(h(Boundary, { id: 'tab' }, h(tab.component, { ...tab.options.inject(), sessionId: 'sess-main', useTabInfo: () => tabInfo })))
  } catch (error) { window.__errors.push('apply: ' + String(error?.stack || error)) }
  window.selectTool = () => { const node = document.getElementById('tool').firstChild; const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 8); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }
  window.ReactDOMVersion = ReactDOM?.version
})()
