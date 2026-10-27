/**
 * dsh-session-summary Client — a Codex-style pinned summary card.
 *
 * Hand-written classic-script ModuleLoader bundle (no build step). A toggle in
 * the conversation header's `utilities` seat opens a floating card rendered by
 * this plugin's `shell.overlay` entry, anchored below the conversation
 * header's right edge. Every value shown comes from data the native client
 * already holds (session list, projections, the Chat snapshot, jobs, the
 * Host's change summaries); every click navigates with native services.
 * Nothing is written to the session.
 *
 * Verified against the published DSH 0.2.1-rc.3 client APIs (see
 * docs/research). Following the DSH plugin guide, it requires only React:
 * host controls (icons, StateDot, Tooltip) are copied, not imported.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-summary',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NAME = 'dsh-session-summary'
    const NS = 'session-summary'
    const SLOT = 'conversation.session.header.utilities'
    const OVERLAY_SLOT = 'shell.overlay'
    const OVERLAY_ID = 'dsh-session-summary.card'
    const ENTRY_ID = 'dsh-session-summary.toggle'
    const STORAGE_KEY = 'dsh.session-summary.v1'
    const CARD_ID = 'dsh-session-summary-card'
    const EMPTY = Object.freeze([])
    const PREVIEW_LIMIT = 5
    const SECTION_IDS = Object.freeze(['changes', 'subagents', 'sources', 'plan', 'files', 'jobs', 'related'])

    // ------------------------------------------------------------------ copy
    const ZH = {
      'title': '会话摘要',
      'toggle.open': '显示会话摘要',
      'toggle.close': '隐藏会话摘要',
      'card.aria': '会话摘要',
      'pin': '固定摘要',
      'unpin': '取消固定',
      'pin.hint': '已固定：切换会话或刷新页面后仍会显示',
      'drag.hint': '拖动以移动摘要；聚焦后用方向键移动，Home 恢复位置',
      'position.reset': '靠边显示（避开正文）',
      'compact.expand': '展开摘要',
      'compact.collapse': '收起摘要',
      'more': '更多操作',
      'close': '关闭',
      'copyPath': '复制项目路径',
      'copied': '已复制项目路径',
      'openFiles': '在文件树中查看',
      'refresh': '刷新',
      'project.none': '未设置工作目录',
      'project.cwd': '当前目录：{path}',
      'section.changes': '变更',
      'section.subagents': '子智能体',
      'section.sources': '来源',
      'section.plan': '计划',
      'section.files': '生成文件',
      'section.jobs': '后台任务',
      'section.related': '关联会话',
      'section.collapse': '收起{name}',
      'section.expand': '展开{name}',
      'changes.empty': '本会话还没有记录到文件改动',
      'changes.loading': '正在读取改动…',
      'changes.missing': '{count} 轮的改动记录已不可用（DSH 重启后不保留）',
      'changes.error': '{count} 轮的改动读取失败',
      'changes.retry': '重试',
      'changes.count': '{count} 个文件',
      'changes.churn': '按轮次累加的增删行数，可能与净改动不同',
      'changes.binary': '二进制',
      'changes.oversized': '过大',
      'changes.open': '打开第 {turn} 轮的改动对比',
      'subagents.empty': '没有子智能体',
      'subagents.running': '{count} 运行中',
      'subagents.done': '{count} 完成',
      'subagents.idle': '{count} 未运行',
      'subagents.open': '在侧栏打开 {label}',
      'activity.running': '正在运行',
      'activity.completed': '已完成',
      'activity.inactive': '当前未运行',
      'mode.one-shot': '一次性',
      'mode.continuable': '可继续',
      'mode.unknown': '模式未知',
      'mode.external': '外部任务',
      'sources.empty': '还没有使用网页、MCP、技能或引用',
      'source.fetch': '已读取',
      'source.search': '搜索结果',
      'source.mcp': 'MCP',
      'source.skill': '技能',
      'source.file': '文件',
      'source.folder': '文件夹',
      'source.session': '会话',
      'source.calls': '{count} 次调用',
      'source.tools': '工具：{tools}',
      'plan.mode': '计划模式已开启',
      'plan.progress': '{done}/{total} 已完成',
      'plan.goal': '目标',
      'plan.submitted': '计划',
      'goal.active': '进行中',
      'goal.paused': '已暂停',
      'goal.complete': '已完成',
      'goal.completed': '已完成',
      'goal.blocked': '受阻',
      'todo.pending': '待处理',
      'todo.in_progress': '进行中',
      'todo.completed': '已完成',
      'jobs.running': '运行中',
      'jobs.stopping': '正在停止',
      'jobs.completed': '已完成',
      'jobs.killed': '已停止',
      'jobs.failed': '失败',
      'related.parent': '上级会话',
      'related.forkSource': '分支来源',
      'related.branchSource': '侧栏分支来源',
      'related.fork': '派生分支',
      'related.sideBranch': '侧栏分支',
      'related.archived': '已归档',
      'related.untitled': '未命名会话',
      'showAll': '查看全部（{count}）',
      'showMore': '再显示 {count} 项',
      'showLess': '收起',
      'partial': '仅统计已加载的记录',
      'loadOlder': '加载更早的记录',
      'loadingOlder': '正在加载…',
      'openFailed': '无法打开：{reason}',
      'duration.seconds': '{seconds}秒',
      'duration.minutes': '{minutes}分{seconds}秒',
      'duration.hours': '{hours}小时{minutes}分',
      'duration.days': '{days}天{hours}小时',
      'tokens.thousand': '{value}K',
      'tokens.million': '{value}M',
      'tokens.total': '{value} tok'
    }
    const EN = {
      'title': 'Session summary',
      'toggle.open': 'Show session summary',
      'toggle.close': 'Hide session summary',
      'card.aria': 'Session summary',
      'pin': 'Pin summary',
      'unpin': 'Unpin',
      'pin.hint': 'Pinned: stays open across session switches and reloads',
      'drag.hint': 'Drag to move summary; use arrow keys when focused, Home to reset',
      'position.reset': 'Dock beside conversation',
      'compact.expand': 'Expand summary',
      'compact.collapse': 'Collapse summary',
      'more': 'More actions',
      'close': 'Close',
      'copyPath': 'Copy project path',
      'copied': 'Project path copied',
      'openFiles': 'Show in file tree',
      'refresh': 'Refresh',
      'project.none': 'No working directory',
      'project.cwd': 'Current directory: {path}',
      'section.changes': 'Changes',
      'section.subagents': 'Subagents',
      'section.sources': 'Sources',
      'section.plan': 'Plan',
      'section.files': 'Generated files',
      'section.jobs': 'Background jobs',
      'section.related': 'Related sessions',
      'section.collapse': 'Collapse {name}',
      'section.expand': 'Expand {name}',
      'changes.empty': 'No file changes recorded in this session yet',
      'changes.loading': 'Reading changes…',
      'changes.missing': 'Change records for {count} turn(s) are no longer available (not kept across DSH restarts)',
      'changes.error': 'Failed to read changes for {count} turn(s)',
      'changes.retry': 'Retry',
      'changes.count': '{count} file(s)',
      'changes.churn': 'Line counts summed per turn; may differ from the net change',
      'changes.binary': 'binary',
      'changes.oversized': 'too large',
      'changes.open': 'Open the diff from turn {turn}',
      'subagents.empty': 'No subagents',
      'subagents.running': '{count} running',
      'subagents.done': '{count} done',
      'subagents.idle': '{count} not running',
      'subagents.open': 'Open {label} in sidebar',
      'activity.running': 'running',
      'activity.completed': 'completed',
      'activity.inactive': 'not running',
      'mode.one-shot': 'one-shot',
      'mode.continuable': 'continuable',
      'mode.unknown': 'unknown mode',
      'mode.external': 'external task',
      'sources.empty': 'No web pages, MCP tools, skills or references used yet',
      'source.fetch': 'read',
      'source.search': 'search result',
      'source.mcp': 'MCP',
      'source.skill': 'skill',
      'source.file': 'file',
      'source.folder': 'folder',
      'source.session': 'session',
      'source.calls': '{count} call(s)',
      'source.tools': 'Tools: {tools}',
      'plan.mode': 'Plan mode is on',
      'plan.progress': '{done}/{total} done',
      'plan.goal': 'Goal',
      'plan.submitted': 'Plan',
      'goal.active': 'active',
      'goal.paused': 'paused',
      'goal.complete': 'complete',
      'goal.completed': 'complete',
      'goal.blocked': 'blocked',
      'todo.pending': 'pending',
      'todo.in_progress': 'in progress',
      'todo.completed': 'completed',
      'jobs.running': 'running',
      'jobs.stopping': 'stopping',
      'jobs.completed': 'completed',
      'jobs.killed': 'stopped',
      'jobs.failed': 'failed',
      'related.parent': 'Parent session',
      'related.forkSource': 'Forked from',
      'related.branchSource': 'Side branch of',
      'related.fork': 'Fork',
      'related.sideBranch': 'Side branch',
      'related.archived': 'archived',
      'related.untitled': 'Untitled session',
      'showAll': 'Show all ({count})',
      'showMore': 'Show {count} more',
      'showLess': 'Show less',
      'partial': 'Counts cover loaded history only',
      'loadOlder': 'Load earlier history',
      'loadingOlder': 'Loading…',
      'openFailed': 'Cannot open: {reason}',
      'duration.seconds': '{seconds}s',
      'duration.minutes': '{minutes}m {seconds}s',
      'duration.hours': '{hours}h {minutes}m',
      'duration.days': '{days}d {hours}h',
      'tokens.thousand': '{value}K',
      'tokens.million': '{value}M',
      'tokens.total': '{value} tok'
    }

    // ------------------------------------------------------------ pure helpers
    function errorText(error) { return error instanceof Error ? error.message : String(error?.message ?? error) }
    function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
    function isHttpUrl(value) {
      if (typeof value !== 'string') return false
      try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' } catch { return false }
    }
    function hostOf(value) { try { return new URL(value).hostname.replace(/^www\./, '') } catch { return String(value ?? '') } }
    function basename(path) {
      if (typeof path !== 'string' || path === '') return ''
      const trimmed = path.replace(/[/\\]+$/, '')
      const parts = trimmed.split(/[/\\]/)
      return parts[parts.length - 1] || trimmed
    }
    /** Show paths inside the project relative to it; keep others as given. */
    function displayPath(cwd, path) {
      if (typeof path !== 'string') return ''
      const normalized = path.replace(/\\/g, '/')
      const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return normalized.slice(root.length + 1)
      return path
    }
    function textOf(content) {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      return content.map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')).filter(Boolean).join('\n')
    }
    function parseArgs(raw, fallback) {
      if (typeof raw === 'string' && raw !== '') {
        try { const parsed = JSON.parse(raw); if (isRecord(parsed)) return parsed } catch { /* streaming or malformed */ }
      }
      return isRecord(fallback) ? fallback : undefined
    }
    /** Normalize a Chat tool block (root or PTC sub-call) into one call record. */
    function callInfo(block) {
      if (!isRecord(block)) return null
      const settled = block.kind === 'tool-result'
      if (!settled && block.phase === 'preparing') return { name: typeof block.name === 'string' ? block.name : undefined, args: undefined, meta: undefined, settled: false, error: false, pending: true, callId: block.callId, subCalls: block.subCalls }
      const name = typeof block.name === 'string' && block.name ? block.name : (typeof block.call?.name === 'string' ? block.call.name : undefined)
      const args = parseArgs(block.argsRaw ?? block.call?.argsRaw, block.args)
      return { name, args, meta: settled && isRecord(block.meta) ? block.meta : undefined, settled, error: settled && (block.isError === true || block.error !== undefined && block.error !== null), pending: !settled, callId: block.callId, subCalls: block.subCalls }
    }
    const MCP_NAME = /^mcp__(.+?)__(.+)$/
    const MCP_RESOURCE_TOOLS = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])
    function parseMcpName(name) {
      if (typeof name !== 'string') return null
      const match = MCP_NAME.exec(name)
      return match ? { server: match[1], tool: match[2] } : null
    }
    // Same token grammar as the native @file source (dsh-client-ui-reference).
    const REFERENCE_TOKENS = /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu
    function fileReferences(text, excludeLabels = EMPTY) {
      if (typeof text !== 'string' || !text.includes('@')) return []
      let source = text
      for (const label of excludeLabels) if (typeof label === 'string' && label) source = source.split(`@${label}`).join(' ')
      const found = []
      for (const match of source.matchAll(REFERENCE_TOKENS)) {
        const raw = match[1]
        const quoted = raw.startsWith('@"')
        // Chinese prose often continues right after a path without a space:
        // full-width punctuation never belongs to the path.
        let path = quoted ? raw.slice(2, -1) : raw.slice(1).split(/[，。；：！？、（）【】「」『』]/u)[0].replace(/[.,;:!?)\]]+$/u, '')
        if (!path || path.startsWith('[')) continue
        // Plain words such as @someone are mentions, not paths.
        if (!quoted && !/[/\\.]/.test(path)) continue
        found.push({ path, folder: /[/\\]$/.test(path) })
      }
      return found
    }
    function goalPhase(goal) { return typeof goal?.goal?.phase === 'string' ? goal.goal.phase : typeof goal?.phase === 'string' ? goal.phase : undefined }
    function planTitle(markdown) {
      if (typeof markdown !== 'string') return ''
      const heading = markdown.split('\n').map((line) => line.trim()).find((line) => line !== '')
      return (heading ?? '').replace(/^#+\s*/, '').slice(0, 120)
    }

    const EMPTY_CHAT = Object.freeze({ web: EMPTY, mcp: EMPTY, skills: EMPTY, files: EMPTY, sessions: EMPTY, plans: EMPTY, presented: EMPTY, changeTurns: EMPTY, nodeCount: 0 })
    const chatCache = new WeakMap()
    /**
     * Derive every Chat-backed section from one immutable Chat snapshot. Node
     * and turn-data stores are identity-stable mutable stores, so results are
     * cached per snapshot object, never per store.
     */
    function deriveChat(snapshot) {
      if (!isRecord(snapshot) || !snapshot.nodes || typeof snapshot.nodes.values !== 'function') return EMPTY_CHAT
      const cached = chatCache.get(snapshot)
      if (cached) return cached
      const web = new Map()
      const searchTitles = new Map()
      const mcp = new Map()
      const skills = new Map()
      const files = new Map()
      const sessions = new Map()
      const plans = new Map()
      const presentedFromTool = new Map()
      let order = 0
      const addSkill = (name) => { if (typeof name === 'string' && name.trim() && !skills.has(name.trim())) skills.set(name.trim(), { kind: 'skill', name: name.trim(), order: order++ }) }
      const visitCall = (block, depth) => {
        const call = callInfo(block)
        if (!call || depth > 8) return
        const name = call.name
        if (name === 'web_fetch' && !call.error) {
          const url = typeof call.meta?.url === 'string' ? call.meta.url : call.args?.url
          if (isHttpUrl(url)) {
            const existing = web.get(url)
            web.set(url, { kind: 'web', via: 'fetch', url, title: existing?.title, status: typeof call.meta?.statusCode === 'number' ? call.meta.statusCode : existing?.status, pending: !call.settled, order: existing?.order ?? order++ })
          }
        } else if (name === 'web_search' && call.settled && !call.error && Array.isArray(call.meta?.sources)) {
          for (const source of call.meta.sources) {
            if (!isRecord(source) || !isHttpUrl(source.url)) continue
            const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : undefined
            if (title && !searchTitles.has(source.url)) searchTitles.set(source.url, title)
            if (!web.has(source.url)) web.set(source.url, { kind: 'web', via: 'search', url: source.url, title, order: order++ })
          }
        } else if (name === 'skill') {
          addSkill(call.args?.name)
        } else if (name === 'present' && call.settled && !call.error && Array.isArray(call.args?.files)) {
          for (const file of call.args.files) if (isRecord(file) && typeof file.path === 'string' && file.path) presentedFromTool.set(file.path, { path: file.path, description: typeof file.description === 'string' ? file.description : undefined, order: order++ })
        } else if (name === 'exit_plan_mode' && typeof call.args?.plan === 'string' && call.callId && !plans.has(call.callId)) {
          plans.set(call.callId, { callId: call.callId, title: planTitle(call.args.plan), order: order++ })
        } else if (typeof name === 'string') {
          const parsed = parseMcpName(name) ?? (MCP_RESOURCE_TOOLS.has(name) && typeof call.args?.server === 'string' ? { server: call.args.server, tool: name } : null)
          if (parsed) {
            const entry = mcp.get(parsed.server) ?? { kind: 'mcp', server: parsed.server, tools: new Map(), calls: 0, errors: 0, order: order++ }
            entry.calls++
            if (call.error) entry.errors++
            entry.tools.set(parsed.tool, (entry.tools.get(parsed.tool) ?? 0) + 1)
            mcp.set(parsed.server, entry)
          }
        }
        if (Array.isArray(call.subCalls)) for (const sub of call.subCalls) visitCall(sub, depth + 1)
      }
      const nodes = []
      for (const node of snapshot.nodes.values()) if (isRecord(node)) nodes.push(node)
      nodes.sort((left, right) => (Number(left.anchorSeq) || 0) - (Number(right.anchorSeq) || 0))
      for (const node of nodes) {
        const data = node.data
        if (node.kind === 'tool-call') visitCall(data?.root, 0)
        else if (node.kind === 'user' || node.kind === 'steering') {
          if (!isRecord(data)) continue
          if (Array.isArray(data.skillNames)) for (const name of data.skillNames) addSkill(name)
          const labels = Array.isArray(data.referenceLabels) ? data.referenceLabels : EMPTY
          for (const ref of fileReferences(textOf(data.content), labels)) if (!files.has(ref.path)) files.set(ref.path, { kind: 'file', path: ref.path, folder: ref.folder, order: order++ })
        } else if (node.kind === 'context') {
          const source = data?.source
          if (source?.kind === 'skill-invocation') addSkill(source.name)
          else if (source?.kind === 'session-reference' && Array.isArray(source.references)) {
            for (const ref of source.references) if (isRecord(ref) && typeof ref.sessionId === 'string' && ref.sessionId && !sessions.has(ref.sessionId)) sessions.set(ref.sessionId, { kind: 'session', sessionId: ref.sessionId, label: typeof ref.label === 'string' ? ref.label : undefined, order: order++ })
          }
        } else if (node.kind === 'submitted-plan' && isRecord(data) && typeof data.callId === 'string') {
          const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : planTitle(data.markdown)
          plans.set(data.callId, { callId: data.callId, title, order: plans.get(data.callId)?.order ?? order++ })
        }
      }
      for (const entry of web.values()) if (!entry.title && searchTitles.has(entry.url)) entry.title = searchTitles.get(entry.url)
      const changeTurns = []
      const presented = new Map()
      const timeline = snapshot.timeline
      for (const turn of Array.isArray(timeline?.turnOrder) ? timeline.turnOrder : EMPTY) {
        let value
        try { value = timeline.turns?.get?.(turn)?.data?.get?.('deliverables') } catch { value = undefined }
        if (!isRecord(value)) continue
        if (Number.isSafeInteger(value.changes?.seq)) changeTurns.push({ turn, seq: value.changes.seq })
        if (Array.isArray(value.presented)) {
          for (const item of value.presented) {
            if (!isRecord(item) || typeof item.path !== 'string' || !item.path) continue
            presented.delete(item.path)
            presented.set(item.path, { path: item.path, description: typeof item.description === 'string' ? item.description : undefined, seq: item.seq, turn })
          }
        }
      }
      const byOrder = (left, right) => left.order - right.order
      const webList = [...web.values()].sort((left, right) => (left.via === right.via ? 0 : left.via === 'fetch' ? -1 : 1) || left.order - right.order)
      const result = Object.freeze({
        web: webList,
        mcp: [...mcp.values()].sort(byOrder).map((entry) => ({ ...entry, tools: [...entry.tools.entries()].sort((left, right) => right[1] - left[1]).map(([tool, count]) => ({ tool, count })) })),
        skills: [...skills.values()].sort(byOrder),
        files: [...files.values()].sort(byOrder),
        sessions: [...sessions.values()].sort(byOrder),
        plans: [...plans.values()].sort(byOrder),
        presented: presented.size > 0 ? [...presented.values()].reverse() : [...presentedFromTool.values()].sort((left, right) => right.order - left.order),
        changeTurns,
        nodeCount: nodes.length
      })
      chatCache.set(snapshot, result)
      return result
    }

    /** Merge per-turn summaries by path. Totals are per-turn churn, not a net diff. */
    function aggregateChanges(entries) {
      const files = new Map()
      let added = 0, deleted = 0, loading = 0, missing = 0, failed = 0, recorded = 0
      for (const entry of entries) {
        if (!entry || entry.status === 'loading' || entry.status === undefined) { loading++; continue }
        if (entry.status === 'missing') { missing++; continue }
        if (entry.status !== 'ok' || !isRecord(entry.value) || !Array.isArray(entry.value.files)) { failed++; continue }
        recorded++
        const summary = entry.value
        const turn = Number.isSafeInteger(summary.turn) ? summary.turn : entry.turn
        summary.files.forEach((file, index) => {
          if (!isRecord(file) || typeof file.path !== 'string') return
          const fileAdded = Number.isFinite(file.added) ? file.added : 0
          const fileDeleted = Number.isFinite(file.deleted) ? file.deleted : 0
          added += fileAdded; deleted += fileDeleted
          const previous = files.get(file.path)
          files.set(file.path, {
            path: file.path,
            display: typeof file.display === 'string' && file.display ? file.display : file.path,
            added: (previous?.added ?? 0) + fileAdded,
            deleted: (previous?.deleted ?? 0) + fileDeleted,
            binary: file.binary === true || previous?.binary === true,
            oversized: file.oversized === true || previous?.oversized === true,
            turns: (previous?.turns ?? 0) + 1,
            latest: { seq: entry.seq, turn, index }
          })
        })
      }
      const list = [...files.values()].sort((left, right) => (right.latest.seq - left.latest.seq) || (left.display < right.display ? -1 : left.display > right.display ? 1 : 0))
      return { files: list, added, deleted, loading, missing, failed, recorded, turns: entries.length }
    }

    function tokenTotal(usage) {
      if (!isRecord(usage)) return undefined
      const parts = [usage.uncachedInputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens]
      return parts.every((value) => typeof value === 'number') ? parts.reduce((sum, value) => sum + value, 0) : undefined
    }
    /** Exact formulas of the native subagent catalog (dsh-client-ui-subagent). */
    function activityDuration(summary, activity, now) {
      const timing = summary?.projectionValues?.subagentTiming
      if (!isRecord(timing) || typeof timing.settledMs !== 'number') return undefined
      if (!isRecord(timing.active)) return timing.settledMs
      const end = activity === 'running' ? now : timing.active.through
      return timing.settledMs + Math.max(0, end - timing.active.since)
    }
    function deriveSubagents(catalog, statuses, byId, now) {
      const items = []
      let running = 0, done = 0, idle = 0
      for (const entry of Array.isArray(catalog) ? catalog : EMPTY) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue
        const summary = byId?.[entry.id]
        const mode = ['one-shot', 'continuable', 'external', 'unknown'].includes(entry.mode) ? entry.mode : 'unknown'
        if (mode === 'external') {
          items.push({ id: entry.id, label: entry.label ?? entry.id, title: undefined, mode, state: 'external', createdAt: entry.createdAt })
          continue
        }
        const status = typeof statuses?.get === 'function' ? statuses.get(entry.id) : undefined
        const activity = (status?.running ?? summary?.running) === true ? 'running' : 'inactive'
        const completed = activity === 'inactive' && summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true
        const state = activity === 'running' ? 'running' : completed ? 'done' : 'idle'
        if (state === 'running') running++
        else if (state === 'done') done++
        else idle++
        const title = typeof summary?.title === 'string' && summary.title.trim() ? summary.title.trim() : undefined
        items.push({ id: entry.id, label: typeof entry.label === 'string' && entry.label ? entry.label : entry.id, title, mode, state, elapsedMs: activityDuration(summary, activity, now), tokens: tokenTotal(summary?.projectionValues?.tokenUsage), createdAt: entry.createdAt, hasProjection: summary?.projectionValues !== undefined })
      }
      const rank = { running: 0, done: 1, idle: 2, external: 3 }
      items.sort((left, right) => (rank[left.state] - rank[right.state]) || ((Number(right.createdAt) || 0) - (Number(left.createdAt) || 0)))
      return { items, running, done, idle }
    }

    const SIDE_BRANCH_TITLE = / · (?:自|改)第 \d+ 轮$/
    function sessionTitle(row) {
      if (!isRecord(row)) return undefined
      for (const value of [row.title, row.displayTitle]) if (typeof value === 'string' && value.trim()) return value.trim()
      return undefined
    }
    function deriveRelated(sessionId, list, archivedIds, sideBranch) {
      const byId = isRecord(list?.byId) ? list.byId : {}
      const ids = Array.isArray(list?.ids) ? list.ids : Object.keys(byId)
      const archived = new Set(Array.isArray(archivedIds) ? archivedIds : EMPTY)
      const row = byId[sessionId]
      const items = []
      const describe = (id, relation) => ({ id, relation, title: sessionTitle(byId[id]), archived: archived.has(id), running: byId[id]?.running === true })
      if (isRecord(sideBranch) && typeof sideBranch.sourceSessionId === 'string' && sideBranch.sourceSessionId !== sessionId) {
        items.push({ ...describe(sideBranch.sourceSessionId, 'branchSource'), turn: sideBranch.turn, mode: sideBranch.mode })
      } else if (typeof row?.parentId === 'string' && row.parentId) {
        items.push(describe(row.parentId, row.origin === 'subagent' ? 'parent' : 'forkSource'))
      }
      for (const id of ids) {
        const candidate = byId[id]
        if (id === sessionId || !isRecord(candidate) || candidate.parentId !== sessionId || candidate.origin === 'subagent') continue
        const title = sessionTitle(candidate)
        items.push(describe(id, title && SIDE_BRANCH_TITLE.test(title) ? 'sideBranch' : 'fork'))
      }
      return items
    }

    function deriveJobs(rows, now) {
      const list = Array.isArray(rows) ? rows.filter((job) => isRecord(job) && typeof job.id === 'string') : []
      const live = (job) => job.status === 'running' || job.status === 'stopping'
      const sorted = [...list].sort((left, right) => {
        const liveLeft = live(left), liveRight = live(right)
        if (liveLeft !== liveRight) return liveLeft ? -1 : 1
        if (liveLeft) return (left.startedAt ?? 0) - (right.startedAt ?? 0)
        return ((right.finishedAt ?? right.startedAt ?? 0) - (left.finishedAt ?? left.startedAt ?? 0))
      })
      return {
        running: sorted.filter(live).length,
        items: sorted.map((job) => ({ id: job.id, kind: typeof job.kind === 'string' ? job.kind : '', label: typeof job.label === 'string' && job.label ? job.label : job.id, status: job.status, live: live(job), durationMs: typeof job.startedAt === 'number' ? Math.max(0, (live(job) ? now : (job.finishedAt ?? job.startedAt)) - job.startedAt) : undefined }))
      }
    }

    function deriveTodos(todos) {
      const items = Array.isArray(todos) ? todos.filter((item) => isRecord(item) && typeof item.content === 'string') : []
      return { items, done: items.filter((item) => item.status === 'completed').length, total: items.length }
    }
    function planModeActive(plan) {
      if (!isRecord(plan)) return false
      return plan.pending === true ? plan.active !== true : plan.active === true
    }

    function splitDuration(ms) {
      const totalSeconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000)
      const totalMinutes = Math.floor(totalSeconds / 60)
      const totalHours = Math.floor(totalMinutes / 60)
      return { seconds: totalSeconds % 60, minutes: totalMinutes % 60, hours: totalHours % 24, days: Math.floor(totalHours / 24), totalMinutes, totalHours }
    }
    function formatDuration(ms, t) {
      const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
      if (days > 0) return t('duration.days', { days, hours })
      if (totalHours > 0) return t('duration.hours', { hours: totalHours, minutes: String(minutes).padStart(2, '0') })
      if (totalMinutes > 0) return t('duration.minutes', { minutes: totalMinutes, seconds: String(seconds).padStart(2, '0') })
      return t('duration.seconds', { seconds })
    }
    function formatTokens(value, t) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      const scaled = (next) => (next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10))
      const text = value < 1e3 ? String(value) : value < 1e6 ? t('tokens.thousand', { value: scaled(value / 1e3) }) : t('tokens.million', { value: scaled(value / 1e6) })
      return t('tokens.total', { value: text })
    }

    // ---------------------------------------------------------- addresses
    const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'
    function encodeSegment(segment) { return encodeURIComponent(segment).replace(/%3A/gi, ':') }
    function encodePath(path) { return path.split('/').map(encodeSegment).join('/') }
    function sessionFileAddress(sessionId, path) {
      const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`
    }
    function isAbsoluteWorkspacePath(path) { return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\') || path.startsWith('//') }
    /** Same grammar as the native file address helper (dsh-client-ui-deliverables). */
    function fileAddressFor(sessionId, cwd, path) {
      const normalized = String(path).replace(/\\/g, '/')
      if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized)
      const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '')
      if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
      return sessionFileAddress(sessionId, normalized)
    }
    function changesReviewAddress(sessionId, seq, turn) { return `dsh-resource://changes-review/session/${encodeURIComponent(sessionId)}/${seq}/${turn}` }
    function subagentChatAddress(parentSessionId, childSessionId, mode) {
      return `dsh-resource://subagentchat/session/${encodeURIComponent(childSessionId)}?${new URLSearchParams({ parent: parentSessionId, mode })}`
    }
    function planAddress(sessionId, subagent, callId) {
      const address = subagent?.address
      if (isRecord(address) && typeof address.parentSessionId === 'string' && typeof address.childSessionId === 'string') {
        return `dsh-resource://plan/subagent/${[address.parentSessionId, address.childSessionId, address.mode ?? 'unknown', callId].map(encodeURIComponent).join('/')}`
      }
      return `dsh-resource://plan/${encodeURIComponent(sessionId)}/${encodeURIComponent(callId)}`
    }
    function changesSummaryUrl(sessionId, seq) { return `api/changes.summary?${new URLSearchParams({ sessionId, seq: String(seq) })}` }

    // ------------------------------------------------------- stores / caches
    function sanitizePosition(value) {
      return isRecord(value) && Number.isFinite(value.left) && Number.isFinite(value.top)
        ? { left: value.left, top: value.top } : null
    }
    function sanitizePrefs(value) {
      // Each window starts open/pinned with only Changes expanded. Old saved
      // close/collapse choices do not override startup; only position persists.
      const collapsed = Object.fromEntries(SECTION_IDS.filter((id) => id !== 'changes').map((id) => [id, true]))
      return { pinned: true, collapsed, floating: false, position: sanitizePosition(value?.position) }
    }
    /** Reserve a column on wide conversations, or a row above narrow ones. */
    function summaryLayout(rect, viewport, floating) {
      const layout = floating ? 'floating' : rect.width >= 900 ? 'side' : 'stack'
      const width = Math.max(1, Math.min(layout === 'stack' ? 460 : 320, rect.width - 24, viewport.width - 24))
      const right = Math.round(clamp(rect.right - 12, width + 12, viewport.width - 12))
      const top = Math.max(12, rect.bottom + 8)
      const maxHeight = Math.max(40, Math.min(viewport.height - top - (layout === 'stack' ? 160 : 24), viewport.height * (layout === 'stack' ? 0.45 : 0.72)))
      return { right, top, width, maxHeight, layout }
    }
    /** Optional companion plugins reserve space below the summary, never inside its scroller. */
    function summaryAccessoryHeight() {
      if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 0
      const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-summary-accessory-height'))
      return Number.isFinite(value) ? Math.max(0, value) : 0
    }
    /** Viewport coordinates, independent of the overlay's containing block. */
    function cardPlacement(anchor, position, viewport, measuredHeight, reservedHeight = 0) {
      const margin = 12
      const width = Math.max(1, Math.min(anchor.width, viewport.width - margin * 2))
      const docked = !position && anchor.layout && anchor.layout !== 'floating'
      const reserve = Number.isFinite(reservedHeight) ? clamp(reservedHeight, 0, Math.max(0, viewport.height - margin * 2 - 40)) : 0
      const maxHeight = Math.max(1, Math.min(anchor.maxHeight, viewport.height - margin * 2, docked ? viewport.height - anchor.top - margin : Infinity) - reserve)
      const height = Math.min(measuredHeight ?? maxHeight, maxHeight)
      const left = position?.left ?? anchor.right - width
      const top = position?.top ?? anchor.top
      return {
        left: clamp(left, margin, Math.max(margin, viewport.width - width - margin)),
        top: clamp(top, margin, Math.max(margin, viewport.height - height - margin - reserve)),
        width, maxHeight
      }
    }
    function createStore(initial, { storage, key, sanitize = (value) => value, serialize = (value) => value } = {}) {
      let state = initial
      if (storage && key) {
        try { const raw = storage.getItem(key); if (raw) state = sanitize(JSON.parse(raw)) } catch { state = initial }
      }
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        set(patch) {
          const next = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          if (Object.keys(next).every((name) => next[name] === state[name]) && Object.keys(state).every((name) => name in next)) return
          state = next
          if (storage && key) { try { storage.setItem(key, JSON.stringify(serialize(state))) } catch { /* private mode or quota */ } }
          for (const listener of [...listeners]) listener()
        }
      }
    }
    /** Per-plugin cache of Host change summaries, keyed by (session, event seq). */
    function createSummaryCache(fetchImpl) {
      let state = {}
      const listeners = new Set()
      const lifetime = new AbortController()
      const publish = () => { for (const listener of [...listeners]) listener() }
      const keyOf = (sessionId, seq) => `${sessionId}\u0000${seq}`
      async function read(sessionId, seq, key) {
        let next
        try {
          const response = await fetchImpl(changesSummaryUrl(sessionId, seq), { signal: lifetime.signal, credentials: 'same-origin' })
          if (response.status === 404) next = { status: 'missing' }
          else if (!response.ok) next = { status: 'error', error: `HTTP ${response.status}` }
          else {
            const value = await response.json()
            next = isRecord(value) && Array.isArray(value.files) ? { status: 'ok', value } : { status: 'error', error: 'invalid summary' }
          }
        } catch (error) {
          next = { status: 'error', error: errorText(error) }
        }
        if (lifetime.signal.aborted) return
        state = { ...state, [key]: next }
        publish()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        entry(sessionId, seq) { return state[keyOf(sessionId, seq)] },
        ensure(sessionId, seq) {
          if (lifetime.signal.aborted || typeof sessionId !== 'string' || !Number.isSafeInteger(seq)) return
          const key = keyOf(sessionId, seq)
          // Failures are retried only through retry(); never automatically.
          if (state[key] !== undefined) return
          state = { ...state, [key]: { status: 'loading' } }
          publish()
          void read(sessionId, seq, key)
        },
        retry(sessionId) {
          const prefix = `${sessionId}\u0000`
          const next = { ...state }
          let changed = false
          for (const key of Object.keys(next)) if (key.startsWith(prefix) && next[key].status !== 'ok' && next[key].status !== 'loading') { delete next[key]; changed = true }
          if (changed) { state = next; publish() }
        },
        dispose() { lifetime.abort(); listeners.clear() }
      }
    }

    // ------------------------------------------------------------------ CSS
    // Classes are copied from the host's own controls (header icon button,
    // menu surface, StateDot, Tooltip) and renamed under the `dss-` prefix;
    // only theme tokens are shared with the host.
    const CSS = `
.dss-anchor{display:inline-flex;align-items:center;flex:none}
.dss-toggle{box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;position:relative;font:inherit}
.dss-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dss-toggle:active{background:var(--dsw-alias-interactive-bg-active)}
.dss-toggle svg{width:15px;height:15px}
.dss-toggle[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dss-toggle-badge{position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base)}
.dss-card{position:fixed;z-index:30;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);background:color-mix(in srgb,var(--dsw-specific-menu) 88%,transparent);backdrop-filter:var(--dsw-menu-backdrop-filter);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;-webkit-app-region:no-drag;cursor:default;pointer-events:auto}
.dss-conversation-layout{margin-right:var(--dss-side-space,0px);margin-top:var(--dss-top-space,0px);min-width:0}
.dss-card[data-compact-collapsed] .dss-body,.dss-card[data-compact-collapsed] .dss-notice{display:none}
.dss-card[data-compact-collapsed] .dss-head:has(.dss-menu){flex-wrap:wrap}
.dss-card[data-compact-collapsed] .dss-menu{position:static;flex:0 0 100%;margin-top:4px;box-shadow:none}
.dss-head{flex:none;display:flex;align-items:center;gap:2px;padding:10px 8px 6px 14px;position:relative}
.dss-project{flex:1;min-width:0;display:flex;align-items:center;gap:7px;margin-right:4px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;font-weight:600;border-radius:var(--dsw-radius-xs)}
.dss-project svg{flex:none;color:var(--dsw-alias-label-secondary)}
.dss-project[data-dss-drag-handle]{cursor:grab;touch-action:none;user-select:none}
.dss-card[data-dragging] .dss-project{cursor:grabbing}
.dss-project:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dss-project-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dss-icon-btn{box-sizing:border-box;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;font:inherit}
.dss-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dss-icon-btn[aria-pressed=true]{color:var(--dsw-alias-state-business-primary)}
.dss-icon-btn[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dss-icon-btn svg{width:14px;height:14px}
.dss-menu{position:absolute;right:8px;top:36px;z-index:2;min-width:176px;margin:0;padding:4px;list-style:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}
.dss-menu button{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:8px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dss-menu button svg{flex:none;color:var(--dsw-alias-label-secondary)}
.dss-menu button:hover,.dss-menu button:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dss-menu button:disabled{opacity:.4;cursor:default;background:transparent}
.dss-body{flex:1;min-height:0;overflow:auto;padding:0 6px 8px;overscroll-behavior:contain}
.dss-section{padding:4px 0 2px}
.dss-section+.dss-section{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:4px;padding-top:6px}
.dss-sec-head{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:6px;padding:3px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.dss-sec-head:hover{color:var(--dsw-alias-label-secondary)}
.dss-sec-title{flex:none}
.dss-sec-meta{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-end;gap:6px;white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}
.dss-sec-chevron{flex:none;display:inline-flex;transition:transform .12s;opacity:.7}
.dss-sec-chevron svg{width:12px;height:12px}
.dss-sec-head[aria-expanded=false] .dss-sec-chevron{transform:rotate(-90deg)}
.dss-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px}
.dss-row{box-sizing:border-box;width:100%;min-height:28px;display:flex;align-items:center;gap:8px;padding:4px 8px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left}
button.dss-row{cursor:pointer}
button.dss-row:hover,button.dss-row:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dss-row-icon{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.dss-row-main{flex:1;min-width:0;display:flex;flex-direction:column}
.dss-row-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dss-row-sub{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dss-row-meta{flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dss-tag{flex:none;padding:0 5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:16px;white-space:nowrap}
.dss-added{color:var(--dsw-alias-state-success-primary)}
.dss-deleted{color:var(--dsw-alias-state-error-primary)}
.dss-empty,.dss-note{padding:2px 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dss-note{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.dss-link{padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dss-link:hover{text-decoration:underline}
.dss-link:disabled{opacity:.5;cursor:default;text-decoration:none}
.dss-more{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;margin:1px 0 0;padding:3px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dss-more:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dss-more svg{width:12px;height:12px}
.dss-more[aria-expanded=true] svg{transform:rotate(180deg)}
.dss-dots{display:inline-flex;align-items:center;gap:3px}
.dss-state{flex:none;width:14px;height:16px;display:inline-flex;align-items:center;justify-content:center}
.dss-dot{position:relative;display:inline-block;flex:none;color:var(--dsw-alias-state-idle-primary)}
.dss-dot:after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}
.dss-dot[data-state=done]{color:var(--dsw-alias-state-success-primary)}
.dss-dot[data-state=warning]{color:var(--dsw-alias-state-warn-primary)}
.dss-dot[data-state=error]{color:var(--dsw-alias-state-error-primary)}
.dss-dot[data-state=idle]{color:var(--dsw-alias-state-idle-primary)}
.dss-spinner{flex:none;color:var(--dsw-alias-label-tertiary)}
.dss-spinner-motion{transform-origin:center;animation:dss-spin 1.5s linear infinite}
.dss-spinner-track,.dss-spinner-arc{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.dss-spinner-track{opacity:.25}
.dss-spinner-arc{stroke-dasharray:12 150;animation:dss-dash 1.5s ease-in-out infinite}
.dss-notice{flex:none;margin:0 10px 8px;padding:4px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dss-tip{display:inline-flex;align-items:center;position:fixed;z-index:100;width:max-content;box-sizing:border-box;max-width:min(50vw,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:hidden;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00,#fff);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;animation:dss-tip-in .15s var(--ds-ease-in-out)}
.dss-icon-fallback{display:inline-block}
@keyframes dss-spin{to{transform:rotate(360deg)}}
@keyframes dss-dash{0%{stroke-dasharray:12 150;stroke-dashoffset:0}50%{stroke-dasharray:24 150;stroke-dashoffset:-6}to{stroke-dasharray:12 150;stroke-dashoffset:0}}
@keyframes dss-tip-in{0%{opacity:0}}
@media (prefers-reduced-motion:reduce){.dss-spinner-motion,.dss-spinner-arc{animation:none}.dss-spinner-arc{stroke-dasharray:18 150;stroke-dashoffset:-3}.dss-tip{animation:none}}
`

    // ---------------------------------------------------------------- icons
    // Exact host icon markup (16×16, stroke 1) copied from the installed shell
    // by scripts/extract-host-icons.mjs; tests fail if the host changes them.
    const HOST_ICONS = {"list":["svg",{"viewBox":"0 0 16 16","fill":"none","stroke":"currentColor","strokeLinecap":"round","strokeWidth":1},[["path",{"d":"M6 3.5h7.5M6 8h7.5M6 12.5h7.5"}],["path",{"d":"M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01"}]]],"pin":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z","stroke":"currentColor","strokeLinejoin":"round"}],["path",{"d":"M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z","fill":"currentColor"}]]],"pinFill":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z","fill":"currentColor","stroke":"currentColor","strokeLinejoin":"round"}],["path",{"d":"M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z","fill":"currentColor"}]]],"ellipsis":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z","fill":"currentColor"}],["path",{"d":"M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z","fill":"currentColor"}],["path",{"d":"M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z","fill":"currentColor"}]]],"close":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M2.5 2.5L13.5 13.5","stroke":"currentColor"}],["path",{"d":"M13.5 2.5L2.5 13.5","stroke":"currentColor"}]]],"chevronDown":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6","stroke":"currentColor"}]]],"folder":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z","stroke":"currentColor"}],["path",{"d":"M3.63501 7.66614H12.3647","stroke":"currentColor"}]]],"file":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M6.15479 4.91687H9.84543","stroke":"currentColor"}],["path",{"d":"M11.8798 9.55347V2.71525C11.8798 2.37416 11.564 2.09766 11.1744 2.09766H4.82577C4.43618 2.09766 4.12036 2.37416 4.12036 2.71525V9.55347","stroke":"currentColor"}],["path",{"d":"M2.28735 13.8022V8.84792C2.28735 8.77514 2.36262 8.72673 2.42884 8.75693L13.2936 13.7112C13.3914 13.7558 13.3596 13.9022 13.2521 13.9022H2.38735C2.33213 13.9022 2.28735 13.8575 2.28735 13.8022Z","stroke":"currentColor"}],["path",{"d":"M7.46929 10.979L13.5783 8.7416C13.6435 8.7177 13.7126 8.76601 13.7126 8.83551L13.7125 13.8022C13.7125 13.8574 13.6678 13.9022 13.6125 13.9022H7.99999","stroke":"currentColor"}],["path",{"d":"M6.15479 7.2395H9.05644","stroke":"currentColor"}]]],"globe":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z","stroke":"currentColor"}],["path",{"d":"M2.34619 8H13.6538","stroke":"currentColor","strokeLinecap":"square"}],["path",{"d":"M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138","stroke":"currentColor"}],["path",{"d":"M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138","stroke":"currentColor"}]]],"api":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M3 4L7 8L3 12","stroke":"currentColor"}],["path",{"d":"M9 12H13","stroke":"currentColor"}]]],"skill":["svg",{"viewBox":"0 0 17 17","fill":"none","strokeWidth":1},[["path",{"d":"M4.57788 5.77124H10.7029","stroke":"currentColor"}],["path",{"d":"M4.57788 8.89819H7.91879","stroke":"currentColor"}],["path",{"d":"M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z","fill":"currentColor"}],["path",{"d":"M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z","stroke":"currentColor"}]]],"link":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M6.59961 9.40051C6.82779 9.6334 7.10015 9.81842 7.40074 9.94472C7.70132 10.071 8.02409 10.1361 8.35013 10.1361C8.67618 10.1361 8.99894 10.071 9.29953 9.94472C9.60011 9.81842 9.87247 9.6334 10.1007 9.40051L12.9015 6.59967C13.3658 6.13541 13.6266 5.50572 13.6266 4.84915C13.6266 4.19258 13.3658 3.56289 12.9015 3.09863C12.4372 2.63436 11.8075 2.37354 11.151 2.37354C10.4944 2.37354 9.86472 2.63436 9.40045 3.09863L9.05034 3.44873","stroke":"currentColor"}],["path",{"d":"M9.40051 6.59959C9.17233 6.3667 8.89997 6.18169 8.59939 6.05538C8.2988 5.92907 7.97603 5.86401 7.64999 5.86401C7.32395 5.86401 7.00118 5.92907 6.70059 6.05538C6.40001 6.18169 6.12765 6.3667 5.89946 6.59959L3.09863 9.40043C2.63436 9.8647 2.37354 10.4944 2.37354 11.151C2.37354 11.8075 2.63436 12.4372 3.09863 12.9015C3.56289 13.3657 4.19258 13.6266 4.84915 13.6266C5.50572 13.6266 6.13541 13.3657 6.59967 12.9015L6.94978 12.5514","stroke":"currentColor"}]]],"branch":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564","stroke":"currentColor"}],["path",{"d":"M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944","stroke":"currentColor"}],["circle",{"cx":"12.4502","cy":"3.3079","r":"1.56962","stroke":"currentColor"}],["circle",{"cx":"12.4502","cy":"12.6921","r":"1.56962","stroke":"currentColor"}]]],"rightUp":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M11.7256 2.77441C12.5538 2.77469 13.2256 3.44616 13.2256 4.27441V10.1416H12.2256V4.27441C12.2256 3.99844 12.0015 3.77469 11.7256 3.77441H5.7207V2.77441H11.7256Z","fill":"currentColor"}],["path",{"d":"M2.77441 13.2255L12.3756 3.62427","stroke":"currentColor"}]]],"checklist":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M3.75 6.25C4.7165 6.25 5.5 5.4665 5.5 4.5C5.5 3.5335 4.7165 2.75 3.75 2.75C2.7835 2.75 2 3.5335 2 4.5C2 5.4665 2.7835 6.25 3.75 6.25Z","stroke":"currentColor"}],["path",{"d":"M7.5 4.5H13.5","stroke":"currentColor"}],["path",{"d":"M3.75 13.25C4.7165 13.25 5.5 12.4665 5.5 11.5C5.5 10.5335 4.7165 9.75 3.75 9.75C2.7835 9.75 2 10.5335 2 11.5C2 12.4665 2.7835 13.25 3.75 13.25Z","stroke":"currentColor"}],["path",{"d":"M7.5 11.5H13.5","stroke":"currentColor"}]]],"goal":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5","stroke":"currentColor"}],["path",{"d":"M11.5 8C11.5001 8.69227 11.2948 9.36901 10.9102 9.94463C10.5257 10.5202 9.97901 10.9689 9.33944 11.2338C8.69986 11.4987 7.99609 11.5681 7.31712 11.433C6.63816 11.2979 6.01449 10.9645 5.52501 10.475C5.03548 9.98552 4.70209 9.36185 4.56702 8.68289C4.43195 8.00392 4.50127 7.30015 4.76619 6.66057C5.03112 6.021 5.47976 5.47436 6.05538 5.08978C6.631 4.70519 7.30774 4.49995 8.00001 4.5","stroke":"currentColor"}],["path",{"d":"M8.00024 7.99976L11.2 4.80005","stroke":"currentColor"}],["path",{"d":"M12.4719 5.62245C12.4246 5.66972 12.3569 5.69025 12.2913 5.67715L10.7814 5.37555C10.7022 5.35972 10.6402 5.29781 10.6244 5.2186L10.3228 3.70866C10.3097 3.6431 10.3302 3.57533 10.3775 3.52806L12.1826 1.723C12.2863 1.61929 12.4627 1.65879 12.5122 1.79684L12.9271 2.95225C12.9472 3.00847 12.9915 3.05272 13.0477 3.07291L14.2031 3.48774C14.3412 3.5373 14.3807 3.71368 14.277 3.81739L12.4719 5.62245Z","stroke":"currentColor"}]]],"plan":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M4.9375 5.90295H11.0625","stroke":"currentColor"}],["path",{"d":"M4.9375 9.02991H8.27841","stroke":"currentColor"}],["path",{"d":"M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V7.61328L13 8.68164V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H8.32812L7.39258 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5Z","fill":"currentColor"}],["path",{"d":"M8.97212 14.3693C9.17511 14.5723 9.37811 14.7753 9.5811 14.9783C9.67012 14.8953 9.75914 14.8123 9.84815 14.7293C11.4505 13.2352 13.0528 11.7411 14.6551 10.247C14.7441 10.164 14.8331 10.081 14.9221 9.99803C14.5989 9.6748 14.2756 9.35157 13.9524 9.02834C13.8694 9.11736 13.7864 9.20637 13.7034 9.29539C12.2093 10.8977 10.7152 12.5 9.22113 14.1023C9.13813 14.1913 9.05513 14.2803 8.97212 14.3693Z","fill":"currentColor"}],["path",{"d":"M11.6323 13.7841C11.6323 14.0395 11.6323 14.295 11.6323 14.5504C11.6812 14.5523 11.7301 14.5543 11.779 14.5562C12.659 14.5913 13.539 14.6263 14.419 14.6614C14.4679 14.6633 14.5168 14.6653 14.5657 14.6672C14.5657 14.3339 14.5657 14.0006 14.5657 13.6672C14.5168 13.6692 14.4679 13.6711 14.419 13.6731C13.539 13.7081 12.659 13.7432 11.779 13.7783C11.7301 13.7802 11.6812 13.7821 11.6323 13.7841Z","fill":"currentColor"}]]],"copy":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["rect",{"x":"1.52075","y":"4.07373","rx":"2","stroke":"currentColor"}],["path",{"d":"M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z","fill":"currentColor"}]]],"refresh":["svg",{"viewBox":"0 0 16 16","fill":"none","strokeWidth":1},[["path",{"d":"M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1","stroke":"currentColor"}],["path",{"d":"M14.4999 1.5V5.1H10.8999","stroke":"currentColor"}]]],"tree":["svg",{"viewBox":"0 0 16 16","fill":"none","stroke":"currentColor","strokeLinecap":"round","strokeLinejoin":"round","strokeWidth":1},[["path",{"d":"M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46C2.65 13.5 2 12.85 2 12.05v-8.1c0-.8.65-1.45 1.46-1.45h2.4c.49 0 .94.24 1.21.65l.5.73c.27.4.73.65 1.21.65h3.76c.8 0 1.46.65 1.46 1.45v6.02Z"}],["path",{"d":"M8.7 8.1v3M11.2 8.1v3"}]]]}
    function renderIconNode(node, key) {
      const [type, attrs, children] = node
      return h(type, { key, ...attrs }, Array.isArray(children) ? children.map(renderIconNode) : undefined)
    }
    function Icon({ name, size = 16, className }) {
      const node = HOST_ICONS[name]
      if (!Array.isArray(node)) return h('span', { className: 'dss-icon-fallback', style: { width: size, height: size }, 'aria-hidden': true })
      const [type, attrs, children] = node
      return h(type, { ...attrs, width: size, height: size, className, 'aria-hidden': true, focusable: 'false' }, Array.isArray(children) ? children.map(renderIconNode) : undefined)
    }
    /** Copy of the host StateDot: spinner for ongoing, 10px dot otherwise. */
    function Dot({ state }) {
      const native = state === 'running' ? 'ongoing' : state === 'external' ? 'idle' : state
      if (native === 'ongoing') {
        return h('span', { className: 'dss-state', 'aria-hidden': true }, h('svg', { className: 'dss-spinner', 'data-state': 'ongoing', width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true },
          h('g', { className: 'dss-spinner-motion' }, h('circle', { className: 'dss-spinner-track', cx: '12', cy: '12', r: '9.5' }), h('circle', { className: 'dss-spinner-arc', cx: '12', cy: '12', r: '9.5' }))))
      }
      return h('span', { className: 'dss-state', 'aria-hidden': true }, h('span', { className: 'dss-dot', 'data-state': native, style: { width: 10, height: 10 } }))
    }
    function FileIcon({ folder }) { return h(Icon, { name: folder ? 'folder' : 'file' }) }

    // -------------------------------------------------------------- hooks
    const ApiContext = React.createContext(null)
    function useStore(store, selector) {
      const read = React.useCallback(() => selector(store.getSnapshot()), [store, selector])
      return React.useSyncExternalStore(store.subscribe, read, read)
    }
    function useNow(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }
    /** Re-derive Chat data at most every `interval` ms while a turn streams. */
    function useThrottledValue(input, derive, interval) {
      const [value, setValue] = React.useState(() => derive(input))
      const last = React.useRef({ input, at: Date.now() })
      React.useEffect(() => {
        if (last.current.input === input) return
        const wait = interval - (Date.now() - last.current.at)
        const run = () => { last.current = { input, at: Date.now() }; setValue(derive(input)) }
        if (wait <= 0) { run(); return }
        const timer = setTimeout(run, wait)
        return () => clearTimeout(timer)
      }, [input, derive, interval])
      return value
    }
    function fallbackSelectorHook(selector) { return selector(undefined) }
    function fallbackProjectionHook() { return undefined }
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max))

    let tipSequence = 0
    /**
     * Host-style tooltip trigger: 500ms hover delay, immediate on keyboard
     * focus, hidden on leave/blur/press. The bubble renders in this plugin's
     * own overlay entry, never as foreign DOM.
     */
    function Tip({ label, children, side = 'bottom' }) {
      const api = React.useContext(ApiContext)
      const [id] = React.useState(() => ++tipSequence)
      const timer = React.useRef(0)
      React.useEffect(() => () => { clearTimeout(timer.current); api?.hideTip(id) }, [api, id])
      if (!api || !label || !React.isValidElement(children)) return children
      const text = typeof label === 'function' ? label() : label
      const show = (target) => { if (target?.isConnected) api.showTip({ id, text, rect: target.getBoundingClientRect(), side }) }
      const hide = () => { clearTimeout(timer.current); api.hideTip(id) }
      const chain = (name, handler) => (event) => { children.props[name]?.(event); handler(event) }
      return React.cloneElement(children, {
        onMouseEnter: chain('onMouseEnter', (event) => { const target = event.currentTarget; clearTimeout(timer.current); timer.current = setTimeout(() => show(target), 500) }),
        onMouseLeave: chain('onMouseLeave', hide),
        onFocus: chain('onFocus', (event) => { const target = event.currentTarget; let keyboard = false; try { keyboard = target.matches(':focus-visible') } catch { keyboard = false } if (keyboard) show(target) }),
        onBlur: chain('onBlur', hide),
        onPointerDown: chain('onPointerDown', hide)
      })
    }
    function TipBubble({ tip }) {
      const ref = React.useRef(null)
      const [position, setPosition] = React.useState(null)
      React.useLayoutEffect(() => {
        const element = ref.current
        if (!element || typeof window === 'undefined') return
        const width = element.offsetWidth, height = element.offsetHeight, rect = tip.rect, margin = 12, gap = 8
        let left, top
        if (tip.side === 'left') {
          left = rect.left - gap - width
          top = rect.top + rect.height / 2 - height / 2
          if (left < margin) left = rect.right + gap
        } else {
          left = rect.left + rect.width / 2 - width / 2
          top = rect.bottom + gap
          if (top + height > window.innerHeight - margin) top = rect.top - gap - height
        }
        setPosition({ left: Math.round(clamp(left, margin, window.innerWidth - width - margin)), top: Math.round(clamp(top, margin, window.innerHeight - height - margin)) })
      }, [tip])
      return h('div', { ref, className: 'dss-tip', role: 'tooltip', style: position ?? { visibility: 'hidden', left: 0, top: 0 } }, tip.text)
    }

    // ------------------------------------------------------- presentational
    function Row({ icon, label, sub, meta, onClick, title, ariaLabel }) {
      const content = [
        h('span', { key: 'icon', className: 'dss-row-icon' }, icon),
        h('span', { key: 'main', className: 'dss-row-main' }, h('span', { className: 'dss-row-label' }, label), sub ? h('span', { className: 'dss-row-sub' }, sub) : null),
        meta ? h('span', { key: 'meta', className: 'dss-row-meta' }, meta) : null
      ]
      const row = onClick
        ? h('button', { type: 'button', className: 'dss-row', onClick, 'aria-label': ariaLabel }, content)
        : h('div', { className: 'dss-row' }, content)
      return h('li', null, title ? h(Tip, { label: title, side: 'left' }, row) : row)
    }
    function Section({ id, title, meta, collapsed, onToggle, children, t }) {
      const headingId = `${CARD_ID}-${id}`
      return h('section', { className: 'dss-section', 'aria-labelledby': headingId, 'data-section': id },
        h('button', { type: 'button', id: headingId, className: 'dss-sec-head', 'aria-expanded': !collapsed, 'aria-label': t(collapsed ? 'section.expand' : 'section.collapse', { name: title }), onClick: () => onToggle(id) },
          h('span', { className: 'dss-sec-chevron', 'aria-hidden': true }, h(Icon, { name: 'chevronDown', size: 12 })),
          h('span', { className: 'dss-sec-title' }, title),
          meta ? h('span', { className: 'dss-sec-meta' }, meta) : null),
        collapsed ? null : children)
    }
    /** Codex-style preview: "show N more" for changed files, "show all (N)" elsewhere. */
    function LimitedList({ items, renderItem, expanded, onExpand, t, limit = PREVIEW_LIMIT, more = 'all' }) {
      const visible = expanded ? items : items.slice(0, limit)
      const hidden = items.length - visible.length
      return h(React.Fragment, null,
        h('ul', { className: 'dss-list' }, visible.map(renderItem)),
        items.length > limit ? h('button', { type: 'button', className: 'dss-more', 'aria-expanded': Boolean(expanded), onClick: onExpand },
          expanded ? t('showLess') : more === 'more' ? t('showMore', { count: hidden }) : t('showAll', { count: items.length }),
          h(Icon, { name: 'chevronDown', size: 12 })) : null)
    }
    function sourceRows(model) {
      const rows = []
      for (const item of model.web) rows.push({ key: `web:${item.url}`, ...item })
      for (const item of model.mcp) rows.push({ key: `mcp:${item.server}`, ...item })
      for (const item of model.skills) rows.push({ key: `skill:${item.name}`, ...item })
      for (const item of model.files) rows.push({ key: `file:${item.path}`, ...item })
      for (const item of model.sessions) rows.push({ key: `session:${item.sessionId}`, ...item })
      return rows
    }
    function knownKey(t, key, fallback) { return ZH[key] !== undefined ? t(key) : fallback }

    /** Pure view of one prepared model; every action arrives as a callback. */
    function SummaryCard({ model, t, actions, prefs, expanded, onExpand, menuOpen, setMenuOpen, notice, dragHandle, compact, compactExpanded, onToggleCompact }) {
      const collapsed = prefs.collapsed ?? {}
      const toggleSection = actions.toggleSection
      const sections = []
      const changes = model.changes
      const changesMeta = changes.added || changes.deleted
        ? h(Tip, { label: t('changes.churn') }, h('span', { className: 'dss-dots' }, h('span', { className: 'dss-added' }, `+${changes.added}`), h('span', { className: 'dss-deleted' }, `−${changes.deleted}`)))
        : (changes.files.length ? t('changes.count', { count: changes.files.length }) : null)
      sections.push(h(Section, { key: 'changes', id: 'changes', title: t('section.changes'), meta: changesMeta, collapsed: collapsed.changes, onToggle: toggleSection, t },
        changes.files.length > 0 ? h(LimitedList, { items: changes.files, expanded: expanded.changes, onExpand: () => onExpand('changes'), t, more: 'more', limit: 3,
          renderItem: (file) => h(Row, { key: file.path, icon: h(FileIcon, {}), label: basename(file.display) || file.display, sub: file.display, title: t('changes.open', { turn: file.latest.turn }),
            meta: [file.binary ? h('span', { key: 'b', className: 'dss-tag' }, t('changes.binary')) : null, file.oversized ? h('span', { key: 'o', className: 'dss-tag' }, t('changes.oversized')) : null,
              !file.binary && !file.oversized ? h('span', { key: 'a', className: 'dss-added' }, `+${file.added}`) : null, !file.binary && !file.oversized ? h('span', { key: 'd', className: 'dss-deleted' }, `−${file.deleted}`) : null],
            onClick: () => actions.openChange(file) }) }) : null,
        changes.loading > 0 && changes.files.length === 0 ? h('div', { className: 'dss-empty' }, t('changes.loading')) : null,
        changes.turns === 0 ? h('div', { className: 'dss-empty' }, t('changes.empty')) : null,
        changes.missing > 0 ? h('div', { className: 'dss-note' }, t('changes.missing', { count: changes.missing })) : null,
        changes.failed > 0 ? h('div', { className: 'dss-note' }, t('changes.error', { count: changes.failed }), h('button', { type: 'button', className: 'dss-link', onClick: actions.retryChanges }, t('changes.retry'))) : null))

      const subagents = model.subagents
      const subMeta = subagents.items.length ? h('span', { className: 'dss-dots' },
        h('span', { className: 'dss-dots', 'aria-hidden': true }, subagents.items.slice(0, 4).map((item) => h(Dot, { key: item.id, state: item.state }))),
        [subagents.running ? t('subagents.running', { count: subagents.running }) : null, subagents.done ? t('subagents.done', { count: subagents.done }) : null, subagents.idle ? t('subagents.idle', { count: subagents.idle }) : null].filter(Boolean).join(' · ')) : null
      sections.push(h(Section, { key: 'subagents', id: 'subagents', title: t('section.subagents'), meta: subMeta, collapsed: collapsed.subagents, onToggle: toggleSection, t },
        subagents.items.length ? h(LimitedList, { items: subagents.items, expanded: expanded.subagents, onExpand: () => onExpand('subagents'), t, limit: 3,
          renderItem: (item) => h(Row, { key: item.id, icon: h(Dot, { state: item.state }), label: item.title ?? item.label, sub: [t(`mode.${item.mode}`), item.title && item.title !== item.label ? item.label : null].filter(Boolean).join(' · '),
            meta: item.state === 'external' ? null : [item.elapsedMs !== undefined ? h('span', { key: 'e' }, formatDuration(item.elapsedMs, t)) : null, item.tokens !== undefined ? h('span', { key: 'k' }, formatTokens(item.tokens, t)) : null],
            title: item.state === 'external' ? t('mode.external') : t(item.state === 'running' ? 'activity.running' : item.state === 'done' ? 'activity.completed' : 'activity.inactive'),
            ariaLabel: item.state === 'external' ? undefined : t('subagents.open', { label: item.title ?? item.label }),
            onClick: item.state === 'external' ? undefined : () => actions.openSubagent(item) }) }) : h('div', { className: 'dss-empty' }, t('subagents.empty'))))

      const sources = sourceRows(model.sources)
      sections.push(h(Section, { key: 'sources', id: 'sources', title: t('section.sources'), meta: sources.length ? String(sources.length) : null, collapsed: collapsed.sources, onToggle: toggleSection, t },
        sources.length ? h(LimitedList, { items: sources, expanded: expanded.sources, onExpand: () => onExpand('sources'), t,
          renderItem: (item) => {
            if (item.kind === 'web') return h(Row, { key: item.key, icon: h(Icon, { name: 'globe' }), label: item.title || hostOf(item.url), sub: item.url, title: item.url, meta: h('span', { className: 'dss-tag' }, t(item.via === 'fetch' ? 'source.fetch' : 'source.search')), onClick: () => actions.openUrl(item.url) })
            if (item.kind === 'mcp') return h(Row, { key: item.key, icon: h(Icon, { name: 'api' }), label: item.server, sub: t('source.tools', { tools: item.tools.slice(0, 4).map((tool) => tool.tool).join(', ') + (item.tools.length > 4 ? '…' : '') }), title: item.tools.map((tool) => `${tool.tool} ×${tool.count}`).join('\n'), meta: [h('span', { key: 'tag', className: 'dss-tag' }, t('source.mcp')), h('span', { key: 'calls' }, t('source.calls', { count: item.calls }))] })
            if (item.kind === 'skill') return h(Row, { key: item.key, icon: h(Icon, { name: 'skill' }), label: item.name, meta: h('span', { className: 'dss-tag' }, t('source.skill')), onClick: () => actions.openSkill(item.name) })
            if (item.kind === 'file') return h(Row, { key: item.key, icon: h(FileIcon, { folder: item.folder }), label: basename(item.path) || item.path, sub: displayPath(model.project.cwd, item.path), meta: h('span', { className: 'dss-tag' }, t(item.folder ? 'source.folder' : 'source.file')), onClick: item.folder ? () => actions.openFilesTab() : () => actions.openFile(item.path) })
            return h(Row, { key: item.key, icon: h(Icon, { name: 'link' }), label: item.title || item.label || item.sessionId, sub: item.title && item.label && item.label !== item.title ? `@${item.label}` : undefined, meta: h('span', { className: 'dss-tag' }, t('source.session')), onClick: () => actions.openSession(item.sessionId) })
          } }) : h('div', { className: 'dss-empty' }, t('sources.empty'))))

      const plan = model.plan
      if (plan.mode || plan.goal || plan.todos.total || plan.submitted.length) {
        sections.push(h(Section, { key: 'plan', id: 'plan', title: t('section.plan'), meta: plan.todos.total ? t('plan.progress', { done: plan.todos.done, total: plan.todos.total }) : null, collapsed: collapsed.plan, onToggle: toggleSection, t },
          plan.mode || plan.goal ? h('ul', { className: 'dss-list' },
            plan.mode ? h(Row, { key: 'mode', icon: h(Icon, { name: 'plan' }), label: t('plan.mode') }) : null,
            plan.goal ? h(Row, { key: 'goal', icon: h(Icon, { name: 'goal' }), label: plan.goal.objective, sub: t('plan.goal'), title: plan.goal.objective, meta: plan.goal.phase ? h('span', { className: 'dss-tag' }, knownKey(t, `goal.${plan.goal.phase}`, plan.goal.phase)) : null }) : null) : null,
          plan.todos.total ? h(LimitedList, { items: plan.todos.items.map((item, index) => ({ ...item, index })), expanded: expanded.plan, onExpand: () => onExpand('plan'), t, limit: 6,
            renderItem: (item) => h(Row, { key: item.index, icon: h(Dot, { state: item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'running' : 'idle' }), label: item.content, title: `${knownKey(t, `todo.${item.status}`, String(item.status))} · ${item.content}` }) }) : null,
          plan.submitted.length ? h('ul', { className: 'dss-list' }, plan.submitted.map((item) => h(Row, { key: item.callId, icon: h(Icon, { name: 'checklist' }), label: item.title || t('plan.submitted'), meta: h('span', { className: 'dss-tag' }, t('plan.submitted')), onClick: () => actions.openPlan(item.callId) }))) : null))
      }

      if (model.files.length) {
        sections.push(h(Section, { key: 'files', id: 'files', title: t('section.files'), meta: String(model.files.length), collapsed: collapsed.files, onToggle: toggleSection, t },
          h(LimitedList, { items: model.files, expanded: expanded.files, onExpand: () => onExpand('files'), t,
            renderItem: (file) => h(Row, { key: file.path, icon: h(FileIcon, {}), label: basename(file.path) || file.path, sub: file.description || displayPath(model.project.cwd, file.path), title: file.path, onClick: () => actions.openFile(file.path) }) })))
      }

      const jobs = model.jobs
      if (jobs.items.length) {
        sections.push(h(Section, { key: 'jobs', id: 'jobs', title: t('section.jobs'), meta: jobs.running ? t('subagents.running', { count: jobs.running }) : String(jobs.items.length), collapsed: collapsed.jobs, onToggle: toggleSection, t },
          h(LimitedList, { items: jobs.items, expanded: expanded.jobs, onExpand: () => onExpand('jobs'), t,
            renderItem: (job) => h(Row, { key: job.id, icon: h(Dot, { state: job.status === 'running' ? 'running' : job.status === 'completed' ? 'done' : job.status === 'failed' ? 'error' : job.status === 'stopping' || job.status === 'killed' ? 'warning' : 'idle' }), label: job.label, sub: [job.kind, knownKey(t, `jobs.${job.status}`, String(job.status ?? ''))].filter(Boolean).join(' · '), meta: job.durationMs !== undefined ? formatDuration(job.durationMs, t) : null }) })))
      }

      if (model.related.length) {
        sections.push(h(Section, { key: 'related', id: 'related', title: t('section.related'), meta: String(model.related.length), collapsed: collapsed.related, onToggle: toggleSection, t },
          h(LimitedList, { items: model.related, expanded: expanded.related, onExpand: () => onExpand('related'), t,
            renderItem: (item) => h(Row, { key: `${item.relation}:${item.id}`, icon: h(Icon, { name: item.relation === 'fork' || item.relation === 'sideBranch' ? 'branch' : 'rightUp' }), label: item.title || t('related.untitled'), sub: t(`related.${item.relation}`) + (item.relation === 'branchSource' && Number.isSafeInteger(item.turn) ? ` · #${item.turn}` : ''),
              meta: [item.running ? h(Dot, { key: 'r', state: 'running' }) : null, item.archived ? h('span', { key: 'a', className: 'dss-tag' }, t('related.archived')) : null], onClick: () => actions.openSession(item.id) }) })))
      }

      const project = model.project
      const projectTip = project.cwd ? (project.current && project.current !== project.cwd ? `${project.cwd}\n${t('project.cwd', { path: project.current })}` : project.cwd) : t('project.none')
      return h(React.Fragment, null,
        h('div', { className: 'dss-head' },
          h(Tip, { label: `${projectTip}\n${t('drag.hint')}` },
            h('div', { className: 'dss-project', tabIndex: 0, 'aria-label': `${project.cwd || t('project.none')}. ${t('drag.hint')}`, 'data-dss-drag-handle': '', ...dragHandle }, h(Icon, { name: 'folder', size: 16 }), h('span', { className: 'dss-project-name' }, project.name || t('project.none')))),
          compact ? h(Tip, { label: t(compactExpanded ? 'compact.collapse' : 'compact.expand') }, h('button', { type: 'button', className: 'dss-icon-btn', 'data-dss-compact': '', 'aria-expanded': compactExpanded, 'aria-label': t(compactExpanded ? 'compact.collapse' : 'compact.expand'), onClick: onToggleCompact }, h('span', { style: { display: 'inline-flex', transform: compactExpanded ? 'rotate(180deg)' : undefined } }, h(Icon, { name: 'chevronDown', size: 14 })))) : null,
          h(Tip, { label: t(prefs.pinned ? 'unpin' : 'pin') },
            h('button', { type: 'button', className: 'dss-icon-btn', 'aria-pressed': prefs.pinned, 'aria-label': t(prefs.pinned ? 'unpin' : 'pin'), 'data-dss-pin': '', onClick: actions.togglePin }, h(Icon, { name: prefs.pinned ? 'pinFill' : 'pin', size: 14 }))),
          h(Tip, { label: t('more') },
            h('button', { type: 'button', className: 'dss-icon-btn', 'aria-label': t('more'), 'aria-haspopup': 'true', 'aria-expanded': menuOpen, 'data-dss-more': '', onClick: () => setMenuOpen(!menuOpen) }, h(Icon, { name: 'ellipsis', size: 14 }))),
          h(Tip, { label: t('close') },
            h('button', { type: 'button', className: 'dss-icon-btn', 'aria-label': t('close'), 'data-dss-close': '', onClick: actions.close }, h(Icon, { name: 'close', size: 14 }))),
          menuOpen ? h('ul', { className: 'dss-menu', role: 'group', 'aria-label': t('more') },
            h('li', null, h('button', { type: 'button', disabled: !project.cwd, onClick: () => { setMenuOpen(false); actions.copyPath() } }, h(Icon, { name: 'copy', size: 14 }), t('copyPath'))),
            h('li', null, h('button', { type: 'button', disabled: !actions.canOpenFilesTab(), onClick: () => { setMenuOpen(false); actions.openFilesTab() } }, h(Icon, { name: 'tree', size: 14 }), t('openFiles'))),
            h('li', null, h('button', { type: 'button', onClick: () => { setMenuOpen(false); actions.refresh() } }, h(Icon, { name: 'refresh', size: 14 }), t('refresh'))),
            h('li', null, h('button', { type: 'button', onClick: () => { setMenuOpen(false); actions.resetPosition() } }, h(Icon, { name: 'refresh', size: 14 }), t('position.reset')))) : null),
        notice ? h('div', { className: 'dss-notice', role: 'status' }, notice) : null,
        h('div', { className: 'dss-body', onPointerDown: menuOpen ? () => setMenuOpen(false) : undefined }, sections,
          model.partial ? h('div', { className: 'dss-note' }, t('partial'), h('button', { type: 'button', className: 'dss-link', disabled: model.loadingOlder, onClick: actions.loadOlder }, t(model.loadingOlder ? 'loadingOlder' : 'loadOlder'))) : null))
    }

    // ---------------------------------------------- session-scoped data side
    function useJobsRows(api, sessionId) {
      const jobs = api.service('jobs')
      React.useEffect(() => {
        if (typeof jobs?.watchRows !== 'function') return
        let release
        try { release = jobs.watchRows(sessionId) } catch (error) { console.warn('[session-summary] jobs:', errorText(error)) }
        return () => { try { if (typeof release === 'function') release() } catch { /* already released */ } }
      }, [jobs, sessionId])
      const subscribe = React.useCallback((listener) => (typeof jobs?.state?.subscribe === 'function' ? jobs.state.subscribe(listener) : () => {}), [jobs])
      const read = React.useCallback(() => (typeof jobs?.state?.getSnapshot === 'function' ? jobs.state.getSnapshot()?.rows?.[sessionId] : undefined) ?? EMPTY, [jobs, sessionId])
      return React.useSyncExternalStore(subscribe, read, read)
    }
    function useSideBranch(api, sessionId) {
      const [branch, setBranch] = React.useState(null)
      React.useEffect(() => {
        setBranch(null)
        if (!api.hasSideBranch()) return
        const controller = new AbortController()
        api.sideBranchInfo(sessionId, controller.signal).then((value) => { if (!controller.signal.aborted) setBranch(value) }).catch(() => {})
        return () => controller.abort()
      }, [api, sessionId])
      return branch
    }
    const selectHasMore = (session) => session?.hasMore === true
    const selectLoadingOlder = (session) => session?.loadingOlder === true
    const selectSubagent = (session) => session?.subagent ?? null
    const selectSelf = (value) => value
    const selectArchived = (value) => value?.archivedSessionIds ?? EMPTY

    /**
     * Mounted inside the header toggle only while the card is open: reads the
     * Session through the slot's standard selector hooks, derives the model and
     * hands it to this plugin's own overlay entry. Renders nothing itself.
     */
    function SummaryData(props) {
      const { sessionId, api, anchorElement } = props
      const useSession = props.useSession ?? fallbackSelectorHook
      const useSessions = props.useSessions ?? fallbackSelectorHook
      const useSessionStatus = props.useSessionStatus ?? fallbackSelectorHook
      const useWorkspaces = props.useWorkspaces ?? fallbackSelectorHook
      const useChat = props.useChat ?? fallbackSelectorHook
      const useProjection = props.useProjection ?? fallbackProjectionHook
      const list = useSessions(selectSelf)
      const statuses = useSessionStatus(selectSelf)
      const workspaces = useWorkspaces(selectSelf)
      const hasMore = useSession(selectHasMore)
      const loadingOlder = useSession(selectLoadingOlder)
      const subagent = useSession(selectSubagent)
      const chatSnapshot = useChat(selectSelf)
      const catalog = useProjection('subagentCatalog')
      const todos = useProjection('todos')
      const plan = useProjection('plan')
      const goal = useProjection('goal')
      const workingDirectory = useProjection('workingDirectory')
      const chat = useThrottledValue(chatSnapshot, deriveChat, 400)
      const summaries = useStore(api.summaries, selectSelf)
      const jobRows = useJobsRows(api, sessionId)
      const sideBranch = useSideBranch(api, sessionId)
      const byId = isRecord(list?.byId) ? list.byId : {}
      const row = byId[sessionId]
      const cwd = typeof row?.cwd === 'string' && row.cwd ? row.cwd : (typeof workingDirectory === 'string' && workingDirectory ? workingDirectory : undefined)
      const workspace = Array.isArray(workspaces?.items) ? workspaces.items.find((item) => Array.isArray(item?.sessionIds) && item.sessionIds.includes(sessionId)) : undefined
      const childRunning = Array.isArray(catalog) && catalog.some((entry) => (typeof statuses?.get === 'function' ? statuses.get(entry?.id)?.running : undefined) ?? byId[entry?.id]?.running)
      const jobRunning = Array.isArray(jobRows) && jobRows.some((job) => job?.status === 'running' || job?.status === 'stopping')
      const now = useNow(Boolean(childRunning || jobRunning))

      React.useEffect(() => { for (const entry of chat.changeTurns) api.summaries.ensure(sessionId, entry.seq) }, [api, sessionId, chat.changeTurns, summaries])
      React.useEffect(() => {
        // Children never opened may lack projection values until read; the native catalog does the same on expand.
        for (const entry of Array.isArray(catalog) ? catalog : EMPTY) if (isRecord(entry) && entry.mode !== 'external' && byId[entry.id]?.projectionValues === undefined) api.refreshProjections(entry.id)
      }, [api, catalog, byId])

      const model = React.useMemo(() => {
        const changeEntries = chat.changeTurns.map((entry) => ({ ...entry, ...(api.summaries.entry(sessionId, entry.seq) ?? { status: 'loading' }) }))
        const subagents = deriveSubagents(catalog, statuses, byId, now)
        const labels = new Set(subagents.items.map((item) => item.label))
        return {
          project: { name: (typeof workspace?.title === 'string' && workspace.title) || basename(cwd) || '', cwd, current: typeof workingDirectory === 'string' ? workingDirectory : undefined },
          changes: aggregateChanges(changeEntries),
          subagents,
          sources: { web: chat.web, mcp: chat.mcp, skills: chat.skills, files: chat.files.filter((item) => !labels.has(item.path)), sessions: chat.sessions.map((item) => ({ ...item, title: sessionTitle(byId[item.sessionId]) })) },
          plan: { mode: planModeActive(plan), goal: isRecord(goal) && typeof goal.goal?.objective === 'string' ? { objective: goal.goal.objective, phase: goalPhase(goal) } : null, todos: deriveTodos(todos), submitted: chat.plans },
          files: chat.presented,
          jobs: deriveJobs(jobRows, now),
          related: deriveRelated(sessionId, list, selectArchived(workspaces), sideBranch),
          partial: hasMore,
          loadingOlder
        }
      }, [chat, summaries, catalog, statuses, byId, now, workspace, cwd, workingDirectory, plan, goal, todos, jobRows, list, workspaces, sideBranch, hasMore, loadingOlder, sessionId, api])

      React.useLayoutEffect(() => { api.publish(sessionId, { model, context: { cwd, subagent, catalog: Array.isArray(catalog) ? catalog : EMPTY } }) }, [api, sessionId, model, cwd, subagent, catalog])
      React.useLayoutEffect(() => () => api.unpublish(sessionId), [api, sessionId])
      const floating = useStore(api.prefs, (state) => state.floating)
      const cardHeight = useStore(api.ui, (state) => state.cardHeight)
      const cardHeightRef = React.useRef(cardHeight)
      cardHeightRef.current = cardHeight
      const placeRef = React.useRef(null)
      React.useLayoutEffect(() => { placeRef.current?.() }, [cardHeight])
      // Reserve space only inside the owning conversation. No shell replacement.
      // The anchor arrives as state from a callback ref: a parent's object ref
      // is not attached yet when this child's layout effect first runs.
      React.useLayoutEffect(() => {
        const header = anchorElement?.closest?.('header') ?? anchorElement
        if (!header || typeof window === 'undefined') return
        const root = header.closest('[data-phase]')
        const content = [...(root?.querySelectorAll('[data-conversation-content]') ?? [])].find((element) => element.getAttribute('data-conversation-session') === sessionId && element.closest('[data-phase]') === root)
        const clearSpace = () => {
          content?.classList.remove('dss-conversation-layout')
          content?.style.removeProperty('--dss-side-space')
          content?.style.removeProperty('--dss-top-space')
        }
        const place = () => {
          const anchor = summaryLayout(header.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, floating || !content)
          if (content && anchor.layout !== 'floating') {
            content.classList.add('dss-conversation-layout')
            content.style.setProperty('--dss-side-space', `${anchor.layout === 'side' ? anchor.width + 24 : 0}px`)
            content.style.setProperty('--dss-top-space', `${anchor.layout === 'stack' ? Math.min(cardHeightRef.current, anchor.maxHeight) + summaryAccessoryHeight() + 20 : 0}px`)
          } else clearSpace()
          api.publishAnchor(sessionId, anchor)
        }
        placeRef.current = place
        place()
        let frame = 0
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place) }
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        observer?.observe(header)
        window.addEventListener('resize', schedule)
        window.addEventListener('dsh:summary-accessory-change', schedule)
        return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('dsh:summary-accessory-change', schedule); placeRef.current = null; clearSpace() }
      }, [api, sessionId, anchorElement, floating])
      return null
    }

    const selectPrefs = (value) => value
    const selectOpenSession = (value) => value.openSession
    const selectView = (value) => value.view
    const selectTip = (value) => value.tip

    function SummaryToggle(props) {
      const { sessionId, api, t } = props
      const prefs = useStore(api.prefs, selectPrefs)
      const openSession = useStore(api.ui, selectOpenSession)
      const open = prefs.pinned || openSession === sessionId
      const [anchorElement, setAnchorElement] = React.useState(null)
      const buttonRef = React.useRef(null)
      React.useEffect(() => api.registerToggle(sessionId, buttonRef), [api, sessionId])
      React.useEffect(() => { api.forgetOtherSession(sessionId) }, [api, sessionId])
      const useSessionStatus = props.useSessionStatus ?? fallbackSelectorHook
      const catalog = (props.useProjection ?? fallbackProjectionHook)('subagentCatalog')
      const busy = useSessionStatus(React.useCallback((statuses) => typeof statuses?.get === 'function' && Array.isArray(catalog) && catalog.some((entry) => statuses.get(entry?.id)?.running === true), [catalog]))
      const onClick = () => { if (open) api.close(); else api.open(sessionId) }
      const label = t(open ? 'toggle.close' : 'toggle.open')
      return h(ApiContext.Provider, { value: api },
        h('span', { ref: setAnchorElement, className: 'dss-anchor', 'data-dsh-session-summary-toggle': '' },
          h(Tip, { label },
            h('button', { ref: buttonRef, type: 'button', className: 'dss-toggle', 'aria-label': label, 'aria-expanded': open, 'aria-controls': open ? CARD_ID : undefined, onClick },
              h(Icon, { name: 'list', size: 16 }),
              busy && !open ? h('span', { className: 'dss-toggle-badge', 'aria-hidden': true }) : null)),
          open ? h(SummaryData, { ...props, key: sessionId, anchorElement }) : null))
    }

    // ---------------------------------------------------- frame overlay side
    /** The card itself, rendered by this plugin's `shell.overlay` entry. */
    function SummaryCardHost({ api, t, view, prefs }) {
      const { sessionId, model, context, anchor } = view
      const pinned = prefs.pinned
      const cardRef = React.useRef(null)
      const [expanded, setExpanded] = React.useState({})
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [compactExpanded, setCompactExpanded] = React.useState(false)
      const compact = anchor?.layout === 'stack'
      const [offset, setOffset] = React.useState({ x: 0, y: 0 })
      const close = React.useCallback(() => api.close(), [api])

      const [viewport, setViewport] = React.useState(() => ({ width: window.innerWidth, height: window.innerHeight, reservedHeight: summaryAccessoryHeight() }))
      const [measuredHeight, setMeasuredHeight] = React.useState(null)
      const [dragPosition, setDragPosition] = React.useState(null)
      const dragRef = React.useRef(null)
      const placement = anchor ? cardPlacement(anchor, dragPosition ?? (prefs.floating ? prefs.position : null), viewport, measuredHeight, viewport.reservedHeight) : null
      React.useLayoutEffect(() => {
        const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight, reservedHeight: summaryAccessoryHeight() })
        const measure = () => { if (cardRef.current) { const height = cardRef.current.getBoundingClientRect().height; setMeasuredHeight(height); api.ui.set({ cardHeight: height }) } }
        measure()
        let frame = 0
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        if (cardRef.current) observer?.observe(cardRef.current)
        window.addEventListener('resize', resize)
        window.addEventListener('dsh:summary-accessory-change', resize)
        return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', resize); window.removeEventListener('dsh:summary-accessory-change', resize) }
      }, [])
      // Keep containing-block compensation separate from the user's viewport position.
      React.useLayoutEffect(() => {
        const element = cardRef.current
        if (!element || !placement) return
        const rect = element.getBoundingClientRect()
        const dx = placement.left - rect.left, dy = placement.top - rect.top
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setOffset((current) => ({ x: current.x + dx, y: current.y + dy }))
      }, [anchor, viewport, placement?.left, placement?.top, placement?.width, placement?.maxHeight])
      React.useEffect(() => () => dragRef.current?.cleanup(), [])
      const dragHandle = {
        onPointerDown(event) {
          if (event.button !== 0 || event.isPrimary === false || dragRef.current || !placement) return
          const element = event.currentTarget
          const rect = cardRef.current.getBoundingClientRect()
          const startX = event.clientX, startY = event.clientY
          const pointerId = event.pointerId
          const drag = { last: null, cleanup: null }
          const move = (next) => {
            if (next.pointerId !== pointerId) return
            const dx = next.clientX - startX, dy = next.clientY - startY
            if (!drag.last && Math.hypot(dx, dy) < 3) return
            const box = cardPlacement(anchor, { left: rect.left + dx, top: rect.top + dy }, { width: window.innerWidth, height: window.innerHeight }, rect.height, summaryAccessoryHeight())
            drag.last = { left: box.left, top: box.top }
            setDragPosition(drag.last)
          }
          const finish = (next) => {
            if (next.pointerId !== undefined && next.pointerId !== pointerId) return
            if (next.type === 'pointerup') move(next)
            drag.cleanup()
            if (drag.last && next.type !== 'pointercancel') api.setPosition(drag.last)
            setDragPosition(null)
          }
          drag.cleanup = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', finish)
            window.removeEventListener('pointercancel', finish)
            window.removeEventListener('blur', finish)
            element.removeEventListener('lostpointercapture', finish)
            dragRef.current = null
            try { if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId) } catch { /* detached */ }
          }
          dragRef.current = drag
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', finish)
          window.addEventListener('pointercancel', finish)
          window.addEventListener('blur', finish)
          element.addEventListener('lostpointercapture', finish)
          try { element.setPointerCapture(pointerId) } catch { /* window listeners also cover synthetic/unsupported capture */ }
          setMenuOpen(false)
          api.tip.set({ tip: null })
          element.focus({ preventScroll: true })
          event.preventDefault()
        },
        onKeyDown(event) {
          if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || dragRef.current) return
          if (event.key === 'Home') { event.preventDefault(); api.setPosition(null); return }
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
          if (!direction || !placement) return
          event.preventDefault()
          const step = event.shiftKey ? 64 : 16
          const box = cardPlacement(anchor, { left: placement.left + direction[0] * step, top: placement.top + direction[1] * step }, viewport, measuredHeight, viewport.reservedHeight)
          api.setPosition({ left: box.left, top: box.top })
        }
      }
      React.useEffect(() => {
        if (pinned) return
        const onPointerDown = (event) => {
          const target = event.target
          if (cardRef.current?.contains?.(target) || target?.closest?.('[data-dsh-session-summary-toggle]')) return
          close()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => document.removeEventListener('pointerdown', onPointerDown, true)
      }, [pinned, close])
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
          const card = cardRef.current
          if (!card || document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return
          const inside = card.contains(document.activeElement)
          if (menuOpen && inside) { event.preventDefault(); setMenuOpen(false); return }
          if (pinned && !inside) return
          event.preventDefault()
          close()
          api.focusToggle(sessionId)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [pinned, close, menuOpen, api, sessionId])
      React.useEffect(() => {
        if (!notice) return
        const timer = setTimeout(() => setNotice(null), 3200)
        return () => clearTimeout(timer)
      }, [notice])

      const cwd = context?.cwd
      const actions = React.useMemo(() => {
        const guard = (operation) => {
          try {
            const result = operation()
            if (result && typeof result.then === 'function') result.catch((error) => setNotice(t('openFailed', { reason: errorText(error) })))
          } catch (error) { setNotice(t('openFailed', { reason: errorText(error) })) }
        }
        return {
          close,
          togglePin: () => api.togglePin(sessionId),
          resetPosition: () => api.setPosition(null),
          toggleSection: api.toggleSection,
          openChange: (file) => guard(() => api.openResource(changesReviewAddress(sessionId, file.latest.seq, file.latest.turn), { params: { index: file.latest.index } })),
          retryChanges: () => api.summaries.retry(sessionId),
          openSubagent: (item) => guard(() => api.openResource(subagentChatAddress(sessionId, item.id, item.mode === 'external' ? 'unknown' : item.mode), { kind: 'subagentchat', preferNewPane: true })),
          openUrl: (url) => guard(() => api.openUrl(url)),
          openSkill: (name) => guard(() => api.openSkill(sessionId, cwd, name)),
          openFile: (path) => guard(() => api.openResource(fileAddressFor(sessionId, cwd, path))),
          openSession: (id) => guard(() => api.openSession(id)),
          openPlan: (callId) => guard(() => api.openResource(planAddress(sessionId, context?.subagent, callId))),
          openFilesTab: () => guard(() => api.openFilesTab()),
          canOpenFilesTab: () => api.canOpenFilesTab(),
          copyPath: () => guard(async () => { await api.copyText(cwd); setNotice(t('copied')) }),
          refresh: () => { api.summaries.retry(sessionId); for (const entry of context?.catalog ?? EMPTY) if (isRecord(entry) && entry.mode !== 'external') api.refreshProjections(entry.id, true) },
          loadOlder: () => guard(() => api.loadOlder(sessionId))
        }
      }, [api, sessionId, cwd, context, close, t])

      const style = placement
        ? { ...placement, top: placement.top + offset.y, left: placement.left + offset.x }
        : { visibility: 'hidden', top: 0, left: 0 }
      return h('section', { id: CARD_ID, ref: cardRef, className: 'dss-card', role: 'dialog', 'aria-label': t('card.aria'), 'data-dsh-session-summary': sessionId, 'data-pinned': pinned ? '' : undefined, 'data-dragging': dragPosition ? '' : undefined, 'data-layout': anchor?.layout, 'data-compact-collapsed': compact && !compactExpanded ? '' : undefined, style },
        h(SummaryCard, { model, t, actions, prefs, expanded, onExpand: (id) => setExpanded((current) => ({ ...current, [id]: !current[id] })), menuOpen, setMenuOpen, notice, dragHandle, compact, compactExpanded, onToggleCompact: () => setCompactExpanded(value => !value) }))
    }
    function SummaryOverlay({ api, t }) {
      const view = useStore(api.view, selectView)
      const prefs = useStore(api.prefs, selectPrefs)
      const openSession = useStore(api.ui, selectOpenSession)
      const tip = useStore(api.tip, selectTip)
      const open = Boolean(view?.model) && (prefs.pinned || openSession === view.sessionId)
      React.useEffect(() => {
        if (!tip) return
        const hide = () => api.hideTip(tip.id)
        window.addEventListener('scroll', hide, true)
        window.addEventListener('blur', hide)
        return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide) }
      }, [api, tip])
      return h(ApiContext.Provider, { value: api },
        open ? h(SummaryCardHost, { key: view.sessionId, api, t, view, prefs }) : null,
        tip ? h(TipBubble, { key: `${tip.id}:${tip.text}`, tip }) : null)
    }

    // ---------------------------------------------------------------- apply
    function createApi(ctx, { storage, fetchImpl, transportFetch, clipboard, openWindow }) {
      const prefs = createStore(sanitizePrefs({}), { storage, key: STORAGE_KEY, sanitize: sanitizePrefs, serialize: ({ position }) => ({ position }) })
      const ui = createStore({ openSession: null, cardHeight: 40 })
      const view = createStore({ view: null })
      const tip = createStore({ tip: null })
      const summaries = createSummaryCache(fetchImpl)
      const refreshed = new Set()
      const toggles = new Map()
      const service = (name) => { try { return ctx.get(name) } catch { return undefined } }
      const requireService = (name) => {
        const value = service(name)
        if (!value) throw new Error(`${name} unavailable`)
        return value
      }
      const tabs = () => service('sidebarRightTabs')
      return {
        prefs, ui, view, tip, summaries, service,
        setPosition(position) { const next = sanitizePosition(position); prefs.set({ position: next, floating: next !== null }) },
        open(sessionId) { ui.set({ openSession: sessionId }) },
        close() { prefs.set({ pinned: false }); ui.set({ openSession: null }) },
        togglePin(sessionId) {
          if (prefs.getSnapshot().pinned) { prefs.set({ pinned: false }); ui.set({ openSession: sessionId }) } else prefs.set({ pinned: true })
        },
        /** An unpinned card belongs to the Session it was opened in. */
        forgetOtherSession(sessionId) {
          const current = ui.getSnapshot().openSession
          if (current !== null && current !== sessionId && !prefs.getSnapshot().pinned) ui.set({ openSession: null })
        },
        toggleSection(id) {
          if (!SECTION_IDS.includes(id)) return
          prefs.set((state) => { const collapsed = { ...state.collapsed }; if (collapsed[id]) delete collapsed[id]; else collapsed[id] = true; return { collapsed } })
        },
        publish(sessionId, value) { view.set((state) => ({ view: { ...(state.view?.sessionId === sessionId ? state.view : {}), sessionId, ...value } })) },
        publishAnchor(sessionId, anchor) {
          const current = view.getSnapshot().view
          const previous = current?.sessionId === sessionId ? current.anchor : undefined
          if (previous && previous.right === anchor.right && previous.top === anchor.top && previous.width === anchor.width && previous.maxHeight === anchor.maxHeight && previous.layout === anchor.layout) return
          view.set((state) => ({ view: { ...(state.view?.sessionId === sessionId ? state.view : {}), sessionId, anchor } }))
        },
        unpublish(sessionId) { if (view.getSnapshot().view?.sessionId === sessionId) view.set({ view: null }) },
        registerToggle(sessionId, ref) { toggles.set(sessionId, ref); return () => { if (toggles.get(sessionId) === ref) toggles.delete(sessionId) } },
        focusToggle(sessionId) { try { toggles.get(sessionId)?.current?.focus?.() } catch { /* detached */ } },
        showTip(value) { tip.set({ tip: value }) },
        hideTip(id) { if (tip.getSnapshot().tip?.id === id) tip.set({ tip: null }) },
        openResource(address, options) { requireService('sidebarRight').openResource(address, options) },
        openUrl(url) {
          if (!isHttpUrl(url)) throw new Error('unsupported URL')
          const sidebar = service('sidebarRight')
          if (sidebar && tabs()?.get?.('browser') !== undefined) sidebar.openTab('browser', { params: { url } })
          else openWindow(url)
        },
        async openSkill(sessionId, cwd, name) {
          const skills = service('remote')?.skills ?? service('remote.skills')
          if (typeof skills?.list !== 'function') throw new Error('skills unavailable')
          const result = await skills.list({ sessionId })
          const path = result?.ok ? result.value?.skills?.find?.((skill) => skill?.name === name)?.path : undefined
          if (typeof path !== 'string' || !path) throw new Error(name)
          requireService('sidebarRight').openResource(fileAddressFor(sessionId, cwd, path))
        },
        openSession(id) { requireService('uiWorkspace').openSession(id) },
        canOpenFilesTab() { return Boolean(service('sidebarRight')) && tabs()?.get?.('files') !== undefined },
        openFilesTab() { requireService('sidebarRight').openTab('files') },
        async copyText(text) {
          if (typeof text !== 'string' || !text) throw new Error('empty')
          if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard unavailable')
          await clipboard.writeText(text)
        },
        loadOlder(sessionId) {
          const session = service('sessions')?.binding?.(sessionId)?.session
          if (typeof session?.loadOlder !== 'function') throw new Error('history paging unavailable')
          return session.loadOlder()
        },
        refreshProjections(childId, force = false) {
          if (!force && refreshed.has(childId)) return
          refreshed.add(childId)
          const sessions = service('sessions')
          if (typeof sessions?.refreshProjections !== 'function') return
          try { const result = sessions.refreshProjections(childId); if (result && typeof result.catch === 'function') result.catch(() => {}) } catch { /* optional enrichment */ }
        },
        hasSideBranch() { return tabs()?.get?.('side-branch') !== undefined },
        async sideBranchInfo(sessionId, signal) {
          const response = await transportFetch('/api/side-branch/branch', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal })
          const data = await response.json()
          return data?.ok === true && isRecord(data.branch) ? data.branch : null
        },
        dispose() { summaries.dispose(); view.set({ view: null }); tip.set({ tip: null }) }
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), '[session-summary] locale')
      ctx.effect(() => {
        // Plugin stylesheet, owned by this effect (the documented native pattern).
        if (typeof document === 'undefined' || !document.head) return () => {}
        const style = document.createElement('style')
        style.dataset.plugin = NAME
        style.dataset.pluginCss = `${NAME}/client.css`
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, '[session-summary] styles')
      let storage
      try { storage = globalThis.localStorage } catch { storage = undefined }
      const transport = globalThis.__DSH_TRANSPORT__
      const api = createApi(ctx, {
        storage,
        fetchImpl: (...args) => globalThis.fetch(...args),
        transportFetch: transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args),
        clipboard: globalThis.navigator?.clipboard,
        openWindow: (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer')
      })
      ctx.effect(() => () => api.dispose(), '[session-summary] lifetime')
      const label = () => ctx.locale.bind(NS)('title')
      ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT, id: ENTRY_ID, order: 100, locale: NS, label, inject: () => ({ api })
      }, SummaryToggle)), '[session-summary] header toggle')
      ctx.effect(() => ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
        name: OVERLAY_SLOT, id: OVERLAY_ID, order: 40, locale: NS, label, inject: () => ({ api })
      }, SummaryOverlay)), '[session-summary] card overlay')
    }

    return {
      name: NAME, inject: ['slots', 'locale'], apply,
      // Pure helpers exported for the package's own tests.
      deriveChat, aggregateChanges, deriveSubagents, deriveRelated, deriveJobs, deriveTodos, planModeActive, fileReferences, parseMcpName, callInfo,
      fileAddressFor, changesReviewAddress, subagentChatAddress, planAddress, changesSummaryUrl, formatDuration, formatTokens, basename, hostOf, displayPath,
      createStore, sanitizePrefs, sanitizePosition, cardPlacement, summaryLayout, summaryAccessoryHeight, createSummaryCache, createApi, SummaryCard, SummaryCardHost, SummaryOverlay, SummaryToggle, SummaryData, ApiContext,
      HOST_ICONS, ZH, EN, CSS, SLOT, ENTRY_ID, OVERLAY_SLOT, OVERLAY_ID, STORAGE_KEY, SECTION_IDS
    }
  }
})
