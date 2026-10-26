/** Session Navigator: a classic Client module; only React is a runtime import. */
window.__ModuleLoader__.load({
  id: 'dsh-session-navigator',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-session-navigator'
    const NS = 'session-navigator'
    const ZH = {
      title: '会话导航', subtitle: '凭最近聊过的内容，找回想继续的会话。',
      search: '搜索会话', placeholder: '搜索标题、话题或最近提问…', clear: '清除搜索',
      workspace: '工作区', allWorkspaces: '全部工作区', sort: '排序', visited: '最近访问', updated: '最近更新',
      archives: '包含归档', archived: '已归档', archiveHint: '此会话已归档，请在原生侧栏取消归档后打开。',
      count: '{count} 个会话', loadedCount: '已显示 {loaded} / {total}', more: '加载更多',
      loading: '正在读取会话…', loadingDetail: '正在读取详情…', empty: '还没有可导航的会话',
      emptyHint: '开始一段对话后，会话和最近提问会出现在这里。', noMatches: '没有找到匹配会话',
      noMatchesHint: '试试其他关键词，或选择全部工作区。', resetFilters: '清除筛选',
      untitled: '未命名会话', ungrouped: '未分组', noQuestion: '还没有用户提问', noSummary: '还没有生成摘要',
      noSummaryHint: '最近提问会即时显示，你也可以手动更新摘要。', noHistory: '暂无其他话题',
      selectHint: '选择会话，查看最近讨论与历史话题', recent: '最近', questionLabel: '最近提问',
      summary: '最近讨论', oldSummary: '之前的摘要', oldTopic: '之前的话题', recentTopic: '最近话题', pastTopics: '此前聊过',
      oldHint: '已有新内容，下面的摘要尚未覆盖最新讨论。',
      open: '打开会话', opening: '正在打开…', refresh: '更新摘要', refreshBusy: '正在更新…',
      pause: '暂停自动摘要', resume: '恢复自动摘要', paused: '自动摘要已暂停',
      pauseHint: '暂停后仍可手动更新摘要。', automaticOff: '自动摘要未开启，可手动更新。',
      statusReady: '摘要已更新', statusStale: '有新内容', statusQueued: '等待后台更新', statusGenerating: '后台更新中',
      statusEmpty: '尚无摘要', statusError: '摘要暂时无法更新', retainedSummary: '暂时无法更新，已保留原摘要；最近提问仍会即时显示。', backgroundHint: '正在后台更新，可以继续浏览或打开会话。',
      activityAt: '会话更新', summaryAt: '摘要更新', visitedAt: '最近访问', never: '尚无记录',
      retry: '重试', loadFailure: '暂时无法读取会话', detailFailure: '暂时无法读取详情', unknownError: '请求失败，请稍后重试。',
      actionFailure: '操作未完成', openFailure: '无法打开会话', queuedNotice: '已安排更新，完成后会自动显示。',
      unchangedNotice: '摘要已覆盖当前内容。', pausedNotice: '已暂停自动摘要。', resumedNotice: '已恢复自动摘要。',
      livePaused: '实时更新暂时中断，已显示的内容仍可查看。', reconnect: '重新连接',
      streamUnavailable: '当前连接暂不支持实时更新。',
      model: '摘要模型：{model}', keyboard: '↑↓ 选择 · Enter 打开 · 单击查看详情',
      back: '返回对话', preview: '会话详情', details: '查看详情', closePreview: '关闭预览',
      errorDetails: '查看错误详情',
    }
    const EN = {
      title: 'Session navigator', subtitle: 'Find your way back by what you discussed most recently.',
      search: 'Search sessions', placeholder: 'Search titles, topics, or recent questions…', clear: 'Clear search',
      workspace: 'Workspace', allWorkspaces: 'All workspaces', sort: 'Sort', visited: 'Recently visited', updated: 'Recently updated',
      archives: 'Include archived', archived: 'Archived', archiveHint: 'Unarchive this session in the native sidebar before opening it.',
      count: '{count} sessions', loadedCount: 'Showing {loaded} of {total}', more: 'Load more',
      loading: 'Loading sessions…', loadingDetail: 'Loading details…', empty: 'No sessions yet',
      emptyHint: 'Start a conversation to see it and its latest question here.', noMatches: 'No matching sessions',
      noMatchesHint: 'Try another search or select all workspaces.', resetFilters: 'Clear filters',
      untitled: 'Untitled session', ungrouped: 'Ungrouped', noQuestion: 'No user question yet', noSummary: 'No summary yet',
      noSummaryHint: 'The latest question appears immediately. You can also update the summary manually.', noHistory: 'No earlier topics',
      selectHint: 'Select a session to view its recent discussion and earlier topics', recent: 'Recent', questionLabel: 'Latest question',
      summary: 'Recent discussion', oldSummary: 'Earlier summary', oldTopic: 'Earlier topic', recentTopic: 'Latest topic', pastTopics: 'Earlier topics',
      oldHint: 'New content is not yet covered by the summary below.',
      open: 'Open session', opening: 'Opening…', refresh: 'Update summary', refreshBusy: 'Updating…',
      pause: 'Pause automatic summaries', resume: 'Resume automatic summaries', paused: 'Automatic summaries paused',
      pauseHint: 'You can still update summaries manually while paused.', automaticOff: 'Automatic summaries are off. You can update manually.',
      statusReady: 'Summary up to date', statusStale: 'New content', statusQueued: 'Background update queued', statusGenerating: 'Updating in background',
      statusEmpty: 'No summary yet', statusError: 'Summary temporarily unavailable', retainedSummary: 'The earlier summary is preserved. Your latest question still appears immediately.', backgroundHint: 'Updating in the background. You can keep browsing or open this session.',
      activityAt: 'Session updated', summaryAt: 'Summary updated', visitedAt: 'Last visited', never: 'Not recorded',
      retry: 'Retry', loadFailure: 'Could not load sessions', detailFailure: 'Could not load details', unknownError: 'The request failed. Please retry.',
      actionFailure: 'Action failed', openFailure: 'Could not open session', queuedNotice: 'Update queued. The summary will appear automatically.',
      unchangedNotice: 'The summary already covers the current content.', pausedNotice: 'Automatic summaries paused.', resumedNotice: 'Automatic summaries resumed.',
      livePaused: 'Live updates are temporarily disconnected. Saved content is still available.', reconnect: 'Reconnect',
      streamUnavailable: 'Live updates are not supported by this connection.',
      model: 'Summary model: {model}', keyboard: '↑↓ Select · Enter Open · Click for details',
      back: 'Back to conversation', preview: 'Session details', details: 'View details', closePreview: 'Close preview',
      errorDetails: 'View error details',
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
    function summaryBehind(item) {
      if (!item) return false
      const source = Number(item.sourceSeq) || 0
      const summary = Number(item.summarySeq) || 0
      return (Number(item.latestQuestionSeq) || 0) > summary || source > summary || item.status === 'stale'
    }
    function secondLine(item) {
      const waiting = ['queued', 'generating', 'error', 'empty'].includes(item?.status)
      if (item?.recentTopic && !summaryBehind(item) && !waiting) return { kind: 'recent', text: item.recentTopic }
      if (item?.latestQuestion) return { kind: 'questionLabel', text: item.latestQuestion }
      if (item?.recentTopic) return { kind: 'oldTopic', text: item.recentTopic }
      return { kind: 'questionLabel', text: '' }
    }
    function currentMainSession(snapshot) {
      return Object.values(snapshot?.byId || {}).find(row => (row.retainedBy?.mainView || 0) > 0)?.id
    }
    function mergeItems(previous, incoming) {
      const byId = new Map(previous.map(item => [item.sessionId, item]))
      for (const item of incoming) byId.set(item.sessionId, item)
      return [...byId.values()]
    }
    function errorMessage(error) { return String(error?.message || error || '') }
    async function requestJSON(fetchImpl, action, payload, signal) {
      const response = await fetchImpl(`/api/session-navigator/${action}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal,
      })
      let value
      try { value = await response.json() } catch { throw new Error(`HTTP ${response.status}`) }
      if (!response.ok || value?.ok !== true) throw Object.assign(new Error(value?.error?.message || value?.message || (typeof value?.error === 'string' ? value.error : '') || `HTTP ${response.status}`), { code: value?.error?.code || value?.code || 'REQUEST_FAILED' })
      return value
    }
    /** Stream parsing accepts arbitrarily split UTF-8 and a final unterminated line. */
    async function readChanges(body, signal, onFrame) {
      if (!body || typeof body.getReader !== 'function') throw Object.assign(new Error('STREAM_UNAVAILABLE'), { code: 'STREAM_UNAVAILABLE' })
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      const cancel = () => { void reader.cancel().catch(() => {}) }
      signal.addEventListener('abort', cancel, { once: true })
      function frame(line) {
        if (!line.trim()) return
        const value = JSON.parse(line)
        if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid change frame')
        if (!signal.aborted) onFrame(value)
      }
      try {
        while (!signal.aborted) {
          const value = await reader.read()
          if (value.done) break
          pending += decoder.decode(value.value, { stream: true })
          let index
          while ((index = pending.indexOf('\n')) >= 0) {
            frame(pending.slice(0, index)); pending = pending.slice(index + 1)
          }
          if (pending.length > 131072) throw new Error('Change frame too large')
        }
        if (!signal.aborted) { pending += decoder.decode(); if (pending.trim()) frame(pending) }
      } finally {
        signal.removeEventListener('abort', cancel)
        try { await reader.cancel() } catch {}
        reader.releaseLock()
      }
    }
    /** Tracks actual main-session transitions rather than projections or background activity. */
    function trackVisits(source, touch, { now = Date.now, cooldownMs = 1000 } = {}) {
      let previous
      let disposed = false
      const recent = new Map()
      const update = () => {
        const id = currentMainSession(source.getSnapshot())
        if (id === previous || disposed) return
        previous = id
        if (!id) return
        const time = now()
        if (recent.has(id) && time - recent.get(id) < cooldownMs) return
        recent.set(id, time)
        if (recent.size > 256) recent.delete(recent.keys().next().value)
        Promise.resolve().then(() => { if (!disposed) return touch(id) }).catch(() => {})
      }
      const unsubscribe = source.subscribe(update)
      update()
      return () => { disposed = true; unsubscribe(); recent.clear() }
    }

    function createController({ request, fetchImpl, navigate, debounceMs = 180, pageSize = 50 }) {
      const store = createStore({
        query: '', workspaceId: '', includeArchived: false, sort: 'visited',
        items: [], total: 0, nextOffset: undefined, workspaces: [], settings: null,
        byId: {}, detailStates: {}, actions: {}, selectedId: null,
        loading: false, moreLoading: false, error: '', watchState: 'connecting', watchError: '',
      })
      let disposed = false
      let activePages = 0
      let listGeneration = 0
      let listAbort
      let filterTimer
      let invalidationTimer
      let watchAbort
      let reconnectTimer
      let reconnectAttempt = 0
      const requests = new Set()
      const detailRequests = new Map()
      const itemVersions = new Map()
      const itemHolders = new Map()
      const invalidItems = new Set()
      let allInvalid = false
      const newAbort = () => { const abort = new AbortController(); requests.add(abort); return abort }
      const releaseAbort = abort => requests.delete(abort)
      function setAction(id, value) { const state = store.getSnapshot(); store.set({ actions: { ...state.actions, [id]: { ...state.actions[id], ...value } } }) }
      function putItem(item) {
        if (!item?.sessionId || disposed) return
        const state = store.getSnapshot()
        itemVersions.set(item.sessionId, (itemVersions.get(item.sessionId) || 0) + 1)
        store.set({ byId: { ...state.byId, [item.sessionId]: item }, items: state.items.map(row => row.sessionId === item.sessionId ? item : row) })
      }
      async function loadList(append = false, quiet = false) {
        if (disposed || !activePages) return
        clearTimeout(filterTimer)
        const captured = store.getSnapshot()
        if (append && (captured.moreLoading || captured.loading || captured.nextOffset === undefined)) return
        listAbort?.abort()
        const generation = ++listGeneration
        const abort = listAbort = newAbort()
        const versions = new Map(itemVersions)
        const targetCount = append ? pageSize : Math.max(pageSize, captured.items.length)
        store.set({ loading: !append && !quiet, moreLoading: append, error: '' })
        try {
          let collected = append ? captured.items : []
          let offset = append ? captured.nextOffset : 0
          let result
          // Keep a previously expanded result window after a live invalidation.
          do {
            result = await request('list', {
              query: captured.query.trim() || undefined, workspaceId: captured.workspaceId || undefined,
              includeArchived: captured.includeArchived, sort: captured.sort, offset, limit: pageSize,
            }, abort.signal)
            if (disposed || abort.signal.aborted || generation !== listGeneration) return
            collected = mergeItems(collected, Array.isArray(result.items) ? result.items : [])
            const next = Number.isSafeInteger(result.nextOffset) && result.nextOffset > offset ? result.nextOffset : undefined
            offset = next
          } while (!append && offset !== undefined && collected.length < targetCount)
          const state = store.getSnapshot()
          collected = collected.map(item => (itemVersions.get(item.sessionId) || 0) > (versions.get(item.sessionId) || 0) && state.byId[item.sessionId] ? state.byId[item.sessionId] : item)
          const byId = { ...state.byId }
          for (const item of collected) { byId[item.sessionId] = item; invalidItems.delete(item.sessionId) }
          const selectedId = collected.some(item => item.sessionId === state.selectedId) ? state.selectedId : collected[0]?.sessionId || null
          store.set({ items: collected, byId, total: Number(result.total) || 0, nextOffset: offset,
            workspaces: Array.isArray(result.workspaces) ? result.workspaces : state.workspaces,
            settings: result.settings || state.settings, selectedId, error: '' })
        } catch (error) {
          if (!disposed && !abort.signal.aborted && generation === listGeneration) store.set({ error: errorMessage(error) })
        } finally {
          releaseAbort(abort)
          if (listAbort === abort) listAbort = null
          if (!disposed && generation === listGeneration) store.set({ loading: false, moreLoading: false })
        }
      }
      async function loadItem(id, force = false) {
        if (disposed || !id) return
        if (!force && store.getSnapshot().byId[id] && !invalidItems.has(id) && !allInvalid) return
        const existing = detailRequests.get(id)
        if (existing && !force && !existing.abort.signal.aborted) return existing.promise
        if (existing) existing.abort.abort()
        const abort = newAbort()
        const version = itemVersions.get(id) || 0
        const task = { abort, promise: null }
        detailRequests.set(id, task)
        store.set({ detailStates: { ...store.getSnapshot().detailStates, [id]: { loading: true, error: '' } } })
        task.promise = (async () => {
          try {
            const result = await request('get', { sessionId: id }, abort.signal)
            if (disposed || abort.signal.aborted || detailRequests.get(id) !== task) return
            if ((itemVersions.get(id) || 0) === version) putItem(result.item)
            invalidItems.delete(id)
            store.set({ detailStates: { ...store.getSnapshot().detailStates, [id]: { loading: false, error: '' } } })
          } catch (error) {
            if (!disposed && !abort.signal.aborted) store.set({ detailStates: { ...store.getSnapshot().detailStates, [id]: { loading: false, error: errorMessage(error) } } })
          } finally { releaseAbort(abort); if (detailRequests.get(id) === task) detailRequests.delete(id) }
        })()
        return task.promise
      }
      function scheduleInvalidation(frame) {
        if (disposed) return
        if (frame.sessionId) invalidItems.add(frame.sessionId)
        else allInvalid = true
        clearTimeout(invalidationTimer)
        invalidationTimer = setTimeout(() => {
          invalidationTimer = null
          if (disposed) return
          if (activePages) void loadList(false, true)
          const ids = new Set(itemHolders.keys())
          if (activePages && store.getSnapshot().selectedId) ids.add(store.getSnapshot().selectedId)
          for (const id of ids) if (allInvalid || invalidItems.has(id)) void loadItem(id, true)
          if (allInvalid) for (const id of Object.keys(store.getSnapshot().byId)) invalidItems.add(id)
          allInvalid = false
        }, debounceMs)
      }
      async function connectWatch() {
        if (disposed || watchAbort) return
        clearTimeout(reconnectTimer)
        const abort = watchAbort = newAbort()
        let lastRevision = null
        store.set({ watchState: 'connecting', watchError: '' })
        try {
          const response = await fetchImpl('/api/session-navigator/watch', {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
            body: '{}', signal: abort.signal,
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await readChanges(response.body, abort.signal, frame => {
            if (disposed || abort.signal.aborted) return
            reconnectAttempt = 0
            store.set({ watchState: 'connected', watchError: '' })
            if (frame.revision !== lastRevision) { lastRevision = frame.revision; scheduleInvalidation(frame) }
          })
          if (!abort.signal.aborted) throw new Error('Stream disconnected')
        } catch (error) {
          if (!disposed && !abort.signal.aborted) {
            const unavailable = error?.code === 'STREAM_UNAVAILABLE'
            store.set({ watchState: unavailable ? 'unsupported' : 'disconnected', watchError: errorMessage(error) })
            // Retry the long-lived stream only; never poll session data.
            if (!unavailable) {
              const delay = Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempt++, 4))
              reconnectTimer = setTimeout(() => { reconnectTimer = null; void connectWatch() }, delay)
            }
          }
        } finally { releaseAbort(abort); if (watchAbort === abort) watchAbort = null }
      }
      async function mutate(id, action, payload) {
        if (disposed || !id || store.getSnapshot().actions[id]?.busy) return
        const abort = newAbort()
        setAction(id, { busy: action, error: '', notice: '' })
        try {
          const value = await request(action, { sessionId: id, ...payload }, abort.signal)
          if (disposed || abort.signal.aborted) return
          putItem(value.item)
          setAction(id, { busy: '', error: '', notice: action === 'refresh' ? (value.status === 'unchanged' ? 'unchangedNotice' : 'queuedNotice') : payload.paused ? 'pausedNotice' : 'resumedNotice' })
        } catch (error) {
          if (!disposed && !abort.signal.aborted) setAction(id, { busy: '', error: errorMessage(error), notice: '' })
        } finally { releaseAbort(abort) }
      }
      const api = {
        ...store,
        start: connectWatch,
        activate() { activePages++; void loadList(); return () => { activePages = Math.max(0, activePages - 1); if (!activePages) { listAbort?.abort(); clearTimeout(filterTimer) } } },
        change(patch, composing = false) {
          if (disposed) return
          listGeneration++; listAbort?.abort(); clearTimeout(filterTimer)
          store.set({ ...patch, items: [], selectedId: null, nextOffset: undefined, loading: true, error: '' })
          if (!composing) filterTimer = setTimeout(() => { filterTimer = null; void loadList() }, debounceMs)
        },
        select(id) { if (disposed) return; store.set({ selectedId: id }); void loadItem(id) },
        more: () => loadList(true), retry: () => loadList(),
        retainItem(id) {
          if (!id || disposed) return () => {}
          itemHolders.set(id, (itemHolders.get(id) || 0) + 1)
          void loadItem(id)
          return () => {
            const count = (itemHolders.get(id) || 1) - 1
            if (count) itemHolders.set(id, count)
            else {
              itemHolders.delete(id)
              if (!(activePages && store.getSnapshot().selectedId === id)) detailRequests.get(id)?.abort.abort()
            }
          }
        },
        retryItem: id => loadItem(id, true),
        refresh: id => mutate(id, 'refresh'),
        pause: (id, paused) => mutate(id, 'pause', { paused }),
        async touch(id) {
          if (disposed || !id) return
          const abort = newAbort()
          try {
            const value = await request('touch', { sessionId: id }, abort.signal)
            if (!disposed && !abort.signal.aborted) putItem(value.item)
          } catch {} finally { releaseAbort(abort) }
        },
        async open(item) {
          if (!item || item.archived || disposed || store.getSnapshot().actions[item.sessionId]?.opening) return
          const id = item.sessionId
          setAction(id, { opening: true, openError: '' })
          try {
            await navigate(id)
            if (!disposed) setAction(id, { opening: false, openError: '' })
          } catch (error) { if (!disposed) setAction(id, { opening: false, openError: errorMessage(error) }) }
        },
        reconnect() {
          clearTimeout(reconnectTimer)
          watchAbort?.abort(); watchAbort = null; reconnectAttempt = 0
          void connectWatch()
          if (activePages) void loadList(false, true)
        },
        dispose() {
          disposed = true
          clearTimeout(filterTimer); clearTimeout(invalidationTimer); clearTimeout(reconnectTimer)
          for (const abort of requests) abort.abort()
          requests.clear(); detailRequests.clear(); itemHolders.clear()
        },
      }
      return api
    }

    const CSS = `
.dsh-nav-page,.dsh-nav-hover{color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;box-sizing:border-box}
.dsh-nav-page *,.dsh-nav-hover *{box-sizing:border-box}
.dsh-nav-page{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);padding:calc(var(--dsh-frame-top-clearance,0px) + 24px) 28px 24px}
.dsh-nav-shell{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:20px;min-height:100%}
.dsh-nav-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-left:max(0px,calc(var(--dsh-frame-leading-clearance,0px) - 28px))}
.dsh-nav-title{display:flex;align-items:center;gap:10px;margin:0;font-size:24px;line-height:1.4;font-weight:650;letter-spacing:-.025em}
.dsh-nav-subtitle{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;margin:6px 0 0}
.dsh-nav-toolbar{display:flex;flex-direction:column;gap:12px}
.dsh-nav-search{display:flex;align-items:center;gap:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:0 12px;min-height:44px}
.dsh-nav-search:focus-within{border-color:var(--dsw-alias-brand-primary);outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.dsh-nav-search svg{color:var(--dsw-alias-label-secondary);flex-shrink:0}
.dsh-nav-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;padding:12px 0}
.dsh-nav-search input::placeholder{color:var(--dsw-alias-label-secondary)}
.dsh-nav-filters{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dsh-nav-control{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-nav-control select{max-width:240px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:6px 26px 6px 9px;min-height:32px}
.dsh-nav-control input{accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;margin:0}
.dsh-nav-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsh-nav-columns{display:grid;grid-template-columns:minmax(260px,1.05fr) minmax(280px,1fr);gap:20px;align-items:start;flex:1;min-height:0}
.dsh-nav-list{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:visible;background:var(--dsw-alias-bg-base)}
.dsh-nav-row-wrap{position:relative;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-nav-row-wrap:last-child{border-bottom:0}.dsh-nav-row-wrap:first-child .dsh-nav-row{border-radius:11px 11px 0 0}.dsh-nav-row-wrap:last-child .dsh-nav-row{border-radius:0 0 11px 11px}
.dsh-nav-row{display:flex;flex-direction:column;gap:7px;width:100%;text-align:left;background:transparent;border:0;color:inherit;font:inherit;padding:15px 16px;cursor:pointer;min-height:94px}
.dsh-nav-row:hover{background:var(--dsw-alias-bg-layer-1)}
.dsh-nav-row[aria-selected=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-base));box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.dsh-nav-row-title{font-weight:600;font-size:14px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;width:100%}
.dsh-nav-row-subtitle{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;width:100%}
.dsh-nav-row-meta{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dsh-nav-row-workspace{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}.dsh-nav-row-meta time{white-space:nowrap}
.dsh-nav-dot{width:6px;height:6px;border-radius:50%;display:inline-block;background:var(--dsw-alias-state-idle-primary);flex-shrink:0}
.dsh-nav-dot[data-status=ready]{background:var(--dsw-alias-state-success-primary)}.dsh-nav-dot[data-status=error]{background:var(--dsw-alias-state-error-primary)}.dsh-nav-dot[data-status=generating],.dsh-nav-dot[data-status=queued],.dsh-nav-dot[data-status=stale]{background:var(--dsw-alias-state-warn-primary)}
.dsh-nav-detail{position:sticky;top:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:22px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.dsh-nav-detail h2{font-size:17px;line-height:1.5;margin:0 0 9px;font-weight:600;overflow-wrap:anywhere}
.dsh-nav-badges{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:20px;color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-nav-badge{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:3px 6px;display:inline-flex;align-items:center;gap:5px;line-height:1.25}
.dsh-nav-section{margin:0 0 19px}.dsh-nav-section:last-child{margin-bottom:0}.dsh-nav-section h3{margin:0 0 7px;font-size:11px;line-height:1.5;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsh-nav-copy{font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.dsh-nav-question{padding:9px 11px;background:var(--dsw-alias-bg-base);border-left:2px solid var(--dsw-alias-border-l2);border-radius:0 6px 6px 0;margin:0;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto}
.dsh-nav-muted{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);margin:0}
.dsh-nav-tags{display:flex;flex-wrap:wrap;gap:6px}.dsh-nav-tag{background:var(--dsw-alias-bg-layer-2);border-radius:5px;padding:4px 8px;font-size:11px;line-height:1.4;overflow-wrap:anywhere;max-width:100%}
.dsh-nav-times{display:grid;grid-template-columns:auto 1fr;gap:7px 14px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:18px 0 0}.dsh-nav-times dt,.dsh-nav-times dd{margin:0}.dsh-nav-times dd{text-align:right;font-variant-numeric:tabular-nums}
.dsh-nav-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-nav-button{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 11px;font:inherit;font-size:12px;font-weight:500;line-height:1.4;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
.dsh-nav-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dsh-nav-button:disabled{opacity:.5;cursor:not-allowed}.dsh-nav-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-base));color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.dsh-nav-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-base))}
.dsh-nav-quiet{background:transparent;border-color:transparent}.dsh-nav-icon-button{padding:6px;width:30px;height:30px;flex-shrink:0}.dsh-nav-pause{margin-top:10px;font-size:11px}
.dsh-nav-button:focus-visible,.dsh-nav-row:focus-visible,.dsh-nav-control select:focus-visible,.dsh-nav-control input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dsh-nav-notice{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.6;display:flex;gap:10px;justify-content:space-between;align-items:center}
.dsh-nav-feedback{font-size:12px;line-height:1.7;margin:10px 0 0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-nav-error{color:var(--dsw-alias-state-error-primary)}.dsh-nav-error details{font-size:11px;margin-top:6px}.dsh-nav-error summary{cursor:pointer}.dsh-nav-error p{white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-nav-empty{text-align:center;padding:54px 20px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;align-items:center;gap:10px}.dsh-nav-empty strong{font-weight:500;font-size:14px;color:var(--dsw-alias-label-primary)}.dsh-nav-empty p{margin:0;font-size:12px;line-height:1.7;max-width:300px}
.dsh-nav-footer{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 2px 0;color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-nav-popover{position:absolute;top:calc(100% - 2px);left:12px;right:12px;z-index:12;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:15px;box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);max-height:360px;overflow:auto}
.dsh-nav-popover .dsh-nav-section{margin-bottom:12px}.dsh-nav-popover .dsh-nav-times{margin-top:12px}.dsh-nav-popover .dsh-nav-copy{font-size:12px;line-height:1.7}
.dsh-nav-hover{min-width:0;max-width:390px;padding:6px 0}.dsh-nav-hover .dsh-nav-section{margin-bottom:12px}.dsh-nav-hover .dsh-nav-copy{font-size:12px;line-height:1.7}.dsh-nav-hover .dsh-nav-question{max-height:120px;font-size:12px}.dsh-nav-hover .dsh-nav-badges{margin-bottom:12px}.dsh-nav-hover .dsh-nav-times{margin-top:12px}
.dsh-nav-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:850px){.dsh-nav-page{padding-left:18px;padding-right:18px}.dsh-nav-columns{gap:14px;grid-template-columns:minmax(230px,1fr) minmax(240px,1fr)}.dsh-nav-detail{padding:16px}.dsh-nav-count{margin-left:0}}
@media(max-width:650px){.dsh-nav-columns{grid-template-columns:1fr}.dsh-nav-detail{position:static}.dsh-nav-list{max-height:50vh;overflow:auto}.dsh-nav-popover{display:none}.dsh-nav-title{font-size:21px}.dsh-nav-header{gap:8px}.dsh-nav-control select{max-width:185px}.dsh-nav-filters{gap:10px}.dsh-nav-footer{align-items:flex-start;flex-wrap:wrap}}
`
    function Icon({ kind = 'compass', size = 20, ...props }) {
      const paths = {
        compass: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'm16 8-2.5 5.5L8 16l2.5-5.5L16 8Z'],
        search: ['M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'm16 16 4.5 4.5'],
        close: ['m6 6 12 12', 'M18 6 6 18'],
        back: ['m10 6-6 6 6 6', 'M4 12h16'],
        open: ['M14 4h6v6', 'm20 4-9 9', 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5'],
        refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M6.1 7A7 7 0 0 1 18 5l2 3', 'M4 16l2 3a7 7 0 0 0 11.9-2'],
      }
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props },
        (paths[kind] || paths.compass).map((d, i) => h('path', { key: i, d })))
    }
    function useState(api) { return React.useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot) }
    function useLocale(locale) { React.useSyncExternalStore(callback => locale.subscribe(callback), () => locale.getSnapshot().revision, () => locale.getSnapshot().revision); return locale.getSnapshot().active }
    function timeText(value, language, short = false) {
      const number = typeof value === 'number' ? value : Date.parse(value)
      if (!Number.isFinite(number) || number <= 0) return ''
      try { return new Intl.DateTimeFormat(language || undefined, short ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(number)) } catch { return new Date(number).toLocaleString() }
    }
    function statusKey(item) {
      return ({ ready: 'statusReady', stale: 'statusStale', queued: 'statusQueued', generating: 'statusGenerating', empty: 'statusEmpty', error: 'statusError' })[item?.status] || 'statusEmpty'
    }
    function Failure({ title, message, retry, t }) {
      return h('div', { className: 'dsh-nav-feedback dsh-nav-error', role: 'alert' },
        h('span', null, title), message ? h('details', null, h('summary', null, t('errorDetails')), h('p', null, message)) : null,
        retry ? h('button', { type: 'button', className: 'dsh-nav-button', onClick: retry }, t('retry')) : null)
    }
    function DetailContent({ item, t, language, compact = false }) {
      const behind = summaryBehind(item)
      return h(React.Fragment, null,
        h('div', { className: 'dsh-nav-badges' },
          h('span', { className: 'dsh-nav-badge' }, h('span', { className: 'dsh-nav-dot', 'data-status': item.status }), t(statusKey(item))),
          item.paused ? h('span', { className: 'dsh-nav-badge' }, t('paused')) : null,
          item.archived ? h('span', { className: 'dsh-nav-badge' }, t('archived')) : null),
        behind && item.recentSummary ? h('p', { className: 'dsh-nav-muted', style: { marginBottom: 12 } }, t('oldHint')) : null,
        item.status === 'error' && item.recentSummary ? h('p', { className: 'dsh-nav-muted', style: { marginBottom: 12 } }, t('retainedSummary')) : null,
        ['queued', 'generating'].includes(item.status) ? h('p', { className: 'dsh-nav-muted', style: { marginBottom: 12 } }, t('backgroundHint')) : null,
        item.recentTopic ? h('section', { className: 'dsh-nav-section' }, h('h3', null, t(behind ? 'oldTopic' : 'recentTopic')), h('p', { className: 'dsh-nav-copy' }, item.recentTopic)) : null,
        h('section', { className: 'dsh-nav-section' }, h('h3', null, t(behind ? 'oldSummary' : 'summary')),
          h('p', { className: item.recentSummary ? 'dsh-nav-copy' : 'dsh-nav-muted' }, item.recentSummary || t('noSummary')),
          !item.recentSummary && !compact ? h('p', { className: 'dsh-nav-muted', style: { marginTop: 5 } }, t('noSummaryHint')) : null),
        h('section', { className: 'dsh-nav-section' }, h('h3', null, t('questionLabel')),
          item.latestQuestion ? h('blockquote', { className: 'dsh-nav-question' }, item.latestQuestion) : h('p', { className: 'dsh-nav-muted' }, t('noQuestion'))),
        h('section', { className: 'dsh-nav-section' }, h('h3', null, t('pastTopics')),
          item.pastTopics?.length ? h('div', { className: 'dsh-nav-tags' }, item.pastTopics.map((topic, i) => h('span', { key: `${i}:${topic}`, className: 'dsh-nav-tag' }, topic))) : h('p', { className: 'dsh-nav-muted' }, t('noHistory'))),
        item.status === 'error' ? h(Failure, { title: t('statusError'), message: item.error, t }) : null,
        h('dl', { className: 'dsh-nav-times' },
          h('dt', null, t('activityAt')), h('dd', null, timeText(item.updatedAt, language) || t('never')),
          item.summaryUpdatedAt ? h(React.Fragment, null, h('dt', null, t('summaryAt')), h('dd', null, timeText(item.summaryUpdatedAt, language))) : null,
          !compact ? h(React.Fragment, null, h('dt', null, t('visitedAt')), h('dd', null, timeText(item.lastVisitedAt, language) || t('never'))) : null))
    }
    function SessionRow({ item, selected, api, t, language, index, onKeyDown, sort }) {
      const [preview, setPreview] = React.useState(false)
      const timer = React.useRef(null)
      const button = React.useRef(null)
      const previewId = React.useId()
      const line = secondLine(item)
      React.useEffect(() => () => clearTimeout(timer.current), [])
      const reveal = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(true), 500) }
      const hide = () => { clearTimeout(timer.current); setPreview(false) }
      return h('div', { className: 'dsh-nav-row-wrap', onMouseEnter: reveal, onMouseLeave: hide,
        onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) hide() } },
        h('button', {
          ref: button, type: 'button', className: 'dsh-nav-row', role: 'option', 'aria-selected': selected,
          tabIndex: selected ? 0 : -1, 'data-nav-row': index, 'aria-describedby': preview ? previewId : undefined,
          onClick: () => { api.select(item.sessionId); hide() }, onDoubleClick: () => void api.open(item),
          onFocus: () => { api.select(item.sessionId); if (!selected) reveal() },
          onKeyDown: event => { if (event.key === 'Escape') { hide(); event.stopPropagation() } else onKeyDown(event, index) },
        }, h('span', { className: 'dsh-nav-row-title' }, item.title || t('untitled')),
        h('span', { className: 'dsh-nav-row-subtitle' }, `${t(line.kind)}：${line.text || t('noQuestion')}`),
        h('span', { className: 'dsh-nav-row-meta' },
          h('span', { className: 'dsh-nav-row-workspace' }, item.workspaceTitle || t('ungrouped')),
          item.archived ? h('span', null, t('archived')) : null,
          item.paused ? h('span', null, t('paused')) : null,
          h('span', { className: 'dsh-nav-dot', 'data-status': item.status, title: t(statusKey(item)) }),
          h('span', { className: 'dsh-nav-sr' }, t(statusKey(item))),
          h('time', null, timeText(sort === 'updated' ? item.updatedAt : item.lastVisitedAt || item.updatedAt, language, true)))),
        preview ? h('div', { id: previewId, className: 'dsh-nav-popover', role: 'tooltip', onKeyDown: event => { if (event.key === 'Escape') hide() } },
          h(DetailContent, { item, t, language, compact: true })) : null)
    }
    function DetailPanel({ state, api, t, language }) {
      const item = state.byId[state.selectedId]
      const detail = state.detailStates[state.selectedId]
      if (!item) return h('aside', { className: 'dsh-nav-detail dsh-nav-empty', 'aria-label': t('preview') }, h(Icon, { size: 28 }), h('p', null, t('selectHint')))
      const action = state.actions[item.sessionId] || {}
      const generating = item.status === 'queued' || item.status === 'generating'
      return h('aside', { className: 'dsh-nav-detail', 'aria-label': t('preview') },
        h('h2', null, item.title || t('untitled')),
        h('p', { className: 'dsh-nav-muted', style: { marginBottom: 16 } }, item.workspaceTitle || t('ungrouped')),
        h(DetailContent, { item, t, language }),
        detail?.error ? h(Failure, { title: t('detailFailure'), message: detail.error, retry: () => api.retryItem(item.sessionId), t }) : null,
        h('div', { className: 'dsh-nav-actions' },
          h('button', { type: 'button', className: 'dsh-nav-button dsh-nav-primary', disabled: item.archived || Boolean(action.opening), onClick: () => void api.open(item) }, h(Icon, { kind: 'open', size: 15 }), t(action.opening ? 'opening' : 'open')),
          h('button', { type: 'button', className: 'dsh-nav-button', disabled: Boolean(action.busy) || generating, onClick: () => void api.refresh(item.sessionId), title: item.model ? t('model', { model: item.model }) : undefined }, h(Icon, { kind: 'refresh', size: 15 }), t(action.busy === 'refresh' || generating ? 'refreshBusy' : 'refresh'))),
        h('button', { type: 'button', className: 'dsh-nav-button dsh-nav-quiet dsh-nav-pause', disabled: Boolean(action.busy), onClick: () => void api.pause(item.sessionId, !item.paused), title: t('pauseHint') }, t(item.paused ? 'resume' : 'pause')),
        item.archived ? h('p', { className: 'dsh-nav-feedback' }, t('archiveHint')) : null,
        state.settings?.autoSummarize === false ? h('p', { className: 'dsh-nav-feedback' }, t('automaticOff')) : null,
        action.notice ? h('p', { className: 'dsh-nav-feedback', role: 'status' }, t(action.notice)) : null,
        action.openError ? h(Failure, { title: t('openFailure'), message: action.openError, t }) : null,
        action.error ? h(Failure, { title: t('actionFailure'), message: action.error, t }) : null)
    }
    function NavigatorPage({ api, t, locale, back }) {
      const state = useState(api)
      const language = useLocale(locale)
      const list = React.useRef(null)
      const input = React.useRef(null)
      const composing = React.useRef(false)
      React.useEffect(() => api.activate(), [api])
      const selectAt = index => {
        const bounded = Math.max(0, Math.min(state.items.length - 1, index))
        const item = state.items[bounded]
        if (!item) return
        api.select(item.sessionId)
        const row = list.current?.querySelector(`[data-nav-row="${bounded}"]`)
        row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' })
      }
      const onRowKey = (event, index) => {
        if (event.isComposing || event.nativeEvent?.isComposing || composing.current) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selectAt(index + (event.key === 'ArrowDown' ? 1 : -1)) }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); selectAt(event.key === 'Home' ? 0 : state.items.length - 1) }
        else if (event.key === 'Enter') { event.preventDefault(); void api.open(state.items[index]) }
      }
      const filtered = Boolean(state.query || state.workspaceId || state.includeArchived)
      return h('main', { className: 'dsh-nav-page', 'aria-label': t('title') }, h('style', null, CSS),
        h('div', { className: 'dsh-nav-shell' },
          h('header', { className: 'dsh-nav-header' },
            h('div', null, h('h1', { className: 'dsh-nav-title' }, h(Icon, { size: 25 }), t('title')), h('p', { className: 'dsh-nav-subtitle' }, t('subtitle'))),
            h('button', { type: 'button', className: 'dsh-nav-button dsh-nav-quiet', onClick: back, title: t('back'), 'aria-label': t('back') }, h(Icon, { kind: 'back', size: 18 }))),
          h('div', { className: 'dsh-nav-toolbar' },
            h('div', { className: 'dsh-nav-search' }, h(Icon, { kind: 'search', size: 18 }), h('input', {
              ref: input, type: 'search', value: state.query, placeholder: t('placeholder'), 'aria-label': t('search'), autoComplete: 'off', spellCheck: false,
              onChange: event => api.change({ query: event.target.value }, composing.current),
              onCompositionStart: () => { composing.current = true },
              onCompositionEnd: event => { composing.current = false; api.change({ query: event.target.value }) },
              onKeyDown: event => { if (event.key === 'ArrowDown' && !composing.current) { event.preventDefault(); selectAt(0) } },
            }), state.query ? h('button', { type: 'button', className: 'dsh-nav-button dsh-nav-quiet dsh-nav-icon-button', 'aria-label': t('clear'), onClick: () => { api.change({ query: '' }); input.current?.focus() } }, h(Icon, { kind: 'close', size: 16 })) : null),
            h('div', { className: 'dsh-nav-filters' },
              h('label', { className: 'dsh-nav-control' }, t('workspace'), h('select', { value: state.workspaceId, onChange: event => api.change({ workspaceId: event.target.value }) },
                h('option', { value: '' }, t('allWorkspaces')), state.workspaces.map(workspace => h('option', { key: workspace.id, value: workspace.id }, workspace.title || t('ungrouped'))))),
              h('label', { className: 'dsh-nav-control' }, t('sort'), h('select', { value: state.sort, onChange: event => api.change({ sort: event.target.value }) }, h('option', { value: 'visited' }, t('visited')), h('option', { value: 'updated' }, t('updated')))),
              h('label', { className: 'dsh-nav-control' }, h('input', { type: 'checkbox', checked: state.includeArchived, onChange: event => api.change({ includeArchived: event.target.checked }) }), t('archives')),
              h('span', { className: 'dsh-nav-count', role: 'status', 'aria-live': 'polite' }, t('count', { count: state.total })))),
          ['disconnected', 'unsupported'].includes(state.watchState) ? h('div', { className: 'dsh-nav-notice', role: 'status' }, h('span', null, t(state.watchState === 'unsupported' ? 'streamUnavailable' : 'livePaused')), h('button', { type: 'button', className: 'dsh-nav-button', onClick: api.reconnect }, t('reconnect'))) : null,
          h('div', { className: 'dsh-nav-columns' },
            h('section', null,
              h('div', { ref: list, className: 'dsh-nav-list', role: 'listbox', 'aria-label': t('title'), 'aria-busy': state.loading || state.moreLoading },
                state.items.map((item, index) => h(SessionRow, { key: item.sessionId, item, index, selected: item.sessionId === state.selectedId, api, t, language, onKeyDown: onRowKey, sort: state.sort })),
                !state.items.length ? h('div', { className: 'dsh-nav-empty', role: 'status' },
                  h(Icon, { kind: filtered ? 'search' : 'compass', size: 30 }),
                  h('strong', null, t(state.loading ? 'loading' : state.error ? 'loadFailure' : filtered ? 'noMatches' : 'empty')),
                  !state.loading && !state.error ? h('p', null, t(filtered ? 'noMatchesHint' : 'emptyHint')) : null,
                  filtered && !state.loading ? h('button', { type: 'button', className: 'dsh-nav-button', onClick: () => api.change({ query: '', workspaceId: '', includeArchived: false }) }, t('resetFilters')) : null) : null),
              state.error ? h(Failure, { title: t('loadFailure'), message: state.error, retry: api.retry, t }) : null,
              h('footer', { className: 'dsh-nav-footer' }, h('span', null, t('loadedCount', { loaded: state.items.length, total: state.total })),
                state.nextOffset !== undefined ? h('button', { type: 'button', className: 'dsh-nav-button', disabled: state.loading || state.moreLoading, onClick: api.more }, t(state.moreLoading ? 'loading' : 'more')) : null),
              h('p', { className: 'dsh-nav-muted', style: { marginTop: 10, fontSize: 11 } }, t('keyboard'))),
            h(DetailPanel, { state, api, t, language }))))
    }
    function NativeHover({ sessionId, api, t, locale }) {
      const state = useState(api)
      const language = useLocale(locale)
      React.useEffect(() => api.retainItem(sessionId), [api, sessionId])
      const item = state.byId[sessionId]
      const detail = state.detailStates[sessionId]
      return h('section', { className: 'dsh-nav-hover', 'aria-label': t('preview') }, h('style', null, CSS),
        item ? h(DetailContent, { item, t, language, compact: true }) : h('p', { className: 'dsh-nav-muted', role: 'status' }, t(detail?.error ? 'detailFailure' : 'loadingDetail')),
        detail?.error ? h(Failure, { title: t('detailFailure'), message: detail.error, retry: () => api.retryItem(sessionId), t }) : null)
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), `${NAME}: zh`)
      ctx.effect(() => ctx.locale.register(NS, 'en', EN), `${NAME}: en`)
      const t = ctx.locale.bind(NS)
      const transport = globalThis.__DSH_TRANSPORT__
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : globalThis.fetch.bind(globalThis)
      const api = createController({ request: (action, payload, signal) => requestJSON(fetchImpl, action, payload, signal), fetchImpl, navigate: id => ctx.uiWorkspace.openSession(id) })
      ctx.effect(() => { void api.start(); return () => api.dispose() }, `${NAME}: requests`)
      ctx.effect(() => trackVisits(ctx.sessions.list, id => api.touch(id)), `${NAME}: visits`)
      const inject = () => ({ api, t, locale: ctx.locale, back: () => ctx.layout.selectPanel(null) })
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NAME, order: 35, locale: NS, label: () => t('title') }, props => h(Icon, { size: props.size || 20 }))), `${NAME}: entry`)
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NAME, locale: NS, inject }, NavigatorPage)), `${NAME}: page`)
      ctx.effect(() => ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({ name: 'sidebar.session.row.hover', id: NAME, order: 35, locale: NS, inject }, NativeHover)), `${NAME}: hover`)
    }
    return { name: NAME, inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout'], apply,
      __test: { createStore, summaryBehind, secondLine, currentMainSession, mergeItems, requestJSON, readChanges, trackVisits, createController, ZH, EN } }
  },
})
