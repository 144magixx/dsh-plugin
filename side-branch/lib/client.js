/**
 * dsh-side-branch Client. Hand-written classic-script ModuleLoader bundle.
 * All conversation rendering, input, model/permission selection and interaction
 * requests belong to DSH's native conversation.content factory.
 * Verified against published 0.2.1-rc.2 source; not a runtime acceptance claim.
 */
window.__ModuleLoader__.load({
  id: 'dsh-side-branch',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const KIND = 'side-branch'
    const TYPE = 'dsh-side-branch'
    const SLOT = 'side-branch.conversation'
    const NS = 'side-branch'
    const PREFIX = 'dsh-resource://side-branch/session/'
    const STORAGE_KEY = 'dsh.side-branch.recovery.v1'
    const EMPTY = Object.freeze([])
    // crypto.randomUUID exists only in secure contexts (HTTPS/localhost); `dsh web`
    // on a LAN address is plain HTTP, so mint v4 UUIDs from getRandomValues instead.
    const randomUUID = () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    const ZH = {
      title: '岔路 · 侧栏分支', guide: '选择历史轮次续问，或编辑原提问；分支持久保留在会话列表中',
      continue: '侧栏分支', edit: '编辑本轮提问', continueMode: '从本轮之后续问', editMode: '编辑本轮提问',
      turnTitle: '自第 {turn} 轮', editTitle: '改第 {turn} 轮', turn: '第 {turn} 轮',
      loading: '正在读取…', retry: '重试', create: '创建并在侧栏打开', creating: '正在创建…',
      unavailable: '仅可从已完成轮次的最后一条回复分支', unsupported: '当前 DSH 缺少原生会话嵌入或草稿接口，请检查插件兼容版本',
      empty: '当前会话没有可用轮次', select: '选择起点', search: '筛选提问或回答', noHuman: '本轮没有可编辑的首条人类提问',
      retained: '保留第 1–{keep} 轮；不继承第 {from}–{total} 轮', retainedNone: '不继承历史轮次；从修改后的第 1 轮提问开始',
      editing: '正在编辑第 {turn} 轮提问', anchored: '分支来自第 {turn} 轮之后',
      attachments: '原提问含 {count} 个附件，请在原生输入框中重新添加',
      drift: '切点之后源会话还有 {count} 轮；当前工作区文件没有回滚', files: '查看 {count} 个可能已变动的文件',
      unknown: '含 shell 命令或无法恢复的改动记录，可能存在未列出的文件改动',
      concurrent: '两个会话正在同一工作区工作。文件编辑需要读取最新内容；shell 改动不受过期版本检查保护。',
      native: '使用下方原生输入框修改提问、选择模型和权限后发送', original: '查看原提问',
      openMain: '在主视图打开', close: '关闭分支标签', keep: '保留', archive: '归档', cancel: '取消',
      closeTitle: '保留还是归档此分支？', closeBody: '保留会话是默认选择。归档后仍可从已归档会话中恢复。',
      remember: '记住我的选择', running: '分支仍在运行。保留标签外的任务；如需归档，请先在原生会话中停止任务。',
      recovery: '待处理的分支', recoveryBody: '原生标签关闭后，会话仍保留。可在这里决定保留或归档。',
      reopen: '重新打开', retainedNotice: '分支已保留', error: '操作失败', sourceArchived: '源会话已归档',
      requestSaved: '创建请求已保存；重试将恢复同一个分支', configError: '分支尚未完成初始化，暂不能发送消息',
      newRequest: '检查会话列表后另建分支', newRequestHelp: '之前的分支可能已经创建，或已包含待处理输入。请先检查会话列表；另建分支会保留原会话及其中的工作。',
      editPrompt: '编辑', forkPrompt: '分叉', editPromptHint: '编辑这条历史提问', forkPromptHint: '保留这一轮的提问和回答，从本轮之后创建侧栏分支',
      saveEdit: '保存并重新发送', prepareEdit: '在输入框中继续', revisionHelp: '修改后在主视图打开新版本，保留旧版本；不继承本轮原回答和后续对话。', editAttachments: '原提问含附件：修改后将打开新版本的输入框，请重新添加附件再发送。',
      forkTitle: '第 {turn} 轮分叉', forkEditing: '分叉起点：第 {turn} 轮提问', userUnavailable: '本轮完成后可编辑提问或分叉',
      modelHint: '初始模型和权限取源会话当前配置；可在原生输入框中调整', clearChoice: '清除记住的关闭选择'
    }
    const EN = {
      title: 'Side branch', guide: 'Continue from a historical turn or edit its original prompt; branches stay in the session list',
      continue: 'Side branch', edit: 'Edit this prompt', continueMode: 'Continue after this turn', editMode: 'Edit this prompt',
      turnTitle: 'After turn {turn}', editTitle: 'Edit turn {turn}', turn: 'Turn {turn}',
      loading: 'Loading…', retry: 'Retry', create: 'Create and open in sidebar', creating: 'Creating…',
      unavailable: 'Only the final response of a completed turn can be branched', unsupported: 'This DSH version lacks the required native conversation or draft interface',
      empty: 'No eligible turns in this session', select: 'Choose a starting point', search: 'Filter prompts or responses', noHuman: 'This turn has no initial human prompt to edit',
      retained: 'Keep turns 1–{keep}; exclude turns {from}–{total}', retainedNone: 'Start with the edited first prompt, with no inherited turns',
      editing: 'Editing the prompt of turn {turn}', anchored: 'Branch after turn {turn}',
      attachments: 'The original prompt has {count} attachment(s). Add them again in the native composer.',
      drift: 'The source has {count} later turn(s). Workspace files have not been rolled back.', files: 'Show {count} potentially changed files',
      unknown: 'Shell commands or unavailable change records may have changed files missing from this list.',
      concurrent: 'Both sessions are working in the same workspace. Read current files before editing; shell changes are not protected by stale-version checks.',
      native: 'Edit the prompt and choose model and permissions in the native composer below', original: 'View original prompt',
      openMain: 'Open in main view', close: 'Close branch tab', keep: 'Keep', archive: 'Archive', cancel: 'Cancel',
      closeTitle: 'Keep or archive this branch?', closeBody: 'Keep is the default. Archived sessions can be restored from the archived session list.',
      remember: 'Remember my choice', running: 'This branch is still running. Keep its task running outside the tab, or stop it in the native conversation before archiving.',
      recovery: 'Branches awaiting a decision', recoveryBody: 'Closing a native tab keeps the session. Decide here whether to keep or archive it.',
      reopen: 'Reopen', retainedNotice: 'Branch kept', error: 'Operation failed', sourceArchived: 'Source session archived',
      requestSaved: 'Creation request saved; retry will recover the same branch', configError: 'Branch initialization is incomplete; sending is unavailable',
      newRequest: 'Inspect sessions, then create another branch', newRequestHelp: 'The previous branch may already exist or contain pending input. Inspect the session list first; creating another branch keeps the original session and its work.',
      editPrompt: 'Edit', forkPrompt: 'Fork', editPromptHint: 'Edit this historical prompt', forkPromptHint: 'Keep this turn’s prompt and answer, then fork after this turn',
      saveEdit: 'Save and resend', prepareEdit: 'Continue in composer', revisionHelp: 'Open an edited version in the main view and keep the original. Its old answer and later conversation are excluded.', editAttachments: 'This prompt has attachments. Continue in the new version’s composer, add the attachments again, then send.',
      forkTitle: 'Fork at turn {turn}', forkEditing: 'Fork starts at prompt {turn}', userUnavailable: 'Edit or fork this prompt after the turn finishes',
      modelHint: 'Initial model and permissions come from the source’s current settings; change them in the native composer', clearChoice: 'Clear remembered close choice'
    }

    function BranchIcon({ size = 22, className }) {
      return h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size, className, fill: 'none', stroke: '#608de6', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M6 6v12M6 12c0-5 12 0 12-6' }),
        h('circle', { cx: 6, cy: 4, r: 2 }),
        h('circle', { cx: 6, cy: 20, r: 2 }),
        h('circle', { cx: 18, cy: 4, r: 2 }))
    }

    function branchAddress(branch) {
      if (!branch || typeof branch.sessionId !== 'string' || !branch.sessionId || typeof branch.sourceSessionId !== 'string' || !branch.sourceSessionId || !['continue', 'edit'].includes(branch.mode) || !Number.isSafeInteger(branch.turn) || branch.turn < 1) throw new Error('Invalid branch address')
      const params = new URLSearchParams({ source: branch.sourceSessionId, mode: branch.mode, turn: String(branch.turn) })
      if (['fork', 'revise'].includes(branch.intent)) params.set('intent', branch.intent)
      return `${PREFIX}${encodeURIComponent(branch.sessionId)}?${params}`
    }
    function parseBranchAddress(value) {
      try {
        const url = new URL(value)
        const parts = url.pathname.split('/').filter(Boolean)
        const sourceSessionId = url.searchParams.get('source')
        const mode = url.searchParams.get('mode')
        const turnText = url.searchParams.get('turn')
        const turn = Number(turnText)
        if (url.protocol !== 'dsh-resource:' || url.hostname !== KIND || parts.length !== 2 || parts[0] !== 'session' || !sourceSessionId || !['continue', 'edit'].includes(mode) || !/^\d+$/.test(turnText ?? '') || !Number.isSafeInteger(turn) || turn < 1) return null
        const sessionId = decodeURIComponent(parts[1])
        const intent = url.searchParams.get('intent')
        if (intent !== null && !['fork', 'revise'].includes(intent)) return null
        return sessionId ? { sessionId, sourceSessionId, mode, turn, ...(intent ? { intent } : {}) } : null
      } catch { return null }
    }
    function errorText(error) { return error instanceof Error ? error.message : String(error?.message ?? error) }
    function requiresNewRequest(error) { return error?.code === 'creation-uncertain' || error?.code === 'branch-has-work' }
    function nativeCapabilities(ctx) {
      try {
        return typeof ctx.sessions?.retain === 'function' && typeof ctx.conversation?.input?.requestDraftInitialization === 'function' &&
          typeof ctx.slots?.snapshot === 'function' && ctx.slots.snapshot('factory:conversation.content').length > 0
      } catch { return false }
    }
    function createApi(send) {
      return async (operation, body, signal) => {
        if (!['turns', 'anchor-info', 'create', 'branch', 'close'].includes(operation)) throw new Error('Unknown side-branch operation')
        const response = await send(`/api/side-branch/${operation}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
        let data
        try { data = await response.json() } catch { throw new Error(`side-branch: HTTP ${response.status}`) }
        if (!response.ok || data?.ok !== true) {
          const error = new Error(data?.message || `side-branch: HTTP ${response.status}`)
          error.code = data?.code
          error.sessionId = data?.sessionId
          throw error
        }
        return data
      }
    }
    /** One derived lookup per immutable Chat snapshot, shared by every footer. */
    const nativeTurnCache = new WeakMap()
    /** Match the shipped TurnTailNodeView gating using its existing Chat view. */
    function nativeTurnState(snapshot, messageId) {
      if (!snapshot?.locations?.getTurn || !snapshot?.nodes?.get) return ''
      let lookup = nativeTurnCache.get(snapshot)
      if (!lookup) {
        lookup = new Map()
        for (const turn of snapshot.timeline?.turnOrder ?? EMPTY) {
          const nodes = snapshot.locations.getTurn(turn).map((key) => snapshot.nodes.get(key)).filter(Boolean)
          const tail = nodes.find((node) => node.kind === 'turn-tail' && node.data?.closing?.finalNode?.messageId)
          if (!tail) continue
          const last = nodes.findLast((node) => !['turn-tail', 'turn-process', 'turn-max-tokens'].includes(node.kind))
          const unavailable = tail.data.branchUnavailable || (last?.anchorSeq ?? -1) > (tail.data.closing.finalNode.seq ?? tail.data.seq)
          lookup.set(tail.data.closing.finalNode.messageId, `${turn}:${unavailable ? 'blocked' : 'ready'}`)
        }
        nativeTurnCache.set(snapshot, lookup)
      }
      return lookup.get(messageId) ?? ''
    }
    function nativeUserTurnState(snapshot, node) {
      const location = node?.location
      if (node?.kind !== 'user' || node.data?.source?.kind !== 'user' || typeof node.id !== 'string' || !node.id || !['turn', 'step'].includes(location?.kind)) return ''
      const turn = location.turn?.turn
      if (!Number.isSafeInteger(turn) || turn < 1 || !snapshot?.locations?.getTurn || !snapshot?.nodes?.get) return ''
      const prompts = snapshot.locations.getTurn(turn).map((key) => snapshot.nodes.get(key)).filter((item) => ['user', 'steering'].includes(item?.kind) && item.data?.source?.kind === 'user')
      const first = prompts.reduce((initial, item) => !initial || item.data.seq < initial.data.seq ? item : initial, null)
      if (first?.id !== node.id) return ''
      const recorded = snapshot.timeline?.turns?.get(turn) ?? location.turn
      return `${turn}:${recorded?.end ? 'ready' : 'blocked'}`
    }
    function eligible(row, mode) { return row?.completed === true && (mode === 'edit' ? row.editable === true : row.branchable !== false) }
    function retryBranchAddress(value, nonce) {
      if (!parseBranchAddress(value)) throw new Error('Invalid side-branch resource')
      const url = new URL(value); url.searchParams.set('retry', nonce); return url.toString()
    }
    function preview(text, limit) { return Array.from(String(text ?? '')).slice(0, limit).join('') }
    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve()
      return new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    }
    function readRecovery(storage) {
      try {
        const data = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}')
        return { records: Array.isArray(data.records) ? data.records.filter((item) => { try { return !!branchAddress(item) } catch { return false } }) : [], preference: ['keep', 'archive'].includes(data.preference) ? data.preference : null, requests: data.requests && typeof data.requests === 'object' && !Array.isArray(data.requests) ? data.requests : {} }
      } catch { return { records: [], preference: null, requests: {} } }
    }
    function requestKey(request) {
      const identity = [request.sourceSessionId, request.mode, request.turn ?? null, request.messageId ?? null]
      if (request.expectedPromptMessageId !== undefined || request.intent !== undefined || request.editId !== undefined) identity.push(request.expectedPromptMessageId ?? null, request.intent ?? null, request.editId ?? null)
      return JSON.stringify(identity)
    }
    /** All close work is recorded synchronously before the native void handler returns. */
    function createRuntime({ api, storage, makeId, onRecover = () => {}, log = console }) {
      let state = readRecovery(storage)
      const listeners = new Set()
      const skipClose = new Set()
      const creations = new Map()
      const closing = new Map()
      let disposed = false
      function publish() {
        try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (error) { log.warn('[side-branch] recovery storage:', errorText(error)) }
        if (!disposed) for (const listener of listeners) listener()
      }
      function record(branch, patch = {}) {
        const { sessionId, sourceSessionId, turn, mode } = branch
        const previous = state.records.find((item) => item.sessionId === sessionId)
        const next = { ...previous, sessionId, sourceSessionId, turn, mode, ...(branch.intent ? { intent: branch.intent } : {}), ...patch }
        state = { ...state, records: [...state.records.filter((item) => item.sessionId !== sessionId), next] }
        publish()
      }
      function forget(sessionId) { state = { ...state, records: state.records.filter((item) => item.sessionId !== sessionId) }; publish() }
      const runtime = {
        api, getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        setPreference(preference) { state = { ...state, preference: ['keep', 'archive'].includes(preference) ? preference : null }; publish() },
        record, forget,
        create(request) {
          const key = requestKey(request)
          if (creations.has(key)) return creations.get(key)
          const requestId = state.requests[key] ?? makeId()
          state = { ...state, requests: { ...state.requests, [key]: requestId } }; publish()
          const operation = api('create', { ...request, requestId }).then((result) => {
            if (!result.branch?.ready) throw new Error('Branch initialization is incomplete')
            const branch = request.intent ? { ...result.branch, intent: request.intent } : result.branch
            record(branch, { requestKey: key })
            // Keep request id until navigation succeeds; a failed open can retry safely.
            return branch
          }).finally(() => creations.delete(key))
          creations.set(key, operation)
          return operation
        },
        newRequest(request) {
          const key = requestKey(request)
          if (creations.has(key)) throw new Error('Branch creation is still pending')
          const requests = { ...state.requests }; delete requests[key]
          // Detach the old branch's retry link so reopening it cannot clear the
          // new request. Keep every old recovery record and all session content.
          const records = state.records.map((record) => {
            if (record.requestKey !== key) return record
            const { requestKey, ...preserved } = record; return preserved
          })
          state = { ...state, requests, records }; publish()
        },
        createdOpened(request) {
          const key = requestKey(request)
          const requests = { ...state.requests }; delete requests[key]; state = { ...state, requests }; publish()
        },
        opened(branch) {
          const existing = state.records.find((item) => item.sessionId === branch.sessionId)
          const requests = { ...state.requests }
          if (existing?.requestKey) delete requests[existing.requestKey]
          state = { ...state, requests }; record(branch, { pendingOpen: false, pendingClose: false, error: undefined })
        },
        async resolveClose(branch, action, remember = false) {
          const result = await api('close', { sessionId: branch.sessionId, action })
          if (result.status === 'archived' || result.status === 'kept') {
            if (remember) runtime.setPreference(action)
            forget(branch.sessionId)
          } else record(branch, { pendingClose: true, running: result.running === true, status: result.status })
          return result
        },
        closeResolved(sessionId) { skipClose.add(sessionId) },
        closeFromTab(address, ownerSessionId) {
          const branch = parseBranchAddress(address)
          if (!branch || disposed) return
          if (skipClose.delete(branch.sessionId)) return
          record(branch, { pendingClose: true, status: 'checking', ownerSessionId })
          if (closing.has(branch.sessionId)) return
          const operation = api('close', { sessionId: branch.sessionId, action: 'auto' }).then(async (result) => {
            if (result.status === 'archived') { forget(branch.sessionId); return }
            if (state.preference && !(state.preference === 'archive' && result.running)) {
              result = await runtime.resolveClose(branch, state.preference)
              if (['archived', 'kept'].includes(result.status)) return
            }
            record(branch, { pendingClose: true, running: result.running === true, status: result.status })
            if (!disposed) onRecover(branch, ownerSessionId)
          }).catch((error) => {
            record(branch, { pendingClose: true, error: errorText(error) })
            log.warn('[side-branch] close deferred:', errorText(error))
            if (!disposed) onRecover(branch, ownerSessionId)
          }).finally(() => closing.delete(branch.sessionId))
          closing.set(branch.sessionId, operation)
          return operation
        },
        dispose() { disposed = true; listeners.clear() }
      }
      return runtime
    }
    /** Ordinary native sessions retain their plain id, never a SubagentAddress. */
    function branchResourceProvider(ctx, api) {
      return { protocol: KIND, async *open(address, { signal }) {
        if (signal.aborted) return
        try {
          const parsed = parseBranchAddress(address)
          if (!parsed) throw new Error('Invalid side-branch resource')
          const data = await api('branch', { sessionId: parsed.sessionId }, signal)
          if (signal.aborted) return
          if (!data.branch?.ready || data.branch.sessionId !== parsed.sessionId || data.branch.sourceSessionId !== parsed.sourceSessionId || data.branch.mode !== parsed.mode || data.branch.turn !== parsed.turn) throw new Error('Branch initialization is incomplete or resource identity does not match')
          if (parsed.intent && !data.branch.intent) data.branch = { ...data.branch, intent: parsed.intent }
          const reference = ctx.sessions.retain(parsed.sessionId, { source: 'sidebarChat', signal })
          try {
            await reference.ready
            if (signal.aborted) return
            if (data.branch.mode === 'edit' && data.ownUserMessages === 0 && !data.hasPendingHumanInput) {
              const initialize = ctx.conversation?.input?.requestDraftInitialization
              if (typeof initialize !== 'function') throw new Error('Native draft initialization is unavailable')
              const result = initialize.call(ctx.conversation.input, reference.binding, { prompt: data.branch.originalPrompt })
              if (result === 'blocked') throw new Error('Native draft initialization is temporarily blocked')
            }
            yield { ok: true, value: { reference, ...data } }
            await waitForAbort(signal)
          } finally { reference.release() }
        } catch (error) {
          // ResourceRegistry consumes failure frames; it does not catch a throw.
          if (!signal.aborted) yield { ok: false, error: { code: error.code ?? 'side-branch/resource', message: errorText(error) } }
        }
      } }
    }

    const CSS = `
.sb-root{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}
.sb-scroll{overflow:auto;min-height:0;padding:14px;display:flex;flex-direction:column;gap:12px}.sb-native{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.sb-native>div{min-height:0}
.sb-header{flex:none;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l3);font-size:12px;line-height:1.5;max-height:42%;overflow:auto}.sb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sb-title{font-weight:600}.sb-muted{color:var(--dsw-alias-label-tertiary);font-size:12px}.sb-card{padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.sb-btn{font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);border-radius:6px;padding:5px 9px;cursor:pointer}.sb-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}.sb-btn:disabled{opacity:.5;cursor:default}.sb-btn:focus-visible,.sb-field:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.sb-action{font:inherit;font-size:11px;padding:2px 5px;background:transparent;border:0;color:var(--dsw-alias-label-tertiary);cursor:pointer}.sb-action:disabled{opacity:.5;cursor:default}
.sb-prompt-editor{align-self:flex-end;width:min(100%,720px);box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.sb-prompt-editor textarea{min-height:110px;resize:vertical;line-height:1.6}.sb-prompt-editor p{margin:8px 0}.sb-user-message{min-width:0}.sb-user-actions{position:relative;display:inline-flex;align-items:center;flex:none}.sb-user-actions .sb-action{font-size:var(--dsh-content-font-size-secondary,13px);line-height:24px;border-radius:5px;padding:0 6px;white-space:nowrap}.sb-user-actions .sb-action:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.sb-user-actions .sb-action:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}.sb-user-error{position:absolute;z-index:10;top:100%;right:0;width:280px;max-width:70vw;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.5}
.sb-field{box-sizing:border-box;width:100%;font:inherit;padding:7px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:6px}.sb-turn{width:100%;text-align:left;display:block}.sb-turn[aria-pressed=true]{outline:1px solid var(--dsw-alias-label-primary)}.sb-turn p{margin:4px 0;overflow-wrap:anywhere}.sb-notice{padding:8px 10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);border-radius:6px;margin:8px 0;overflow-wrap:anywhere}.sb-notice summary{cursor:pointer}.sb-notice ul{margin:6px 0;padding-left:20px}.sb-error{white-space:pre-wrap;overflow-wrap:anywhere}.sb-original{white-space:pre-wrap;max-height:180px;overflow:auto;font:inherit}.sb-space{margin-top:8px}.sb-close{border:1px solid var(--dsw-alias-label-tertiary)}
`
    function Style() { return h('style', null, CSS) }
    function Button({ children, ...props }) { return h('button', { type: 'button', className: 'sb-btn', ...props }, children) }
    function ErrorView({ error, t, retry, newRequest, busy }) { return error ? h('div', { className: 'sb-notice sb-error', role: 'alert' }, h('strong', null, t('error')), h('div', null, errorText(error)), newRequest ? h(React.Fragment, null, h('p', null, t('newRequestHelp')), h(Button, { disabled: busy, onClick: newRequest }, t('newRequest'))) : retry && h(Button, { disabled: busy, onClick: retry }, t('retry'))) : null }
    function Drift({ drift, t }) {
      if (!drift) return null
      return h('div', { className: 'sb-notice' }, h('div', null, t('drift', { count: drift.laterTurns ?? 0 })),
        drift.files?.length > 0 && h('details', null, h('summary', null, t('files', { count: drift.files.length })), h('ul', null, drift.files.map((file) => h('li', { key: file }, h('code', null, file))))),
        drift.unknown && h('div', { className: 'sb-muted' }, t('unknown')))
    }
    function CloseChoice({ branch, running, runtime, t, onDone, onCancel }) {
      const [remember, setRemember] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const choose = async (action) => {
        setBusy(true); setError(null)
        try { const result = await runtime.resolveClose(branch, action, remember); if (['kept', 'archived'].includes(result.status)) onDone?.(); else setError(t('running')) }
        catch (error) { setError(error) } finally { setBusy(false) }
      }
      return h('section', { className: 'sb-notice sb-close', 'aria-label': t('closeTitle') }, h('strong', null, t('closeTitle')), h('p', null, t('closeBody')),
        running && h('p', null, t('running')),
        h('label', { className: 'sb-row' }, h('input', { type: 'checkbox', checked: remember, onChange: (event) => setRemember(event.target.checked) }), t('remember')),
        h('div', { className: 'sb-row sb-space' }, h(Button, { disabled: busy, onClick: () => choose('keep') }, t('keep')), h(Button, { disabled: busy, onClick: () => choose('archive') }, t('archive')), onCancel && h(Button, { disabled: busy, onClick: onCancel }, t('cancel'))), h(ErrorView, { error, t }))
    }
    function Recovery({ runtime, t, openBranch }) {
      const state = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
      const pending = state.records.filter((record) => record.pendingClose || record.pendingOpen)
      return h(React.Fragment, null, pending.length > 0 && h('section', null, h('h3', null, t('recovery')), h('p', { className: 'sb-muted' }, t('recoveryBody')),
        pending.map((branch) => h('div', { className: 'sb-card', key: branch.sessionId }, h('div', { className: 'sb-row' }, h('strong', null, t(branch.intent === 'fork' ? 'forkTitle' : branch.mode === 'edit' ? 'editTitle' : 'turnTitle', { turn: branch.turn })), h(Button, { onClick: () => openBranch(branch) }, t('reopen'))), h(ErrorView, { error: branch.error, t }), branch.pendingClose && h(CloseChoice, { branch, running: branch.running, runtime, t })))),
        state.preference && h(Button, { onClick: () => runtime.setPreference(null) }, t('clearChoice')))
    }
    function Picker({ sessionId, tab, runtime, t, nativeAvailable, openMain }) {
      const [mode, setMode] = React.useState('continue')
      const [turns, setTurns] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [anchor, setAnchor] = React.useState(null)
      const [filter, setFilter] = React.useState('')
      const [error, setError] = React.useState(null)
      const [creationFailed, setCreationFailed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [revision, refresh] = React.useReducer((n) => n + 1, 0)
      React.useEffect(() => {
        const controller = new AbortController(); setError(null); setCreationFailed(false); setTurns(null)
        runtime.api('turns', { sourceSessionId: sessionId }, controller.signal).then((result) => { if (controller.signal.aborted) return; setTurns(result.turns); setSelected((current) => result.turns.some((row) => row.turn === current) ? current : result.turns.findLast((row) => eligible(row, mode))?.turn ?? null) }).catch((error) => { if (!controller.signal.aborted) setError(error) })
        return () => controller.abort()
      }, [sessionId, revision])
      React.useEffect(() => {
        const controller = new AbortController(); setAnchor(null)
        if (selected !== null && eligible(turns?.find((row) => row.turn === selected), mode)) runtime.api('anchor-info', { sourceSessionId: sessionId, mode, turn: selected }, controller.signal).then((result) => { if (!controller.signal.aborted) setAnchor(result.anchor) }).catch((error) => { if (!controller.signal.aborted) setError(error) })
        return () => controller.abort()
      }, [sessionId, selected, mode, turns])
      const anchorMatches = anchor?.sourceSessionId === sessionId && anchor?.mode === mode && anchor?.turn === selected
      const create = async () => {
        if (!anchorMatches || busy || !nativeAvailable) return
        const request = { sourceSessionId: sessionId, mode, turn: selected }; setBusy(true); setError(null); setCreationFailed(false)
        try {
          const branch = await runtime.create(request)
          if (tab.signal.aborted) runtime.record(branch, { pendingOpen: true })
          else { tab.actions.openResource(branchAddress(branch), { replaceTab: true }); runtime.createdOpened(request) }
        }
        catch (error) { setError(error); setCreationFailed(true) } finally { setBusy(false) }
      }
      const startAnother = () => {
        if (!requiresNewRequest(error) || busy) return
        runtime.newRequest({ sourceSessionId: sessionId, mode, turn: selected })
        void create()
      }
      const filtered = turns?.filter((row) => `${row.prompt}\n${row.response}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      return h('div', { className: 'sb-scroll' }, h('strong', null, t('select')), !nativeAvailable && h(ErrorView, { error: t('unsupported'), t }),
        h('div', { className: 'sb-row' }, ['continue', 'edit'].map((value) => h(Button, { key: value, disabled: busy, 'aria-pressed': mode === value, onClick: () => { setMode(value); setError(null) } }, t(value === 'edit' ? 'editMode' : 'continueMode')))),
        (turns?.length ?? 0) > 50 && h('input', { className: 'sb-field', value: filter, 'aria-label': t('search'), placeholder: t('search'), onChange: (event) => setFilter(event.target.value) }),
        turns === null && !error && h('div', null, t('loading')), turns?.length === 0 && h('div', null, t('empty')),
        filtered?.map((row) => h(Button, { key: row.turn, className: 'sb-btn sb-turn', disabled: busy || !eligible(row, mode), 'aria-pressed': selected === row.turn, title: !eligible(row, mode) ? row.unavailableReason || t(mode === 'edit' && !row.editable ? 'noHuman' : 'unavailable') : undefined, onClick: () => { setSelected(row.turn); setError(null) } }, h('strong', null, t('turn', { turn: row.turn })), h('p', null, preview(row.prompt, 50)), h('p', { className: 'sb-muted' }, preview(row.response, 120)), !eligible(row, mode) && h('p', { className: 'sb-muted' }, row.unavailableReason || t(mode === 'edit' && !row.editable ? 'noHuman' : 'unavailable')))),
        anchor && h(React.Fragment, null, h(Drift, { drift: anchor.drift, t }), mode === 'edit' && h('details', null, h('summary', null, t('original')), h('pre', { className: 'sb-original' }, anchor.originalPrompt)), anchor.attachmentCount > 0 && mode === 'edit' && h('div', { className: 'sb-muted' }, t('attachments', { count: anchor.attachmentCount }))),
        h('p', { className: 'sb-muted' }, t('modelHint')), h(Button, { disabled: busy || !anchorMatches || !nativeAvailable, onClick: create }, t(busy ? 'creating' : 'create')),
        h(ErrorView, { error, t, busy, retry: creationFailed ? create : () => refresh(), newRequest: creationFailed && requiresNewRequest(error) ? startAnother : undefined }), h(Recovery, { runtime, t, openBranch: (branch) => { tab.actions.openResource(branchAddress(branch)); runtime.opened(branch) } }))
    }
    function FixedChat(props) { return props.renderSlot('conversation.session', { view: 'chat' }) }
    function NativeConversation(props) {
      const { resource, tab, runtime, t, openMain, useSession, useConversation, useSessions, useProjection, inputActions, renderFactorySlot, sessionId } = props
      const session = useSession((value) => value)
      const activeTargets = useConversation((value) => value.activeTargets.size)
      const summaryBlank = useSessions((value) => value.byId[sessionId]?.blank)
      const sourceRunning = useSessions((value) => value.byId[resource.branch.sourceSessionId]?.running)
      const outline = useProjection('turnOutline')
      const [status, setStatus] = React.useState(resource)
      const [error, setError] = React.useState(null)
      const [closing, setClosing] = React.useState(false)
      const [revision, retry] = React.useReducer((n) => n + 1, 0)
      React.useEffect(() => {
        inputActions?.persistDraft?.()
      }, [inputActions])
      React.useEffect(() => {
        const controller = new AbortController()
        runtime.api('branch', { sessionId }, controller.signal).then((value) => { if (!controller.signal.aborted) { setStatus(value); setError(null) } }).catch((error) => { if (!controller.signal.aborted) setError(error) })
        return () => controller.abort()
      }, [sessionId, session.running, outline, revision])
      const phase = activeTargets > 0 || !session.blank && !session.awaitingFirstTurn || session.running ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
      const settling = phase === 'blank' && session.openState === 'loading' && summaryBlank !== true
      const hero = phase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      const branch = status.branch
      const editing = branch.mode === 'edit' && status.ownUserMessages === 0 && !status.hasPendingHumanInput
      const finishClose = () => { runtime.closeResolved(sessionId); tab.actions.close() }
      const close = async () => {
        setError(null)
        try { const result = await runtime.resolveClose(branch, 'auto'); if (result.status === 'archived') finishClose(); else setClosing(true) } catch (error) { setError(error) }
      }
      const supported = typeof renderFactorySlot === 'function' && typeof inputActions?.setDraft === 'function'
      return h('div', { className: 'sb-root' }, h('div', { className: 'sb-header' },
        h('div', { className: 'sb-row' }, h('strong', null, t(branch.intent === 'fork' && branch.mode === 'continue' ? 'anchored' : branch.intent === 'fork' ? 'forkEditing' : editing ? 'editing' : branch.mode === 'edit' ? 'editTitle' : 'anchored', { turn: branch.turn })), h(Button, { onClick: () => openMain(sessionId) }, t('openMain')), h(Button, { onClick: close }, t('close'))),
        editing && h('div', { className: 'sb-muted' }, branch.turn === 1 ? t('retainedNone') : t('retained', { keep: branch.turn - 1, from: branch.turn, total: branch.totalTurns })),
        editing && h('div', { className: 'sb-muted' }, t('native')),
        editing && branch.attachmentCount > 0 && h('div', { className: 'sb-notice' }, t('attachments', { count: branch.attachmentCount })),
        status.sourceArchived && h('div', { className: 'sb-muted' }, t('sourceArchived')),
        h(Drift, { drift: branch.drift, t }), (sourceRunning ?? status.sourceRunning) && session.running && h('div', { className: 'sb-notice' }, t('concurrent')),
        branch.mode === 'edit' && h('details', null, h('summary', null, t('original')), h('pre', { className: 'sb-original' }, branch.originalPrompt)),
        closing && h(CloseChoice, { branch, running: session.running, runtime, t, onDone: finishClose, onCancel: () => setClosing(false) }),
        h(ErrorView, { error, t, retry }), !supported && h(ErrorView, { error: t('unsupported'), t })),
        supported && branch.ready && h('div', { className: 'sb-native' }, renderFactorySlot('conversation.content', { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }, { slots: { views: FixedChat } })))
    }
    function BranchBody(props) {
      const { useTabInfo, useResource, SessionProvider, renderSlot, runtime, t, nativeAvailable, openMain } = props
      const { tab } = useTabInfo()
      const parsed = parseBranchAddress(tab.contentId)
      // Resource hooks also accept unclaimed page addresses; avoid opening picker resources.
      return h('div', { className: 'sb-root' }, h(Style), parsed ? h(ResourceBody, { ...props, tab, parsed }) : h(Picker, { ...props, tab, nativeAvailable, openMain }))
    }
    function ResourceBody({ tab, useResource, SessionProvider, renderSlot, runtime, t }) {
      const resource = useResource(tab.contentId)
      if (resource.value === undefined) return h('div', { className: 'sb-scroll' }, resource.status === 'loading' && h('div', null, t('loading')), h(ErrorView, { error: resource.failure ?? (resource.status === 'none' ? t('unsupported') : null), t }), h(Button, { onClick: () => {
        const branch = parseBranchAddress(tab.contentId)
        runtime.closeResolved(branch.sessionId)
        tab.actions.openResource(retryBranchAddress(tab.contentId, randomUUID()), { replaceTab: true })
      } }, t('retry')))
      if (typeof SessionProvider !== 'function') return h(ErrorView, { error: t('unsupported'), t })
      return h(SessionProvider, { session: resource.value.reference }, renderSlot(SLOT, { resource: resource.value, tab }))
    }
    function AssistantActions({ sessionId, messageId, useChat, useAccess, runtime, t, nativeAvailable, openBranch, sidebarSessionId }) {
      const native = useChat((snapshot) => nativeTurnState(snapshot, messageId))
      const allowed = useAccess('session/fork')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [modeFailed, setModeFailed] = React.useState('continue')
      const available = (mode) => allowed && nativeAvailable && (mode === 'edit' ? native !== '' : native.endsWith(':ready'))
      const create = async (mode) => {
        if (!available(mode) || busy) return
        const ownerSessionId = sidebarSessionId()
        setBusy(true); setError(null); setModeFailed(mode)
        const request = { sourceSessionId: sessionId, mode, messageId }
        try { const branch = await runtime.create(request); if (openBranch(branch, ownerSessionId)) runtime.createdOpened(request) }
        catch (error) { setError(error) } finally { setBusy(false) }
      }
      const startAnother = () => {
        if (!requiresNewRequest(error) || busy) return
        runtime.newRequest({ sourceSessionId: sessionId, mode: modeFailed, messageId })
        void create(modeFailed)
      }
      return h('span', { className: 'sb-row' }, h(Style), ['continue', 'edit'].map((mode) => h('button', { key: mode, type: 'button', className: 'sb-action', disabled: busy || !available(mode), title: !nativeAvailable ? t('unsupported') : !available(mode) ? t('unavailable') : t(mode === 'edit' ? 'editing' : 'anchored', { turn: native.split(':')[0] }), onClick: () => create(mode) }, t(mode))), error && h('span', { role: 'alert', className: 'sb-error' }, errorText(error), ' ', requiresNewRequest(error) ? h(React.Fragment, null, h('span', null, t('newRequestHelp')), ' ', h(Button, { disabled: busy, onClick: startAnother }, t('newRequest'))) : h(Button, { disabled: busy, onClick: () => create(modeFailed) }, t('retry'))))
    }
    function promptText(node) { return (node.data.content ?? EMPTY).filter((part) => part.type === 'text').map((part) => part.text).join('\n') }
    function userRequest(node, sessionId, native, intent) {
      return { sourceSessionId: sessionId, mode: intent === 'fork' ? 'continue' : 'edit', turn: Number(native.split(':')[0]), expectedPromptMessageId: node.id, intent }
    }
    async function submitEditedPrompt(ctx, runtime, request, text, { attachments = false } = {}) {
      const branch = await runtime.create(request)
      const reference = ctx.sessions.retain(branch.sessionId, { source: 'sidebarChat' })
      try {
        await reference.ready
        const binding = reference.binding
        if (attachments) {
          const outcome = ctx.conversation.input.requestDraftInitialization(binding, { prompt: text, whenDraftExists: 'keep' })
          if (outcome === 'blocked') throw new Error('The edited version’s composer is temporarily unavailable. Retry to continue.')
        } else {
          const result = await binding.session.prompt([{ type: 'text', text }], 'queue', undefined, `side-branch-revise:${branch.sessionId}`)
          if (!result.ok) throw result.error
        }
        return branch
      } finally { reference.release() }
    }
    function PromptEditor({ node, sessionId, native, ctx, runtime, t, openMain, sidebarSessionId, onCancel }) {
      const [text, setText] = React.useState(() => promptText(node))
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const pending = React.useRef(false)
      const frozen = React.useRef(null)
      const [editId] = React.useState(() => randomUUID())
      const attachments = (node.data.content ?? EMPTY).some((part) => part.type !== 'text')
      const save = async () => {
        if (pending.current || !text.trim()) return
        const request = { ...userRequest(node, sessionId, native, 'revise'), editId }
        // Keep the same text and request after an uncertain submission result.
        frozen.current ??= text
        pending.current = true; setBusy(true); setError(null)
        const owner = sidebarSessionId()
        try {
          const branch = await submitEditedPrompt(ctx, runtime, request, frozen.current, { attachments })
          if (sidebarSessionId() === owner) { openMain(branch.sessionId); runtime.createdOpened(request); onCancel() }
          else runtime.record(branch, { pendingOpen: true, ownerSessionId: owner })
        } catch (failure) { setError(failure) } finally { pending.current = false; setBusy(false) }
      }
      return h('section', { className: 'sb-prompt-editor', 'aria-label': t('editPrompt') },
        h('textarea', { className: 'sb-field', rows: 5, autoFocus: true, value: text, disabled: busy || frozen.current !== null, 'aria-label': t('editPrompt'), onChange: (event) => setText(event.target.value), onKeyDown: (event) => { if (event.key === 'Escape' && !busy) onCancel() } }),
        h('p', { className: 'sb-muted' }, t('revisionHelp')),
        attachments && h('p', { className: 'sb-muted' }, t('editAttachments')),
        h('div', { className: 'sb-row' }, h(Button, { disabled: busy || !text.trim(), onClick: save }, t(busy ? 'creating' : attachments ? 'prepareEdit' : 'saveEdit')), h(Button, { disabled: busy, onClick: onCancel }, t('cancel'))),
        h(ErrorView, { error, t, busy, retry: save }))
    }
    function UserActions({ node, sessionId, useChat, useAccess, runtime, t, nativeAvailable, openBranch, sidebarSessionId, onEdit }) {
      const native = useChat((snapshot) => nativeUserTurnState(snapshot, node))
      const allowed = useAccess('session/fork')
      const [busy, setBusy] = React.useState(false)
      const pending = React.useRef(false)
      const [error, setError] = React.useState(null)
      const available = allowed && nativeAvailable && native.endsWith(':ready')
      const forkReady = useChat((snapshot) => {
        if (!native || !snapshot?.locations?.getTurn || !snapshot?.nodes?.get) return false
        const tail = snapshot.locations.getTurn(Number(native.split(':')[0])).map((key) => snapshot.nodes.get(key)).find((item) => item?.kind === 'turn-tail')
        const messageId = tail?.data?.closing?.finalNode?.messageId
        return !!messageId && nativeTurnState(snapshot, messageId).endsWith(':ready')
      })
      const request = userRequest(node, sessionId, native, 'fork')
      const create = async () => {
        if (!available || !forkReady || pending.current) return
        const ownerSessionId = sidebarSessionId()
        pending.current = true; setBusy(true); setError(null)
        try { const branch = await runtime.create(request); if (openBranch(branch, ownerSessionId)) runtime.createdOpened(request) }
        catch (failure) { setError(failure) } finally { pending.current = false; setBusy(false) }
      }
      const startAnother = () => {
        if (!requiresNewRequest(error) || pending.current) return
        runtime.newRequest(request); void create()
      }
      if (!native) return null
      return h('span', { className: 'sb-user-actions', 'data-busy': busy },
        h('button', { type: 'button', className: 'sb-action', disabled: busy || !available, title: !nativeAvailable ? t('unsupported') : !available ? t('userUnavailable') : t('editPromptHint'), onClick: () => onEdit(native) }, t('editPrompt')),
        h('button', { type: 'button', className: 'sb-action', disabled: busy || !available || !forkReady, 'aria-busy': busy, title: !nativeAvailable ? t('unsupported') : !available || !forkReady ? t('unavailable') : t('forkPromptHint'), onClick: create }, t(busy ? 'creating' : 'forkPrompt')),
        error && h('div', { className: 'sb-user-error' }, h(ErrorView, { error, t, busy, retry: create, newRequest: requiresNewRequest(error) ? startAnother : undefined })))
    }
    /** Compose the native action row through extraActions, preserving Copy. */
    function registerUserActions(ctx, props) {
      const slot = 'conversation.chat.node'
      const id = `${TYPE}.user-actions`
      let previous
      let unregister
      let disposed = false
      function reconcile() {
        if (disposed) return
        const original = ctx.slots.entries(slot).find((entry) => entry.options.key === 'user' && entry.options.id !== id)
        if (original === previous) return
        previous = original
        unregister?.(); unregister = undefined
        if (!original) return
        const NativeUser = original.component
        const renderNative = NativeUser?.$$typeof === Symbol.for('react.memo') && typeof NativeUser.type === 'function' ? NativeUser.type : null
        function UserMessage(nativeProps) {
          const [editing, setEditing] = React.useState('')
          const [selectedId, setSelectedId] = React.useState(nativeProps.node.id)
          if (selectedId !== nativeProps.node.id) { setSelectedId(nativeProps.node.id); setEditing('') }
          // DSH's native renderer supplies the bubble and Copy action unchanged.
          const bubble = renderNative ? renderNative(nativeProps) : null
          if (!React.isValidElement(bubble) || typeof bubble.props.actions !== 'function') return h(NativeUser, nativeProps)
          if (editing) return h(React.Fragment, null, h(Style), h(PromptEditor, { ...nativeProps, ...props, ctx, native: editing, onCancel: () => setEditing('') }))
          const actions = bubble.props.actions
          return h(React.Fragment, null, h(Style), React.cloneElement(bubble, { actions: (text) => {
            const row = actions(text)
            if (!React.isValidElement(row)) return row
            return React.cloneElement(row, { extraActions: h(React.Fragment, null, row.props.extraActions, h(UserActions, { ...nativeProps, ...props, onEdit: setEditing })) })
          } }))
        }
        unregister = ctx.slots.register({ name: slot, ...original.options, id, locale: original.locale, inject: original.inject, priority: (original.options.priority ?? 0) - 1 }, UserMessage)
      }
      const unsubscribe = ctx.slots.subscribe(slot, reconcile)
      reconcile()
      return () => { disposed = true; unsubscribe(); unregister?.() }
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), '[side-branch] locale')
      const t = ctx.locale.bind(NS)
      const transport = globalThis.__DSH_TRANSPORT__
      const send = transport?.fetch ? transport.fetch.bind(transport) : globalThis.fetch.bind(globalThis)
      const api = createApi(send)
      let storage
      try { storage = globalThis.localStorage } catch { storage = undefined }
      const sidebarSessionId = () => ctx.sidebarRight.mounted.getSnapshot()
      const runtime = createRuntime({ api, storage, makeId: () => randomUUID(), onRecover: (_branch, ownerSessionId) => {
        // Never navigate a different Session if the user switched during the request.
        // Recovery records remain available from the guide after refresh as well.
        if (sidebarSessionId() !== ownerSessionId) return
        try { ctx.sidebarRight.openTab(KIND, { params: { recovery: true } }) } catch (error) { console.warn('[side-branch] recovery awaits guide:', errorText(error)) }
      } })
      const nativeAvailable = nativeCapabilities(ctx)
      const openMain = (sessionId) => ctx.uiWorkspace.openSession(sessionId)
      const openBranch = (branch, ownerSessionId) => {
        if (sidebarSessionId() !== ownerSessionId) { runtime.record(branch, { pendingOpen: true, ownerSessionId }); return false }
        ctx.sidebarRight.openResource(branchAddress(branch))
        void ctx.sessions.refresh().catch((error) => console.warn('[side-branch] session list refresh:', errorText(error)))
        return true
      }
      ctx.effect(() => () => runtime.dispose(), '[side-branch] lifetime')
      ctx.effect(() => ctx.resources.register(branchResourceProvider(ctx, api)), '[side-branch] native resources')
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: TYPE, kind: KIND, priority: 'extension', patterns: [`${PREFIX}**`], canOpen: (address) => parseBranchAddress(address) !== null,
        title: (address) => { const branch = parseBranchAddress(address); return branch ? t(branch.intent === 'fork' ? 'forkTitle' : branch.mode === 'edit' ? 'editTitle' : 'turnTitle', { turn: branch.turn }) : t('title') },
        guide: [{ id: KIND, order: 20, icon: BranchIcon, title: () => t('title'), description: () => t('guide') }], keepMounted: true, multiple: true }), '[side-branch] tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE, locale: NS, children: { [SLOT]: { kind: 'single', scope: 'session' } }, inject: () => ({ runtime, t, nativeAvailable, openMain }) }, BranchBody)), '[side-branch] tab body')
      ctx.effect(() => ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, locale: NS, inject: () => ({ runtime, t, openMain }) }, NativeConversation)), '[side-branch] child conversation')
      ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: TYPE, order: 40, locale: NS, inject: () => ({ runtime, t, nativeAvailable, openBranch, sidebarSessionId }) }, AssistantActions)), '[side-branch] per-turn actions')
      ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => registerUserActions(ctx, { runtime, t, nativeAvailable, openBranch, openMain, sidebarSessionId })), '[side-branch] user message actions')
      ctx.effect(() => ctx.sidebarRight.registerCloseHandler(KIND, (ownerSessionId, tab) => { runtime.closeFromTab(tab.contentId, ownerSessionId) }), '[side-branch] recoverable close')
    }
    return { name: TYPE, inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'resources', 'sessions', 'conversation', 'uiWorkspace', 'locale', 'connection'], apply,
      branchAddress, parseBranchAddress, retryBranchAddress, nativeCapabilities, requiresNewRequest, createApi, nativeTurnState, nativeUserTurnState, registerUserActions, UserActions, eligible, preview, createRuntime, branchResourceProvider, randomUUID, ZH, EN, CSS, STORAGE_KEY }
  }
})
