/** Native DSH client: an independent accessory below the session summary. */
window.__ModuleLoader__.load({
  id: 'dsh-capability-selector',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-capability-selector'
    const NS = 'capability-selector'
    const PANEL_ID = 'dsh-capability-selector-panel'
    const DOCK_HEIGHT = 36
    const RESERVE_GAP = 12
    const ACCESSORIES = 'capability-selector.accessories'
    const EMPTY = Object.freeze([])
    const ZH = {
      title: '外部能力', subtitle: '发现本机能力，选择用于本次任务', search: '搜索名称、用途或来源…', all: '全部', skill: 'Skills', cli: 'CLI', mcp: 'MCP', refresh: '刷新', close: '关闭能力选择器', loading: '正在扫描本机能力…', empty: '没有匹配的能力', retry: '重试', source: '来源', allSources: '全部来源', readyOnly: '仅已安装 / 配置', selected: '已选 {count} 项', clear: '清空', add: '添加到输入框', adding: '正在添加…', detail: '详情', back: '返回能力列表', sources: '安装来源', instruction: '本次任务使用说明', full: '查看完整说明', detailLoading: '正在读取说明…', noDetail: '选择一项能力查看说明、来源和依赖', installed: '已安装', configured: '已配置', missing: '未安装', disabled: '已禁用', limited: '待核对', unknown: '待核对', local: '本机', scope: '扫描已支持的位置；安装和配置状态不代表登录就绪或当前会话可调用。', warnings: '{count} 条扫描提示', noSession: '打开一个会话后即可选择能力', stale: '当前会话已变化，请重新打开面板后添加。', blocked: '输入框正忙，请稍后重试；已选能力仍保留。', unsupported: '此版本未提供原生草稿追加接口，可复制使用说明。', copy: '复制使用说明', copied: '已复制使用说明', duplicate: '已添加这些能力；再次选择后可添加新的说明。', merged: '{count} 处来源', fingerprint: '内容版本', variants: '同名版本', added: '已添加到当前输入框', select: '选择 {name}', partial: '扫描结果不完整，展开提示查看原因', scanned: '最近扫描 {time}', description: '说明', truncated: '说明较长，以下仅展示部分内容。', configuredHint: 'MCP 已配置；实际连接与当前会话工具可用性尚未验证。', emptySelection: '先选择要使用的能力', error: '请求失败，请重试', noCopy: '无法访问剪贴板，请手动复制下方说明。', selectedHint: '选择仅表示本次任务的使用偏好', cardTotal: '{count} 项', cardStats: 'Skills {skills} · CLI {cli} · MCP {mcp}', cardDedup: '已去重，选择用于本次任务', cardDiscovering: '正在发现本机能力…', cardIdle: '点击发现本机能力', cardFailed: '能力发现未完成，点击重试',
    }
    const EN = {
      title: 'External capabilities', subtitle: 'Discover local capabilities for this task', search: 'Search names, purposes or sources…', all: 'All', skill: 'Skills', cli: 'CLI', mcp: 'MCP', refresh: 'Refresh', close: 'Close capability selector', loading: 'Scanning local capabilities…', empty: 'No matching capabilities', retry: 'Retry', source: 'Source', allSources: 'All sources', readyOnly: 'Installed / configured', selected: '{count} selected', clear: 'Clear', add: 'Add to composer', adding: 'Adding…', detail: 'Details', back: 'Back to capabilities', sources: 'Installation sources', instruction: 'Task usage instructions', full: 'Read full instructions', detailLoading: 'Reading instructions…', noDetail: 'Choose an item to see its instructions, sources and dependencies', installed: 'Installed', configured: 'Configured', missing: 'Not installed', disabled: 'Disabled', limited: 'Check required', unknown: 'Check required', local: 'Local', scope: 'Scans supported locations. Installation or configuration does not verify authentication or availability in this session.', warnings: '{count} scan notices', noSession: 'Open a session to select capabilities', stale: 'The active session changed. Reopen the panel before adding.', blocked: 'The composer is busy. Try again; your selection is kept.', unsupported: 'This version has no native append API. Copy the instructions instead.', copy: 'Copy instructions', copied: 'Instructions copied', duplicate: 'These instructions were already added. Change the selection to add more.', merged: '{count} sources', fingerprint: 'Content version', variants: 'Name variants', added: 'Added to the current composer', select: 'Select {name}', partial: 'Incomplete scan; expand notices for details', scanned: 'Last scanned {time}', description: 'Description', truncated: 'This long document is shown in part.', configuredHint: 'MCP is configured; connection and session tool availability have not been verified.', emptySelection: 'Select capabilities first', error: 'Request failed. Please retry.', noCopy: 'Clipboard unavailable. Copy the instructions below manually.', selectedHint: 'Selection expresses a preference for this task', cardTotal: '{count} total', cardStats: 'Skills {skills} · CLI {cli} · MCP {mcp}', cardDedup: 'Deduplicated. Choose capabilities for this task.', cardDiscovering: 'Discovering local capabilities…', cardIdle: 'Discover local capabilities', cardFailed: 'Discovery incomplete. Click to retry.',
    }
    Object.assign(ZH, { cardsGrip: '拖动调整顺序，点按查看选项', cardsHide: '隐藏「{name}」', cardsManage: '管理卡片…', cardsTitle: '卡片管理', cardsHint: '拖动卡片标题左侧的把手调整顺序', cardsHidden: '已隐藏 {count} 张卡片', cardsReset: '恢复默认', cardsDone: '完成', cardsToggle: '显示「{name}」' })
    Object.assign(EN, { cardsGrip: 'Drag to reorder, click for options', cardsHide: 'Hide “{name}”', cardsManage: 'Manage cards…', cardsTitle: 'Manage cards', cardsHint: 'Drag the handle left of a card title to reorder', cardsHidden: '{count} hidden cards', cardsReset: 'Restore defaults', cardsDone: 'Done', cardsToggle: 'Show “{name}”' })
    function errorText(error) { return String(error?.message ?? error ?? '') }

    // ----- Generic card stack: order and visibility for every accessory card -----
    const LAYOUT_KEY = 'dsh-capability-selector.cards.v1'
    const idList = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id && id.length <= 200))].slice(0, 200) : []
    /** Per-browser layout; a broken or missing record falls back to the default order. */
    function createCardLayout(storage = globalThis.localStorage) {
      let state
      try { const raw = JSON.parse(storage?.getItem(LAYOUT_KEY) || '{}'); state = { order: idList(raw.order), hidden: idList(raw.hidden) } } catch { state = { order: [], hidden: [] } }
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        set(patch) {
          state = { order: idList(patch.order ?? state.order), hidden: idList(patch.hidden ?? state.hidden) }
          try { storage?.setItem(LAYOUT_KEY, JSON.stringify(state)) } catch { /* private mode: keep in memory */ }
          for (const fn of [...listeners]) fn()
        },
        reset() { state = { order: [], hidden: [] }; try { storage?.removeItem(LAYOUT_KEY) } catch {} for (const fn of [...listeners]) fn() },
      }
    }
    /** Insert each id missing from `order` after its nearest earlier neighbour in `reference`. */
    function insertMissing(order, reference, keep) {
      const out = [...order]
      reference.forEach((id, i) => {
        if (!keep(id) || out.includes(id)) return
        let at = 0
        for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(reference[j]); if (k >= 0) { at = k + 1; break } }
        out.splice(at, 0, id)
      })
      return out
    }
    /** Stored order first; newly registered cards join at their registration position. */
    function arrangeCards(defaults, order) {
      const present = new Set(defaults)
      return insertMissing(idList(order).filter(id => present.has(id)), defaults, () => true)
    }
    function moveCard(ids, id, index) { const rest = ids.filter(value => value !== id); rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id); return rest }
    /** Write a new visible order back into the full order; hidden and absent cards keep their places. */
    function commitOrder(all, visibleOrder, hidden, previous) {
      const queue = [...visibleOrder]
      const merged = all.map(id => hidden.has(id) ? id : queue.shift())
      const present = new Set(all)
      return insertMissing(merged, idList(previous), id => !present.has(id))
    }
    /** Live registrations of the accessories slot; null when the host cannot enumerate them. */
    function slotCardSource(slots) {
      let key, snapshot = EMPTY
      return {
        subscribe(fn) { try { const stop = slots?.subscribe?.(ACCESSORIES, fn); return typeof stop === 'function' ? stop : () => {} } catch { return () => {} } },
        read() {
          let entries
          try { entries = slots?.entries?.(ACCESSORIES) } catch { return null }
          if (!Array.isArray(entries)) return null
          const seen = new Set(), rows = []
          for (const entry of entries) {
            const id = entry?.options?.id
            if (typeof id !== 'string' || !id || seen.has(id) || id === NAME) continue
            seen.add(id); rows.push({ id, order: entry.options.order ?? 0, label: entry.options.label })
          }
          rows.sort((a, b) => a.order - b.order)
          const next = rows.map(row => row.id).join('\n')
          if (next !== key) { key = next; snapshot = Object.freeze(rows) }
          return snapshot
        },
      }
    }
    function cardLabel(row, t) {
      if (!row) return ''
      try { const value = typeof row.label === 'function' ? row.label() : row.label; if (typeof value === 'string' && value) return value } catch { /* fall back to the id */ }
      return row.id === NAME ? t('title') : row.id
    }
    function GripIcon() {
      return h('svg', { width: 8, height: 14, viewBox: '0 0 8 14', 'aria-hidden': true }, ...[[2, 2], [6, 2], [2, 7], [6, 7], [2, 12], [6, 12]].map(([cx, cy]) => h('circle', { key: `${cx}:${cy}`, cx, cy, r: 1.25, fill: 'currentColor' })))
    }
    const fill = (text, params) => String(text).replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '')
    function CardStack({ rows, layout, t, renderCard, dockRef }) {
      const value = useStore(layout)
      const byId = new Map(rows.map(row => [row.id, row]))
      const all = arrangeCards(rows.map(row => row.id), value.order)
      const hidden = new Set(value.hidden.filter(id => byId.has(id)))
      const visible = all.filter(id => !hidden.has(id))
      const [drag, setDrag] = React.useState(null), [menu, setMenu] = React.useState(null), [manage, setManage] = React.useState(false)
      const items = React.useRef(new Map()), bodies = React.useRef(new Map()), active = React.useRef(null), latest = React.useRef({})
      const shown = drag ? moveCard(visible, drag.id, drag.target) : visible
      latest.current = { visible, shown, drag, all, hidden, order: value.order }
      const label = id => cardLabel(byId.get(id), t)
      const DROP_MS = 180
      const clearLift = d => {
        const body = bodies.current.get(d.id), item = items.current.get(d.id)
        if (body) for (const name of ['position', 'left', 'top', 'width', 'zIndex', 'transition', 'transform', 'margin']) body.style[name] = ''
        if (item) item.style.height = ''
      }
      /** The lifted card leaves the scrolling column and follows the pointer in both axes. */
      function lift(d) {
        const body = bodies.current.get(d.id), item = items.current.get(d.id)
        if (!body || !item) return false
        const rect = body.getBoundingClientRect()
        item.style.height = `${item.getBoundingClientRect().height}px`
        Object.assign(body.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, margin: '0', zIndex: '60', transition: 'none' })
        // A transformed ancestor would offset fixed boxes; measure and compensate once.
        const placed = body.getBoundingClientRect()
        d.ox = rect.left - placed.left; d.oy = rect.top - placed.top
        d.left = rect.left - d.startX; d.top = rect.top - d.startY
        return true
      }
      function place() {
        const d = active.current
        const body = d?.lifted && !d.dropping && bodies.current.get(d.id)
        if (!body) return
        body.style.left = `${Math.round(d.x + d.left + d.ox)}px`
        body.style.top = `${Math.round(d.y + d.top + d.oy)}px`
        body.style.transform = 'scale(1.02)'
      }
      React.useLayoutEffect(() => { if (drag) place() })
      function settle(d) { clearTimeout(d.timer); d.release?.(); clearLift(d); if (active.current === d) active.current = null; setDrag(null) }
      function finish(commit) {
        const d = active.current
        if (!d || d.dropping) return d
        d.release?.()
        if (!d.moved) { active.current = null; return d }
        const { visible: before, drag: current, all: full, hidden: off, order } = latest.current
        const next = commit && current ? moveCard(before, current.id, current.target) : before
        if (commit && next.join('\n') !== before.join('\n')) layout.set({ order: commitOrder(full, next, off, order) })
        const body = bodies.current.get(d.id), item = items.current.get(d.id)
        if (!commit || !body || !item || !d.lifted) { settle(d); return d }
        // Glide into the dashed slot, then return the card to the column.
        d.dropping = true
        const slot = item.getBoundingClientRect()
        body.style.transition = `left ${DROP_MS}ms ease, top ${DROP_MS}ms ease, transform ${DROP_MS}ms ease`
        body.style.left = `${Math.round(slot.left + d.ox)}px`; body.style.top = `${Math.round(slot.top + d.oy)}px`; body.style.transform = 'none'
        d.timer = setTimeout(() => settle(d), DROP_MS + 20)
        return d
      }
      React.useEffect(() => {
        if (!drag) return
        const key = event => { if (event.key === 'Escape' && !active.current?.dropping) { event.preventDefault(); const d = active.current; if (d) settle(d) } }
        window.addEventListener('keydown', key, true)
        return () => window.removeEventListener('keydown', key, true)
      }, [drag !== null])
      React.useEffect(() => {
        if (menu === null) return
        const close = event => { if (!event.target?.closest?.('[data-dsc-card-menu], .dsc-grip')) setMenu(null) }
        const key = event => { if (event.key === 'Escape') setMenu(null) }
        document.addEventListener('pointerdown', close, true); window.addEventListener('keydown', key, true)
        return () => { document.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true) }
      }, [menu])
      React.useEffect(() => () => { const d = active.current; if (d) { clearTimeout(d.timer); d.release?.(); clearLift(d) } active.current = null }, [])
      function onMove(event) {
        const d = active.current
        if (!d || d.pointer !== event.pointerId || d.dropping) return
        d.x = event.clientX; d.y = event.clientY
        if (!d.moved) {
          if (Math.hypot(d.x - d.startX, d.y - d.startY) < 4) return
          d.moved = true; setMenu(null); setManage(false)
          d.lifted = lift(d)
          setDrag({ id: d.id, target: latest.current.visible.indexOf(d.id) })
        }
        event.preventDefault()
        const dock = dockRef?.current
        if (dock) { const r = dock.getBoundingClientRect(); if (d.y < r.top + 28) dock.scrollTop -= 12; else if (d.y > r.bottom - 28) dock.scrollTop += 12 }
        place()
        const center = d.y - d.grab + d.height / 2
        let target = 0
        for (const other of latest.current.shown) {
          if (other === d.id) continue
          const rect = items.current.get(other)?.getBoundingClientRect()
          if (rect && rect.top + rect.height / 2 < center) target++
        }
        if (latest.current.drag?.target !== target) setDrag({ id: d.id, target })
      }
      const grip = id => ({
        onPointerDown(event) {
          if (event.button !== 0 || event.isPrimary === false || active.current) return
          const item = items.current.get(id)
          if (!item) return
          const rect = item.getBoundingClientRect()
          const d = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, grab: event.clientY - rect.top, height: rect.height, moved: false, lifted: false, ox: 0, oy: 0 }
          // Window listeners: reordering moves DOM nodes, which would drop element pointer capture.
          const up = next => { if (next.pointerId !== d.pointer) return; const done = finish(true); if (done && !done.moved) setMenu(current => current === id ? null : id) }
          const cancel = next => { if (next.pointerId === undefined || next.pointerId === d.pointer) finish(false) }
          const blur = () => finish(false)
          window.addEventListener('pointermove', onMove, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true); window.addEventListener('blur', blur)
          d.release = () => { d.release = undefined; window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('blur', blur) }
          active.current = d
          event.preventDefault()
        },
        onKeyDown(event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMenu(current => current === id ? null : id) } },
      })
      return h(React.Fragment, null,
        ...shown.map(id => h('div', { key: id, ref: element => { if (element) items.current.set(id, element); else items.current.delete(id) }, className: 'dsc-card-item', 'data-dsc-card': id, 'data-dragging': drag?.id === id },
          h('div', { className: 'dsc-card-body', ref: element => { if (element) bodies.current.set(id, element); else bodies.current.delete(id) } },
            h('button', { type: 'button', className: 'dsc-grip', 'aria-label': `${label(id)} · ${t('cardsGrip')}`, title: t('cardsGrip'), 'aria-haspopup': 'menu', 'aria-expanded': menu === id, ...grip(id) }, h(GripIcon)),
            menu === id ? h('div', { className: 'dsc-card-menu', role: 'menu', 'data-dsc-card-menu': '' },
              h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); layout.set({ hidden: [...value.hidden, id] }) } }, fill(t('cardsHide'), { name: label(id) })),
              h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); setManage(true) } }, t('cardsManage'))) : null,
            h('div', { className: 'dsc-card-content' }, renderCard(id))))),
        manage ? h('section', { className: 'dsc-manage', 'aria-label': t('cardsTitle') },
          h('div', { className: 'dsc-manage-head' }, t('cardsTitle')),
          h('p', { className: 'dsc-manage-hint' }, t('cardsHint')),
          h('ul', null, ...all.map(id => h('li', { key: id },
            h('span', null, label(id)),
            h('button', { type: 'button', role: 'switch', className: 'dsc-switch', 'aria-checked': !hidden.has(id), 'aria-label': fill(t('cardsToggle'), { name: label(id) }),
              onClick: () => layout.set({ hidden: hidden.has(id) ? value.hidden.filter(other => other !== id) : [...value.hidden, id] }) })))),
          h('div', { className: 'dsc-manage-actions' },
            h('button', { type: 'button', className: 'dsc-plain', onClick: () => layout.reset() }, t('cardsReset')),
            h('button', { type: 'button', className: 'dsc-plain dsc-manage-done', onClick: () => setManage(false) }, t('cardsDone'))))
          : hidden.size ? h('button', { type: 'button', className: 'dsc-cards-hidden', onClick: () => setManage(true) }, fill(t('cardsHidden'), { count: hidden.size }), ' · ', t('cardsManage').replace(/…$/, '')) : null)
    }
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
    function dockPlacement(summary, fallback, viewport, measuredHeight = DOCK_HEIGHT) {
      const { left: vx = 0, top: vy = 0, width: vw, height: vh } = viewport
      const width = Math.max(1, Math.min(summary?.width ?? 320, vw - 24))
      const maxHeight = Math.max(1, Math.min(vh - 24, Math.max(DOCK_HEIGHT, vh - 24 - (summary ? 40 + RESERVE_GAP : 0))))
      const height = clamp(Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : DOCK_HEIGHT, 1, maxHeight)
      return { left: clamp(summary?.left ?? (fallback?.right ?? vx + vw) - width - 12, vx + 12, vx + vw - width - 12), top: clamp(summary ? summary.bottom + 8 : (fallback?.bottom ?? vy + 52) + 8, vy + 12, vy + vh - height - 12), width, height, maxHeight }
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
.dsc-dock{position:fixed;z-index:38;display:flex;flex-direction:column;align-items:stretch;gap:8px;overflow:auto;overscroll-behavior:contain;pointer-events:auto;-webkit-app-region:no-drag;min-width:0}.dsc-controls{display:block;position:sticky;top:0;z-index:1;min-width:0;width:100%;flex:none;border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-alias-bg-layer-1,var(--dsc-bg))}.dsc-accessories{display:flex;flex-direction:column;gap:8px;min-width:0;flex:none}.dsc-accessories:empty{display:none}
.dsc-trigger{display:block;width:100%;height:auto;min-height:0;flex:none;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l3,var(--dsc-border));border-radius:var(--dsw-radius-xl,16px);color:var(--dsc-text);background:var(--dsw-alias-bg-layer-1,var(--dsc-bg));text-align:left;box-shadow:none}.dsc-trigger:hover,.dsc-trigger[aria-expanded=true]{background:var(--dsw-alias-bg-layer-2,var(--dsc-bg));border-color:var(--dsw-alias-border-l2,var(--dsc-border))}.dsc-trigger:focus-visible{outline-offset:-2px}.dsc-card-head{display:flex;align-items:center;gap:8px;min-height:24px;min-width:0}.dsc-card-head>svg{flex:none;color:var(--dsc-muted)}.dsc-card-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.dsc-card-count{flex:none;max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsc-muted);font-variant-numeric:tabular-nums}.dsc-card-stats{display:block;margin-top:5px;font-size:12px;line-height:18px;color:var(--dsc-muted);overflow-wrap:anywhere}.dsc-card-hint{display:block;margin-top:4px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,var(--dsc-muted));overflow-wrap:anywhere}.dsc-selected-count{font:inherit;color:inherit}.dsc-panel{position:fixed;z-index:50;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsc-border);border-radius:14px;box-shadow:0 12px 50px #00000026;background:var(--dsc-bg);pointer-events:auto;-webkit-app-region:no-drag;max-width:calc(100vw - 24px)}
.dsc-head{display:flex;align-items:center;gap:10px;flex:none;padding:17px 18px 10px}.dsc-head-icon{display:flex;align-items:center;justify-content:center;width:35px;height:35px;border-radius:9px;color:var(--dsc-accent);background:var(--dsc-hover)}.dsc-heading{flex:1;min-width:0}.dsc-heading h2{font-size:18px;margin:0;font-weight:600}.dsc-subtitle{font-size:11px;color:var(--dsc-muted);margin-top:1px}.dsc-plain{border:0;background:transparent;color:var(--dsc-muted);border-radius:6px;padding:5px 8px;flex:none}.dsc-plain:hover{background:var(--dsc-hover);color:var(--dsc-text)}.dsc-close{font-size:22px!important;line-height:22px}.dsc-search-wrap{padding:0 18px 12px;flex:none}.dsc-search{width:100%;height:37px;border:1px solid var(--dsc-border);border-radius:8px;background:var(--dsc-bg);color:var(--dsc-text);padding:0 11px;min-width:0}
.dsc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 18px 12px;flex:none;border-bottom:1px solid var(--dsc-border)}.dsc-tabs{display:flex;gap:3px;flex:1;min-width:210px}.dsc-tab{padding:5px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsc-muted);white-space:nowrap}.dsc-tab[aria-pressed=true]{background:var(--dsc-hover);color:var(--dsc-accent);font-weight:600}.dsc-tab-count{font-size:10px;opacity:.75;margin-left:5px}.dsc-source-select{max-width:145px;height:29px;border:1px solid var(--dsc-border);border-radius:6px;color:var(--dsc-muted);background:var(--dsc-bg)}.dsc-ready{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsc-muted);white-space:nowrap}.dsc-ready input,.dsc-row input{accent-color:var(--dsc-accent)}
.dsc-panel-body{display:grid;grid-template-columns:minmax(0,1fr) 290px;flex:1;min-height:0}.dsc-list{overflow:auto;overscroll-behavior:contain;min-height:0;padding:8px 10px;scrollbar-gutter:stable}.dsc-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;min-height:59px;min-width:0}.dsc-row[data-active=true]{background:var(--dsc-hover)}.dsc-row input{flex:none;width:16px;height:16px;margin:0}.dsc-entry{border:0;background:transparent;display:flex;gap:9px;align-items:center;min-width:0;flex:1;padding:3px 0;text-align:left;color:var(--dsc-text)}.dsc-kind-icon{width:29px;height:29px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex:none;font-size:11px;color:#8b70c2;background:#9474c214}.dsc-kind-icon[data-kind=cli]{color:#529780;background:#52978014}.dsc-kind-icon[data-kind=mcp]{color:#658ec2;background:#658ec214}.dsc-entry-text{display:block;min-width:0;flex:1;overflow:hidden}.dsc-entry-name{display:flex;gap:6px;align-items:center;min-width:0;overflow:hidden;font-weight:500}.dsc-entry-name>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsc-merged{font-size:10px;color:var(--dsc-muted);font-weight:400;flex:none}.dsc-entry-description{display:block;max-width:100%;color:var(--dsc-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px}.dsc-row-meta{text-align:right;flex:none;min-width:0;overflow:hidden;font-size:10px;max-width:88px;color:var(--dsc-muted)}.dsc-row-meta .dsc-status{overflow:hidden;text-overflow:ellipsis}.dsc-status{display:block;white-space:nowrap}.dsc-status[data-status=installed]{color:#5b9b7e}.dsc-status[data-status=configured]{color:#688cc3}.dsc-status[data-status=limited]{color:#b08d4e}.dsc-row-source{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;max-width:88px}
.dsc-detail{border-left:1px solid var(--dsc-border);padding:16px;overflow:auto;overscroll-behavior:contain;min-width:0;background:var(--dsc-hover)}.dsc-detail h3{margin:8px 0;font-size:19px;overflow-wrap:anywhere}.dsc-detail h4{font-size:12px;margin:18px 0 7px;font-weight:600}.dsc-detail p{color:var(--dsc-muted);margin:6px 0;overflow-wrap:anywhere}.dsc-source-item{padding:7px 0;border-bottom:1px solid var(--dsc-border)}.dsc-source-item strong{font-size:11px;font-weight:500}.dsc-source-item code{font:10px/1.5 ui-monospace,monospace;display:block;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--dsc-muted);margin-top:3px}.dsc-content{font:11px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;user-select:text}.dsc-task-text{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsc-muted);user-select:text}.dsc-mobile-back{display:none}.dsc-empty{padding:28px 16px;text-align:center;color:var(--dsc-muted);font-size:12px}
.dsc-feedback{padding:8px 16px;border-top:1px solid var(--dsc-border);font-size:11px;flex:none;max-height:90px;overflow:auto;overflow-wrap:anywhere;color:var(--dsc-muted)}.dsc-feedback[role=alert]{color:#b18554}.dsc-warnings{margin:0;font-size:11px;color:var(--dsc-muted)}.dsc-warnings summary{cursor:pointer}.dsc-warnings ul{margin:6px 0;padding-left:20px}.dsc-footer{border-top:1px solid var(--dsc-border);padding:10px 16px;flex:none;display:flex;align-items:center;gap:10px;min-width:0}.dsc-selection{flex:1;min-width:0}.dsc-selection-head{display:flex;gap:10px;align-items:center;white-space:nowrap}.dsc-selection-head button{font-size:11px;padding:1px 4px}.dsc-chips{display:flex;gap:4px;overflow:auto;margin-top:5px;max-height:30px}.dsc-chip{border:0;border-radius:6px;padding:2px 6px;background:var(--dsc-hover);color:var(--dsc-muted);font-size:10px!important;white-space:nowrap;flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis}.dsc-add{border:0;border-radius:8px;background:var(--dsc-accent);color:#fff;padding:9px 14px;font-weight:500;flex:none}.dsc-footnote{font-size:10px;color:var(--dsc-muted);padding:0 16px 9px;flex:none}.dsc-backdrop{position:fixed;inset:0;z-index:49;background:#00000020;pointer-events:auto}.dsc-dock-notice{position:static;flex:none;max-width:100%;padding:7px 10px;border-radius:8px;background:var(--dsc-surface);box-shadow:0 3px 15px #00000014;font-size:11px;color:var(--dsc-muted)}
.dsc-card-item{position:relative;flex:none;min-width:0;border-radius:var(--dsw-radius-xl,16px)}.dsc-card-item:has(>.dsc-card-body>.dsc-card-content:empty){display:none}
.dsc-card-item[data-dragging=true]{background:color-mix(in srgb,#007AFF 5%,transparent);outline:2px dashed color-mix(in srgb,#007AFF 45%,transparent);outline-offset:-2px}
.dsc-card-body{position:relative;border-radius:inherit;transform-origin:50% 30%}.dsc-card-item[data-dragging=true]>.dsc-card-body{box-shadow:0 16px 36px #0000002e;border-radius:var(--dsw-radius-xl,16px);pointer-events:none}
.dsc-card-item .dsc-controls{position:static}.dsc-card-content{min-width:0}
.dsc-grip{position:absolute;z-index:6;left:1px;top:9px;width:10px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsc-muted));display:flex;align-items:center;justify-content:center;opacity:0;cursor:grab!important;touch-action:none;transition:opacity .12s}
.dsc-card-item:hover>.dsc-card-body>.dsc-grip,.dsc-grip:focus-visible,.dsc-grip[aria-expanded=true]{opacity:1}.dsc-grip:hover{color:var(--dsc-text);background:var(--dsc-hover)}.dsc-card-item[data-dragging=true] .dsc-grip{opacity:1;color:#007AFF;cursor:grabbing!important;pointer-events:auto}
.dsc-card-menu{position:absolute;z-index:7;left:16px;top:8px;min-width:150px;padding:4px;border:1px solid var(--dsc-border);border-radius:10px;background:var(--dsc-surface);box-shadow:0 8px 28px #00000024;display:flex;flex-direction:column}.dsc-card-menu button{border:0;background:transparent;color:var(--dsc-text);text-align:left;padding:6px 9px;border-radius:7px;white-space:nowrap}.dsc-card-menu button:hover{background:var(--dsc-hover)}
.dsc-manage{flex:none;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l3,var(--dsc-border));border-radius:var(--dsw-radius-xl,16px);background:var(--dsw-alias-bg-layer-1,var(--dsc-bg))}.dsc-manage-head{font-weight:600}.dsc-manage-hint{margin:2px 0 6px;font-size:11px;color:var(--dsc-muted)}.dsc-manage ul{list-style:none;margin:0;padding:0}.dsc-manage li{display:flex;align-items:center;gap:8px;min-height:34px;border-top:1px solid var(--dsc-border)}.dsc-manage li:first-child{border-top:0}.dsc-manage li>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsc-manage-actions{display:flex;justify-content:space-between;margin-top:6px}.dsc-manage-done{color:#007AFF!important}
.dsc-switch{position:relative;flex:none;width:34px;height:20px;border:0;border-radius:10px;padding:0;background:var(--dsw-alias-bg-layer-3,#d1d1d6)}.dsc-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #00000033;transition:left .15s}.dsc-switch[aria-checked=true]{background:#34C759}.dsc-switch[aria-checked=true]::after{left:16px}
.dsc-cards-hidden{flex:none;align-self:center;border:0;background:transparent;color:var(--dsc-muted);font-size:11px!important;padding:2px 8px;border-radius:6px}.dsc-cards-hidden:hover{color:var(--dsc-text);background:var(--dsc-hover)}
@media(prefers-reduced-motion:reduce){.dsc-card-body,.dsc-grip,.dsc-switch::after{transition:none}}
@media(max-width:759px){.dsc-panel-body{grid-template-columns:minmax(0,1fr)}.dsc-detail{display:none;border-left:0}.dsc-panel[data-detail=true] .dsc-list{display:none}.dsc-panel[data-detail=true] .dsc-detail{display:block}.dsc-mobile-back{display:inline-flex}.dsc-subtitle{display:none}.dsc-head{padding:12px 12px 9px}.dsc-search-wrap{padding:0 12px 9px}.dsc-toolbar{padding:0 12px 9px;gap:5px}.dsc-tabs{min-width:100%;flex:none}.dsc-tab{padding:4px 8px}.dsc-footer{padding:9px 12px;gap:6px}.dsc-add{padding:8px 10px}.dsc-copy{display:none}.dsc-footnote{padding:0 12px 7px}.dsc-row-source{max-width:72px}.dsc-source-select{max-width:155px}.dsc-controls{gap:5px}}
@media(max-height:480px){.dsc-head{padding:6px 12px}.dsc-head-icon,.dsc-subtitle,.dsc-footnote,.dsc-chips,.dsc-ready{display:none}.dsc-heading h2{font-size:15px}.dsc-search-wrap{padding:0 12px 5px}.dsc-search{height:30px}.dsc-toolbar{padding:0 12px 5px;gap:3px}.dsc-tabs{min-width:0}.dsc-source-select{display:none}.dsc-footer{padding:5px 12px}.dsc-add{padding:5px 10px}.dsc-feedback{max-height:45px;padding:4px 12px}}
@media(max-height:360px){.dsc-trigger{padding:6px 10px}.dsc-card-hint{display:none}.dsc-card-stats{margin-top:3px}}
@media(max-height:280px){.dsc-trigger{padding:3px 8px}.dsc-card-stats,.dsc-card-hint{display:none}.dsc-head{padding:0 12px;height:22px;min-height:0}.dsc-head .dsc-plain{padding:0 6px;height:20px;min-height:0;line-height:18px}.dsc-heading h2{font-size:13px;line-height:20px}.dsc-search-wrap{padding-bottom:3px}.dsc-search{height:24px;min-height:0}.dsc-toolbar{padding-bottom:3px}.dsc-tab{padding:2px 6px;height:24px;min-height:0}.dsc-footer{padding:3px 12px}.dsc-footer button{min-height:0}.dsc-copy{display:none}.dsc-feedback{max-height:28px}.dsc-list{padding:2px 6px}.dsc-row{min-height:38px;padding:3px 6px}.dsc-entry-description,.dsc-row-source{display:none}}
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
    // `ctx.sidebarRight.isExpanded()` is the documented truth; the panel's and
    // frame's presentation markers only say when to read it again.
    const SIDEBAR_MARKERS = Object.freeze(['data-sidebar-right-open', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'])
    function rightSidebarExpanded(sidebar, doc) {
      if (typeof sidebar?.isExpanded === 'function') {
        try { return sidebar.isExpanded() === true } catch { /* fall back to the panel marker */ }
      }
      const panels = doc?.querySelectorAll?.('[data-sidebar-right-panel][data-sidebar-right-open]')
      return Boolean(panels) && [...panels].some(panel => !panel.closest?.('[hidden]'))
    }
    function watchRightSidebar(sidebar, listener, doc) {
      const stops = []
      if (typeof MutationObserver === 'function' && doc?.documentElement) {
        const observer = new MutationObserver(() => listener())
        observer.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: [...SIDEBAR_MARKERS] })
        stops.push(() => observer.disconnect())
      }
      if (typeof sidebar?.mounted?.subscribe === 'function') {
        try { const stop = sidebar.mounted.subscribe(() => listener()); if (typeof stop === 'function') stops.push(stop) } catch { /* optional trigger */ }
      }
      return () => { for (const stop of stops.splice(0)) { try { stop() } catch { /* already released */ } } }
    }
    /** Beside an expanded right sidebar the dock shows only with a summary card the user revealed there. */
    function dockHidden(sidebarOpen, summaryShown) { return sidebarOpen === true && !summaryShown }
    function useDockGeometry(sessionId, anchors, dockRef, sidebarOpen = false) {
      const [geometry, setGeometry] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!sessionId) { setGeometry(null); return }
        let frame = 0, summaryElement, headerElement, dockElement, stopped = false, writtenReserve
        const root = document.documentElement, previousReserve = root.style.getPropertyValue('--dsh-summary-accessory-height')
        const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        const summaryObserver = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
        function releaseReserve() {
          if (writtenReserve !== undefined && root.style.getPropertyValue('--dsh-summary-accessory-height') === writtenReserve) {
            if (previousReserve) root.style.setProperty('--dsh-summary-accessory-height', previousReserve); else root.style.removeProperty('--dsh-summary-accessory-height')
            window.dispatchEvent(new Event('dsh:summary-accessory-change'))
          }
          writtenReserve = undefined
        }
        function measure() {
          if (stopped) return
          const found = document.getElementById('dsh-session-summary-card')
          const ownDock = dockRef.current
          const mine = found?.getAttribute('data-dsh-session-summary') === sessionId && found.getClientRects().length
          // A summary seated in this stack is a member, not the anchor above it.
          const docked = Boolean(mine && typeof ownDock?.contains === "function" && ownDock.contains(found))
          const summary = mine && !docked ? found : null
          const header = anchors.get(sessionId)?.closest?.('header')
          const toggleOpen = Boolean(header?.querySelector?.('[data-dsh-session-summary-toggle] [aria-expanded="true"]'))
          if (summary !== summaryElement || header !== headerElement || ownDock !== dockElement) {
            resizeObserver?.disconnect(); summaryObserver?.disconnect(); summaryElement = summary; headerElement = header; dockElement = ownDock
            if (summary) { resizeObserver?.observe(summary); summaryObserver?.observe(summary, { attributes: true, attributeFilter: ['style', 'data-layout'] }) }
            if (header) { resizeObserver?.observe(header); summaryObserver?.observe(header, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] }) }
            if (ownDock) resizeObserver?.observe(ownDock)
          }
          if (dockHidden(sidebarOpen, summary || docked || toggleOpen)) {
            // Hidden docks reserve nothing; the body observer still sees a revealed summary.
            releaseReserve()
            setGeometry(old => old?.hidden ? old : { hidden: true })
            return
          }
          const viewport = viewportOf(window), dock = dockPlacement(summary?.getBoundingClientRect(), header?.getBoundingClientRect(), viewport, ownDock?.getBoundingClientRect().height)
          const reserve = `${Math.ceil(dock.height) + RESERVE_GAP}px`
          writtenReserve = reserve
          if (root.style.getPropertyValue('--dsh-summary-accessory-height') !== reserve) {
            root.style.setProperty('--dsh-summary-accessory-height', reserve)
            window.dispatchEvent(new Event('dsh:summary-accessory-change'))
          }
          const next = { dock, viewport, panel: panelPlacement(dock, viewport) }
          setGeometry(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
        }
        function schedule() { if (!stopped) { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) } }
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
        observer?.observe(document.body, { childList: true, subtree: true })
        window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); window.addEventListener('dsh:summary-accessory-change', schedule)
        window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule)
        measure()
        return () => {
          stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); resizeObserver?.disconnect(); summaryObserver?.disconnect()
          window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); window.removeEventListener('dsh:summary-accessory-change', schedule)
          window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule)
          releaseReserve()
        }
      }, [sessionId, anchors, dockRef, sidebarOpen])
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
    function CapabilityCard({ api, state, t, triggerRef }) {
      const items = state.items ?? EMPTY
      const hasScan = state.scannedAt != null || state.status === 'ready' || items.length > 0
      const counts = { skills: 0, cli: 0, mcp: 0 }
      for (const item of items) { const key = item.kind === 'skill' ? 'skills' : item.kind; if (key in counts) counts[key]++ }
      const hint = hasScan ? t('cardDedup') : t(state.status === 'loading' ? 'cardDiscovering' : state.status === 'error' ? 'cardFailed' : 'cardIdle')
      return h('button', {
        ref: triggerRef, type: 'button', className: 'dsc-trigger', 'data-dsh-capability-card': '',
        'aria-label': t('title'), 'aria-describedby': `${PANEL_ID}-card-summary`, 'aria-expanded': state.open,
        'aria-controls': state.open ? PANEL_ID : undefined, 'aria-busy': state.status === 'loading',
        onClick: () => state.open ? api.close() : api.open(),
      }, h('span', { className: 'dsc-card-head' }, h(Icon, { size: 20 }), h('span', { className: 'dsc-card-title' }, t('title')),
        hasScan ? h('span', { className: 'dsc-card-count' }, t('cardTotal', { count: items.length })) : null,
        h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'm9 5 7 7-7 7' }))),
        h('span', { className: 'dsc-card-stats', id: `${PANEL_ID}-card-summary` }, hasScan ? t('cardStats', counts) : 'Skills · CLI · MCP'),
        h('span', { className: 'dsc-card-hint', role: state.status === 'error' ? 'status' : undefined }, hint,
          state.selectedIds.length ? h('span', { className: 'dsc-selected-count' }, ' · ', t('selected', { count: state.selectedIds.length })) : null))
    }
    const CLOSED_SIDEBAR = Object.freeze({ subscribe: () => () => {}, read: () => false })
    const NO_CARDS = Object.freeze({ subscribe: () => () => {}, read: () => null })
    function CapabilityOverlay({ api, anchors, uiSession, sessions, t, renderSlot = () => null, sidebar = CLOSED_SIDEBAR, cardSource = NO_CARDS, cardLayout }) {
      const active = useStore(uiSession.current), state = useStore(api)
      const slotRows = React.useSyncExternalStore(cardSource.subscribe, cardSource.read, cardSource.read)
      const sessionId = active?.key
      React.useLayoutEffect(() => { api.setSession(sessionId, sessionId ? sessions.binding(sessionId) : undefined) }, [api, sessions, sessionId, active?.ctx])
      React.useEffect(() => {
        const current = api.getSnapshot()
        if (sessionId && current.sessionId === sessionId && current.status === 'idle') void api.scan()
      }, [api, sessionId, state.sessionId, state.status])
      const sidebarOpen = React.useSyncExternalStore(sidebar.subscribe, sidebar.read, sidebar.read)
      const triggerRef = React.useRef(null), dockRef = React.useRef(null)
      const geometry = useDockGeometry(sessionId, anchors, dockRef, sidebarOpen)
      const hidden = geometry?.hidden === true
      const dockStyle = { ...useFixedPosition(dockRef, geometry?.dock), height: 'auto', maxHeight: geometry?.dock?.maxHeight }
      React.useEffect(() => { if (!state.notice || state.open) return; const timer = setTimeout(() => api.set({ notice: '' }), 4000); return () => clearTimeout(timer) }, [api, state.notice, state.open])
      // A panel left open would otherwise pop back when the sidebar closes.
      React.useEffect(() => { if (hidden && state.open) api.close() }, [api, hidden, state.open])
      if (!sessionId || !geometry || hidden) return null
      const card = h('div', { className: 'dsc-controls' }, h(CapabilityCard, { api, state, t, triggerRef }))
      // Hosts that cannot enumerate the slot keep the fixed order.
      const stack = slotRows && cardLayout
        ? h(CardStack, { rows: [{ id: NAME, order: 0, label: () => t('title') }, ...slotRows].sort((a, b) => a.order - b.order), layout: cardLayout, t, dockRef, renderCard: id => id === NAME ? card : renderSlot(ACCESSORIES, { sessionId }, { only: id }) })
        : h(React.Fragment, null, card, h('div', { className: 'dsc-accessories' }, renderSlot(ACCESSORIES, { sessionId })))
      return h('div', { className: 'dsc-root', 'data-dsh-capability-selector': '' },
        h('div', { ref: dockRef, className: 'dsc-dock', style: dockStyle },
          stack,
          !state.open && state.notice ? h('div', { className: 'dsc-dock-notice', role: 'status' }, state.notice) : null),
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
      // Optional service: read lazily so plugin load order never matters.
      const sidebarRight = () => { try { return ctx.get?.('sidebarRight') } catch { return undefined } }
      const sidebar = { read: () => rightSidebarExpanded(sidebarRight(), globalThis.document), subscribe: listener => watchRightSidebar(sidebarRight(), listener, globalThis.document) }
      const cardSource = slotCardSource(ctx.slots), cardLayout = createCardLayout()
      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: `${NAME}.anchor`, order: 110, locale: NS, label, inject: () => ({ anchors }) }, CapabilityAnchor)))
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: `${NAME}.overlay`, order: 50, locale: NS, label, children: { [ACCESSORIES]: { kind: 'list', scope: 'root' } }, inject: () => ({ api, anchors, uiSession: ctx.uiSession, sessions: ctx.sessions, sidebar, cardSource, cardLayout }) }, CapabilityOverlay)))
    }
    return { name: NAME, inject: ['slots', 'locale', 'uiSession', 'sessions', 'conversation'], apply, createController, createStore, createCardLayout, arrangeCards, moveCard, commitOrder, slotCardSource, cardLabel, CardStack, LAYOUT_KEY, dockPlacement, useDockGeometry, rightSidebarExpanded, watchRightSidebar, dockHidden, ACCESSORIES, panelPlacement, filterItems, buildSelectionText, requestJSON, CSS, ZH, EN, CapabilityPanel, CapabilityCard, CapabilityOverlay, CapabilityAnchor, Details }
  },
})
