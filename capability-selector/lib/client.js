/** Native DSH client: an independent accessory below the session summary. */
window.__ModuleLoader__.load({
  id: 'dsh-capability-selector',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-capability-selector'
    const NS = 'capability-selector'
    const PANEL_ID = 'dsh-capability-selector-panel'
    const RESERVE = 48
    const EMPTY = Object.freeze([])
    const ZH = {
      title: '外部能力', subtitle: '发现本机能力，选择用于本次任务', search: '搜索名称、用途或来源…', all: '全部', skill: 'Skills', cli: 'CLI', mcp: 'MCP', refresh: '刷新', close: '关闭能力选择器', loading: '正在扫描本机能力…', empty: '没有匹配的能力', retry: '重试', source: '来源', allSources: '全部来源', readyOnly: '仅已安装 / 配置', selected: '已选 {count} 项', clear: '清空', add: '添加到输入框', adding: '正在添加…', detail: '详情', back: '返回能力列表', sources: '安装来源', instruction: '本次任务使用说明', full: '查看完整说明', detailLoading: '正在读取说明…', noDetail: '选择一项能力查看说明、来源和依赖', installed: '已安装', configured: '已配置', missing: '未安装', disabled: '已禁用', limited: '待核对', unknown: '待核对', local: '本机', scope: '扫描已支持的位置；安装和配置状态不代表登录就绪或当前会话可调用。', warnings: '{count} 条扫描提示', noSession: '打开一个会话后即可选择能力', stale: '当前会话已变化，请重新打开面板后添加。', blocked: '输入框正忙，请稍后重试；已选能力仍保留。', unsupported: '此版本未提供原生草稿追加接口，可复制使用说明。', copy: '复制使用说明', copied: '已复制使用说明', duplicate: '已添加这些能力；再次选择后可添加新的说明。', merged: '{count} 处来源', fingerprint: '内容版本', variants: '同名版本', added: '已添加到当前输入框', select: '选择 {name}', partial: '扫描结果不完整，展开提示查看原因', scanned: '最近扫描 {time}', description: '说明', truncated: '说明较长，以下仅展示部分内容。', configuredHint: 'MCP 已配置；实际连接与当前会话工具可用性尚未验证。', emptySelection: '先选择要使用的能力', error: '请求失败，请重试', noCopy: '无法访问剪贴板，请手动复制下方说明。', selectedHint: '选择仅表示本次任务的使用偏好',
    }
    const EN = {
      title: 'External capabilities', subtitle: 'Discover local capabilities for this task', search: 'Search names, purposes or sources…', all: 'All', skill: 'Skills', cli: 'CLI', mcp: 'MCP', refresh: 'Refresh', close: 'Close capability selector', loading: 'Scanning local capabilities…', empty: 'No matching capabilities', retry: 'Retry', source: 'Source', allSources: 'All sources', readyOnly: 'Installed / configured', selected: '{count} selected', clear: 'Clear', add: 'Add to composer', adding: 'Adding…', detail: 'Details', back: 'Back to capabilities', sources: 'Installation sources', instruction: 'Task usage instructions', full: 'Read full instructions', detailLoading: 'Reading instructions…', noDetail: 'Choose an item to see its instructions, sources and dependencies', installed: 'Installed', configured: 'Configured', missing: 'Not installed', disabled: 'Disabled', limited: 'Check required', unknown: 'Check required', local: 'Local', scope: 'Scans supported locations. Installation or configuration does not verify authentication or availability in this session.', warnings: '{count} scan notices', noSession: 'Open a session to select capabilities', stale: 'The active session changed. Reopen the panel before adding.', blocked: 'The composer is busy. Try again; your selection is kept.', unsupported: 'This version has no native append API. Copy the instructions instead.', copy: 'Copy instructions', copied: 'Instructions copied', duplicate: 'These instructions were already added. Change the selection to add more.', merged: '{count} sources', fingerprint: 'Content version', variants: 'Name variants', added: 'Added to the current composer', select: 'Select {name}', partial: 'Incomplete scan; expand notices for details', scanned: 'Last scanned {time}', description: 'Description', truncated: 'This long document is shown in part.', configuredHint: 'MCP is configured; connection and session tool availability have not been verified.', emptySelection: 'Select capabilities first', error: 'Request failed. Please retry.', noCopy: 'Clipboard unavailable. Copy the instructions below manually.', selectedHint: 'Selection expresses a preference for this task',
    }
    function errorText(error) { return String(error?.message ?? error ?? '') }
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return { getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }, set(patch) { const next = { ...state, ...patch }; if (Object.keys(next).every(key => next[key] === state[key])) return; state = next; for (const fn of [...listeners]) fn() } }
    }
    const clamp = (n, a, b) => Math.max(a, Math.min(n, Math.max(a, b)))
    function viewportOf(win) {
      const v = win.visualViewport
      return { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? win.innerWidth, height: v?.height ?? win.innerHeight }
    }
    function dockPlacement(summary, fallback, viewport) {
      const { left: vx = 0, top: vy = 0, width: vw, height: vh } = viewport
      const width = Math.max(1, Math.min(summary?.width ?? 320, vw - 24))
      return { left: clamp(summary?.left ?? (fallback?.right ?? vx + vw) - width - 12, vx + 12, vx + vw - width - 12), top: clamp(summary ? summary.bottom + 8 : (fallback?.bottom ?? vy + 52) + 8, vy + 12, vy + vh - 48), width, height: 36 }
    }
    function panelPlacement(dock, viewport) {
      const { left: vx = 0, top: vy = 0, width: vw, height: vh } = viewport
      const width = Math.max(1, Math.min(1000, vw - 24))
      const height = Math.max(1, Math.min(660, vh - 24))
      const leftSpace = dock.left - vx - 24
      const side = vw >= 900 && leftSpace >= Math.min(760, width)
      const actualWidth = side ? Math.min(width, leftSpace) : width
      return { left: side ? dock.left - actualWidth - 12 : vx + (vw - actualWidth) / 2, top: clamp(dock.top, vy + 12, vy + vh - height - 12), width: actualWidth, height, mode: vw < 760 ? 'sheet' : side ? 'left' : 'center' }
    }
    function filterItems(items, { query = '', kind = 'all', agent = '', readyOnly = false }) {
      const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
      return items.filter(item => (kind === 'all' || item.kind === kind) && (!agent || item.sources?.some(source => source.agent === agent)) && (!readyOnly || ['installed', 'configured'].includes(item.status)) && words.every(word => [item.name, item.description, ...(item.sources ?? []).flatMap(source => [source.agent, source.path])].join(' ').toLocaleLowerCase().includes(word)))
    }
    function buildSelectionText(items) {
      return ['[本次任务选择的外部能力]', '请按任务需要优先使用以下能力。选择仅表示使用偏好；按需读取 Skill，核对 CLI 帮助，确认 MCP 是否已接入当前会话。', ...items.map(item => item.selectionText || `- ${item.kind}: ${item.name}；状态：${item.status}`)].join('\n')
    }
    async function requestJSON(fetchImpl, action, payload, signal) {
      const response = await fetchImpl(`/api/capability-selector/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal })
      let data
      try { data = await response.json() } catch { throw new Error(`HTTP ${response.status}`) }
      if (!response.ok || data?.ok !== true) throw new Error(data?.message ?? data?.error?.message ?? `HTTP ${response.status}`)
      return data
    }
    function createController({ request, append, current, copy, t = key => key }) {
      const store = createStore({ sessionId: undefined, open: false, items: EMPTY, selectedIds: EMPTY, query: '', kind: 'all', agent: '', readyOnly: false, status: 'idle', error: '', notice: '', warnings: EMPTY, activeId: null, detail: null, detailStatus: 'idle', detailError: '', showDetail: false, scannedAt: null, complete: true, adding: false })
      let binding, scanAbort, detailAbort, generation = 0, detailGeneration = 0, disposed = false
      const selected = () => store.getSnapshot().items.filter(item => store.getSnapshot().selectedIds.includes(item.id))
      function setSession(id, nextBinding) {
        if (id === store.getSnapshot().sessionId && nextBinding === binding) return
        generation++; detailGeneration++; scanAbort?.abort(); detailAbort?.abort(); binding = nextBinding
        store.set({ sessionId: id, open: false, items: EMPTY, selectedIds: EMPTY, status: 'idle', error: '', notice: '', activeId: null, detail: null, detailStatus: 'idle', detailError: '', warnings: EMPTY, scannedAt: null, adding: false, showDetail: false })
      }
      async function scan(refresh = false) {
        const sessionId = store.getSnapshot().sessionId
        if (!sessionId || disposed) return
        scanAbort?.abort(); detailAbort?.abort(); detailGeneration++; const abort = scanAbort = new AbortController(); const ticket = ++generation
        store.set({ status: 'loading', error: '', notice: '' })
        try {
          const data = await request('scan', { sessionId, refresh }, abort.signal)
          if (disposed || ticket !== generation || abort.signal.aborted) return
          const items = Array.isArray(data.items) ? data.items : EMPTY
          const previous = store.getSnapshot()
          store.set({ items, selectedIds: previous.selectedIds.filter(id => items.some(item => item.id === id)), activeId: items.some(item => item.id === previous.activeId) ? previous.activeId : items[0]?.id ?? null, detail: null, detailStatus: 'idle', status: 'ready', warnings: data.warnings ?? EMPTY, scannedAt: data.scannedAt ?? Date.now(), complete: data.complete !== false })
        } catch (error) { if (!disposed && ticket === generation && !abort.signal.aborted) store.set({ status: 'error', error: errorText(error) }) }
      }
      function open() { store.set({ open: true, notice: '', showDetail: false }); if (store.getSnapshot().status === 'idle' || store.getSnapshot().status === 'error') void scan() }
      function close() { store.set({ open: false, showDetail: false }) }
      function toggle(id) {
        const state = store.getSnapshot(), item = state.items.find(item => item.id === id)
        if (!item || ['missing', 'disabled'].includes(item.status)) return
        store.set({ selectedIds: state.selectedIds.includes(id) ? state.selectedIds.filter(value => value !== id) : [...state.selectedIds, id], notice: '' })
      }
      async function detail(id) {
        const state = store.getSnapshot(); if (!state.items.some(item => item.id === id)) return
        detailAbort?.abort(); const abort = detailAbort = new AbortController(); const ticket = ++detailGeneration
        store.set({ activeId: id, showDetail: true, detail: null, detailStatus: 'loading', detailError: '' })
        try {
          const data = await request('detail', { sessionId: state.sessionId, id }, abort.signal)
          if (!disposed && ticket === detailGeneration && !abort.signal.aborted) store.set({ detail: data, detailStatus: 'ready' })
        } catch (error) { if (!disposed && ticket === detailGeneration && !abort.signal.aborted) store.set({ detailStatus: 'error', detailError: errorText(error) }) }
      }
      function add() {
        const state = store.getSnapshot(), items = selected()
        if (!items.length) { store.set({ notice: t('emptySelection') }); return }
        const active = current()
        if (!binding || active.id !== state.sessionId || active.binding !== binding) { store.set({ notice: t('stale') }); return }
        store.set({ adding: true, notice: '' })
        try {
          const result = append(binding, buildSelectionText(items))
          if (result === 'applied') { store.set({ open: false, notice: t('added'), adding: false }); return }
          store.set({ notice: t(result === 'unsupported' ? 'unsupported' : 'blocked'), adding: false })
        } catch (error) { store.set({ notice: errorText(error), adding: false }) }
      }
      async function copySelection() {
        const items = selected(); if (!items.length) return
        try { await copy(buildSelectionText(items)); if (!disposed) store.set({ notice: t('copied') }) } catch { if (!disposed) store.set({ notice: t('noCopy') }) }
      }
      return { ...store, setSession, open, close, scan, toggle, detail, add, copySelection, selected, dispose() { disposed = true; generation++; detailGeneration++; scanAbort?.abort(); detailAbort?.abort(); store.set({ open: false }); } }
    }
    function Icon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true }, ...[[3,3],[14,3],[3,14],[14,14]].map(([x,y]) => h('rect', { key: `${x}:${y}`, x, y, width: 7, height: 7, rx: 1.5 })))
    }
    const CSS = `
.dsc-root{--dsc-bg:var(--dsw-alias-bg-base,#fff);--dsc-surface:var(--dsw-specific-menu,#fff);--dsc-text:var(--dsw-alias-label-primary,#27364b);--dsc-muted:var(--dsw-alias-label-secondary,#7d899b);--dsc-border:var(--dsw-alias-border-l1,#e3e8f0);--dsc-hover:var(--dsw-alias-interactive-bg-hover,#f3f5fa);--dsc-accent:var(--dsw-alias-state-business-primary,#5a74de);color:var(--dsc-text);font:13px/1.5 var(--dsh-font-family-text-default,system-ui,sans-serif);text-align:left}
.dsc-root *{box-sizing:border-box}.dsc-root button,.dsc-root input,.dsc-root select{font:inherit}.dsc-root button{cursor:pointer}.dsc-root button:disabled{cursor:default;opacity:.5}.dsc-root button:focus-visible,.dsc-root input:focus-visible,.dsc-root select:focus-visible,.dsc-root summary:focus-visible{outline:2px solid var(--dsc-accent);outline-offset:2px}
.dsc-dock{position:fixed;z-index:38;display:flex;align-items:center;gap:8px;pointer-events:auto;-webkit-app-region:no-drag;min-width:0}
.dsc-trigger{height:36px;flex:none;display:inline-flex;align-items:center;gap:7px;padding:0 11px;border:1px solid var(--dsc-border);border-radius:9px;color:var(--dsc-muted);background:var(--dsc-surface);box-shadow:0 2px 8px #00000007}.dsc-trigger:hover,.dsc-trigger[aria-expanded=true]{background:var(--dsc-hover);color:var(--dsc-accent)}.dsc-count{font-size:11px;padding:0 6px;border-radius:10px;background:var(--dsc-hover);font-variant-numeric:tabular-nums}.dsc-selected-count{font-size:11px;color:var(--dsc-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.dsc-panel{position:fixed;z-index:50;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsc-border);border-radius:14px;box-shadow:0 12px 50px #00000026;background:var(--dsc-bg);pointer-events:auto;-webkit-app-region:no-drag;max-width:calc(100vw - 24px)}
.dsc-head{display:flex;align-items:center;gap:10px;flex:none;padding:17px 18px 10px}.dsc-head-icon{display:flex;align-items:center;justify-content:center;width:35px;height:35px;border-radius:9px;color:var(--dsc-accent);background:var(--dsc-hover)}.dsc-heading{flex:1;min-width:0}.dsc-heading h2{font-size:18px;margin:0;font-weight:600}.dsc-subtitle{font-size:11px;color:var(--dsc-muted);margin-top:1px}.dsc-plain{border:0;background:transparent;color:var(--dsc-muted);border-radius:6px;padding:5px 8px;flex:none}.dsc-plain:hover{background:var(--dsc-hover);color:var(--dsc-text)}.dsc-close{font-size:22px!important;line-height:22px}.dsc-search-wrap{padding:0 18px 12px;flex:none}.dsc-search{width:100%;height:37px;border:1px solid var(--dsc-border);border-radius:8px;background:var(--dsc-bg);color:var(--dsc-text);padding:0 11px;min-width:0}
.dsc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 18px 12px;flex:none;border-bottom:1px solid var(--dsc-border)}.dsc-tabs{display:flex;gap:3px;flex:1;min-width:210px}.dsc-tab{padding:5px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsc-muted);white-space:nowrap}.dsc-tab[aria-pressed=true]{background:var(--dsc-hover);color:var(--dsc-accent);font-weight:600}.dsc-tab-count{font-size:10px;opacity:.75;margin-left:5px}.dsc-source-select{max-width:145px;height:29px;border:1px solid var(--dsc-border);border-radius:6px;color:var(--dsc-muted);background:var(--dsc-bg)}.dsc-ready{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsc-muted);white-space:nowrap}.dsc-ready input,.dsc-row input{accent-color:var(--dsc-accent)}
.dsc-panel-body{display:grid;grid-template-columns:minmax(0,1fr) 290px;flex:1;min-height:0}.dsc-list{overflow:auto;overscroll-behavior:contain;min-height:0;padding:8px 10px;scrollbar-gutter:stable}.dsc-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;min-height:59px;min-width:0}.dsc-row[data-active=true]{background:var(--dsc-hover)}.dsc-row input{flex:none;width:16px;height:16px;margin:0}.dsc-entry{border:0;background:transparent;display:flex;gap:9px;align-items:center;min-width:0;flex:1;padding:3px 0;text-align:left;color:var(--dsc-text)}.dsc-kind-icon{width:29px;height:29px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex:none;font-size:11px;color:#8b70c2;background:#9474c214}.dsc-kind-icon[data-kind=cli]{color:#529780;background:#52978014}.dsc-kind-icon[data-kind=mcp]{color:#658ec2;background:#658ec214}.dsc-entry-text{display:block;min-width:0;flex:1;overflow:hidden}.dsc-entry-name{display:flex;gap:6px;align-items:center;min-width:0;overflow:hidden;font-weight:500}.dsc-entry-name>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsc-merged{font-size:10px;color:var(--dsc-muted);font-weight:400;flex:none}.dsc-entry-description{display:block;max-width:100%;color:var(--dsc-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px}.dsc-row-meta{text-align:right;flex:none;min-width:0;overflow:hidden;font-size:10px;max-width:88px;color:var(--dsc-muted)}.dsc-row-meta .dsc-status{overflow:hidden;text-overflow:ellipsis}.dsc-status{display:block;white-space:nowrap}.dsc-status[data-status=installed]{color:#5b9b7e}.dsc-status[data-status=configured]{color:#688cc3}.dsc-status[data-status=limited]{color:#b08d4e}.dsc-row-source{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;max-width:88px}
.dsc-detail{border-left:1px solid var(--dsc-border);padding:16px;overflow:auto;overscroll-behavior:contain;min-width:0;background:var(--dsc-hover)}.dsc-detail h3{margin:8px 0;font-size:19px;overflow-wrap:anywhere}.dsc-detail h4{font-size:12px;margin:18px 0 7px;font-weight:600}.dsc-detail p{color:var(--dsc-muted);margin:6px 0;overflow-wrap:anywhere}.dsc-source-item{padding:7px 0;border-bottom:1px solid var(--dsc-border)}.dsc-source-item strong{font-size:11px;font-weight:500}.dsc-source-item code{font:10px/1.5 ui-monospace,monospace;display:block;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--dsc-muted);margin-top:3px}.dsc-content{font:11px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;user-select:text}.dsc-task-text{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsc-muted);user-select:text}.dsc-mobile-back{display:none}.dsc-empty{padding:28px 16px;text-align:center;color:var(--dsc-muted);font-size:12px}
.dsc-feedback{padding:8px 16px;border-top:1px solid var(--dsc-border);font-size:11px;flex:none;max-height:90px;overflow:auto;overflow-wrap:anywhere;color:var(--dsc-muted)}.dsc-feedback[role=alert]{color:#b18554}.dsc-warnings{margin:0;font-size:11px;color:var(--dsc-muted)}.dsc-warnings summary{cursor:pointer}.dsc-warnings ul{margin:6px 0;padding-left:20px}.dsc-footer{border-top:1px solid var(--dsc-border);padding:10px 16px;flex:none;display:flex;align-items:center;gap:10px;min-width:0}.dsc-selection{flex:1;min-width:0}.dsc-selection-head{display:flex;gap:10px;align-items:center;white-space:nowrap}.dsc-selection-head button{font-size:11px;padding:1px 4px}.dsc-chips{display:flex;gap:4px;overflow:auto;margin-top:5px;max-height:30px}.dsc-chip{border:0;border-radius:6px;padding:2px 6px;background:var(--dsc-hover);color:var(--dsc-muted);font-size:10px!important;white-space:nowrap;flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis}.dsc-add{border:0;border-radius:8px;background:var(--dsc-accent);color:#fff;padding:9px 14px;font-weight:500;flex:none}.dsc-footnote{font-size:10px;color:var(--dsc-muted);padding:0 16px 9px;flex:none}.dsc-backdrop{position:fixed;inset:0;z-index:49;background:#00000020;pointer-events:auto}.dsc-dock-notice{position:absolute;top:40px;right:0;max-width:320px;padding:7px 10px;border-radius:8px;background:var(--dsc-surface);box-shadow:0 3px 15px #00000014;font-size:11px;color:var(--dsc-muted)}
@media(max-width:759px){.dsc-panel-body{grid-template-columns:minmax(0,1fr)}.dsc-detail{display:none;border-left:0}.dsc-panel[data-detail=true] .dsc-list{display:none}.dsc-panel[data-detail=true] .dsc-detail{display:block}.dsc-mobile-back{display:inline-flex}.dsc-subtitle{display:none}.dsc-head{padding:12px 12px 9px}.dsc-search-wrap{padding:0 12px 9px}.dsc-toolbar{padding:0 12px 9px;gap:5px}.dsc-tabs{min-width:100%;flex:none}.dsc-tab{padding:4px 8px}.dsc-footer{padding:9px 12px;gap:6px}.dsc-add{padding:8px 10px}.dsc-copy{display:none}.dsc-footnote{padding:0 12px 7px}.dsc-row-source{max-width:72px}.dsc-source-select{max-width:155px}.dsc-dock{gap:5px}}
@media(max-height:480px){.dsc-head{padding:6px 12px}.dsc-head-icon,.dsc-subtitle,.dsc-footnote,.dsc-chips,.dsc-ready{display:none}.dsc-heading h2{font-size:15px}.dsc-search-wrap{padding:0 12px 5px}.dsc-search{height:30px}.dsc-toolbar{padding:0 12px 5px;gap:3px}.dsc-tabs{min-width:0}.dsc-source-select{display:none}.dsc-footer{padding:5px 12px}.dsc-add{padding:5px 10px}.dsc-feedback{max-height:45px;padding:4px 12px}}
@media(max-height:280px){.dsc-head{padding:0 12px;height:22px;min-height:0}.dsc-head .dsc-plain{padding:0 6px;height:20px;min-height:0;line-height:18px}.dsc-heading h2{font-size:13px;line-height:20px}.dsc-search-wrap{padding-bottom:3px}.dsc-search{height:24px;min-height:0}.dsc-toolbar{padding-bottom:3px}.dsc-tab{padding:2px 6px;height:24px;min-height:0}.dsc-footer{padding:3px 12px}.dsc-footer button{min-height:0}.dsc-copy{display:none}.dsc-feedback{max-height:28px}.dsc-list{padding:2px 6px}.dsc-row{min-height:38px;padding:3px 6px}.dsc-entry-description,.dsc-row-source{display:none}}
`
    function useStore(store) { return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) }
    function useFixedPosition(ref, target) {
      const [offset, setOffset] = React.useState({ x: 0, y: 0 })
      React.useLayoutEffect(() => {
        if (!ref.current || !target) return
        const rect = ref.current.getBoundingClientRect(), dx = target.left - rect.left, dy = target.top - rect.top
        if (Math.abs(dx) > .5 || Math.abs(dy) > .5) setOffset(old => ({ x: old.x + dx, y: old.y + dy }))
      }, [ref, target?.left, target?.top, target?.width, target?.height])
      return target ? { left: target.left + offset.x, top: target.top + offset.y, width: target.width, height: target.height } : { visibility: 'hidden', left: 0, top: 0 }
    }
    function useDockGeometry(sessionId, anchors) {
      const [geometry, setGeometry] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!sessionId) { setGeometry(null); return }
        let frame = 0, summaryElement, headerElement, stopped = false
        const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        const summaryObserver = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
        function measure() {
          if (stopped) return
          const found = document.getElementById('dsh-session-summary-card')
          const summary = found?.getAttribute('data-dsh-session-summary') === sessionId && found.getClientRects().length ? found : null
          const header = anchors.get(sessionId)?.closest?.('header')
          if (summary !== summaryElement || header !== headerElement) {
            resizeObserver?.disconnect(); summaryObserver?.disconnect(); summaryElement = summary; headerElement = header
            if (summary) { resizeObserver?.observe(summary); summaryObserver?.observe(summary, { attributes: true, attributeFilter: ['style', 'data-layout'] }) }
            if (header) resizeObserver?.observe(header)
          }
          const viewport = viewportOf(window), dock = dockPlacement(summary?.getBoundingClientRect(), header?.getBoundingClientRect(), viewport)
          const next = { dock, viewport, panel: panelPlacement(dock, viewport) }
          setGeometry(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
        }
        function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
        observer?.observe(document.body, { childList: true, subtree: true })
        window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); window.addEventListener('dsh:summary-accessory-change', schedule)
        window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule)
        measure()
        return () => { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); resizeObserver?.disconnect(); summaryObserver?.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.removeEventListener('dsh:summary-accessory-change', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule) }
      }, [sessionId, anchors])
      return geometry
    }
    function CapabilityAnchor({ sessionId, anchors }) {
      const ref = React.useCallback(element => { if (element) anchors.set(sessionId, element); else anchors.delete(sessionId); window.dispatchEvent(new Event('dsh:summary-accessory-change')) }, [sessionId, anchors])
      return h('span', { ref, 'data-dsh-capability-anchor': sessionId, style: { width: 0, height: 0, display: 'inline-block' }, 'aria-hidden': true })
    }
    function Details({ api, state, t }) {
      const item = state.items.find(value => value.id === state.activeId)
      if (!item) return h('aside', { className: 'dsc-detail dsc-empty' }, t('noDetail'))
      const content = state.detail?.content ?? state.detail?.body
      return h('aside', { className: 'dsc-detail', 'aria-label': t('detail') },
        h('button', { type: 'button', className: 'dsc-plain dsc-mobile-back', onClick: () => api.set({ showDetail: false }) }, '← ', t('back')),
        h('span', { className: 'dsc-status', 'data-status': item.status }, t(item.kind), ' · ', t(item.status in ZH ? item.status : 'unknown')),
        h('h3', null, item.name), item.contentHash ? h('code', { className: 'dsc-task-text' }, `${t('fingerprint')} · ${item.contentHash.slice(0, 8)}`) : null, h('p', null, item.description), item.kind === 'mcp' ? h('p', null, t('configuredHint')) : null,
        h('h4', null, t('sources')),
        ...(item.sources ?? []).map((source, index) => h('div', { key: `${source.path}:${index}`, className: 'dsc-source-item' }, h('strong', null, source.agent ?? t('local')), source.path ? h('code', null, source.path) : null)),
        h('h4', null, t('instruction')), h('div', { className: 'dsc-task-text' }, item.selectionText ?? buildSelectionText([item])),
        state.detailStatus === 'idle' ? h('button', { type: 'button', className: 'dsc-plain', onClick: () => api.detail(item.id) }, t('full'), ' ↗') : null,
        state.detailStatus === 'loading' ? h('p', { role: 'status' }, t('detailLoading')) : null,
        state.detailStatus === 'error' ? h('div', { role: 'alert' }, state.detailError, h('button', { type: 'button', className: 'dsc-plain', onClick: () => api.detail(item.id) }, t('retry'))) : null,
        typeof content === 'string' && content ? h('pre', { className: 'dsc-content' }, content) : null,
        state.detail?.truncated ? h('p', null, t('truncated')) : null)
    }
    function CapabilityPanel({ api, state, t, placement, triggerRef }) {
      const ref = React.useRef(null), searchRef = React.useRef(null)
      const style = useFixedPosition(ref, placement)
      const visible = filterItems(state.items, state)
      const agents = [...new Set(state.items.flatMap(item => (item.sources ?? []).map(source => source.agent).filter(Boolean)))].sort()
      const selected = api.selected()
      React.useEffect(() => { const frame = requestAnimationFrame(() => searchRef.current?.focus()); return () => cancelAnimationFrame(frame) }, [])
      React.useEffect(() => {
        const close = () => { api.close(); triggerRef.current?.focus({ preventScroll: true }) }
        const keydown = event => {
          if (event.isComposing) return
          if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close() }
          if (event.key === 'Tab' && placement.mode === 'sheet') {
            const nodes = [...(ref.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') ?? [])].filter(node => node.getClientRects().length)
            const first = nodes[0], last = nodes.at(-1)
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }
        const outside = event => { if (!ref.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) api.close() }
        document.addEventListener('keydown', keydown, true); document.addEventListener('pointerdown', outside, true)
        return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', outside, true) }
      }, [api, triggerRef, placement.mode])
      const warnings = state.warnings.map(warning => typeof warning === 'string' ? warning : [warning.agent, warning.message ?? warning.code, warning.path].filter(Boolean).join(' · '))
      return h(React.Fragment, null,
        placement.mode === 'sheet' ? h('div', { className: 'dsc-backdrop', onClick: () => api.close(), 'aria-hidden': true }) : null,
        h('section', { id: PANEL_ID, ref, className: 'dsc-panel', role: 'dialog', 'aria-modal': placement.mode === 'sheet' ? true : undefined, 'aria-labelledby': `${PANEL_ID}-title`, 'data-detail': state.showDetail, 'data-mode': placement.mode, style },
          h('div', { className: 'dsc-head' }, h('span', { className: 'dsc-head-icon' }, h(Icon, { size: 20 })), h('div', { className: 'dsc-heading' }, h('h2', { id: `${PANEL_ID}-title` }, t('title')), h('div', { className: 'dsc-subtitle' }, t('subtitle'))), h('button', { type: 'button', className: 'dsc-plain', disabled: state.status === 'loading', onClick: () => api.scan(true) }, t('refresh')), h('button', { type: 'button', className: 'dsc-plain dsc-close', 'aria-label': t('close'), onClick: () => { api.close(); triggerRef.current?.focus({ preventScroll: true }) } }, '×')),
          h('div', { className: 'dsc-search-wrap' }, h('input', { ref: searchRef, className: 'dsc-search', type: 'search', value: state.query, placeholder: t('search'), 'aria-label': t('search'), onChange: event => api.set({ query: event.target.value, showDetail: false }) })),
          h('div', { className: 'dsc-toolbar' }, h('div', { className: 'dsc-tabs', 'aria-label': t('title') }, ...['all', 'skill', 'cli', 'mcp'].map(kind => h('button', { type: 'button', className: 'dsc-tab', key: kind, 'aria-pressed': state.kind === kind, onClick: () => api.set({ kind, showDetail: false }) }, t(kind), h('span', { className: 'dsc-tab-count' }, state.items.filter(item => kind === 'all' || item.kind === kind).length)))), h('select', { className: 'dsc-source-select', value: state.agent, 'aria-label': t('source'), onChange: event => api.set({ agent: event.target.value }) }, h('option', { value: '' }, t('allSources')), ...agents.map(agent => h('option', { key: agent, value: agent }, agent))), h('label', { className: 'dsc-ready' }, h('input', { type: 'checkbox', checked: state.readyOnly, onChange: event => api.set({ readyOnly: event.target.checked }) }), t('readyOnly'))),
          h('div', { className: 'dsc-panel-body' }, h('div', { className: 'dsc-list', 'aria-busy': state.status === 'loading' },
            state.status === 'loading' && !state.items.length ? h('div', { className: 'dsc-empty', role: 'status' }, t('loading')) : null,
            state.status === 'error' ? h('div', { className: 'dsc-empty', role: 'alert' }, state.error, h('button', { type: 'button', className: 'dsc-plain', onClick: () => api.scan(true) }, t('retry'))) : null,
            state.status === 'ready' && !visible.length ? h('div', { className: 'dsc-empty' }, t('empty')) : null,
            ...visible.map(item => h('div', { className: 'dsc-row', key: item.id, 'data-active': state.activeId === item.id },
              h('input', { type: 'checkbox', checked: state.selectedIds.includes(item.id), disabled: ['disabled', 'missing'].includes(item.status), 'aria-label': t('select', { name: item.name }), onChange: () => api.toggle(item.id) }),
              h('button', { type: 'button', className: 'dsc-entry', onClick: () => api.detail(item.id), 'aria-label': `${item.name} · ${t('detail')}` }, h('span', { className: 'dsc-kind-icon', 'data-kind': item.kind }, ({ skill: 'S', cli: '>_', mcp: 'M' })[item.kind]), h('span', { className: 'dsc-entry-text' }, h('span', { className: 'dsc-entry-name' }, h('span', null, item.name), item.kind === 'skill' && state.items.some(other => other.id !== item.id && other.kind === item.kind && other.name === item.name) ? h('span', { className: 'dsc-merged', title: item.contentHash ?? item.id }, `${t('variants')} ${item.contentHash?.slice(0, 6) ?? ''}`) : null, (item.sources?.length ?? 0) > 1 ? h('span', { className: 'dsc-merged' }, t('merged', { count: item.sources.length })) : null), h('span', { className: 'dsc-entry-description' }, item.description))),
              h('span', { className: 'dsc-row-meta' }, h('span', { className: 'dsc-status', 'data-status': item.status }, t(item.status in ZH ? item.status : 'unknown')), h('span', { className: 'dsc-row-source' }, [...new Set((item.sources ?? []).map(source => source.agent))].join(' · ')))))), h(Details, { api, state, t })),
          warnings.length || !state.complete ? h('div', { className: 'dsc-feedback' }, h('details', { className: 'dsc-warnings' }, h('summary', null, t('warnings', { count: warnings.length }), !state.complete ? ` · ${t('partial')}` : ''), h('ul', null, ...warnings.map((warning, index) => h('li', { key: index }, warning))))) : null,
          state.notice ? h('div', { className: 'dsc-feedback', role: 'status' }, state.notice) : null,
          h('div', { className: 'dsc-footer' }, h('div', { className: 'dsc-selection' }, h('div', { className: 'dsc-selection-head' }, h('span', null, t('selected', { count: selected.length })), selected.length ? h('button', { type: 'button', className: 'dsc-plain', onClick: () => api.set({ selectedIds: EMPTY }) }, t('clear')) : null), selected.length ? h('div', { className: 'dsc-chips' }, ...selected.map(item => h('button', { type: 'button', className: 'dsc-chip', key: item.id, onClick: () => api.toggle(item.id), title: item.name }, item.name, ' ×'))) : null), h('button', { type: 'button', className: 'dsc-plain dsc-copy', disabled: !selected.length, onClick: () => api.copySelection() }, t('copy')), h('button', { type: 'button', className: 'dsc-add', disabled: !selected.length || state.adding || state.status === 'loading', onClick: () => api.add() }, t(state.adding ? 'adding' : 'add'), ' →')),
          h('div', { className: 'dsc-footnote' }, t('scope'))))
    }
    function CapabilityOverlay({ api, anchors, uiSession, sessions, t }) {
      const active = useStore(uiSession.current), state = useStore(api)
      const sessionId = active?.key
      React.useLayoutEffect(() => { api.setSession(sessionId, sessionId ? sessions.binding(sessionId) : undefined) }, [api, sessions, sessionId, active?.ctx])
      const geometry = useDockGeometry(sessionId, anchors)
      const triggerRef = React.useRef(null), dockRef = React.useRef(null)
      const dockStyle = useFixedPosition(dockRef, geometry?.dock)
      React.useEffect(() => {
        if (!sessionId) return
        const root = document.documentElement, old = root.style.getPropertyValue('--dsh-summary-accessory-height')
        root.style.setProperty('--dsh-summary-accessory-height', `${RESERVE}px`); window.dispatchEvent(new Event('dsh:summary-accessory-change'))
        return () => { if (root.style.getPropertyValue('--dsh-summary-accessory-height') === `${RESERVE}px`) { if (old) root.style.setProperty('--dsh-summary-accessory-height', old); else root.style.removeProperty('--dsh-summary-accessory-height'); window.dispatchEvent(new Event('dsh:summary-accessory-change')) } }
      }, [sessionId])
      React.useEffect(() => { if (!state.notice || state.open) return; const timer = setTimeout(() => api.set({ notice: '' }), 4000); return () => clearTimeout(timer) }, [api, state.notice, state.open])
      if (!sessionId || !geometry) return null
      return h('div', { className: 'dsc-root', 'data-dsh-capability-selector': '' },
        h('div', { ref: dockRef, className: 'dsc-dock', style: dockStyle }, h('button', { ref: triggerRef, type: 'button', className: 'dsc-trigger', 'aria-label': t('title'), 'aria-expanded': state.open, 'aria-controls': state.open ? PANEL_ID : undefined, onClick: () => state.open ? api.close() : api.open() }, h(Icon), t('title'), state.items.length ? h('span', { className: 'dsc-count' }, state.items.length) : null), state.selectedIds.length ? h('span', { className: 'dsc-selected-count' }, t('selected', { count: state.selectedIds.length })) : null, !state.open && state.notice ? h('div', { className: 'dsc-dock-notice', role: 'status' }, state.notice) : null),
        state.open && state.sessionId === sessionId ? h(CapabilityPanel, { key: sessionId, api, state, t, placement: geometry.panel, triggerRef }) : null)
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }))
      const t = ctx.locale.bind(NS), anchors = new Map()
      const transport = globalThis.__DSH_TRANSPORT__, fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args)
      const api = createController({ request: (action, args, signal) => requestJSON(fetchImpl, action, args, signal), current: () => { const id = ctx.uiSession.current.getSnapshot()?.key; return { id, binding: id ? ctx.sessions.binding(id) : undefined } }, append: (binding, text) => typeof ctx.conversation?.input?.requestDraftInitialization === 'function' ? ctx.conversation.input.requestDraftInitialization(binding, { prompt: text, whenDraftExists: 'append' }) : 'unsupported', copy: text => { let clipboard; try { clipboard = ctx.get?.('clipboard') } catch { /* optional service */ } clipboard ??= globalThis.navigator?.clipboard; if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard unavailable'); return clipboard.writeText(text) }, t })
      ctx.effect(() => { const element = document.createElement('style'); element.dataset.plugin = NAME; element.textContent = CSS; document.head.appendChild(element); return () => element.remove() })
      ctx.effect(() => () => api.dispose())
      const label = () => t('title')
      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: `${NAME}.anchor`, order: 110, locale: NS, label, inject: () => ({ anchors }) }, CapabilityAnchor)))
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: `${NAME}.overlay`, order: 50, locale: NS, label, inject: () => ({ api, anchors, uiSession: ctx.uiSession, sessions: ctx.sessions }) }, CapabilityOverlay)))
    }
    return { name: NAME, inject: ['slots', 'locale', 'uiSession', 'sessions', 'conversation'], apply, createController, createStore, dockPlacement, panelPlacement, filterItems, buildSelectionText, requestJSON, CSS, ZH, EN, CapabilityPanel, CapabilityOverlay, CapabilityAnchor, Details }
  },
})
