/** Session Search: a classic ModuleLoader Client; all host data is read-only. */
window.__ModuleLoader__.load({
  id: 'dsh-session-search',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-session-search'
    const NS = 'session-search'
    const EMPTY = Object.freeze([])
    const ZH = {
      title: '会话搜索', current: '当前会话', titles: '会话标题', all: '所有会话正文',
      placeholder: '输入关键词搜索…', query: '搜索关键词', close: '关闭搜索',
      workspace: '工作区', everyWorkspace: '全部工作区', tools: '包含工具内容', archives: '包含归档会话',
      prompt: '输入关键词，查找历史消息或会话标题', loading: '正在搜索…', empty: '没有找到匹配内容',
      partial: '搜索尚未完成，可继续扫描剩余会话', results: '已找到 {count} 条消息', titleResults: '已找到 {count} 个会话', progress: '已扫描 {done} / {total} 个会话',
      continue: '继续搜索', more: '加载更多', retry: '重新搜索', stale: '会话内容已变化，请重新搜索',
      context: '消息上下文', contextLoading: '正在读取上下文…', contextEmpty: '选择一条消息查看上下文',
      titleOnly: '标题命中。可直接打开会话查看完整内容。', target: '命中消息',
      openParent: '打开父会话', parentHint: '请从父会话打开该子会话；这里仍展示子会话的命中上下文。', unavailableHint: '此会话暂时无法打开，可在此查看命中上下文。',
      open: '打开会话', opening: '正在打开…', openFailed: '打开会话失败：{message}',
      openHint: '命中内容在此面板高亮；打开会话保留 DSH 的阅读位置。',
      archiveHint: '此会话已归档；请在侧栏取消归档后打开。上下文仍可在此查看。',
      archived: '已归档', untitled: '未命名会话', ungrouped: '未分组',
      previous: '上一条命中', next: '下一条命中', position: '第 {index} / {count} 条已加载结果',
      keyboard: '↑↓ 选择 · Enter 打开会话 · Esc 关闭', limited: '仅显示第 {start}–{end} 个字符，共 {total} 个字符',
      warning: '{count} 个会话未能完整搜索', warningDetails: '查看搜索提示',
      shortcutFailure: '部分快捷键未能注册；可使用搜索按钮。',
      user: '你', assistant: '助手', tool: '工具', other: '消息',
      currentLabel: '搜索当前会话', globalLabel: '搜索所有会话', refreshContext: '重试读取上下文',
      unknownError: '请求失败，请重试', noSession: '尚未选择会话，已切换为全局搜索',
      sidebar: '搜索', searching: '搜索中', filterNotice: '文字匹配，忽略英文大小写',
    }
    const EN = {
      title: 'Session search', current: 'Current session', titles: 'Session titles', all: 'All message history',
      placeholder: 'Type to search…', query: 'Search text', close: 'Close search',
      workspace: 'Workspace', everyWorkspace: 'All workspaces', tools: 'Include tool content', archives: 'Include archived',
      prompt: 'Enter text to find historical messages or session titles', loading: 'Searching…', empty: 'No matching content',
      partial: 'Search is incomplete. Continue to scan remaining sessions.', results: '{count} matching messages', titleResults: '{count} matching sessions', progress: 'Scanned {done} / {total} sessions',
      continue: 'Continue search', more: 'Load more', retry: 'Search again', stale: 'Session content changed. Search again.',
      context: 'Message context', contextLoading: 'Loading context…', contextEmpty: 'Select a message to view its context',
      titleOnly: 'Title match. Open the session to read its content.', target: 'Matching message',
      openParent: 'Open parent session', parentHint: 'Open this child from its parent. The matching child context is shown here.', unavailableHint: 'This session cannot currently be opened. Its matching context is available here.',
      open: 'Open session', opening: 'Opening…', openFailed: 'Could not open session: {message}',
      openHint: 'Matches are highlighted here. Opening a session keeps DSH’s reading position.',
      archiveHint: 'This session is archived. Unarchive it in the sidebar before opening. You can still read its context here.',
      archived: 'Archived', untitled: 'Untitled session', ungrouped: 'Ungrouped',
      previous: 'Previous match', next: 'Next match', position: 'Loaded result {index} of {count}',
      keyboard: '↑↓ Select · Enter Open session · Esc Close', limited: 'Showing characters {start}–{end} of {total}',
      warning: '{count} sessions could not be fully searched', warningDetails: 'Search notices',
      shortcutFailure: 'Some shortcuts could not be registered. Use the search buttons.',
      user: 'You', assistant: 'Assistant', tool: 'Tool', other: 'Message',
      currentLabel: 'Search current session', globalLabel: 'Search all sessions', refreshContext: 'Retry context',
      unknownError: 'Request failed. Please retry.', noSession: 'No session selected. Searching all sessions.',
      sidebar: 'Search', searching: 'Searching', filterNotice: 'Literal text matching, case insensitive',
    }

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        set(patch) { state = { ...state, ...patch }; for (const listener of listeners) listener() },
      }
    }
    function currentSessionId(snapshot) {
      return Object.values(snapshot?.byId ?? {}).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id
    }
    function navigationTarget(item, snapshot) {
      if (!item || item.archived) return { target: undefined, kind: 'unavailable' }
      if (item.origin !== 'subagent' || snapshot?.byId?.[item.sessionId]) return { target: item.sessionId, kind: 'session' }
      return item.parentSession ? { target: item.parentSession, kind: 'parent' } : { target: undefined, kind: 'unavailable' }
    }
    function resultKey(item) { return `${item.sessionId}:${item.kind}:${item.seq ?? 'title'}` }
    function mergeResults(previous, incoming) {
      const unique = new Map(previous.map(item => [resultKey(item), item]))
      for (const item of incoming) unique.set(resultKey(item), item)
      const groups = new Map()
      for (const item of unique.values()) {
        if (!groups.has(item.sessionId)) groups.set(item.sessionId, [])
        groups.get(item.sessionId).push(item)
      }
      return [...groups.values()].flat()
    }
    // Literal matching preserves the original characters and never interprets HTML.
    function highlightParts(text, query) {
      text = String(text ?? '')
      query = String(query ?? '').trim()
      if (!query) return [{ text, match: false }]
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const expression = new RegExp(escaped, 'giu')
      const parts = []
      let last = 0
      for (const found of text.matchAll(expression)) {
        if (found.index > last) parts.push({ text: text.slice(last, found.index), match: false })
        parts.push({ text: found[0], match: true })
        last = found.index + found[0].length
      }
      if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last), match: false })
      return parts
    }
    function searchPayload(state, cursor) {
      return {
        query: state.query.trim(), mode: state.mode,
        ...(state.mode === 'current' && state.currentSessionId ? { sessionId: state.currentSessionId } : {}),
        ...(state.mode !== 'current' && state.workspaceId ? { workspaceId: state.workspaceId } : {}),
        includeTools: state.includeTools, includeArchived: state.includeArchived,
        ...(cursor ? { cursor } : {}), limit: 40,
      }
    }
    function shortcutGesture(event) {
      return !event.isComposing && !event.repeat && !event.altKey &&
        Boolean(event.metaKey) !== Boolean(event.ctrlKey) &&
        (event.code === 'KeyF' || event.key?.toLowerCase() === 'f')
    }
    function errorOf(error) {
      return { code: String(error?.code ?? 'REQUEST_FAILED'), message: String(error?.message ?? error ?? '') }
    }
    async function requestJSON(fetchImpl, action, payload, signal) {
      const response = await fetchImpl(`/api/session-search/${action}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal,
      })
      let body
      try { body = await response.json() } catch { throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'INVALID_RESPONSE' }) }
      if (!response.ok || body?.ok !== true) {
        throw Object.assign(new Error(body?.error?.message ?? `HTTP ${response.status}`), { code: body?.error?.code ?? 'REQUEST_FAILED' })
      }
      return body
    }

    /** Owns cancellable search/context requests without depending on React or DOM. */
    function createController({ request, navigate, navigation = item => ({ target: item?.sessionId, kind: 'session' }), debounceMs = 250, maxEmptyPages = 4 }) {
      const store = createStore({
        open: false, focusRevision: 0, mode: 'current', query: '', workspaceId: '',
        includeTools: false, includeArchived: false, currentSessionId: undefined,
        items: [], selected: 0, status: 'idle', complete: false, nextCursor: undefined,
        scannedSessions: 0, totalSessions: 0, warnings: [], error: null,
        context: { status: 'idle', items: [], error: null }, opening: false, openError: null,
        shortcutErrors: [], noSession: false,
      })
      let generation = 0
      let navigationGeneration = 0
      let contextGeneration = 0
      let searchAbort
      let contextAbort
      let timer
      let disposed = false
      const clearContext = () => {
        contextGeneration++
        contextAbort?.abort()
        contextAbort = undefined
        store.set({ context: { status: 'idle', items: [], error: null } })
      }
      function abortSearch() {
        clearTimeout(timer)
        timer = undefined
        generation++
        searchAbort?.abort()
        searchAbort = undefined
      }
      function resetSearch(immediate = false, paused = false) {
        navigationGeneration++
        abortSearch()
        clearContext()
        store.set({ items: [], selected: 0, complete: false, nextCursor: undefined,
          scannedSessions: 0, totalSessions: 0, warnings: [], error: null, openError: null, opening: false,
          status: store.getSnapshot().query.trim() ? 'pending' : 'idle' })
        if (!store.getSnapshot().open || !store.getSnapshot().query.trim() || disposed || paused) return
        if (immediate) void search(false)
        else timer = setTimeout(() => { timer = undefined; void search(false) }, debounceMs)
      }
      async function search(append = false) {
        if (disposed || !store.getSnapshot().open || !store.getSnapshot().query.trim()) return
        if (append && (searchAbort || !store.getSnapshot().nextCursor)) return
        if (!append) abortSearch()
        const ticket = generation
        const captured = store.getSnapshot()
        let cursor = append ? captured.nextCursor : undefined
        let collected = append ? captured.items : []
        let warnings = append ? captured.warnings : []
        const selectedKey = append && captured.items[captured.selected] ? resultKey(captured.items[captured.selected]) : undefined
        const abort = searchAbort = new AbortController()
        store.set({ status: 'loading', error: null })
        try {
          for (let page = 0; page < maxEmptyPages; page++) {
            const value = await request('search', searchPayload(captured, cursor), abort.signal)
            if (disposed || abort.signal.aborted || ticket !== generation) return
            const newItems = Array.isArray(value.items) ? value.items : []
            collected = mergeResults(collected, newItems)
            warnings = [...warnings, ...(Array.isArray(value.warnings) ? value.warnings : [])]
            const nextCursor = typeof value.nextCursor === 'string' && value.nextCursor ? value.nextCursor : undefined
            const complete = value.complete === true
            const selected = selectedKey ? Math.max(0, collected.findIndex(item => resultKey(item) === selectedKey)) : 0
            store.set({ items: collected, selected, nextCursor, complete, warnings,
              scannedSessions: value.scannedSessions ?? 0, totalSessions: value.totalSessions ?? 0 })
            if (newItems.length > 0 || complete || !nextCursor || nextCursor === cursor) break
            cursor = nextCursor
          }
          if (ticket !== generation || disposed || abort.signal.aborted) return
          store.set({ status: 'ready' })
          if (!append || store.getSnapshot().context.status === 'idle') void loadContext()
        } catch (error) {
          if (ticket !== generation || disposed || abort.signal.aborted) return
          store.set({ status: 'error', error: errorOf(error) })
        } finally { if (searchAbort === abort) searchAbort = undefined }
      }
      async function loadContext() {
        clearContext()
        const selected = store.getSnapshot().items[store.getSnapshot().selected]
        if (!selected || selected.seq === undefined || !store.getSnapshot().open || disposed) return
        const ticket = contextGeneration
        const abort = contextAbort = new AbortController()
        store.set({ context: { status: 'loading', items: [], error: null } })
        try {
          const value = await request('context', {
            sessionId: selected.sessionId, seq: selected.seq, includeTools: store.getSnapshot().includeTools,
            offset: Math.max(0, (selected.matchOffset ?? 0) - 200), length: 20000,
          }, abort.signal)
          if (disposed || ticket !== contextGeneration || abort.signal.aborted) return
          store.set({ context: { status: 'ready', items: value.items ?? [], targetSeq: value.targetSeq, error: null } })
        } catch (error) {
          if (!disposed && ticket === contextGeneration && !abort.signal.aborted)
            store.set({ context: { status: 'error', items: [], error: errorOf(error) } })
        } finally { if (contextAbort === abort) contextAbort = undefined }
      }
      function select(index) {
        const state = store.getSnapshot()
        if (!state.items.length) return
        const selected = Math.max(0, Math.min(state.items.length - 1, index))
        if (selected === state.selected && state.context.status !== 'idle') return
        navigationGeneration++
        store.set({ selected, openError: null, opening: false })
        void loadContext()
      }
      const controller = {
        ...store,
        open(mode = 'current', sessionId) {
          if (disposed) return
          const noSession = mode === 'current' && !sessionId
          store.set({ open: true, mode: noSession ? 'all' : mode, currentSessionId: sessionId,
            focusRevision: store.getSnapshot().focusRevision + 1, noSession })
          resetSearch(true)
        },
        close() {
          navigationGeneration++
          abortSearch(); clearContext()
          store.set({ open: false, status: 'idle', opening: false })
        },
        setCurrent(sessionId) {
          if (store.getSnapshot().currentSessionId === sessionId) return
          store.set({ currentSessionId: sessionId })
          if (store.getSnapshot().open && store.getSnapshot().mode === 'current') {
            if (!sessionId) store.set({ mode: 'all', noSession: true })
            resetSearch(true)
          }
        },
        change(patch, paused = false) {
          const allowed = {}
          for (const key of ['query', 'mode', 'workspaceId', 'includeTools', 'includeArchived'])
            if (Object.hasOwn(patch, key)) allowed[key] = patch[key]
          if (allowed.mode === 'current' && !store.getSnapshot().currentSessionId) allowed.mode = 'all'
          store.set({ ...allowed, noSession: false })
          resetSearch(false, paused)
        },
        beginComposition() { abortSearch() },
        navigation,
        select, move(delta) { select(store.getSnapshot().selected + delta) },
        retry() { resetSearch(true) }, more() { return search(true) }, retryContext: loadContext,
        async openSelected() {
          const state = store.getSnapshot()
          const item = state.items[state.selected]
          if (!item || item.archived || state.opening) return
          const destination = navigation(item)
          if (!destination.target) return
          const operation = ++navigationGeneration
          store.set({ opening: true, openError: null })
          try {
            await navigate(destination.target)
            if (!disposed && operation === navigationGeneration) controller.close()
          } catch (error) {
            if (!disposed && operation === navigationGeneration) store.set({ opening: false, openError: errorOf(error) })
          }
        },
        dispose() { disposed = true; abortSearch(); clearContext() },
      }
      return controller
    }

    const CSS = `
.dsh-search-button{font:inherit;border:0;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;padding:7px;border-radius:8px;min-height:30px}
.dsh-search-button:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-search-button:focus-visible,.dsh-search-dialog :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-search-mask{pointer-events:auto;position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:calc(var(--dsh-frame-overlay-top,20px) + 3vh) 20px 20px;background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 80%,transparent);box-sizing:border-box}
.dsh-search-dialog{width:min(100%,960px);height:min(760px,85vh);max-height:calc(100dvh - var(--dsh-frame-overlay-top,20px) - 6vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:0 12px 48px color-mix(in srgb,var(--dsw-alias-label-primary) 15%,transparent);overflow:hidden;font-size:14px;line-height:1.5}
.dsh-search-dialog *{box-sizing:border-box}.dsh-search-dialog button,.dsh-search-dialog input,.dsh-search-dialog select{font:inherit}
.dsh-search-header{padding:18px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-search-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.dsh-search-top h2{font-size:16px;margin:0;font-weight:600}
.dsh-search-input-wrap{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-search-input-wrap:focus-within{border-color:var(--dsw-alias-brand-primary)}.dsh-search-input{width:100%;min-width:0;border:0;background:transparent;color:inherit;outline:none!important;padding:0}
.dsh-search-modes{display:flex;gap:5px;flex-wrap:wrap;margin:12px 0 10px}.dsh-search-mode{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 10px;border-radius:7px;cursor:pointer}.dsh-search-mode[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600}.dsh-search-mode:disabled{opacity:.45;cursor:default}
.dsh-search-filters{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-search-filters label{display:flex;align-items:center;gap:6px}.dsh-search-filters select{max-width:240px;padding:4px 6px;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.dsh-search-filters input{accent-color:var(--dsw-alias-brand-primary)}
.dsh-search-status{padding:9px 20px;color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-search-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,42%) minmax(0,58%)}.dsh-search-results{min-height:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l2);padding:6px}.dsh-search-preview{min-height:0;overflow:auto;padding:16px 20px;overflow-wrap:anywhere}
.dsh-search-group{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:12px 10px 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-search-result{width:100%;display:block;text-align:left;border:1px solid transparent;border-radius:9px;background:transparent;color:inherit;padding:10px;cursor:pointer;margin:2px 0}.dsh-search-result:hover{background:var(--dsw-alias-bg-layer-1)}.dsh-search-result[aria-selected=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}
.dsh-search-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:5px}.dsh-search-snippet{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}.dsh-search-dialog mark{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent);color:inherit;border-radius:2px;font-weight:600}
.dsh-search-empty{padding:28px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}.dsh-search-context-title{font-size:13px;font-weight:600;margin:0 0 12px}.dsh-search-message{margin:0 0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px}.dsh-search-message[data-target=true]{border-color:var(--dsw-alias-brand-primary)}.dsh-search-message-text{white-space:pre-wrap;font:inherit;font-size:13px;margin:0;word-break:break-word}.dsh-search-limited{margin:9px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-search-footer{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 20px;display:flex;align-items:center;gap:12px;justify-content:space-between}.dsh-search-footer-left{min-width:0;flex:1}.dsh-search-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin:2px 0}.dsh-search-action{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}.dsh-search-action:disabled{opacity:.45;cursor:default}.dsh-search-paging{padding:12px;text-align:center}.dsh-search-nav{display:flex;align-items:center;gap:4px}.dsh-search-notice{font-size:12px;margin:8px 0;color:var(--dsw-alias-label-secondary)}.dsh-search-errors{padding:8px 20px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;max-height:100px;overflow:auto}.dsh-search-errors summary{cursor:pointer}.dsh-search-failure{padding:12px;color:var(--dsw-alias-label-secondary);font-size:13px}.dsh-search-failure p{margin:0 0 8px}.dsh-search-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:680px){.dsh-search-mask{padding:var(--dsh-frame-overlay-top,12px) 8px 8px}.dsh-search-dialog{height:92dvh;max-height:calc(100dvh - var(--dsh-frame-overlay-top,12px) - 8px);border-radius:12px}.dsh-search-body{grid-template-columns:1fr;grid-template-rows:minmax(120px,45%) minmax(120px,55%)}.dsh-search-results{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-search-header{padding:12px}.dsh-search-footer{padding:10px 12px}.dsh-search-filters{gap:8px}.dsh-search-preview{padding:12px}}
`
    function SearchIcon() {
      return h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        h('circle', { cx: 10.5, cy: 10.5, r: 6.7 }), h('path', { d: 'M15.5 15.5 21 21', strokeLinecap: 'round' }))
    }
    function Highlight({ text, query }) {
      return highlightParts(text, query).map((part, index) => part.match ? h('mark', { key: index }, part.text) : part.text)
    }
    function formatTime(time) {
      if (!Number.isFinite(time)) return ''
      try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) } catch { return '' }
    }
    function roleLabel(role, t) {
      return t(role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role === 'tool' || role?.startsWith('tool') ? 'tool' : 'other')
    }
    function SearchButton({ api, t, sessionId, location, useSessions }) {
      const current = useSessions(currentSessionId)
      const mode = location === 'sidebar' ? 'all' : 'current'
      return h('button', {
        type: 'button', className: 'dsh-search-button', title: t(mode === 'current' ? 'currentLabel' : 'globalLabel'),
        'aria-label': t(mode === 'current' ? 'currentLabel' : 'globalLabel'),
        onClick: () => api.open(mode, sessionId ?? current),
      }, h(SearchIcon), location === 'sidebar' ? h('span', { className: 'dsh-search-sr' }, t('sidebar')) : null)
    }
    function Preview({ state, api, t }) {
      const selected = state.items[state.selected]
      const context = state.context
      if (!selected) return h('p', { className: 'dsh-search-empty' }, t('contextEmpty'))
      if (selected.seq === undefined) return h('div', null,
        h('h3', { className: 'dsh-search-context-title' }, h(Highlight, { text: selected.title || t('untitled'), query: state.query })),
        h('p', { className: 'dsh-search-notice' }, t('titleOnly')))
      return h('div', null,
        h('h3', { className: 'dsh-search-context-title' }, t('context')),
        context.status === 'loading' ? h('p', { role: 'status', className: 'dsh-search-empty' }, t('contextLoading')) : null,
        context.status === 'error' ? h('div', { className: 'dsh-search-failure', role: 'alert' },
          h('p', null, context.error?.message || t('unknownError')),
          h('button', { type: 'button', className: 'dsh-search-action', onClick: api.retryContext }, t('refreshContext'))) : null,
        context.items.map(item => h('article', { key: item.seq, className: 'dsh-search-message', 'data-target': item.seq === selected.seq },
          h('div', { className: 'dsh-search-meta' }, h('span', null, roleLabel(item.role, t)), h('time', null, formatTime(item.time)),
            item.seq === selected.seq ? h('strong', null, t('target')) : null),
          h('div', { className: 'dsh-search-message-text' }, h(Highlight, { text: item.text, query: state.query })),
          item.truncated ? h('p', { className: 'dsh-search-limited' }, t('limited', { start: (item.offset ?? 0) + 1, end: (item.offset ?? 0) + String(item.text ?? '').length, total: item.totalChars ?? '?' })) : null)))
    }
    function SearchDialog({ api, state, workspaces, t }) {
      const root = React.useRef(null)
      const input = React.useRef(null)
      const list = React.useRef(null)
      const composition = React.useRef(false)
      const preview = React.useRef(null)
      const selected = state.items[state.selected]
      const destination = api.navigation(selected)
      React.useEffect(() => {
        const previous = document.activeElement
        input.current?.focus()
        return () => { if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true }) }
      }, [])
      React.useEffect(() => { input.current?.focus(); input.current?.select() }, [state.focusRevision])
      React.useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
      }, [state.selected, state.items])
      React.useEffect(() => {
        if (state.context.status === 'ready') {
          preview.current?.querySelector('[data-target="true"]')?.scrollIntoView({ block: 'start' })
        } else if (preview.current) preview.current.scrollTop = 0
      }, [state.context])
      const onKeyDown = event => {
        if (event.nativeEvent?.isComposing || event.isComposing || composition.current) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); api.close(); return }
        if (event.key === 'Tab') {
          const focusable = [...root.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
            .filter(node => node.getClientRects().length > 0)
          if (!focusable.length) { event.preventDefault(); root.current.focus(); return }
          const first = focusable[0], last = focusable.at(-1)
          if (event.shiftKey && (document.activeElement === first || !root.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
          return
        }
        const target = event.target
        if (target.tagName === 'SELECT' || target.type === 'checkbox') return
        const onInput = target === input.current
        const onResult = Boolean(target.closest?.('[data-search-result]'))
        if (!(onInput || onResult)) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation(); api.move(event.key === 'ArrowDown' ? 1 : -1)
        } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void api.openSelected() }
      }
      const resultNodes = []
      let group
      for (const [index, item] of state.items.entries()) {
        if (group !== item.sessionId) {
          group = item.sessionId
          resultNodes.push(h('div', { key: `group-${group}`, className: 'dsh-search-group', title: item.title }, item.title || t('untitled')))
        }
        resultNodes.push(h('button', {
          key: resultKey(item), id: `dsh-search-result-${index}`, type: 'button', role: 'option',
          className: 'dsh-search-result', 'aria-selected': index === state.selected, tabIndex: index === state.selected ? 0 : -1,
          'data-search-result': true, onClick: () => api.select(index), onDoubleClick: () => { api.select(index); void api.openSelected() },
        }, h('div', { className: 'dsh-search-meta' }, h('span', null, item.workspaceTitle || t('ungrouped')),
          h('time', null, formatTime(item.time)), item.archived ? h('span', null, t('archived')) : null,
          item.kind === 'message' ? h('span', null, roleLabel(item.role, t)) : null),
        h('div', { className: 'dsh-search-snippet' }, h(Highlight, { text: item.snippet || item.title, query: state.query }))))
      }
      const waiting = state.status === 'loading' || state.status === 'pending'
      const statusText = state.items.length ? t(state.mode === 'titles' ? 'titleResults' : 'results', { count: state.items.length }) : waiting ? t('loading') :
        !state.query.trim() ? t('prompt') : state.status === 'ready' ? t(state.complete ? 'empty' : 'partial') : ''
      return h('div', { className: 'dsh-search-mask', onMouseDown: event => { if (event.target === event.currentTarget) api.close() } },
        h('section', { ref: root, className: 'dsh-search-dialog', role: 'dialog', 'aria-modal': true,
          'aria-labelledby': 'dsh-search-title', 'data-shortcut-modal': 'dsh-session-search', tabIndex: -1, onKeyDown },
          h('header', { className: 'dsh-search-header' },
            h('div', { className: 'dsh-search-top' }, h('h2', { id: 'dsh-search-title' }, t('title')),
              h('button', { type: 'button', className: 'dsh-search-button', onClick: api.close, 'aria-label': t('close'), title: t('close') }, '×')),
            h('div', { className: 'dsh-search-input-wrap' }, h(SearchIcon), h('input', {
              ref: input, className: 'dsh-search-input', type: 'search', value: state.query, placeholder: t('placeholder'),
              'aria-label': t('query'), autoComplete: 'off', spellCheck: false,
              onChange: event => api.change({ query: event.target.value }, composition.current),
              onCompositionStart: () => { composition.current = true; api.beginComposition() },
              onCompositionEnd: event => { composition.current = false; api.change({ query: event.target.value }) },
            })),
            h('div', { className: 'dsh-search-modes', role: 'group', 'aria-label': t('title') },
              ['current', 'titles', 'all'].map(mode => h('button', { key: mode, type: 'button', className: 'dsh-search-mode',
                'aria-pressed': state.mode === mode, disabled: mode === 'current' && !state.currentSessionId,
                onClick: () => api.change({ mode }) }, t(mode)))),
            h('div', { className: 'dsh-search-filters' },
              state.mode !== 'current' ? h('label', null, t('workspace'), h('select', { value: state.workspaceId,
                onChange: event => api.change({ workspaceId: event.target.value }) },
                h('option', { value: '' }, t('everyWorkspace')),
                workspaces.map(workspace => h('option', { key: workspace.id, value: workspace.id }, workspace.title || workspace.path || workspace.id)))) : null,
              state.mode !== 'titles' ? h('label', null, h('input', { type: 'checkbox', checked: state.includeTools,
                onChange: event => api.change({ includeTools: event.target.checked }) }), t('tools')) : null,
              state.mode !== 'current' ? h('label', null, h('input', { type: 'checkbox', checked: state.includeArchived,
                onChange: event => api.change({ includeArchived: event.target.checked }) }), t('archives')) : null),
            state.noSession ? h('p', { className: 'dsh-search-notice' }, t('noSession')) : null),
          h('div', { className: 'dsh-search-status' }, h('span', { role: 'status', 'aria-live': 'polite' }, statusText),
            state.totalSessions > 0 ? h('span', null, t('progress', { done: state.scannedSessions, total: state.totalSessions })) : null,
            state.mode === 'current' && state.items.length > 0 ? h('div', { className: 'dsh-search-nav' },
              h('span', null, t('position', { index: state.selected + 1, count: state.items.length })),
              h('button', { type: 'button', className: 'dsh-search-button', disabled: state.selected === 0,
                title: t('previous'), 'aria-label': t('previous'), onClick: () => api.move(-1) }, '↑'),
              h('button', { type: 'button', className: 'dsh-search-button', disabled: state.selected >= state.items.length - 1,
                title: t('next'), 'aria-label': t('next'), onClick: () => api.move(1) }, '↓')) : null),
          state.shortcutErrors.length ? h('div', { className: 'dsh-search-errors' }, t('shortcutFailure')) : null,
          state.warnings.length ? h('details', { className: 'dsh-search-errors' },
            h('summary', null, t('warning', { count: new Set(state.warnings.map(w => w.sessionId)).size })),
            state.warnings.map((warning, index) => h('p', { key: index }, warning.message || warning.code))) : null,
          h('div', { className: 'dsh-search-body' },
            h('div', { ref: list, className: 'dsh-search-results', role: 'listbox', 'aria-label': t('title'), 'aria-busy': waiting },
              resultNodes,
              !state.items.length && state.status !== 'error' ? h('div', { className: 'dsh-search-empty' }, statusText) : null,
              state.status === 'error' ? h('div', { className: 'dsh-search-failure', role: 'alert' },
                h('p', null, state.error?.code === 'STALE_CURSOR' ? t('stale') : state.error?.message || t('unknownError')),
                h('button', { type: 'button', className: 'dsh-search-action', onClick: api.retry }, t('retry'))) : null,
              state.nextCursor && state.status !== 'error' ? h('div', { className: 'dsh-search-paging' },
                h('button', { type: 'button', className: 'dsh-search-action', disabled: waiting, onClick: api.more },
                  t(waiting ? 'loading' : state.items.length ? 'more' : 'continue'))) : null,
              state.status === 'ready' && !state.complete && !state.nextCursor ? h('div', { className: 'dsh-search-failure' },
                h('p', null, t('partial')), h('button', { type: 'button', className: 'dsh-search-action', onClick: api.retry }, t('retry'))) : null),
            h('div', { ref: preview, className: 'dsh-search-preview' }, h(Preview, { state, api, t }))),
          h('footer', { className: 'dsh-search-footer' },
            h('div', { className: 'dsh-search-footer-left' },
              h('p', { className: 'dsh-search-hint' }, selected?.archived ? t('archiveHint') : destination.kind === 'parent' ? t('parentHint') : selected && !destination.target ? t('unavailableHint') : t('openHint')),
              h('p', { className: 'dsh-search-hint' }, t('keyboard')),
              state.openError ? h('p', { className: 'dsh-search-notice', role: 'alert' }, t('openFailed', { message: state.openError.message })) : null),
            h('button', { type: 'button', className: 'dsh-search-action', disabled: !selected || selected.archived || !destination.target || state.opening,
              onClick: api.openSelected }, t(state.opening ? 'opening' : destination.kind === 'parent' ? 'openParent' : 'open')))))
    }
    function SearchOverlay({ api, t, useSessions, useWorkspaces }) {
      const state = React.useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot)
      const current = useSessions(currentSessionId)
      const workspaces = useWorkspaces(value => value?.items ?? EMPTY)
      React.useEffect(() => { api.setCurrent(current) }, [api, current])
      return h(React.Fragment, null, h('style', null, CSS),
        state.open ? h(SearchDialog, { api, state, workspaces, t }) : null)
    }

    function installShortcuts(ctx, api, t) {
      const service = ctx.get('shortcuts')
      const disposers = []
      const selected = () => currentSessionId(ctx.sessions.list.getSnapshot())
      if (service) {
        for (const [suffix, mode, shift] of [['current', 'current', false], ['global', 'all', true]]) {
          try {
            const binding = { code: 'KeyF', modifiers: shift ? ['primary', 'shift'] : ['primary'] }
            disposers.push(service.register({
              id: `sessionSearch.${suffix}`, label: () => t(mode === 'current' ? 'currentLabel' : 'globalLabel'), aliases: ['search', 'find'],
              defaults: { 'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding },
              regions: ['page', 'editable'], modals: ['dsh-session-search'],
              resolve: context => {
                if (context.modal !== null && context.modal !== 'dsh-session-search') return { status: 'pass' }
                return { status: 'handled', run: () => api.open(mode, selected()) }
              },
            }))
          } catch (error) { api.set({ shortcutErrors: [...api.getSnapshot().shortcutErrors, errorOf(error)] }) }
        }
      }
      // DSH's configurable registry disallows plain primary+F on Web.
      if (!service || service.runtime === 'web') {
        const keydown = event => {
          if (event.defaultPrevented || !shortcutGesture(event)) return
          const modal = document.querySelector('[role="dialog"][aria-modal="true"]')
          if (modal && modal.dataset.shortcutModal !== 'dsh-session-search') return
          event.preventDefault(); event.stopPropagation()
          api.open(event.shiftKey ? 'all' : 'current', selected())
        }
        window.addEventListener('keydown', keydown, true)
        disposers.push(() => window.removeEventListener('keydown', keydown, true))
      }
      return () => { for (const dispose of disposers.reverse()) dispose() }
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), `${NAME}: locale`)
      const t = ctx.locale.bind(NS)
      const transport = globalThis.__DSH_TRANSPORT__
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args)
      const api = createController({
        request: (action, payload, signal) => requestJSON(fetchImpl, action, payload, signal),
        navigate: sessionId => ctx.uiWorkspace.openSession(sessionId),
        navigation: item => navigationTarget(item, ctx.sessions.list.getSnapshot()),
      })
      ctx.effect(() => () => api.dispose(), `${NAME}: requests`)
      ctx.effect(() => installShortcuts(ctx, api, t), `${NAME}: shortcuts`)
      for (const [slot, location] of [['conversation.session.header.actions', 'header'], ['sidebar.footer.action', 'sidebar']]) {
        ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register({
          name: slot, id: `${NAME}.${location}`, order: 30, locale: NS, label: () => t('title'),
          inject: () => ({ api, location }),
        }, SearchButton)), `${NAME}: ${location}`)
      }
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: `${NAME}.dialog`, order: 60, locale: NS, label: () => t('title'), inject: () => ({ api }),
      }, SearchOverlay)), `${NAME}: overlay`)
    }
    return { name: NAME, inject: ['slots', 'locale', 'sessions', 'uiWorkspace'], apply,
      createController, createStore, currentSessionId, navigationTarget, mergeResults, highlightParts, searchPayload,
      shortcutGesture, requestJSON, installShortcuts, resultKey, ZH, EN, CSS }
  },
})
