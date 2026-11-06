/** 待办 · Todo: iPhone-Reminders-style page, right-side card and due-time banners. Only React is imported. */
window.__ModuleLoader__.load({
  id: 'dsh-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-todo', NS = 'todo', ACCESSORY = 'capability-selector.accessories', ROUTE = '/api/todo/action'
    const ZH = {
      title: '待办', search: '搜索', today: '今天', scheduled: '计划', all: '全部', flagged: '旗标', completed: '已完成',
      myLists: '我的列表', addList: '添加列表', newReminder: '新提醒事项', newPlaceholder: '新提醒事项', searchResults: '搜索结果',
      overdue: '已逾期', allDay: '全天', morning: '上午', afternoon: '下午', tonight: '今晚', tomorrow: '明天', yesterday: '昨天',
      showCompleted: '显示已完成', hideCompleted: '隐藏已完成', emptyToday: '今天没有提醒事项', emptyView: '没有提醒事项', emptySearch: '没有找到匹配的提醒事项',
      notes: '备注', date: '日期', time: '时间', flag: '旗标', list: '列表', session: '关联对话', linkCurrent: '关联当前对话', unlink: '取消关联',
      openSession: '打开对话', linkedSession: '已关联对话', delete: '删除', clear: '清除', details: '详细信息', closeDetails: '收起详细信息',
      markDone: '标记为完成', markUndone: '标记为未完成', listName: '列表名称', save: '完成', cancel: '取消', editList: '编辑列表',
      deleteList: '删除列表', confirmDeleteList: '确认删除（含 {count} 项）', lastList: '至少保留一个列表', color: '颜色',
      loading: '正在读取待办…', loadFailure: '暂时无法读取待办', retry: '重试', offline: '同步暂时中断，正在重连', failure: '操作未完成，请重试。',
      todayCount: '今天 {count}', footer: '全部 {all} 项 · 计划 {scheduled} 项', openTodo: '打开待办', add: '新建提醒事项', emptyCard: '今天没有待办，点 + 新建',
      snooze: '10 分钟后', done: '完成', dismiss: '关闭', dueNow: '到期提醒', back: '返回对话', items: '{count} 项',
    }
    const EN = {
      title: 'Todo', search: 'Search', today: 'Today', scheduled: 'Scheduled', all: 'All', flagged: 'Flagged', completed: 'Completed',
      myLists: 'My Lists', addList: 'Add List', newReminder: 'New Reminder', newPlaceholder: 'New Reminder', searchResults: 'Search Results',
      overdue: 'Overdue', allDay: 'All Day', morning: 'Morning', afternoon: 'Afternoon', tonight: 'Tonight', tomorrow: 'Tomorrow', yesterday: 'Yesterday',
      showCompleted: 'Show Completed', hideCompleted: 'Hide Completed', emptyToday: 'No reminders today', emptyView: 'No reminders', emptySearch: 'No matching reminders',
      notes: 'Notes', date: 'Date', time: 'Time', flag: 'Flag', list: 'List', session: 'Conversation', linkCurrent: 'Link current conversation', unlink: 'Unlink',
      openSession: 'Open conversation', linkedSession: 'Linked conversation', delete: 'Delete', clear: 'Clear', details: 'Details', closeDetails: 'Hide details',
      markDone: 'Mark as completed', markUndone: 'Mark as incomplete', listName: 'List name', save: 'Done', cancel: 'Cancel', editList: 'Edit list',
      deleteList: 'Delete list', confirmDeleteList: 'Confirm delete ({count} items)', lastList: 'Keep at least one list', color: 'Color',
      loading: 'Loading reminders…', loadFailure: 'Could not load reminders', retry: 'Retry', offline: 'Sync interrupted, reconnecting', failure: 'The change failed. Please retry.',
      todayCount: 'Today {count}', footer: 'All {all} · Scheduled {scheduled}', openTodo: 'Open Todo', add: 'Add a reminder', emptyCard: 'Nothing today. Press + to add.',
      snooze: 'In 10 min', done: 'Done', dismiss: 'Dismiss', dueNow: 'Reminder', back: 'Back to conversation', items: '{count} items',
    }
    const HEX = { red: '#FF3B30', orange: '#FF9500', yellow: '#FFCC00', green: '#34C759', teal: '#5AC8FA', blue: '#007AFF', indigo: '#5856D6', pink: '#FF2D55', purple: '#AF52DE', brown: '#A2845E', gray: '#8E8E93' }
    const COLORS = Object.keys(HEX)
    const SMART = [
      { id: 'today', color: '#007AFF', glyph: 'calendar' }, { id: 'scheduled', color: '#FF3B30', glyph: 'calendarGrid' },
      { id: 'all', color: 'var(--dtd-all,#3A3A3C)', glyph: 'tray' }, { id: 'flagged', color: '#FF9500', glyph: 'flag' },
      { id: 'completed', color: '#8E8E93', glyph: 'check', wide: true },
    ]
    const TITLE_COLOR = { today: '#007AFF', scheduled: '#FF3B30', flagged: '#FF9500', completed: '#8E8E93' }

    // ----- Dates in the viewer's time zone (mirrors lib/core.js) -----
    const pad = value => String(value).padStart(2, '0')
    const localDate = (at = Date.now()) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
    const addDays = (date, days) => { const [y, m, d] = date.split('-').map(Number); return localDate(new Date(y, m - 1, d + days, 12).getTime()) }
    const instantOf = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh, mm).getTime() }
    function overdue(item, now = Date.now()) {
      if (item.completed || !item.dueDate) return false
      return item.dueTime ? (item.alertAt ?? instantOf(item.dueDate, item.dueTime)) < now : item.dueDate < localDate(now)
    }
    function inView(item, view, today) {
      switch (view) {
        case 'today': return !item.completed && item.dueDate !== null && item.dueDate <= today
        case 'scheduled': return !item.completed && item.dueDate !== null
        case 'all': return !item.completed
        case 'flagged': return !item.completed && item.flagged
        case 'completed': return item.completed
        default: return false
      }
    }
    const compareDue = (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.createdAt - b.createdAt
    function counts(state, today) {
      const result = { today: 0, scheduled: 0, all: 0, flagged: 0, completed: 0, lists: {} }
      for (const list of state.lists) result.lists[list.id] = 0
      for (const item of state.items) {
        for (const view of ['today', 'scheduled', 'all', 'flagged', 'completed']) if (inView(item, view, today)) result[view]++
        if (!item.completed && item.listId in result.lists) result.lists[item.listId]++
      }
      return result
    }
    function dateLabel(date, today, t, lang) {
      if (date === today) return t('today')
      if (date === addDays(today, 1)) return t('tomorrow')
      if (date === addDays(today, -1)) return t('yesterday')
      const [y, m, d] = date.split('-').map(Number), at = new Date(y, m - 1, d, 12)
      const options = y === Number(today.slice(0, 4)) ? { month: 'numeric', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' }
      try { return new Intl.DateTimeFormat(lang || undefined, options).format(at) } catch { return date }
    }
    function weekday(date, lang) { const [y, m, d] = date.split('-').map(Number); try { return new Intl.DateTimeFormat(lang || undefined, { weekday: 'short' }).format(new Date(y, m - 1, d, 12)) } catch { return '' } }
    /** Page: "今天 10:30"; card: "10:30" for today, plus "已逾期" when late. */
    function dueText(item, today, t, lang, compact = false, now = Date.now()) {
      if (!item.dueDate) return ''
      const late = overdue(item, now)
      if (compact && item.dueDate === today && !item.dueTime) return ''
      let text = compact && item.dueDate === today && item.dueTime ? item.dueTime : `${dateLabel(item.dueDate, today, t, lang)}${item.dueTime ? ` ${item.dueTime}` : ''}`
      if (compact && late) text += ` ${t('overdue')}`
      return text
    }
    function part(time) { const hour = Number(String(time).slice(0, 2)); return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'tonight' }

    /** Section model for one view; completed rows stay visible right after being checked, as on iOS. */
    function sectionsFor(state, view, { today, lang, t }) {
      const lists = new Map(state.lists.map(list => [list.id, list]))
      const recent = state.recentDone || {}
      const shows = (item, name) => inView(item, name, today) || (item.completed && (state.showCompleted || recent[item.id]) && inView({ ...item, completed: false }, name, today))
      const byList = items => state.lists.map(list => ({ key: list.id, title: list.name, color: HEX[list.color], items: items.filter(item => item.listId === list.id).sort((a, b) => a.createdAt - b.createdAt) })).filter(section => section.items.length)
      if (view.kind === 'search') {
        const needle = view.query.trim().toLocaleLowerCase()
        return byList(state.items.filter(item => `${item.title}\n${item.notes}`.toLocaleLowerCase().includes(needle)))
      }
      if (view.kind === 'list') {
        const items = state.items.filter(item => item.listId === view.id && (!item.completed || state.showCompleted || recent[item.id]))
        return [{ key: view.id, title: null, items: items.sort((a, b) => a.createdAt - b.createdAt) }]
      }
      const name = view.id
      if (name === 'completed') {
        const groups = new Map()
        for (const item of state.items.filter(item => item.completed).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))) {
          const key = localDate(item.completedAt ?? item.updatedAt)
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(item)
        }
        return [...groups].map(([key, items]) => ({ key, title: dateLabel(key, today, t, lang), items }))
      }
      const items = state.items.filter(item => shows(item, name))
      if (name === 'all') return byList(items)
      if (name === 'flagged') return [{ key: 'flagged', title: null, items: items.sort(compareDue) }]
      const late = items.filter(item => item.dueDate < today).sort(compareDue)
      if (name === 'today') {
        const current = items.filter(item => item.dueDate === today)
        return [
          { key: 'overdue', title: t('overdue'), items: late },
          { key: 'allDay', title: t('allDay'), items: current.filter(item => !item.dueTime).sort(compareDue) },
          ...['morning', 'afternoon', 'tonight'].map(key => ({ key, title: t(key), items: current.filter(item => item.dueTime && part(item.dueTime) === key).sort(compareDue) })),
        ].filter(section => section.items.length)
      }
      const dates = [...new Set(items.filter(item => item.dueDate >= today).map(item => item.dueDate))].sort()
      return [{ key: 'overdue', title: t('overdue'), items: late }, ...dates.map(date => ({ key: date, title: `${dateLabel(date, today, t, lang)} ${date === today || date === addDays(today, 1) ? '' : weekday(date, lang)}`.trim(), items: items.filter(item => item.dueDate === date).sort(compareDue) }))].filter(section => section.items.length)
    }
    /** Fields a reminder created inside a view starts with, so it stays visible there. */
    function defaultsFor(view, state, today) {
      if (view.kind === 'list') return { listId: view.id }
      if (view.kind === 'smart' && (view.id === 'today' || view.id === 'scheduled')) return { dueDate: today }
      if (view.kind === 'smart' && view.id === 'flagged') return { flagged: true }
      return {}
    }
    const eligibleAlert = (item, now) => !item.completed && !item.alerted && Number.isFinite(item.alertAt) && item.alertAt <= now

    async function requestJSON(fetchImpl, input, signal) {
      const response = await fetchImpl(ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal })
      let value
      try { value = await response.json() } catch { throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'invalid_response', status: response.status }) }
      if (!response.ok || value?.ok !== true) throw Object.assign(new Error(value?.message || value?.error || `HTTP ${response.status}`), { code: value?.error || 'operation_failed', status: response.status })
      return value
    }

    /**
     * One store per window. Changes made elsewhere (Agent tool, other windows)
     * arrive through a cheap bounded revision poll; every request is a finite
     * JSON exchange, so nothing is held open across Host update draining.
     */
    function createStore(call, { pollMs = 3000, hiddenPollMs = 15000, maxBackoffMs = 30000, tickMs = 5000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, hidden = () => globalThis.document?.visibilityState === 'hidden', notify } = {}) {
      let state = { status: 'loading', error: '', offline: false, lists: [], items: [], revision: -1, token: null, view: { kind: 'smart', id: 'today' }, query: '', showCompleted: false, recentDone: {}, alerts: [], minute: Math.floor(now() / 60000) }
      const listeners = new Set(), lifetime = new AbortController()
      let disposed = false, started = false, pollTimer, tickTimer, failures = 0, pending = 0, mutationSeq = 0, loading, reloadQueued = false, claiming = false, claimQuietUntil = 0
      const set = patch => { if (disposed) return; state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; for (const listener of [...listeners]) listener() }
      const request = input => call(input, lifetime.signal)
      /** A snapshot that raced a local change is discarded and fetched once more afterwards. */
      function load() {
        if (disposed) return Promise.resolve()
        if (loading) { reloadQueued = true; return loading }
        const seq = mutationSeq
        loading = request({ action: 'snapshot' }).then(value => {
          if (disposed) return
          if (seq !== mutationSeq || pending) { reloadQueued = true; return }
          set({ status: 'ready', error: '', offline: false, lists: value.lists, items: value.items, revision: value.revision, token: value.token })
        }, error => {
          if (!disposed && !lifetime.signal.aborted) set(current => ({ status: current.status === 'ready' ? 'ready' : 'error', error: current.status === 'ready' ? current.error : error.code || 'operation_failed' }))
        }).finally(() => {
          loading = undefined
          if (reloadQueued && !pending && !disposed) { reloadQueued = false; void load() }
        })
        return loading
      }
      function settled() { if (!pending && reloadQueued && !loading && !disposed) { reloadQueued = false; void load() } }
      function nextDelay() { return failures ? Math.min(maxBackoffMs, pollMs * 2 ** Math.min(failures, 4)) : hidden() ? hiddenPollMs : pollMs }
      function schedulePoll(delay = nextDelay()) { clearTimer(pollTimer); pollTimer = disposed ? undefined : setTimer(poll, delay) }
      async function poll() {
        pollTimer = undefined
        if (disposed) return
        try {
          if (!pending) {
            const value = await request({ action: 'revision' })
            failures = 0
            if (state.offline) set({ offline: false })
            if (value.token !== state.token && !pending) await load()
          }
        } catch (error) {
          if (disposed || lifetime.signal.aborted) return
          failures++
          set({ offline: true })
        } finally { if (!disposed) schedulePoll() }
      }
      const upsert = (rows, row) => rows.some(item => item.id === row.id) ? rows.map(item => item.id === row.id ? row : item) : [...rows, row]
      function reconcile(value, input) {
        if (!value.changed) return
        if (value.revision !== state.revision + 1) { set({ revision: value.revision }); void load(); return }
        set(current => {
          let { items, lists } = current
          if (value.item) items = upsert(items, value.item)
          if (value.list) lists = upsert(lists, value.list)
          if (Array.isArray(value.alerts)) for (const alert of value.alerts) items = upsert(items, alert)
          if (input.action === 'delete') items = items.filter(item => item.id !== input.id)
          if (input.action === 'deleteList') { lists = lists.filter(list => list.id !== input.listId); items = items.filter(item => item.listId !== input.listId) }
          return { items, lists, revision: value.revision, token: value.token }
        })
      }
      async function mutate(input, optimistic) {
        if (disposed) return null
        pending++; mutationSeq++
        const before = state
        if (optimistic) set(optimistic)
        try {
          const value = await request(input)
          pending--
          reconcile(value, input)
          settled()
          return value
        } catch (error) {
          pending--
          if (disposed || lifetime.signal.aborted) return null
          reloadQueued = false
          // Restore the server's truth instead of keeping a guess.
          if (optimistic) set({ items: before.items, lists: before.lists })
          set({ error: error.code || 'operation_failed' })
          void load()
          return null
        }
      }
      function present(alerts) {
        if (!alerts.length) return
        set(current => {
          const known = new Set(current.alerts.map(alert => alert.id))
          const next = [...current.alerts, ...alerts.filter(alert => !known.has(alert.id)).map(alert => ({ id: alert.id, title: alert.title, dueDate: alert.dueDate, dueTime: alert.dueTime, sessionId: alert.sessionId, sessionTitle: alert.sessionTitle, listId: alert.listId }))]
          return { alerts: next.slice(-5) }
        })
        for (const alert of alerts) { try { notify?.(alert) } catch {} }
      }
      async function claim() {
        if (disposed || claiming || state.status !== 'ready') return
        const at = now()
        if (at < claimQuietUntil || !state.items.some(item => eligibleAlert(item, at))) return
        claiming = true
        try {
          const value = await mutate({ action: 'claimAlerts' })
          if (!value) return
          // A clock ahead of the Host waits instead of asking every tick.
          if (!value.alerts?.length) claimQuietUntil = now() + 30000
          present(value.alerts || [])
        } finally { claiming = false }
      }
      function tick() {
        tickTimer = undefined
        if (disposed) return
        const minute = Math.floor(now() / 60000)
        if (minute !== state.minute) set({ minute })
        void claim()
        tickTimer = setTimer(tick, tickMs)
      }
      const item = id => state.items.find(row => row.id === id)
      const api = {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        start() { if (started || disposed) return; started = true; void load().then(() => claim()); schedulePoll(); tickTimer = setTimer(tick, tickMs) },
        refresh() { failures = 0; void load(); schedulePoll() },
        create(fields) {
          const title = String(fields.title || '').trim()
          if (!title) return Promise.resolve(null)
          const input = { action: 'create', ...fields, title }
          if (input.dueDate && input.dueTime && input.alertAt === undefined) input.alertAt = instantOf(input.dueDate, input.dueTime)
          return mutate(input)
        },
        update(id, patch) {
          const old = item(id)
          if (!old) return Promise.resolve(null)
          const input = { action: 'update', id, ...patch }
          if ('dueDate' in patch || 'dueTime' in patch) {
            const dueDate = 'dueDate' in patch ? patch.dueDate : old.dueDate, dueTime = dueDate === null ? null : 'dueTime' in patch ? patch.dueTime : old.dueTime
            Object.assign(input, { dueDate, dueTime, alertAt: dueDate && dueTime ? instantOf(dueDate, dueTime) : null })
          }
          const local = { ...patch }
          if ('dueDate' in input) Object.assign(local, { dueDate: input.dueDate, dueTime: input.dueTime, alertAt: input.alertAt, alerted: input.alertAt === null ? false : input.alertAt < now() - 60000 })
          return mutate(input, current => ({ items: current.items.map(row => row.id === id ? { ...row, ...local } : row) }))
        },
        toggle(id) {
          const old = item(id)
          if (!old) return Promise.resolve(null)
          const completed = !old.completed, at = now()
          return mutate({ action: 'complete', id, completed }, current => ({
            items: current.items.map(row => row.id === id ? { ...row, completed, completedAt: completed ? at : null } : row),
            recentDone: completed ? { ...current.recentDone, [id]: true } : current.recentDone,
          }))
        },
        remove(id) { return mutate({ action: 'delete', id }, current => ({ items: current.items.filter(row => row.id !== id) })) },
        createList(fields) { return mutate({ action: 'createList', ...fields }) },
        updateList(listId, patch) { return mutate({ action: 'updateList', listId, ...patch }, current => ({ lists: current.lists.map(list => list.id === listId ? { ...list, ...patch } : list) })) },
        deleteList(listId) {
          return mutate({ action: 'deleteList', listId }, current => ({ lists: current.lists.filter(list => list.id !== listId), items: current.items.filter(row => row.listId !== listId), view: current.view.kind === 'list' && current.view.id === listId ? { kind: 'smart', id: 'today' } : current.view }))
        },
        async snooze(id, minutes = 10) { api.dismissAlert(id); return mutate({ action: 'snooze', id, minutes }) },
        async completeAlert(id) { api.dismissAlert(id); const old = item(id); if (old && !old.completed) return api.toggle(id); return null },
        dismissAlert(id) { set(current => ({ alerts: current.alerts.filter(alert => alert.id !== id) })) },
        setView(view) { set({ view, query: view.kind === 'search' ? view.query : '', recentDone: {}, showCompleted: false }) },
        setQuery(query) { set(current => ({ query, view: query.trim() ? { kind: 'search', query } : current.view.kind === 'search' ? { kind: 'smart', id: 'today' } : current.view })) },
        toggleShowCompleted() { set(current => ({ showCompleted: !current.showCompleted })) },
        clearError() { set({ error: '' }) },
        claim,
        dispose() { disposed = true; lifetime.abort(); clearTimer(pollTimer); clearTimer(tickTimer); listeners.clear() },
      }
      return api
    }

    // ----- Presentation -----
    const CSS = `
.dtd-root{--dtd-blue:#007AFF;--dtd-red:#FF3B30;--dtd-orange:#FF9500;--dtd-line:var(--dsw-alias-border-l1,rgba(60,60,67,.14));--dtd-muted:var(--dsw-alias-label-secondary,#8a8a8e);--dtd-ring:#C7C7CC;color:var(--dsw-alias-label-primary,#1c1c1e);font:14px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",system-ui,sans-serif;box-sizing:border-box;min-width:0}
.dtd-root *{box-sizing:border-box}.dtd-root :where(button,input,textarea,select){font:inherit;color:inherit}.dtd-root :where(button){cursor:pointer}.dtd-root :where(button:disabled){cursor:default;opacity:.5}
.dtd-root :is(button,input,textarea,select):focus-visible{outline:2px solid color-mix(in srgb,var(--dtd-blue) 55%,transparent);outline-offset:2px}
.dtd-page{display:flex;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff)}
.dtd-nav{width:330px;flex:none;display:flex;flex-direction:column;gap:16px;overflow:auto;background:var(--dsw-alias-bg-layer-1,#f7f7f8);border-right:1px solid var(--dtd-line);padding:calc(var(--dsh-frame-top-clearance,0px) + 18px) 16px 20px}
.dtd-search{display:flex;align-items:center;gap:7px;height:36px;padding:0 10px;border-radius:10px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dtd-line);color:var(--dtd-muted)}
.dtd-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary,#1c1c1e)}.dtd-search input::placeholder{color:var(--dtd-muted)}
.dtd-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dtd-tile{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;align-items:center;gap:8px 6px;padding:10px 12px 9px;text-align:left;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dtd-line);border-radius:12px;min-height:76px}
.dtd-tile[data-wide=true]{grid-column:1/-1;grid-template-rows:auto;min-height:0;grid-template-columns:auto 1fr;gap:12px}
.dtd-tile[aria-pressed=true]{background:color-mix(in srgb,var(--dtd-blue) 11%,var(--dsw-alias-bg-base,#fff));border-color:color-mix(in srgb,var(--dtd-blue) 32%,transparent)}
.dtd-tile:hover{border-color:color-mix(in srgb,var(--dtd-blue) 24%,var(--dtd-line))}
.dtd-tile-count{justify-self:end;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.dtd-tile-label{grid-column:1/-1;font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary,#636366)}.dtd-tile[data-wide=true] .dtd-tile-label{grid-column:auto}
.dtd-dot{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:50%;color:#fff}
.dtd-h2{margin:6px 2px 0;font-size:18px;font-weight:700}
.dtd-group{list-style:none;margin:0;padding:0;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dtd-line);border-radius:12px;overflow:hidden}
.dtd-listrow{display:flex;align-items:center;gap:12px;padding:0 0 0 12px;position:relative}
.dtd-listrow>button.dtd-listmain{flex:1;min-width:0;display:flex;align-items:center;gap:12px;border:0;background:transparent;padding:0;text-align:left}
.dtd-listrow-body{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:50px;padding-right:12px;border-top:1px solid var(--dtd-line)}.dtd-listrow:first-child .dtd-listrow-body{border-top:0}
.dtd-listrow[data-active=true]{background:var(--dsw-alias-bg-layer-2,#efeff2)}
.dtd-listname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.dtd-listcount{color:var(--dtd-muted);font-variant-numeric:tabular-nums}
.dtd-listedit{opacity:0;border:0;background:transparent;color:var(--dtd-muted);width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center}.dtd-listrow:hover .dtd-listedit,.dtd-listedit:focus-visible{opacity:1}.dtd-listedit:hover{background:var(--dsw-alias-bg-layer-2,#efeff2)}
.dtd-addlink{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--dtd-blue);font-size:15px;padding:4px 2px;align-self:flex-start}
.dtd-editor-card{padding:12px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dtd-line);border-radius:12px;display:flex;flex-direction:column;gap:10px}
.dtd-field{width:100%;min-width:0;border:1px solid var(--dtd-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);padding:6px 9px}
.dtd-swatches{display:flex;flex-wrap:wrap;gap:7px}.dtd-swatch{width:22px;height:22px;border-radius:50%;border:2px solid transparent;padding:0}.dtd-swatch[aria-pressed=true]{box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#fff),0 0 0 4px currentColor}
.dtd-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.dtd-btn{border:1px solid var(--dtd-line);background:transparent;border-radius:8px;padding:4px 10px;font-size:13px}.dtd-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#efeff2)}.dtd-btn-primary{color:var(--dtd-blue);border-color:color-mix(in srgb,var(--dtd-blue) 40%,transparent)}.dtd-btn-danger{color:var(--dtd-red)}.dtd-spacer{flex:1}
.dtd-main{flex:1;min-width:0;overflow:auto;padding:calc(var(--dsh-frame-top-clearance,0px) + 18px) 34px 48px}
.dtd-main-head{display:flex;align-items:flex-end;gap:12px;margin:6px 0 6px}.dtd-main-title{margin:0;font-size:34px;font-weight:700;letter-spacing:-.01em;line-height:1.15;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtd-main-count{font-size:34px;line-height:1.15;color:var(--dsw-alias-label-tertiary,#c7c7cc);font-weight:500;font-variant-numeric:tabular-nums}
.dtd-toolbar{display:flex;justify-content:flex-end;gap:4px;min-height:28px;margin-right:-6px}.dtd-quiet{border:0;background:transparent;color:var(--dtd-muted);border-radius:7px;padding:4px 8px;font-size:13px;display:inline-flex;align-items:center;gap:5px}.dtd-quiet:hover{background:var(--dsw-alias-bg-layer-2,#efeff2);color:var(--dsw-alias-label-primary,#1c1c1e)}
.dtd-section{margin-top:16px}.dtd-section-title{margin:0 0 2px;font-size:16px;font-weight:700;color:var(--dsw-alias-label-secondary,#636366)}
.dtd-rows{list-style:none;margin:0;padding:0}
.dtd-row{display:flex;gap:12px;align-items:flex-start;padding-top:9px}
.dtd-check{flex:none;width:22px;height:22px;margin-top:1px;border-radius:50%;border:1.5px solid var(--dtd-ring);background:transparent;padding:0;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .15s,border-color .15s}
.dtd-check:hover{border-color:var(--dtd-c,var(--dtd-blue))}.dtd-check[aria-checked=true]{background:var(--dtd-c,var(--dtd-blue));border-color:var(--dtd-c,var(--dtd-blue))}
.dtd-row-body{flex:1;min-width:0;padding-bottom:9px;border-bottom:1px solid var(--dtd-line);display:flex;gap:8px}.dtd-row-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dtd-title-input{width:100%;border:0;outline:0;background:transparent;padding:0;font-size:15px;line-height:1.45;text-overflow:ellipsis}.dtd-row[data-done=true] .dtd-title-input{color:var(--dtd-muted)}
.dtd-notes{font-size:13px;color:var(--dtd-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dtd-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:13px;color:var(--dtd-muted)}.dtd-meta [data-late=true]{color:var(--dtd-red)}
.dtd-chip{display:inline-flex;align-items:center;gap:4px;max-width:220px;border:0;border-radius:6px;padding:1px 7px;background:var(--dsw-alias-bg-layer-2,#efeff2);color:var(--dsw-alias-label-secondary,#636366);font-size:12px}.dtd-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dtd-chip:hover{color:var(--dtd-blue)}
.dtd-row-side{display:flex;align-items:flex-start;gap:4px;padding-top:2px}.dtd-flag{color:var(--dtd-orange)}
.dtd-info{opacity:0;border:0;background:transparent;color:var(--dtd-blue);width:22px;height:22px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center}.dtd-row:hover .dtd-info,.dtd-row:focus-within .dtd-info,.dtd-info[aria-expanded=true]{opacity:1}
.dtd-details{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px 10px;align-items:center;margin:8px 0 4px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#f7f7f8);font-size:13px}
.dtd-details label{color:var(--dtd-muted)}.dtd-details textarea{resize:vertical;min-height:52px}.dtd-inline{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.dtd-inline .dtd-field{width:auto}
.dtd-switch{position:relative;width:38px;height:22px;border-radius:11px;border:0;background:var(--dsw-alias-bg-layer-3,#d1d1d6);padding:0}.dtd-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}.dtd-switch[aria-checked=true]{background:var(--dtd-orange)}.dtd-switch[aria-checked=true]::after{left:18px}
.dtd-new{display:flex;align-items:center;gap:12px;padding-top:9px}.dtd-new .dtd-check{border-style:solid}.dtd-new-input{flex:1;min-width:0;border:0;outline:0;background:transparent;padding:0 0 9px;border-bottom:1px solid var(--dtd-line);font-size:15px}
.dtd-newbtn{display:inline-flex;align-items:center;gap:10px;border:0;background:transparent;color:var(--dtd-blue);font-size:15px;padding:12px 0 6px}
.dtd-empty{margin:48px 0 0;text-align:center;color:var(--dtd-muted);font-size:15px}
.dtd-banner{margin:10px 0 0;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f7f7f8);border:1px solid var(--dtd-line);font-size:13px;display:flex;gap:10px;align-items:center;color:var(--dtd-muted)}
@media(max-width:760px){.dtd-page{flex-direction:column;overflow:auto}.dtd-nav{width:auto;border-right:0;border-bottom:1px solid var(--dtd-line);overflow:visible}.dtd-main{overflow:visible;padding:18px}}
/* Right-side card */
.dtd-card{width:100%;padding:12px 12px 8px;background:var(--dsw-alias-bg-layer-1,#fff);border:.5px solid var(--dsw-alias-border-l3,var(--dtd-line));border-radius:var(--dsw-radius-xl,16px);overflow:hidden}
.dtd-card-head{display:flex;align-items:center;gap:8px;min-height:30px}.dtd-card-title{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;border:0;background:transparent;padding:0;text-align:left}
.dtd-pill{border:0;border-radius:999px;padding:1px 9px;background:color-mix(in srgb,var(--dtd-blue) 12%,transparent);color:var(--dtd-blue);font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
.dtd-icon{border:0;background:transparent;color:var(--dtd-muted);width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;padding:0}.dtd-icon:hover{background:var(--dsw-alias-bg-layer-2,#efeff2);color:var(--dsw-alias-label-primary,#1c1c1e)}
.dtd-card .dtd-rows{max-height:min(40vh,330px);overflow:auto;overscroll-behavior:contain;margin-top:2px}.dtd-card .dtd-row{padding-top:7px}.dtd-card .dtd-row-body{padding-bottom:7px}.dtd-card .dtd-title-input{font-size:14px}.dtd-card .dtd-meta{font-size:12px}.dtd-card .dtd-check{width:20px;height:20px}.dtd-card .dtd-details{grid-template-columns:56px minmax(0,1fr);padding:8px}
.dtd-card .dtd-newbtn{font-size:14px;padding:9px 0 4px}.dtd-card .dtd-new-input{font-size:14px}.dtd-card-empty{margin:8px 0 2px;color:var(--dtd-muted);font-size:12px}
.dtd-card-foot{display:flex;align-items:center;gap:8px;margin-top:6px;padding-top:7px;border-top:1px solid var(--dtd-line);font-size:12px;color:var(--dtd-muted)}.dtd-card-foot span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtd-card-foot button{border:0;background:transparent;color:var(--dtd-muted);display:inline-flex;align-items:center;gap:2px;padding:2px 0;font-size:12px}.dtd-card-foot button:hover{color:var(--dsw-alias-label-primary,#1c1c1e)}
.dtd-error{color:var(--dtd-red);font-size:12px;display:flex;align-items:center;gap:8px;margin-top:6px}
/* Due banners */
.dtd-toasts{position:fixed;z-index:2147483000;top:calc(var(--dsh-frame-top-clearance,0px) + 12px);left:50%;transform:translateX(-50%);width:min(380px,calc(100vw - 24px));display:flex;flex-direction:column;gap:8px;pointer-events:none}
.dtd-toast{pointer-events:auto;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 10px;padding:12px 12px 10px 14px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,transparent);border:1px solid var(--dtd-line);box-shadow:0 10px 30px rgba(0,0,0,.14);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%);animation:dtd-in .22s ease-out}
.dtd-toast-icon{grid-row:1/3;width:34px;height:34px;border-radius:9px;background:var(--dtd-blue);color:#fff;display:flex;align-items:center;justify-content:center}
.dtd-toast-kicker{font-size:12px;color:var(--dtd-muted)}.dtd-toast-title{grid-column:2/4;font-weight:600;font-size:14px;overflow-wrap:anywhere}.dtd-toast .dtd-actions{grid-column:2/4;margin-top:4px}
@keyframes dtd-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.dtd-toast{animation:none}.dtd-check,.dtd-switch::after{transition:none}}
`
    const PATHS = {
      checklist: ['M10 6h10', 'M10 12h10', 'M10 18h10', 'm3.5 6 1.5 1.5L7.5 5', 'm3.5 12 1.5 1.5 2.5-2.5', 'M4 18h2'],
      plus: ['M12 5v14', 'M5 12h14'], plusCircle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 8v8', 'M8 12h8'],
      chevron: ['m9 6 6 6-6 6'], search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13', 'm15.5 15.5 4.5 4.5'],
      calendar: ['M5 6h14v13H5z', 'M5 10h14', 'M9 4v4', 'M15 4v4'], calendarGrid: ['M5 6h14v13H5z', 'M5 10h14', 'M9 4v4', 'M15 4v4', 'M8.5 13.5h1', 'M11.5 13.5h1', 'M14.5 13.5h1', 'M8.5 16.5h1', 'M11.5 16.5h1'],
      tray: ['M4 13h4l1.5 2.5h5L16 13h4', 'M4 13 6.5 6h11L20 13v5H4z'], flag: ['M6 21V4', 'M6 4h11l-2 4 2 4H6'],
      check: ['m5.5 12.5 4 4 9-9'], info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v5', 'M12 8h.01'],
      chat: ['M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5Z'],
      close: ['m6 6 12 12', 'M18 6 6 18'], bullets: ['M10 7h9', 'M10 12h9', 'M10 17h9', 'M5.5 7h.01', 'M5.5 12h.01', 'M5.5 17h.01'],
      more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'], eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5'],
      bell: ['M9 20a3 3 0 0 0 6 0', 'M5 17h14c-2-2-2-4-2-7a5 5 0 0 0-10 0c0 3 0 5-2 7Z'],
    }
    function Icon({ kind, size = 18, width = 1.7, fill }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        (PATHS[kind] || PATHS.checklist).map((d, i) => h('path', { key: i, d, fill: fill && i === (kind === 'flag' ? 1 : 0) ? fill : 'none' })))
    }
    function Dot({ color, glyph, size = 28 }) {
      return h('span', { className: 'dtd-dot', style: { width: size, height: size, background: color } }, h(Icon, { kind: glyph, size: Math.round(size * 0.58), width: 2.2, fill: glyph === 'flag' ? '#fff' : undefined }))
    }
    function Style() { return h('style', { dangerouslySetInnerHTML: { __html: CSS } }) }
    function useStore(store) { return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) }
    function useLanguage(locale) {
      React.useSyncExternalStore(callback => locale?.subscribe ? locale.subscribe(callback) : () => {}, () => locale?.getSnapshot?.().revision ?? 0, () => 0)
      return locale?.getSnapshot?.().active
    }
    const composing = event => event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229

    /** Commits on Enter or blur; Escape restores. Keeps typing undisturbed by background refreshes. */
    function TitleInput({ value, onCommit, label, className = 'dtd-title-input' }) {
      const [draft, setDraft] = React.useState(value), focused = React.useRef(false)
      React.useEffect(() => { if (!focused.current) setDraft(value) }, [value])
      const commit = () => { const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value) }
      return h('input', { className, value: draft, 'aria-label': label, title: value, onChange: event => setDraft(event.target.value),
        onFocus: () => { focused.current = true }, onBlur: () => { focused.current = false; commit() },
        onKeyDown: event => { if (composing(event)) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } else if (event.key === 'Escape') { event.preventDefault(); setDraft(value); focused.current = false; event.currentTarget.blur() } } })
    }
    function Details({ item, store, lists, t, currentSessionId, openSession }) {
      const [notes, setNotes] = React.useState(item.notes)
      React.useEffect(() => setNotes(item.notes), [item.notes])
      const today = localDate()
      return h('div', { className: 'dtd-details' },
        h('label', { htmlFor: `dtd-notes-${item.id}` }, t('notes')),
        h('textarea', { id: `dtd-notes-${item.id}`, className: 'dtd-field', value: notes, rows: 2, onChange: event => setNotes(event.target.value), onBlur: () => { if (notes !== item.notes) void store.update(item.id, { notes }) } }),
        h('label', null, t('date')),
        h('div', { className: 'dtd-inline' },
          h('input', { type: 'date', className: 'dtd-field', 'aria-label': t('date'), value: item.dueDate || '', onChange: event => void store.update(item.id, { dueDate: event.target.value || null }) }),
          h('input', { type: 'time', className: 'dtd-field', 'aria-label': t('time'), value: item.dueTime || '', onChange: event => void store.update(item.id, { dueDate: item.dueDate || today, dueTime: event.target.value || null }) }),
          item.dueDate ? h('button', { type: 'button', className: 'dtd-quiet', onClick: () => void store.update(item.id, { dueDate: null }) }, t('clear')) : null),
        h('label', null, t('flag')),
        h('div', null, h('button', { type: 'button', role: 'switch', className: 'dtd-switch', 'aria-checked': item.flagged, 'aria-label': t('flag'), onClick: () => void store.update(item.id, { flagged: !item.flagged }) })),
        h('label', { htmlFor: `dtd-list-${item.id}` }, t('list')),
        h('select', { id: `dtd-list-${item.id}`, className: 'dtd-field', value: item.listId, onChange: event => void store.update(item.id, { listId: event.target.value }) }, lists.map(list => h('option', { key: list.id, value: list.id }, list.name))),
        h('label', null, t('session')),
        h('div', { className: 'dtd-inline' },
          item.sessionId ? h(React.Fragment, null,
            h('button', { type: 'button', className: 'dtd-chip', onClick: () => openSession(item.sessionId), title: t('openSession') }, h(Icon, { kind: 'chat', size: 13 }), h('span', null, item.sessionTitle || t('linkedSession'))),
            h('button', { type: 'button', className: 'dtd-quiet', onClick: () => void store.update(item.id, { sessionId: null }) }, t('unlink'))) : null,
          !item.sessionId && currentSessionId ? h('button', { type: 'button', className: 'dtd-btn', onClick: () => void store.update(item.id, { sessionId: currentSessionId }) }, t('linkCurrent')) : null,
          !item.sessionId && !currentSessionId ? h('span', { style: { color: 'var(--dtd-muted)' } }, '—') : null),
        h('span'),
        h('div', { className: 'dtd-actions' }, h('button', { type: 'button', className: 'dtd-btn dtd-btn-danger', onClick: () => void store.remove(item.id) }, t('delete'))))
    }
    function ReminderRow({ item, list, lists, store, t, lang, today, compact, showList, expanded, onExpand, currentSessionId, openSession }) {
      const due = dueText(item, today, t, lang, compact), late = overdue(item)
      const color = HEX[list?.color] || HEX.blue
      return h('li', { className: 'dtd-row', 'data-done': item.completed, 'data-reminder': item.id },
        h('button', { type: 'button', role: 'checkbox', className: 'dtd-check', style: { '--dtd-c': color }, 'aria-checked': item.completed, 'aria-label': `${t(item.completed ? 'markUndone' : 'markDone')}: ${item.title}`, onClick: () => void store.toggle(item.id) },
          item.completed ? h(Icon, { kind: 'check', size: 14, width: 2.6 }) : null),
        h('div', { className: 'dtd-row-body' },
          h('div', { className: 'dtd-row-text' },
            h(TitleInput, { value: item.title, label: item.title, onCommit: title => void store.update(item.id, { title }) }),
            !compact && item.notes && !expanded ? h('div', { className: 'dtd-notes' }, item.notes) : null,
            due || item.sessionId || showList ? h('div', { className: 'dtd-meta' },
              due ? h('span', { 'data-late': late }, due) : null,
              showList && list ? h('span', null, list.name) : null,
              item.sessionId ? h('button', { type: 'button', className: 'dtd-chip', title: `${t('openSession')}: ${item.sessionTitle || t('linkedSession')}`, onClick: () => openSession(item.sessionId) }, h(Icon, { kind: 'chat', size: 13 }), h('span', null, item.sessionTitle || t('linkedSession'))) : null) : null,
            expanded ? h(Details, { item, store, lists, t, currentSessionId, openSession }) : null),
          h('div', { className: 'dtd-row-side' },
            h('button', { type: 'button', className: 'dtd-info', 'aria-expanded': expanded, 'aria-label': t(expanded ? 'closeDetails' : 'details'), title: t(expanded ? 'closeDetails' : 'details'), onClick: onExpand }, h(Icon, { kind: 'info', size: 18 })),
            item.flagged ? h('span', { className: 'dtd-flag', title: t('flagged') }, h(Icon, { kind: 'flag', size: 17, fill: 'currentColor' })) : null)))
    }
    /** Enter keeps the row open for the next reminder, as on iOS. */
    function NewReminder({ store, defaults, t, openSignal = 0 }) {
      const [open, setOpen] = React.useState(false), [title, setTitle] = React.useState(''), input = React.useRef(null)
      React.useEffect(() => { if (openSignal) setOpen(true) }, [openSignal])
      React.useEffect(() => { if (open) input.current?.focus() }, [open])
      const submit = async keepOpen => {
        const value = title.trim()
        if (!value) { if (!keepOpen) setOpen(false); return }
        setTitle('')
        await store.create({ ...defaults, title: value })
        if (!keepOpen) setOpen(false)
      }
      if (!open) return h('button', { type: 'button', className: 'dtd-newbtn', onClick: () => setOpen(true) }, h(Icon, { kind: 'plusCircle', size: 22, width: 1.8 }), t('newReminder'))
      return h('div', { className: 'dtd-new' }, h('span', { className: 'dtd-check', 'aria-hidden': true }),
        h('input', { ref: input, className: 'dtd-new-input', value: title, placeholder: t('newPlaceholder'), 'aria-label': t('newReminder'), onChange: event => setTitle(event.target.value),
          onBlur: () => void submit(false), onKeyDown: event => { if (composing(event)) return; if (event.key === 'Enter') { event.preventDefault(); void submit(true) } else if (event.key === 'Escape') { event.preventDefault(); setTitle(''); setOpen(false) } } }))
    }
    function ListEditor({ list, store, t, count, onDone, canDelete }) {
      const [name, setName] = React.useState(list?.name || ''), [color, setColor] = React.useState(list?.color || 'blue'), [confirm, setConfirm] = React.useState(false)
      const save = async () => {
        const value = name.trim()
        if (!value) return
        const result = list ? await store.updateList(list.id, { name: value, color }) : await store.createList({ name: value, color })
        if (result) onDone(list ? list.id : result.list?.id)
      }
      return h('div', { className: 'dtd-editor-card' },
        h('input', { className: 'dtd-field', autoFocus: true, value: name, maxLength: 60, placeholder: t('listName'), 'aria-label': t('listName'), onChange: event => setName(event.target.value),
          onKeyDown: event => { if (composing(event)) return; if (event.key === 'Enter') { event.preventDefault(); void save() } else if (event.key === 'Escape') { event.preventDefault(); onDone() } } }),
        h('div', { className: 'dtd-swatches', role: 'group', 'aria-label': t('color') }, COLORS.map(key => h('button', { key, type: 'button', className: 'dtd-swatch', 'aria-pressed': color === key, 'aria-label': key, style: { background: HEX[key], color: HEX[key] }, onClick: () => setColor(key) }))),
        h('div', { className: 'dtd-actions' },
          list ? h('button', { type: 'button', className: 'dtd-btn dtd-btn-danger', disabled: !canDelete, title: canDelete ? undefined : t('lastList'), onClick: () => { if (!confirm) setConfirm(true); else void store.deleteList(list.id).then(() => onDone()) } }, confirm ? t('confirmDeleteList', { count }) : t('deleteList')) : null,
          h('span', { className: 'dtd-spacer' }),
          h('button', { type: 'button', className: 'dtd-btn', onClick: () => onDone() }, t('cancel')),
          h('button', { type: 'button', className: 'dtd-btn dtd-btn-primary', disabled: !name.trim(), onClick: () => void save() }, t('save'))))
    }
    function viewTitle(view, state, t) {
      if (view.kind === 'search') return { title: t('searchResults'), color: 'inherit' }
      if (view.kind === 'list') { const list = state.lists.find(row => row.id === view.id); return { title: list?.name || '', color: HEX[list?.color] || HEX.blue } }
      return { title: t(view.id), color: TITLE_COLOR[view.id] || 'inherit' }
    }
    function TodoPage({ store, t, locale, currentSession, openSession }) {
      const state = useStore(store), lang = useLanguage(locale)
      const [expanded, setExpanded] = React.useState(null), [listEditor, setListEditor] = React.useState(null)
      const today = localDate(state.minute * 60000 || Date.now())
      const c = counts(state, today), view = state.view
      React.useEffect(() => { setExpanded(null) }, [view.kind, view.id])
      const sections = state.status === 'ready' ? sectionsFor(state, view, { today, lang, t }) : []
      const visible = sections.reduce((sum, section) => sum + section.items.filter(item => !item.completed).length, 0)
      const heading = viewTitle(view, state, t), lists = new Map(state.lists.map(list => [list.id, list]))
      const sessionId = currentSession()
      const showList = view.kind === 'smart' && view.id !== 'all' && state.lists.length > 1
      return h('div', { className: 'dtd-root dtd-page', 'data-todo-page': '' }, h(Style),
        h('nav', { className: 'dtd-nav', 'aria-label': t('title') },
          h('label', { className: 'dtd-search' }, h(Icon, { kind: 'search', size: 16 }), h('input', { type: 'search', value: state.query, placeholder: t('search'), 'aria-label': t('search'), onChange: event => store.setQuery(event.target.value) })),
          h('div', { className: 'dtd-tiles' }, SMART.map(tile => h('button', { key: tile.id, type: 'button', className: 'dtd-tile', 'data-wide': !!tile.wide, 'aria-pressed': view.kind === 'smart' && view.id === tile.id, onClick: () => store.setView({ kind: 'smart', id: tile.id }) },
            h(Dot, { color: tile.color, glyph: tile.glyph, size: 30 }), tile.wide ? null : h('span', { className: 'dtd-tile-count' }, c[tile.id]), h('span', { className: 'dtd-tile-label' }, t(tile.id))))),
          h('h2', { className: 'dtd-h2' }, t('myLists')),
          h('ul', { className: 'dtd-group' }, state.lists.map(list => listEditor === list.id
            ? h('li', { key: list.id, style: { padding: 6 } }, h(ListEditor, { list, store, t, count: state.items.filter(item => item.listId === list.id).length, canDelete: state.lists.length > 1, onDone: () => setListEditor(null) }))
            : h('li', { key: list.id, className: 'dtd-listrow', 'data-active': view.kind === 'list' && view.id === list.id },
              h('button', { type: 'button', className: 'dtd-listmain', onClick: () => store.setView({ kind: 'list', id: list.id }), onDoubleClick: () => setListEditor(list.id) },
                h(Dot, { color: HEX[list.color], glyph: 'bullets', size: 28 }),
                h('span', { className: 'dtd-listrow-body' }, h('span', { className: 'dtd-listname' }, list.name), h('span', { className: 'dtd-listcount' }, c.lists[list.id] || 0))),
              h('button', { type: 'button', className: 'dtd-listedit', 'aria-label': `${t('editList')}: ${list.name}`, title: t('editList'), onClick: () => setListEditor(list.id) }, h(Icon, { kind: 'more', size: 18, width: 2.6 }))))),
          listEditor === 'new' ? h(ListEditor, { store, t, onDone: id => { setListEditor(null); if (id) store.setView({ kind: 'list', id }) } })
            : h('button', { type: 'button', className: 'dtd-addlink', onClick: () => setListEditor('new') }, h(Icon, { kind: 'plusCircle', size: 20 }), t('addList'))),
        h('main', { className: 'dtd-main', 'aria-label': heading.title },
          h('div', { className: 'dtd-toolbar' }, view.kind === 'smart' && view.id === 'completed' ? null : h('button', { type: 'button', className: 'dtd-quiet', onClick: () => store.toggleShowCompleted() }, h(Icon, { kind: 'eye', size: 15 }), t(state.showCompleted ? 'hideCompleted' : 'showCompleted'))),
          h('div', { className: 'dtd-main-head' }, h('h1', { className: 'dtd-main-title', style: { color: heading.color } }, heading.title), view.id === 'completed' ? null : h('span', { className: 'dtd-main-count', 'aria-label': t('items', { count: visible }) }, visible)),
          state.status === 'loading' ? h('p', { className: 'dtd-empty', role: 'status' }, t('loading')) : null,
          state.status === 'error' ? h('div', { className: 'dtd-banner', role: 'alert' }, t('loadFailure'), h('button', { type: 'button', className: 'dtd-btn', onClick: () => store.refresh() }, t('retry'))) : null,
          state.offline && state.status === 'ready' ? h('div', { className: 'dtd-banner', role: 'status' }, t('offline')) : null,
          state.error && state.status === 'ready' ? h('div', { className: 'dtd-banner', role: 'alert' }, t('failure'), h('button', { type: 'button', className: 'dtd-btn', onClick: () => store.clearError() }, t('dismiss'))) : null,
          sections.map(section => h('section', { key: section.key, className: 'dtd-section' },
            section.title ? h('h3', { className: 'dtd-section-title', style: section.color ? { color: section.color } : undefined }, section.title) : null,
            h('ul', { className: 'dtd-rows' }, section.items.map(item => h(ReminderRow, { key: item.id, item, list: lists.get(item.listId), lists: state.lists, store, t, lang, today, showList, expanded: expanded === item.id, onExpand: () => setExpanded(value => value === item.id ? null : item.id), currentSessionId: sessionId, openSession }))))),
          state.status === 'ready' && !sections.length ? h('p', { className: 'dtd-empty' }, t(view.kind === 'search' ? 'emptySearch' : view.id === 'today' ? 'emptyToday' : 'emptyView')) : null,
          state.status === 'ready' && view.kind !== 'search' && view.id !== 'completed' ? h(NewReminder, { key: `${view.kind}:${view.id}`, store, t, defaults: defaultsFor(view, state, today) }) : null))
    }
    function todayItems(state, today) {
      return state.items.filter(item => inView(item, 'today', today) || (item.completed && state.recentDone[item.id] && item.dueDate && item.dueDate <= today))
        .sort(compareDue)
    }
    function TodoCard({ sessionId, store, t, locale, openPage, openSession }) {
      const state = useStore(store), lang = useLanguage(locale)
      const [expanded, setExpanded] = React.useState(null), [openSignal, setOpenSignal] = React.useState(0)
      const today = localDate(state.minute * 60000 || Date.now()), c = counts(state, today)
      const items = todayItems(state, today), lists = new Map(state.lists.map(list => [list.id, list]))
      return h('section', { className: 'dtd-root dtd-card', 'data-todo-card': '', 'aria-label': t('title') }, h(Style),
        h('div', { className: 'dtd-card-head' },
          h('button', { type: 'button', className: 'dtd-card-title', onClick: () => openPage({ kind: 'smart', id: 'today' }), title: t('openTodo') }, h(Icon, { kind: 'checklist', size: 20 }), t('title')),
          h('button', { type: 'button', className: 'dtd-pill', onClick: () => openPage({ kind: 'smart', id: 'today' }) }, t('todayCount', { count: c.today })),
          h('button', { type: 'button', className: 'dtd-icon', 'aria-label': t('add'), title: t('add'), onClick: () => setOpenSignal(value => value + 1) }, h(Icon, { kind: 'plus', size: 18 })),
          h('button', { type: 'button', className: 'dtd-icon', 'aria-label': t('openTodo'), title: t('openTodo'), onClick: () => openPage({ kind: 'smart', id: 'today' }) }, h(Icon, { kind: 'chevron', size: 17 }))),
        state.status === 'loading' ? h('p', { className: 'dtd-card-empty', role: 'status' }, t('loading')) : null,
        state.status === 'error' ? h('div', { className: 'dtd-error', role: 'alert' }, t('loadFailure'), h('button', { type: 'button', className: 'dtd-btn', onClick: () => store.refresh() }, t('retry'))) : null,
        state.status === 'ready' && !items.length ? h('p', { className: 'dtd-card-empty' }, t('emptyCard')) : null,
        items.length ? h('ul', { className: 'dtd-rows' }, items.map(item => h(ReminderRow, { key: item.id, item, list: lists.get(item.listId), lists: state.lists, store, t, lang, today, compact: true, expanded: expanded === item.id, onExpand: () => setExpanded(value => value === item.id ? null : item.id), currentSessionId: sessionId, openSession }))) : null,
        state.status === 'ready' ? h(NewReminder, { store, t, openSignal, defaults: { dueDate: today, ...(sessionId ? { sessionId } : {}) } }) : null,
        state.error && state.status === 'ready' ? h('div', { className: 'dtd-error', role: 'alert' }, t('failure')) : null,
        h('div', { className: 'dtd-card-foot' }, h('span', null, state.offline ? t('offline') : t('footer', { all: c.all, scheduled: c.scheduled })),
          h('button', { type: 'button', onClick: () => openPage({ kind: 'smart', id: 'all' }) }, t('openTodo'), h(Icon, { kind: 'chevron', size: 14 }))))
    }
    function AlertToasts({ store, t, locale, openSession }) {
      const state = useStore(store), lang = useLanguage(locale), today = localDate(state.minute * 60000 || Date.now())
      if (!state.alerts.length) return null
      return h('div', { className: 'dtd-root dtd-toasts', role: 'region', 'aria-label': t('dueNow') }, h(Style),
        state.alerts.map(alert => h('div', { key: alert.id, className: 'dtd-toast', role: 'alert' },
          h('span', { className: 'dtd-toast-icon' }, h(Icon, { kind: 'checklist', size: 20, width: 2 })),
          h('span', { className: 'dtd-toast-kicker' }, `${t('title')} · ${dueText(alert, today, t, lang)}`),
          h('button', { type: 'button', className: 'dtd-icon', style: { width: 24, height: 24 }, 'aria-label': t('dismiss'), title: t('dismiss'), onClick: () => store.dismissAlert(alert.id) }, h(Icon, { kind: 'close', size: 14 })),
          h('div', { className: 'dtd-toast-title' }, alert.title),
          h('div', { className: 'dtd-actions' },
            h('button', { type: 'button', className: 'dtd-btn dtd-btn-primary', onClick: () => void store.completeAlert(alert.id) }, t('done')),
            h('button', { type: 'button', className: 'dtd-btn', onClick: () => void store.snooze(alert.id, 10) }, t('snooze')),
            alert.sessionId ? h('button', { type: 'button', className: 'dtd-btn', onClick: () => { store.dismissAlert(alert.id); openSession(alert.sessionId) } }, t('openSession')) : null))))
    }
    function systemNotifier(t) {
      return alert => {
        const N = globalThis.Notification
        if (!N || N.permission !== 'granted' || globalThis.document?.visibilityState !== 'hidden') return
        new N(t('title'), { body: alert.title, tag: `dsh-todo:${alert.id}` })
      }
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), `${NAME}: locale`)
      const t = ctx.locale.bind(NS)
      const transport = globalThis.__DSH_TRANSPORT__
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args)
      const store = createStore((input, signal) => requestJSON(fetchImpl, input, signal), { notify: systemNotifier(t) })
      ctx.effect(() => {
        store.start()
        const focus = () => store.refresh()
        globalThis.addEventListener?.('focus', focus)
        return () => { globalThis.removeEventListener?.('focus', focus); store.dispose() }
      }, `${NAME}: store`)
      const currentSession = () => { try { return ctx.uiSession?.current?.getSnapshot?.()?.key || null } catch { return null } }
      const openSession = id => { try { ctx.layout.selectPanel(null) } catch {} return ctx.uiWorkspace.openSession(id) }
      const openPage = view => { store.setView(view); ctx.layout.selectPanel(NAME) }
      const shared = () => ({ store, t, locale: ctx.locale, openSession, openPage, currentSession })
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NAME, order: 36, locale: NS, label: () => t('title') }, props => h(Icon, { kind: 'checklist', size: props.size || 18 }))), `${NAME}: entry`)
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NAME, locale: NS, inject: shared }, TodoPage)), `${NAME}: page`)
      ctx.effect(() => ctx.slots.inject(ACCESSORY, () => ctx.slots.register({ name: ACCESSORY, id: NAME, order: 60, locale: NS, label: () => t('title'), inject: shared }, TodoCard)), `${NAME}: card`)
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: `${NAME}.alerts`, order: 70, locale: NS, label: () => t('dueNow'), inject: shared }, AlertToasts)), `${NAME}: alerts`)
    }
    return { name: NAME, inject: ['slots', 'locale', 'uiWorkspace', 'layout', 'uiSession'], apply,
      __test: { createStore, requestJSON, sectionsFor, defaultsFor, counts, inView, overdue, dueText, dateLabel, localDate, addDays, instantOf, todayItems, eligibleAlert, TodoPage, TodoCard, AlertToasts, ZH, EN, CSS, HEX } }
  },
})
