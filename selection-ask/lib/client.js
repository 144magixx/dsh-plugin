/**
 * dsh-selection-ask Client. Hand-written classic-script ModuleLoader bundle.
 *
 * Entry points:
 *  - Conversation text the native Chat view owns: a companion "划词提问" button
 *    beside the native "引用文本" action (`conversation.chat.text-interaction`).
 *  - Everything else (tool output, right-sidebar code/plain/Markdown/PDF/Office
 *    previews): a document selection detector rendered from `shell.overlay`.
 *  - HTML previews: the iframe is opaque, so the HTML renderer is wrapped and a
 *    small bridge posts the in-frame selection to the parent window.
 * Answers come from a hidden Host thread and are shown in a draggable popover
 * that can be pinned as a right-sidebar tab with a per-conversation history.
 */
window.__ModuleLoader__.load({
  id: 'dsh-selection-ask',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }
    let primitives = null
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch { primitives = null }

    const TYPE = 'dsh-selection-ask'
    const KIND = 'selection-ask'
    const NS = 'selection-ask'
    const API_PREFIX = '/api/selection-ask/'
    const OPERATIONS = ['create', 'prompt', 'cancel', 'view', 'list', 'delete', 'clear', 'answer', 'models', 'model']
    const HTML_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html'
    const TEXT_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'
    const INTERACTION_SLOT = 'conversation.chat.text-interaction'
    const DOCUMENT_SLOT = 'sidebar.right.tab.document'
    const MESSAGE_SOURCE = 'dsh-selection-ask'
    const MAX_TEXT = 20000
    const AROUND_LINES = 20
    const AROUND_CHARS = 4000
    const VIEW_WAIT_MS = 2000
    const MAX_BACKOFF_MS = 15000
    const LAST_THREAD_KEY = 'dsh.selection-ask.last.v1'
    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    const MAX_IMAGES = 8
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024

    const ZH = {
      title: '划词提问', guide: '选中会话或文件中的文字即可提问；提问不会出现在左侧工作区',
      ask: '划词提问', history: '历史提问', historyCount: '历史 ({count})', pin: '固定到侧栏', close: '关闭',
      emptyHint: '在会话框或右侧栏文件（代码、文本、Markdown、PDF、HTML）中选中文字，点击「划词提问」开始。',
      placeholderFirst: '针对选中内容提问…（Enter 发送，Shift+Enter 换行）', placeholder: '继续追问，或要求直接修改文件…（Enter 发送）',
      send: '发送', stop: '停止', sending: '发送中…', thinking: '思考中…', answering: '回答中…',
      tools: '已调用 {names}', toolFailed: '{name} 失败', stopped: '已停止', failed: '回答失败',
      approvalTitle: '需要批准：{tool}', allow: '允许一次', reject: '拒绝', submitAnswer: '提交回答', customAnswer: '其他回答…', skip: '跳过',
      historyEmpty: '当前会话还没有划词提问', historyFooter: '仅保存在插件内，不进入左侧工作区', clear: '清空历史', clearConfirm: '确认清空', remove: '删除',
      justNow: '刚刚', minutesAgo: '{n} 分钟前', hoursAgo: '{n} 小时前', daysAgo: '{n} 天前',
      sourceChat: '会话框', sourceTurn: '会话框 · 第 {turn} 轮', sourceTool: '工具输出 · 第 {turn} 轮', sourceHtml: '{name} · HTML 选区',
      truncated: '选区较长，已截断为前 {count} 个字符', error: '出错了', reconnecting: '连接中断，正在重试…', gone: '这条划词提问已被删除',
      noSession: '请先打开一个会话再划词提问', trimmed: '仅显示最近的消息', unavailable: '历史内容暂不可读：{message}', running: '运行中',
      attach: '添加图片（也可粘贴或拖入）', removeImage: '移除图片', images: '{count} 张图片', tooManyImages: '每条消息最多 {count} 张图片', imageTooLarge: '图片不能超过 10 MB：{name}', imageType: '仅支持 PNG、JPEG、WebP、GIF：{name}',
      copy: '复制', copied: '已复制', codeBlock: '代码', wrap: '自动换行', unwrap: '取消换行', footnotes: '脚注', renderFailed: '这条消息无法渲染，已显示原文',
      openFile: '打开 {name}', imageOpen: '查看图片', imageLoading: '图片加载中…', imageFailed: '图片加载失败', imageDialog: '图片预览',
      noImageModel: '当前模型不支持图片输入，请换一个模型', model: '模型', modelLoading: '正在读取模型…', modelFailed: '读取模型失败', modelDefault: '跟随当前会话', modelHint: '只影响这次划词提问，不会改变默认模型',
    }
    const EN = {
      title: 'Selection Ask', guide: 'Select text in the conversation or a file to ask about it; side questions stay out of the workspace list',
      ask: 'Ask', history: 'History', historyCount: 'History ({count})', pin: 'Pin to sidebar', close: 'Close',
      emptyHint: 'Select text in the conversation or a sidebar file (code, text, Markdown, PDF, HTML), then click “Ask”.',
      placeholderFirst: 'Ask about the selection… (Enter to send, Shift+Enter for a new line)', placeholder: 'Follow up, or ask for a file change… (Enter to send)',
      send: 'Send', stop: 'Stop', sending: 'Sending…', thinking: 'Thinking…', answering: 'Answering…',
      tools: 'Used {names}', toolFailed: '{name} failed', stopped: 'Stopped', failed: 'Answer failed',
      approvalTitle: 'Approval needed: {tool}', allow: 'Allow once', reject: 'Reject', submitAnswer: 'Submit', customAnswer: 'Other answer…', skip: 'Skip',
      historyEmpty: 'No side questions in this conversation yet', historyFooter: 'Stored in this plugin only; never in the workspace list', clear: 'Clear history', clearConfirm: 'Confirm clear', remove: 'Delete',
      justNow: 'just now', minutesAgo: '{n} min ago', hoursAgo: '{n} h ago', daysAgo: '{n} d ago',
      sourceChat: 'Conversation', sourceTurn: 'Conversation · turn {turn}', sourceTool: 'Tool output · turn {turn}', sourceHtml: '{name} · HTML selection',
      truncated: 'Long selection truncated to the first {count} characters', error: 'Something went wrong', reconnecting: 'Connection lost, retrying…', gone: 'This side question was deleted',
      noSession: 'Open a conversation before asking about a selection', trimmed: 'Showing recent messages only', unavailable: 'History is unavailable: {message}', running: 'Running',
      attach: 'Add images (or paste / drop them)', removeImage: 'Remove image', images: '{count} image(s)', tooManyImages: 'At most {count} images per message', imageTooLarge: 'Images must be under 10 MB: {name}', imageType: 'Only PNG, JPEG, WebP and GIF are supported: {name}',
      copy: 'Copy', copied: 'Copied', codeBlock: 'Code', wrap: 'Wrap', unwrap: 'Unwrap', footnotes: 'Footnotes', renderFailed: 'This message could not be rendered; showing plain text',
      openFile: 'Open {name}', imageOpen: 'View image', imageLoading: 'Loading image…', imageFailed: 'Image failed to load', imageDialog: 'Image preview',
      noImageModel: 'The current model does not accept images; choose another model', model: 'Model', modelLoading: 'Loading models…', modelFailed: 'Could not load models', modelDefault: 'Same as this conversation', modelHint: 'Applies to this side question only; your default model is unchanged',
    }

    // ---- Pure helpers (exported for tests) ------------------------------------
    const randomId = () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    function errorText(error) { return error instanceof Error ? error.message : String(error?.message ?? error) }
    function parseFileAddress(address) {
      const prefix = 'dsh-resource://file/'
      try {
        if (typeof address !== 'string' || !address.startsWith(prefix)) return null
        const end = address.search(/[?#]/)
        const [scope, ...rest] = address.slice(prefix.length, end === -1 ? undefined : end).split('/')
        if (scope === 'session') {
          const [id, ...segments] = rest
          if (!id || segments.length === 0) return null
          return { sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') }
        }
        if (scope === 'absolute') return { sessionId: null, path: `/${rest.map(decodeURIComponent).join('/')}`.replace(/^\/([A-Za-z]:)/, '$1') }
      } catch {}
      return null
    }
    function baseName(path) {
      const trimmed = String(path ?? '').replace(/[/\\]+$/, '')
      return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed
    }
    function clipSelection(text) {
      const value = String(text ?? '')
      return value.length > MAX_TEXT ? { text: value.slice(0, MAX_TEXT), truncated: true } : { text: value, truncated: false }
    }
    function selectionLabel(selection, t) {
      if (!selection) return ''
      const name = baseName(selection.path)
      switch (selection.kind) {
        case 'chat':
          if (selection.turn === undefined) return t('sourceChat')
          return t(selection.role === 'tool' ? 'sourceTool' : 'sourceTurn', { turn: selection.turn })
        case 'html': return t('sourceHtml', { name: name || 'HTML' })
        case 'file':
          if (selection.startLine === undefined) return name
          return selection.endLine && selection.endLine !== selection.startLine ? `${name} : ${selection.startLine}-${selection.endLine}` : `${name} : ${selection.startLine}`
        default: return name || t('sourceChat')
      }
    }
    function linesAround(lines, start, end, count = AROUND_LINES) {
      if (!Array.isArray(lines) || !Number.isSafeInteger(start)) return {}
      const last = Number.isSafeInteger(end) ? end : start
      const before = lines.slice(Math.max(0, start - 1 - count), Math.max(0, start - 1)).join('\n')
      const after = lines.slice(last, last + count).join('\n')
      return { ...(before ? { before: before.slice(-AROUND_CHARS) } : {}), ...(after ? { after: after.slice(0, AROUND_CHARS) } : {}) }
    }
    function modelLabel(model, t) {
      if (!model) return t('modelDefault')
      return model.effortName || model.reasoningEffort ? `${model.name ?? model.model} · ${model.effortName ?? model.reasoningEffort}` : (model.name ?? model.model)
    }
    /** Read one image File as an encoded prompt part, enforcing the Host's per-image limits. */
    function readImageFile(file, t) {
      return new Promise((resolve, reject) => {
        if (!IMAGE_TYPES.includes(file.type)) return reject(new Error(t('imageType', { name: file.name || file.type })))
        if (file.size > MAX_IMAGE_BYTES) return reject(new Error(t('imageTooLarge', { name: file.name || '' })))
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error ?? new Error('read failed'))
        reader.onload = () => {
          const value = String(reader.result ?? '')
          const comma = value.indexOf(',')
          resolve({ id: randomId(), name: file.name || 'image', mediaType: file.type, data: value.slice(comma + 1), url: URL.createObjectURL(file) })
        }
        reader.readAsDataURL(file)
      })
    }
    function backoffDelay(previous) { return Math.min(MAX_BACKOFF_MS, previous > 0 ? previous * 2 : 500) }
    function relativeTime(timestamp, now, t) {
      const minutes = Math.floor(Math.max(0, now - timestamp) / 60000)
      if (minutes < 1) return t('justNow')
      if (minutes < 60) return t('minutesAgo', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('hoursAgo', { n: hours })
      return t('daysAgo', { n: Math.floor(hours / 24) })
    }
    /** Keep a floating box fully inside the viewport, above the anchor when there is room. */
    function placeNear(rect, viewport, size, gap = 8, preferBelow = false) {
      const width = Math.min(size.width, viewport.width - 16)
      let left = rect.left + rect.width / 2 - width / 2
      left = Math.max(8, Math.min(left, viewport.width - width - 8))
      const above = rect.top - gap - size.height
      const below = rect.top + rect.height + gap
      let top = preferBelow ? (below + size.height <= viewport.height - 8 ? below : above) : (above >= 8 ? above : below)
      top = Math.max(8, Math.min(top, viewport.height - Math.min(size.height, viewport.height - 16) - 8))
      return { left: Math.round(left), top: Math.round(top) }
    }
    function createApi(send) {
      return async (operation, body, signal) => {
        if (!OPERATIONS.includes(operation)) throw new Error('Unknown selection-ask operation')
        let response
        try {
          response = await send(`${API_PREFIX}${operation}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal })
        } catch (error) {
          if (error?.name === 'AbortError' || signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          throw Object.assign(new Error(errorText(error)), { status: 0, code: 'network' })
        }
        let data = null
        try { data = await response.json() } catch {}
        if (!response.ok || data?.ok !== true) {
          throw Object.assign(new Error(data?.message || `selection-ask: HTTP ${response.status}`), { status: response.status, code: data?.code ?? `http-${response.status}` })
        }
        return data
      }
    }
    function abortableSleep(ms, signal) {
      return new Promise((resolve) => {
        if (signal?.aborted) return resolve()
        const timer = setTimeout(done, ms)
        function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
        signal?.addEventListener('abort', done, { once: true })
      })
    }
    /**
     * Long-poll one thread view. Each request is bounded by the Host (≤2.5 s);
     * 503/network failures back off exponentially; stop() aborts and never reconnects.
     */
    function createFeed({ api, threadId, onUpdate, waitMs = VIEW_WAIT_MS, sleep = abortableSleep, now = () => Date.now() }) {
      let stopped = false
      let since
      let delay = 0
      let controller = null
      const stopper = new AbortController()
      async function run() {
        while (!stopped) {
          controller = new AbortController()
          const started = now()
          try {
            const view = await api('view', { threadId, ...(since ? { since, waitMs } : {}) }, controller.signal)
            if (stopped) return
            delay = 0
            const unchanged = view.revision === since
            since = view.revision
            onUpdate({ view, error: null })
            if (unchanged && now() - started < 100) await sleep(250, stopper.signal)
          } catch (error) {
            if (stopped || error?.name === 'AbortError') return
            if (error?.status === 404) { onUpdate({ error, gone: true }); return }
            delay = backoffDelay(delay)
            onUpdate({ error })
            await sleep(delay, stopper.signal)
          }
        }
      }
      return {
        start() { void run() },
        stop() { stopped = true; stopper.abort(); controller?.abort() },
        get stopped() { return stopped },
      }
    }

    /**
     * Selection bridge for HTML previews. It is stringified into interactive
     * previews (scripts allowed, opaque origin) and called directly on the
     * contentWindow of static previews; it must not reference outer scope.
     */
    function selectionBridge(win, post, schedule) {
      var source = 'dsh-selection-ask'
      var doc = win.document
      var pending = 0
      function elementOf(node) { return node && (node.nodeType === 1 ? node : node.parentElement) }
      function blockOf(node) {
        var element = elementOf(node)
        while (element && element !== doc.body && element !== doc.documentElement) {
          var display = win.getComputedStyle(element).display
          if (display !== 'inline' && display !== 'contents') return element
          element = element.parentElement
        }
        return doc.body
      }
      function headingBefore(node) {
        var heading = ''
        var all = doc.querySelectorAll('h1,h2,h3,h4,h5,h6')
        for (var index = 0; index < all.length && index < 400; index++) {
          if (all[index] === node || all[index].contains(node) || (all[index].compareDocumentPosition(node) & 4)) heading = (all[index].textContent || '').trim()
          else break
        }
        return heading.slice(0, 300)
      }
      function send() {
        pending = 0
        var selection = win.getSelection()
        if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) { post({ source: source, type: 'clear' }); return }
        var text = selection.toString()
        if (!text.trim()) { post({ source: source, type: 'clear' }); return }
        var range = selection.getRangeAt(0)
        var rects = range.getClientRects()
        var rect = rects.length ? rects[0] : range.getBoundingClientRect()
        var block = blockOf(range.startContainer)
        var before = ''
        var after = ''
        try {
          var head = doc.createRange(); head.selectNodeContents(block); head.setEnd(range.startContainer, range.startOffset); before = head.toString().slice(-1500)
          var tail = doc.createRange(); tail.selectNodeContents(blockOf(range.endContainer)); tail.setStart(range.endContainer, range.endOffset); after = tail.toString().slice(0, 1500)
        } catch (error) {}
        post({ source: source, type: 'selection', text: text.slice(0, 20000), truncated: text.length > 20000,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          heading: headingBefore(range.startContainer), before: before, after: after, title: String(doc.title || '').slice(0, 200) })
      }
      var defer = schedule || function (callback) { return win.setTimeout(callback, 0) }
      function later() { if (!pending) pending = defer(send) || 1 }
      doc.addEventListener('pointerup', later, true)
      doc.addEventListener('keyup', function (event) { if (event.shiftKey || event.key === 'Shift' || event.key === 'a' && (event.metaKey || event.ctrlKey)) later() }, true)
      doc.addEventListener('pointerdown', function () { post({ source: source, type: 'pointerdown' }) }, true)
      doc.addEventListener('selectionchange', function () { var selection = win.getSelection(); if (!selection || selection.isCollapsed) post({ source: source, type: 'clear' }) })
      win.addEventListener('scroll', function () { var selection = win.getSelection(); if (selection && !selection.isCollapsed) later() }, true)
    }
    const BRIDGE_SCRIPT = `<script data-dsh-selection-ask>(${selectionBridge.toString()})(window,function(m){try{parent.postMessage(m,'*')}catch(e){}})</script>`
    /** Insert the bridge after <head>/<html>/doctype without forcing quirks mode. */
    function injectBridgeText(html) {
      const anchors = [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]
      for (const anchor of anchors) {
        const match = anchor.exec(html)
        if (match) return html.slice(0, match.index + match[0].length) + BRIDGE_SCRIPT + html.slice(match.index + match[0].length)
      }
      return BRIDGE_SCRIPT + html
    }
    function injectBridge(data) {
      if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1) return data
      let text
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { return data }
      if (text.includes('data-dsh-selection-ask')) return data
      return new TextEncoder().encode(injectBridgeText(text))
    }

    // ---- DOM selection readers --------------------------------------------------
    function elementOf(node) { return node ? (node.nodeType === 1 ? node : node.parentElement) : null }
    function inOwnUi(node) { return !!elementOf(node)?.closest?.('[data-selection-ask-ui]') }
    function isEditable(element) { return !!element?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-composer-seat]') }
    function rectOfRange(range) {
      const rects = range.getClientRects()
      const rect = rects.length ? rects[0] : range.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
    function chatDetails(element) {
      const flow = element?.closest?.('[data-chat-flow-kind]')
      const kind = flow?.getAttribute('data-chat-flow-kind') ?? ''
      const turnValue = Number(element?.closest?.('[data-chat-turn]')?.getAttribute('data-chat-turn'))
      const role = kind === 'user' || kind === 'steering' ? 'user' : kind === 'turn-process' || element?.closest?.('[data-turn-process-member], [data-step-process-content]') ? 'tool' : 'assistant'
      return { kind: 'chat', role, ...(Number.isSafeInteger(turnValue) && turnValue >= 0 ? { turn: turnValue } : {}) }
    }
    function blockContext(range) {
      const doc = range.startContainer.ownerDocument
      const win = doc.defaultView
      const blockOf = (node) => {
        let element = elementOf(node)
        while (element && element !== doc.body) {
          const display = win.getComputedStyle(element).display
          if (display !== 'inline' && display !== 'contents') return element
          element = element.parentElement
        }
        return doc.body
      }
      try {
        const head = doc.createRange(); head.selectNodeContents(blockOf(range.startContainer)); head.setEnd(range.startContainer, range.startOffset)
        const tail = doc.createRange(); tail.selectNodeContents(blockOf(range.endContainer)); tail.setStart(range.endContainer, range.endOffset)
        const before = head.toString().slice(-1500)
        const after = tail.toString().slice(0, 1500)
        return { ...(before.trim() ? { before } : {}), ...(after.trim() ? { after } : {}) }
      } catch { return {} }
    }
    function previewDetails(root, range, startElement, endElement) {
      const address = root.getAttribute('data-textpreview-url') ?? ''
      const file = parseFileAddress(address)
      const pathLabel = root.querySelector('[data-textpreview-path]')
      const path = (pathLabel?.getAttribute('title') || pathLabel?.textContent || file?.path || '').trim()
      const renderer = root.getAttribute('data-document-preview') ?? ''
      const details = { kind: 'document', path, sessionId: file?.sessionId ?? null }
      const plainStart = startElement.closest('[data-textpreview-line]')
      const plainEnd = endElement.closest('[data-textpreview-line]')
      if (plainStart && plainEnd) {
        const startLine = Number(plainStart.getAttribute('data-textpreview-line'))
        const endLine = Number(plainEnd.getAttribute('data-textpreview-line'))
        const rows = [...root.querySelectorAll('[data-textpreview-line]')]
        const lines = []
        for (const row of rows) lines[Number(row.getAttribute('data-textpreview-line')) - 1] = (row.textContent ?? '').replace(/\n$/, '')
        return { ...details, kind: 'file', startLine, endLine: Math.max(startLine, endLine), ...linesAround(lines.map((line) => line ?? ''), startLine, endLine) }
      }
      const codeStart = startElement.closest('pre .line')
      const codeEnd = endElement.closest('pre .line')
      const pre = codeStart?.closest('pre')
      if (codeStart && codeEnd && pre && pre === codeEnd.closest('pre')) {
        const rows = [...pre.querySelectorAll('.line')]
        const startLine = rows.indexOf(codeStart) + 1
        const endLine = rows.indexOf(codeEnd) + 1
        if (startLine > 0 && endLine > 0) return { ...details, kind: 'file', startLine, endLine: Math.max(startLine, endLine), ...linesAround(rows.map((row) => row.textContent ?? ''), startLine, endLine) }
      }
      if (renderer === TEXT_BODY_ID || root.querySelector('[data-code-preview]')) details.kind = 'file'
      return { ...details, ...blockContext(range) }
    }
    /** The right-sidebar panel, its Session, and the title of the tab holding an element. */
    function sidebarContext(element) {
      const panel = element?.closest?.('[data-sidebar-right-session]')
      if (!panel) return null
      const body = element.closest('[data-sidebar-right-tab]')
      const tabId = body?.getAttribute('data-sidebar-right-tab')
      let title = ''
      if (tabId) {
        for (const candidate of panel.querySelectorAll('[data-sidebar-right-tab]')) {
          if (candidate !== body && candidate.getAttribute('data-sidebar-right-tab') === tabId) { title = (candidate.textContent ?? '').trim(); break }
        }
      }
      return { sessionId: panel.getAttribute('data-sidebar-right-session') || null, title }
    }
    /** CodeMirror 6 view behind a `.cm-editor`, when the editor exposes it (DOM tile or view). */
    function codeMirrorView(element) {
      const editor = element?.closest?.('.cm-editor')
      const content = editor?.querySelector('.cm-content')
      if (!content) return null
      let tile = content.cmTile
      for (let index = 0; tile && index < 64 && !tile.view; index++) tile = tile.parent
      const view = tile?.view ?? content.cmView?.rootView?.view ?? content.cmView?.view ?? null
      return view?.state?.doc && view.state.selection ? view : null
    }
    function codeMirrorSelection(view) {
      const { from, to } = view.state.selection.main
      if (from === to) return null
      const doc = view.state.doc
      const startLine = doc.lineAt(from).number
      const last = doc.lineAt(to)
      const endLine = to === last.from && last.number > startLine ? last.number - 1 : last.number
      const lineText = (number) => doc.line(number).text
      const before = []
      for (let number = Math.max(1, startLine - AROUND_LINES); number < startLine; number++) before.push(lineText(number))
      const after = []
      for (let number = endLine + 1; number <= Math.min(doc.lines, endLine + AROUND_LINES); number++) after.push(lineText(number))
      const start = view.coordsAtPos?.(from)
      const end = view.coordsAtPos?.(to)
      const rect = start ? { left: Math.min(start.left, end?.left ?? start.left), top: start.top, width: Math.max(1, Math.abs((end?.right ?? start.right) - start.left)), height: Math.max(1, (end?.bottom ?? start.bottom) - start.top) } : null
      return { text: view.state.sliceDoc(from, to), startLine, endLine, rect,
        ...(before.length ? { before: before.join('\n').slice(-AROUND_CHARS) } : {}), ...(after.length ? { after: after.join('\n').slice(0, AROUND_CHARS) } : {}) }
    }
    /**
     * Read the current document selection outside native Chat text sources.
     * @returns selection payload with viewport rect, or null when not ours to handle.
     */
    function readDomSelection(doc, mountedSessionId) {
      const selection = doc.getSelection()
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
      const range = selection.getRangeAt(0)
      const raw = selection.toString()
      if (!raw.trim()) return null
      const start = elementOf(range.startContainer)
      const end = elementOf(range.endContainer)
      if (!start || !end || inOwnUi(start) || inOwnUi(end)) return null
      // Editors in the right sidebar (e.g. dsh-better-sidebar's CodeMirror) are read through their own state.
      const side = sidebarContext(start)
      const cm = side && start.closest('.cm-editor') && start.closest('.cm-editor') === end.closest('.cm-editor') ? codeMirrorView(start) : null
      if (cm) {
        const picked = codeMirrorSelection(cm)
        if (!picked?.text.trim()) return null
        const sourceSessionId = side.sessionId || mountedSessionId
        if (!sourceSessionId) return null
        const clipped = clipSelection(picked.text)
        const { rect, text, ...lines } = picked
        return { sourceSessionId, below: true, rect: rect ?? rectOfRange(range), selection: { kind: 'file', ...(side.title ? { path: side.title } : {}), ...lines, text: clipped.text, ...(clipped.truncated ? { truncated: true } : {}) } }
      }
      if (isEditable(start) || isEditable(end)) return null
      const sourceA = start.closest('[data-text-interaction-source]')
      if (sourceA && sourceA === end.closest('[data-text-interaction-source]')) return null // native Chat action handles it
      const common = elementOf(range.commonAncestorContainer)
      const preview = common?.closest('[data-textpreview-body]') ? common.closest('[data-textpreview-url]') : null
      let details
      let below = false
      if (preview) details = previewDetails(preview, range, start, end)
      else if (common?.closest('[data-conversation-scroll]')) details = { ...chatDetails(start), sessionId: side?.sessionId ?? null }
      else if (side && common?.closest('[data-sidebar-right-tab]')) {
        // Other right-sidebar viewers (dsh-better-sidebar Markdown, plugin tabs): name them by tab title.
        details = { kind: 'document', ...(side.title ? { path: side.title } : {}), sessionId: side.sessionId, ...blockContext(range) }
        below = true
      }
      else return null
      const sourceSessionId = details.sessionId || mountedSessionId
      if (!sourceSessionId) return null
      const { sessionId, ...rest } = details
      const clipped = clipSelection(raw)
      return { sourceSessionId, ...(below ? { below: true } : {}), rect: rectOfRange(range), selection: { ...rest, text: clipped.text, ...(clipped.truncated ? { truncated: true } : {}) } }
    }

    // ---- Shared UI store --------------------------------------------------------
    function createStore() {
      let state = { pill: null, popover: null, revision: 0 }
      const listeners = new Set()
      const set = (patch) => {
        state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
        for (const listener of listeners) listener()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        showPill(pill) { set({ pill }) },
        hidePill(origin) { if (state.pill && (!origin || state.pill.origin === origin)) set({ pill: null }) },
        openCompose(payload) { set({ pill: null, popover: { key: randomId(), anchor: payload.rect, sourceSessionId: payload.sourceSessionId, compose: payload.selection, threadId: null } }) },
        openThread(threadId, sourceSessionId, anchor) { set({ pill: null, popover: { key: randomId(), anchor: anchor ?? null, sourceSessionId, compose: null, threadId } }) },
        setPopoverThread(threadId, keepSelection = false) { if (state.popover) set({ popover: { ...state.popover, threadId, compose: keepSelection ? state.popover.compose : null } }) },
        closePopover() { if (state.popover) set({ popover: null }) },
        historyChanged() { set({ revision: state.revision + 1 }) },
      }
    }

    // ---- Styles -----------------------------------------------------------------
    const CSS = `
.sa-pill{display:inline-flex;align-items:center;gap:5px;border:none;border-radius:999px;padding:5px 11px;background:var(--dsw-alias-button-floating-fill,var(--dsw-alias-bg-layer-1));--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel,0 4px 16px rgba(0,0,0,.12));color:var(--dsw-alias-link,#2f6fec);font:var(--dsw-font-xs-13,13px/1.4 system-ui);cursor:pointer;white-space:nowrap}
.sa-pill:hover,.sa-pill:focus-visible{background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-interactive-bg-hover))}
.sa-pill svg{flex:none}.sa-companion{display:inline-flex;align-items:center;gap:6px}
.sa-floating-pill{position:fixed;z-index:950}
.sa-popover{position:fixed;z-index:940;display:flex;flex-direction:column;width:min(520px,calc(100vw - 24px));max-height:min(70vh,640px);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3,#e2e4e9);border-radius:14px;box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.18));font:var(--dsw-font-xs-13,13px/1.5 system-ui);overflow:hidden}
.sa-panel{display:flex;flex-direction:column;min-height:0;flex:1;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.sa-tab{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}
.sa-head{flex:none;display:flex;align-items:center;gap:8px;padding:9px 10px 9px 14px;border-bottom:1px solid var(--dsw-alias-border-l3);user-select:none}
.sa-head[data-draggable]{cursor:grab}.sa-head[data-dragging]{cursor:grabbing}
.sa-title{font-weight:600;font-size:14px;white-space:nowrap}
.sa-chip{min-width:0;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-link,#2f6fec) 12%,transparent);color:var(--dsw-alias-link,#2f6fec);font-size:12px}
.sa-spacer{flex:1}
.sa-tool{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;line-height:20px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.sa-tool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.sa-tool:disabled{opacity:.5;cursor:default}
.sa-icon-btn{border:none;padding:3px 6px}
.sa-snippet{flex:none;margin:10px 14px 0;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:12px/1.5 var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);white-space:pre-wrap;overflow-wrap:anywhere;max-height:84px;overflow:auto}
.sa-note{margin:6px 14px 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.sa-body{flex:1;min-height:60px;overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px}
.sa-user{align-self:flex-end;max-width:88%;padding:6px 11px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));white-space:pre-wrap;overflow-wrap:anywhere}
.sa-assistant{min-width:0}.sa-assistant .sa-plain{white-space:pre-wrap}
.sa-meta{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;margin-bottom:4px}
.sa-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2bb673);flex:none}.sa-dot[data-state=error]{background:var(--dsw-alias-state-error-primary,#e5484d)}.sa-dot[data-state=running]{background:var(--dsw-alias-link,#2f6fec)}
.sa-error{color:var(--dsw-alias-label-error,#d92d20);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
.sa-card{padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.sa-card pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font-size:12px}
.sa-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sa-choice[aria-pressed=true]{border-color:var(--dsw-alias-link,#2f6fec);color:var(--dsw-alias-link,#2f6fec)}
.sa-primary{background:var(--dsw-alias-button-primary-fill,#2f6fec);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}.sa-primary:hover{background:var(--dsw-alias-button-primary-hover,#2a62d4);color:var(--dsw-alias-label-primary-foreground,#fff)}
.sa-composer{flex:none;display:flex;align-items:flex-end;gap:8px;margin:0 12px 12px;padding:6px 6px 6px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base)}
.sa-composer textarea{flex:1;resize:none;border:none;outline:none;background:transparent;color:inherit;font:inherit;line-height:1.5;max-height:140px;min-height:22px;padding:3px 0}
.sa-send{flex:none;width:30px;height:30px;border-radius:50%;border:none;display:grid;place-items:center;background:var(--dsw-alias-button-primary-fill,#2f6fec);color:#fff;cursor:pointer}.sa-send:disabled{opacity:.4;cursor:default}
.sa-input{box-sizing:border-box;width:100%;font:inherit;padding:5px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-base);color:inherit}
.sa-menu{position:absolute;z-index:5;top:calc(100% + 4px);right:0;width:min(360px,calc(100vw - 24px));max-height:360px;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.14));padding:4px}
.sa-menu-anchor{position:relative}
.sa-item{display:flex;gap:8px;align-items:flex-start;padding:7px 8px;border-radius:7px;cursor:pointer}.sa-item:hover,.sa-item[aria-current=true]{background:var(--dsw-alias-interactive-bg-hover)}
.sa-item-main{flex:1;min-width:0}.sa-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.sa-item-meta{display:flex;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:2px}
.sa-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px 4px;border-top:1px solid var(--dsw-alias-border-l3);margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.sa-link{border:none;background:transparent;color:var(--dsw-alias-link,#2f6fec);cursor:pointer;font:inherit;padding:0}
.sa-empty{padding:18px 16px;color:var(--dsw-alias-label-tertiary);text-align:center}
.sa-shimmer{color:var(--dsw-alias-label-tertiary)}
.sa-composer-wrap{flex:none;margin:0 12px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base)}
.sa-composer-wrap[data-drop]{outline:2px dashed var(--dsw-alias-link,#2f6fec);outline-offset:-2px}
.sa-composer-wrap .sa-composer{margin:0;border:none;border-radius:12px}
.sa-thumbs{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 0}
.sa-thumb{position:relative;width:48px;height:48px;border-radius:8px;overflow:hidden;border:1px solid var(--dsw-alias-border-l3)}
.sa-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.sa-thumb button{position:absolute;top:1px;right:1px;width:16px;height:16px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:11px;line-height:16px;padding:0;cursor:pointer}
.sa-bar{display:flex;align-items:center;gap:6px;padding:0 8px 6px}
.sa-bar .sa-tool{border-color:transparent}
.sa-model{position:relative;min-width:0}
.sa-model>.sa-tool{max-width:260px;overflow:hidden;text-overflow:ellipsis}
.sa-model-menu{position:absolute;z-index:6;bottom:calc(100% + 4px);left:0;width:min(320px,calc(100vw - 24px));max-height:340px;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.14));padding:4px}
.sa-group{padding:6px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.sa-model-row{padding:6px 8px;border-radius:7px;cursor:pointer}.sa-model-row:hover,.sa-model-row[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}
.sa-efforts{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.sa-efforts .sa-tool{padding:0 6px;line-height:18px}
.sa-image-note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:4px}
.sa-assistant .sa-plain{white-space:pre-wrap}
`
    function ensureStyle() {
      if (typeof document === 'undefined' || document.querySelector('style[data-selection-ask-style]')) return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-selection-ask-style', '')
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // ---- Components -------------------------------------------------------------
    function AskIcon({ size = 14, color = 'currentColor' }) {
      return h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M10 3.5l1.8 4.4 4.4 1.8-4.4 1.8L10 15.9l-1.8-4.4L3.8 9.7l4.4-1.8z', fill: color }),
        h('path', { d: 'M17.5 13.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z', fill: color }))
    }
    function GuideIcon({ size = 22, className }) {
      return h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size, className, fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M4 6h10M4 10h7', stroke: '#9aa6b8', strokeWidth: 1.8, strokeLinecap: 'round' }),
        h('rect', { x: 3.5, y: 13, width: 10, height: 4, rx: 1.2, fill: '#bfd6ff' }),
        h('path', { d: 'M18 4l1.1 2.6 2.6 1.1-2.6 1.1L18 11.4l-1.1-2.6-2.6-1.1 2.6-1.1z', fill: '#2f6fec' }),
        h('path', { d: 'M14 18.5c0-1.4 1.1-2.5 2.5-2.5h3c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5h-2l-2 1.5v-1.7c-.9-.3-1.5-1.3-1.5-2.3z', fill: '#2f6fec' }))
    }
    function SendIcon() { return h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', 'aria-hidden': true }, h('path', { d: 'M5 12h13M13 6l6 6-6 6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })) }
    function StopIcon() { return h('svg', { viewBox: '0 0 24 24', width: 12, height: 12, 'aria-hidden': true }, h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: 'currentColor' })) }

    // React.memo / forwardRef components are objects, not functions.
    const isComponent = (value) => typeof value === 'function' || (value !== null && typeof value === 'object' && '$$typeof' in value)
    const MarkdownText = primitives && isComponent(primitives.MarkdownText) ? primitives.MarkdownText : null
    const MarkdownDelegateProvider = primitives && isComponent(primitives.MarkdownDelegateProvider) ? primitives.MarkdownDelegateProvider : null
    // Same address grammar as the native file links (dsh-util-workspace-path).
    function encodeSegment(segment) { return encodeURIComponent(segment).replace(/%3A/gi, ':') }
    function sessionFileAddress(sessionId, path) {
      const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      return `dsh-resource://file/session/${encodeSegment(sessionId)}/${normalized.split('/').map(encodeSegment).join('/')}`
    }
    function isAbsolutePath(path) { return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\') }
    function resolvePath(cwd, path) {
      if (!path || isAbsolutePath(path) || !cwd) return path
      const separator = /^[A-Za-z]:[/\\]/.test(cwd) && cwd.includes('\\') ? '\\' : '/'
      return `${cwd.replace(/[/\\]+$/, '')}${separator}${path.replace(/^(?:\.?[/\\])+/, '')}`
    }
    function fileMediaUrl(path) {
      if (typeof document === 'undefined' || !path || !isAbsolutePath(path) || /^[/\\]{2}/.test(path) || /[\u0000-\u001f\u007f]/.test(path)) return undefined
      const base = document.baseURI
      if (!/^https?:/.test(base) && !base.startsWith('dsh-app://app/')) return undefined
      return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href
    }
    function decodePathValue(value) { try { return decodeURIComponent(String(value).split(/[?#]/)[0] ?? '') } catch { return undefined } }
    /** Markdown delegate for one thread: links open in the right sidebar of the source conversation, local images load through the file route. */
    /** Labels the native MarkdownText requires (code-block toolbar and footnotes). */
    function markdownLabels(t) {
      return { code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') } }, footnotes: t('footnotes') }
    }
    // Used when the host exposes no file-drag service: dragging an image simply does nothing.
    const NO_FILE_DRAG = Object.freeze({ prepare: () => Promise.reject(new Error('file drag unavailable')), reportFailure() {} })
    function createLinks(runtime, sourceSessionId, cwd, t) {
      const resolve = (path) => resolvePath(cwd ?? undefined, path)
      const openFile = async (path, options) => {
        if (!sourceSessionId) return
        const address = sessionFileAddress(sourceSessionId, resolve(path))
        runtime.openResource(address, options?.line === undefined ? undefined : { params: { line: options.line } })
      }
      return {
        openFile,
        openExternalLink: (url) => runtime.openExternal(url),
        labels: markdownLabels(t),
        fileImages: {
          fileDrag: runtime.fileDrag?.() ?? NO_FILE_DRAG,
          resolve: (path) => fileMediaUrl(resolve(path)),
          resourceAddress: (path) => sourceSessionId ? sessionFileAddress(sourceSessionId, resolve(path)) : undefined,
          labels: { open: t('imageOpen'), loading: t('imageLoading'), failed: t('imageFailed'), dialog: t('imageDialog'), close: t('close') },
        },
        pathImages: { resolve: (value) => { const path = decodePathValue(value); return path ? fileMediaUrl(resolve(path)) : undefined } },
        mentions(files) {
          if (!files?.length) return undefined
          const base = (path) => path.split(/[/\\]/).at(-1)
          return { resolve(value) {
            const matches = new Set(files.filter((path) => path === value || base(path) === value || resolve(path) === value))
            const path = matches.size === 1 ? matches.values().next().value : undefined
            if (path === undefined) return undefined
            return { open: () => { void openFile(path) }, label: t('openFile', { name: path }), title: resolve(path) }
          } }
        },
      }
    }
    const LinksContext = React.createContext(null)
    /** Contain a render failure to one message: show its plain text instead of unmounting the panel. */
    const RenderGuard = typeof React.Component === 'function' ? class RenderGuard extends React.Component {
      constructor(props) { super(props); this.state = { failed: false } }
      static getDerivedStateFromError() { return { failed: true } }
      componentDidCatch(error) { console.warn('[selection-ask] message render failed:', errorText(error)) }
      componentDidUpdate(previous) { if (this.state.failed && previous.text !== this.props.text) this.setState({ failed: false }) }
      render() { return this.state.failed ? (this.props.fallback !== undefined ? this.props.fallback : h('div', { className: 'sa-plain' }, this.props.text)) : this.props.children }
    } : null
    function RichText({ text, streaming, files }) {
      const links = React.useContext(LinksContext)
      if (!text) return null
      if (!MarkdownText) return h('div', { className: 'sa-plain' }, text)
      const labels = links?.labels
      const markdown = h(MarkdownText, { text, streaming: streaming === true, ...(labels ? { labels } : {}), ...(links ? { pathImages: links.pathImages, fileMentions: links.mentions(files) } : {}) })
      return RenderGuard ? h(RenderGuard, { text }, markdown) : markdown
    }

    function ToolSummary({ tools, t }) {
      if (!tools?.length) return null
      const failed = tools.filter((tool) => tool.status === 'error')
      const names = [...new Set(tools.map((tool) => tool.name))].slice(0, 6).join(', ')
      return h('div', { className: 'sa-meta' }, h('span', { className: 'sa-dot', 'data-state': failed.length ? 'error' : tools.some((tool) => tool.status === 'running') ? 'running' : 'done' }),
        h('span', null, t('tools', { names })), failed.length > 0 && h('span', { className: 'sa-error' }, t('toolFailed', { name: failed.map((tool) => tool.name).join(', ') })))
    }

    function ApprovalCard({ item, onAnswer, t }) {
      const [busy, setBusy] = React.useState(false)
      const answer = async (outcome) => { setBusy(true); try { await onAnswer(item.id, { outcome }) } finally { setBusy(false) } }
      return h('div', { className: 'sa-card', role: 'group' }, h('strong', null, t('approvalTitle', { tool: item.toolName || 'tool' })),
        item.reason && h('pre', null, item.reason),
        h('div', { className: 'sa-row' }, h('button', { type: 'button', className: 'sa-tool sa-primary', disabled: busy, onClick: () => answer('allowed-once') }, t('allow')), h('button', { type: 'button', className: 'sa-tool', disabled: busy, onClick: () => answer('rejected') }, t('reject'))))
    }

    function QuestionCard({ item, onAnswer, t }) {
      const [choices, setChoices] = React.useState({})
      const [custom, setCustom] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const toggle = (question, label) => setChoices((current) => {
        const selected = current[question.id] ?? []
        const next = question.multiSelect ? (selected.includes(label) ? selected.filter((value) => value !== label) : [...selected, label]) : (selected[0] === label ? [] : [label])
        return { ...current, [question.id]: next }
      })
      const submit = async () => {
        setBusy(true)
        try { await onAnswer(item.id, { answers: item.questions.map((question) => ({ id: question.id, selected: choices[question.id] ?? [], ...(custom[question.id]?.trim() ? { custom: custom[question.id] } : {}) })) }) }
        finally { setBusy(false) }
      }
      return h('div', { className: 'sa-card', role: 'group' }, item.questions.map((question) => h('div', { key: question.id, className: 'sa-panel' },
        question.header && h('div', { className: 'sa-meta' }, question.header), h('strong', null, question.question), question.detail && h('pre', null, question.detail),
        h('div', { className: 'sa-row' }, question.options.map((option) => h('button', { key: option.label, type: 'button', className: 'sa-tool sa-choice', title: option.description, 'aria-pressed': (choices[question.id] ?? []).includes(option.label), disabled: busy, onClick: () => toggle(question, option.label) }, option.label))),
        h('input', { className: 'sa-input', placeholder: t('customAnswer'), value: custom[question.id] ?? '', disabled: busy, onChange: (event) => setCustom((current) => ({ ...current, [question.id]: event.target.value })) }))),
      h('div', { className: 'sa-row' }, h('button', { type: 'button', className: 'sa-tool sa-primary', disabled: busy, onClick: submit }, t('submitAnswer'))))
    }

    function Messages({ view, t, onAnswer, bodyRef, runtime, sourceSessionId }) {
      const cwd = view?.cwd ?? null
      const links = React.useMemo(() => runtime ? createLinks(runtime, sourceSessionId, cwd, t) : null, [runtime, sourceSessionId, cwd, t])
      const body = h(MessageList, { view, t, onAnswer, bodyRef })
      if (!links) return body
      const provided = h(LinksContext.Provider, { value: links }, body)
      return MarkdownDelegateProvider ? h(MarkdownDelegateProvider, { openFile: links.openFile, openExternalLink: links.openExternalLink, fileImages: links.fileImages }, provided) : provided
    }
    function MessageList({ view, t, onAnswer, bodyRef }) {
      const messages = view?.messages ?? []
      const last = messages.at(-1)
      const running = view?.running === true
      const stream = view?.stream
      return h('div', { className: 'sa-body', ref: bodyRef },
        view?.trimmed && h('div', { className: 'sa-meta' }, t('trimmed')),
        messages.map((message) => message.role === 'user'
          ? h('div', { key: message.id, className: 'sa-user' }, message.text, message.images ? h('div', { className: 'sa-image-note' }, `🖼 ${t('images', { count: message.images })}`) : null)
          : h('div', { key: message.id, className: 'sa-assistant' },
            h(ToolSummary, { tools: message.tools, t }),
            h(RichText, { text: message.text, files: message.files }),
            message.status === 'stopped' && h('div', { className: 'sa-meta' }, t('stopped')),
            message.error && h('div', { className: 'sa-error' }, `${t('failed')}: ${message.error}`))),
        running && h('div', { className: 'sa-assistant' }, stream?.text ? h(RichText, { text: stream.text, streaming: true }) : h('div', { className: 'sa-shimmer' }, stream?.reasoning ? t('thinking') : last?.role === 'assistant' ? t('answering') : t('thinking'))),
        (view?.pending ?? []).map((item) => item.kind === 'approval' ? h(ApprovalCard, { key: item.id, item, onAnswer, t }) : h(QuestionCard, { key: item.id, item, onAnswer, t })),
        view?.error && h('div', { className: 'sa-error' }, view.error))
    }

    function ModelPicker({ runtime, t, value, onChange, sourceSessionId }) {
      const [open, setOpen] = React.useState(false)
      const [catalog, setCatalog] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const ref = React.useRef(null)
      React.useEffect(() => {
        if (!open) return
        const controller = new AbortController()
        runtime.models(sourceSessionId, controller.signal).then((result) => { setCatalog(result); setError(null) }, (failure) => { if (failure?.name !== 'AbortError') setError(failure) })
        const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false) }
        document.addEventListener('pointerdown', close, true)
        return () => { controller.abort(); document.removeEventListener('pointerdown', close, true) }
      }, [open, runtime, sourceSessionId])
      const choose = async (selection) => {
        setBusy(true); setError(null)
        try { await onChange(selection); setOpen(false) } catch (failure) { setError(failure) } finally { setBusy(false) }
      }
      return h('span', { className: 'sa-model', ref },
        h('button', { type: 'button', className: 'sa-tool', title: `${t('model')}：${modelLabel(value, t)}`, 'aria-expanded': open, onClick: () => setOpen((current) => !current) }, `${modelLabel(value, t)} ▾`),
        open && h('div', { className: 'sa-model-menu', role: 'listbox' },
          h('div', { className: 'sa-group' }, t('modelHint')),
          !catalog && !error && h('div', { className: 'sa-empty' }, t('modelLoading')),
          error && h('div', { className: 'sa-error', style: { padding: '6px 8px' } }, `${t('modelFailed')}: ${errorText(error)}`),
          (catalog?.groups ?? []).map((group) => h(React.Fragment, { key: group.id },
            h('div', { className: 'sa-group' }, group.name),
            group.models.map((model) => {
              const selected = value?.provider === group.id && value?.model === model.id
              const effort = model.efforts?.some((item) => item.id === value?.reasoningEffort) ? value.reasoningEffort : model.defaultEffort
              const pick = (effortId) => void choose({ provider: group.id, model: model.id, ...(effortId ? { reasoningEffort: effortId } : {}) })
              return h('div', { key: model.id, className: 'sa-model-row', role: 'option', 'aria-selected': selected, onClick: () => { if (!busy) pick(effort) } },
                h('div', null, model.name, model.images === false ? h('span', { className: 'sa-image-note' }, ' · 不支持图片') : null),
                selected && model.efforts?.length > 0 && h('div', { className: 'sa-efforts' }, model.efforts.map((item) => h('button', { key: item.id, type: 'button', className: 'sa-tool sa-choice', 'aria-pressed': value?.reasoningEffort === item.id, disabled: busy, onClick: (event) => { event.stopPropagation(); pick(item.id) } }, item.name))))
            })))))
    }

    function Composer({ runtime, onSubmit, onStop, running, placeholder, t, autoFocus, model, onModel, sourceSessionId }) {
      const [text, setText] = React.useState('')
      const [images, setImages] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [drop, setDrop] = React.useState(false)
      const ref = React.useRef(null)
      const fileRef = React.useRef(null)
      const imagesRef = React.useRef(images)
      imagesRef.current = images
      React.useEffect(() => () => { for (const image of imagesRef.current) URL.revokeObjectURL(image.url) }, [])
      React.useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }) }, [autoFocus])
      React.useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(140, el.scrollHeight)}px` } }, [text])
      const addFiles = async (files) => {
        const list = [...files].filter((file) => file && file.type?.startsWith('image/'))
        if (!list.length) return
        setError(null)
        if (imagesRef.current.length + list.length > MAX_IMAGES) { setError(new Error(t('tooManyImages', { count: MAX_IMAGES }))); return }
        const read = []
        for (const file of list) {
          try { read.push(await readImageFile(file, t)) } catch (failure) { setError(failure) }
        }
        if (read.length) setImages((current) => [...current, ...read].slice(0, MAX_IMAGES))
      }
      const remove = (id) => setImages((current) => current.filter((image) => { if (image.id === id) URL.revokeObjectURL(image.url); return image.id !== id }))
      const submit = async () => {
        if ((!text.trim() && images.length === 0) || busy) return
        setBusy(true); setError(null)
        try {
          await onSubmit(text, images.map(({ data, mediaType, name }) => ({ data, mediaType, name })))
          for (const image of images) URL.revokeObjectURL(image.url)
          setText(''); setImages([])
        } catch (failure) { setError(failure) } finally { setBusy(false) }
      }
      const noImages = images.length > 0 && model?.images === false
      return h(React.Fragment, null,
        error && h('div', { className: 'sa-note sa-error' }, errorText(error)),
        noImages && h('div', { className: 'sa-note sa-error' }, t('noImageModel')),
        h('div', { className: 'sa-composer-wrap', 'data-drop': drop || undefined,
          onDragOver: (event) => { if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) { event.preventDefault(); setDrop(true) } },
          onDragLeave: () => setDrop(false),
          onDrop: (event) => { if (event.dataTransfer?.files?.length) { event.preventDefault(); setDrop(false); void addFiles(event.dataTransfer.files) } } },
          images.length > 0 && h('div', { className: 'sa-thumbs' }, images.map((image) => h('div', { key: image.id, className: 'sa-thumb', title: image.name },
            h('img', { src: image.url, alt: image.name }), h('button', { type: 'button', 'aria-label': t('removeImage'), title: t('removeImage'), disabled: busy, onClick: () => remove(image.id) }, '×')))),
          h('div', { className: 'sa-composer' },
            h('textarea', { ref, rows: 1, value: text, placeholder, disabled: busy, 'aria-label': placeholder, onChange: (event) => setText(event.target.value),
              onPaste: (event) => { const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addFiles(files) } },
              onKeyDown: (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void submit() } } }),
            running && onStop && !text.trim() && images.length === 0
              ? h('button', { type: 'button', className: 'sa-send', title: t('stop'), 'aria-label': t('stop'), onClick: onStop }, h(StopIcon))
              : h('button', { type: 'button', className: 'sa-send', title: busy ? t('sending') : t('send'), 'aria-label': t('send'), disabled: busy || noImages || (!text.trim() && images.length === 0), onClick: () => void submit() }, h(SendIcon))),
          h('div', { className: 'sa-bar' },
            h('button', { type: 'button', className: 'sa-tool sa-icon-btn', title: t('attach'), 'aria-label': t('attach'), disabled: busy || images.length >= MAX_IMAGES, onClick: () => fileRef.current?.click() }, '📎'),
            h('input', { ref: fileRef, type: 'file', accept: IMAGE_TYPES.join(','), multiple: true, hidden: true, onChange: (event) => { void addFiles(event.target.files ?? []); event.target.value = '' } }),
            onModel && h(ModelPicker, { runtime, t, value: model, onChange: onModel, sourceSessionId }))))
    }

    function HistoryMenu({ runtime, sourceSessionId, currentId, onSelect, onCountChange, t }) {
      const [open, setOpen] = React.useState(false)
      const [rows, setRows] = React.useState(null)
      const [confirm, setConfirm] = React.useState(false)
      const [error, setError] = React.useState(null)
      const store = runtime.store
      const revision = React.useSyncExternalStore(store.subscribe, () => store.getSnapshot().revision)
      const ref = React.useRef(null)
      const load = React.useCallback(async (signal) => {
        if (!sourceSessionId) return
        try { const result = await runtime.api('list', { sourceSessionId }, signal); setRows(result.threads); setError(null); onCountChange?.(result.threads.length) }
        catch (failure) { if (failure?.name !== 'AbortError') setError(failure) }
      }, [runtime, sourceSessionId, onCountChange])
      React.useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load, revision, open])
      React.useEffect(() => {
        if (!open) return
        const close = (event) => { if (!ref.current?.contains(event.target)) { setOpen(false); setConfirm(false) } }
        document.addEventListener('pointerdown', close, true)
        return () => document.removeEventListener('pointerdown', close, true)
      }, [open])
      const remove = async (event, id) => {
        event.stopPropagation()
        try { await runtime.api('delete', { threadId: id }); store.historyChanged(); if (id === currentId) onSelect(null) } catch (failure) { setError(failure) }
      }
      const clear = async () => {
        if (!confirm) { setConfirm(true); return }
        try { await runtime.api('clear', { sourceSessionId }); setConfirm(false); store.historyChanged(); onSelect(null) } catch (failure) { setError(failure) }
      }
      const now = Date.now()
      return h('span', { className: 'sa-menu-anchor', ref },
        h('button', { type: 'button', className: 'sa-tool', 'aria-expanded': open, onClick: () => setOpen((value) => !value) }, t('historyCount', { count: rows?.length ?? 0 })),
        open && h('div', { className: 'sa-menu', role: 'menu' },
          rows?.length === 0 && h('div', { className: 'sa-empty' }, t('historyEmpty')),
          (rows ?? []).map((row) => h('div', { key: row.id, className: 'sa-item', role: 'menuitem', tabIndex: 0, 'aria-current': row.id === currentId, onClick: () => { onSelect(row.id); setOpen(false) }, onKeyDown: (event) => { if (event.key === 'Enter') { onSelect(row.id); setOpen(false) } } },
            h('div', { className: 'sa-item-main' }, h('div', { className: 'sa-item-title', title: row.title }, row.title),
              h('div', { className: 'sa-item-meta' }, h('span', { className: 'sa-chip' }, selectionLabel(row.selection, t)), h('span', null, row.running ? t('running') : relativeTime(row.updatedAt, now, t)))),
            h('button', { type: 'button', className: 'sa-tool sa-icon-btn', title: t('remove'), 'aria-label': t('remove'), onClick: (event) => void remove(event, row.id) }, '×'))),
          error && h('div', { className: 'sa-error', style: { padding: '4px 8px' } }, errorText(error)),
          h('div', { className: 'sa-foot' }, h('span', null, t('historyFooter')), rows?.length > 0 && h('button', { type: 'button', className: 'sa-link', onClick: () => void clear() }, confirm ? t('clearConfirm') : t('clear')))))
    }

    function useThreadView(runtime, threadId, active) {
      const [state, setState] = React.useState({ view: null, error: null, gone: false, threadId })
      React.useEffect(() => {
        setState({ view: null, error: null, gone: false, threadId })
        if (!threadId || !active) return
        const feed = runtime.createFeed(threadId, (patch) => setState((previous) => ({ ...previous, ...patch, threadId })))
        feed.start()
        return () => feed.stop()
      }, [runtime, threadId, active])
      return state.threadId === threadId ? state : { view: null, error: null, gone: false, threadId }
    }

    /** Header + snippet + messages + composer, shared by the popover and the sidebar tab. */
    function ThreadPanel({ runtime, t, mode, threadId, compose, sourceSessionId, active = true, onThread, onClose, onPin, headProps }) {
      const { view, error, gone } = useThreadView(runtime, threadId, active)
      const bodyRef = React.useRef(null)
      const requestId = React.useRef(randomId())
      const selection = view?.thread?.selection ?? compose ?? null
      const running = view?.running === true
      const stick = React.useRef(true)
      React.useEffect(() => {
        const body = bodyRef.current
        if (!body) return
        const onScroll = () => { stick.current = body.scrollHeight - body.scrollTop - body.clientHeight < 40 }
        body.addEventListener('scroll', onScroll)
        return () => body.removeEventListener('scroll', onScroll)
      }, [threadId, compose])
      React.useLayoutEffect(() => { const body = bodyRef.current; if (body && stick.current) body.scrollTop = body.scrollHeight }, [view])
      const [composeModel, setComposeModel] = React.useState(null)
      React.useEffect(() => {
        if (threadId || !sourceSessionId) return
        const controller = new AbortController()
        runtime.models(sourceSessionId, controller.signal).then((result) => { if (!controller.signal.aborted) setComposeModel((current) => current ?? result.current ?? null) }, () => {})
        return () => controller.abort()
      }, [runtime, threadId, sourceSessionId])
      const model = threadId ? view?.model ?? null : composeModel
      const changeModel = async (selection) => {
        if (!threadId) {
          const catalog = await runtime.models(sourceSessionId)
          const entry = catalog.groups.find((group) => group.id === selection.provider)?.models.find((item) => item.id === selection.model)
          setComposeModel({ ...selection, name: entry?.name ?? selection.model, effortName: entry?.efforts?.find((item) => item.id === selection.reasoningEffort)?.name, images: entry?.images ?? true, picked: true })
          return
        }
        await runtime.api('model', { threadId, model: selection })
      }
      const submit = async (question, images = []) => {
        if (!threadId) {
          const picked = composeModel?.picked ? { provider: composeModel.provider, model: composeModel.model, ...(composeModel.reasoningEffort ? { reasoningEffort: composeModel.reasoningEffort } : {}) } : undefined
          const result = await runtime.api('create', { requestId: requestId.current, sourceSessionId, selection: compose, question, ...(images.length ? { images } : {}), ...(picked ? { model: picked } : {}) })
          runtime.remember(sourceSessionId, result.thread.id)
          runtime.store.historyChanged()
          onThread(result.thread.id, true)
          return
        }
        await runtime.api('prompt', { threadId, question, ...(images.length ? { images } : {}) })
        runtime.store.historyChanged()
      }
      const answer = async (interactionId, payload) => { await runtime.api('answer', { threadId, interactionId, ...payload }) }
      const stop = () => { void runtime.api('cancel', { threadId }).catch(() => {}) }
      const title = view?.thread?.title
      return h('div', { className: 'sa-panel' },
        h('div', { className: 'sa-head', ...headProps },
          h('span', { className: 'sa-title' }, t('title')),
          selection && h('span', { className: 'sa-chip', title: selection.path || selectionLabel(selection, t) }, selectionLabel(selection, t)),
          h('span', { className: 'sa-spacer' }),
          sourceSessionId && h(HistoryMenu, { runtime, sourceSessionId, currentId: threadId, onSelect: (id) => onThread(id), t }),
          mode === 'popover' && threadId && onPin && h('button', { type: 'button', className: 'sa-tool', onClick: onPin }, t('pin')),
          onClose && h('button', { type: 'button', className: 'sa-tool sa-icon-btn', 'aria-label': t('close'), title: t('close'), onClick: onClose }, '×')),
        selection && h('div', { className: 'sa-snippet', title: title || undefined }, selection.text.length > 600 ? `${selection.text.slice(0, 600)}…` : selection.text),
        selection?.truncated && h('div', { className: 'sa-note' }, t('truncated', { count: MAX_TEXT })),
        !selection && !threadId && h('div', { className: 'sa-empty' }, t('emptyHint')),
        gone && h('div', { className: 'sa-empty' }, t('gone')),
        h(Messages, { view: view?.thread?.id === threadId ? view : null, t, onAnswer: answer, bodyRef, runtime, sourceSessionId: view?.thread?.sourceSessionId ?? sourceSessionId }),
        error && !gone && h('div', { className: 'sa-note' }, error.status === 503 || error.status === 0 ? t('reconnecting') : `${t('error')}: ${errorText(error)}`),
        (threadId || compose) && !gone && h(Composer, { key: threadId ?? 'compose', runtime, onSubmit: submit, onStop: threadId ? stop : null, running, placeholder: threadId ? t('placeholder') : t('placeholderFirst'), t, autoFocus: mode === 'popover' || !threadId, model, onModel: changeModel, sourceSessionId }))
    }

    /** Keep a panel failure inside the panel, with a way out (close / back to empty). */
    function guarded(t, key, child, reset) {
      if (!RenderGuard) return child
      return h(RenderGuard, { key, fallback: h('div', { className: 'sa-empty' }, h('div', { className: 'sa-error' }, t('renderFailed')), h('button', { type: 'button', className: 'sa-tool', style: { marginTop: 8 }, onClick: reset }, t('close'))) }, child)
    }
    function Popover({ runtime, t, popover }) {
      const ref = React.useRef(null)
      const [position, setPosition] = React.useState(null)
      const dragging = React.useRef(null)
      React.useLayoutEffect(() => {
        const element = ref.current
        if (!element || position) return
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        const size = { width: element.offsetWidth || 520, height: Math.min(element.offsetHeight || 320, viewport.height * 0.7) }
        const anchor = popover.anchor ?? { left: viewport.width - size.width - 24, top: 80, width: 0, height: 0 }
        setPosition(placeNear(anchor, viewport, { width: size.width, height: Math.max(size.height, 320) }, 10, true))
      }, [popover.key])
      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && ref.current?.contains(document.activeElement)) runtime.store.closePopover() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [runtime])
      const headProps = {
        'data-draggable': '',
        onPointerDown: (event) => {
          if (event.button !== 0 || event.target.closest('button, input, textarea, [role=menu]')) return
          const element = ref.current
          if (!element) return
          const box = element.getBoundingClientRect()
          dragging.current = { dx: event.clientX - box.left, dy: event.clientY - box.top }
          event.currentTarget.setPointerCapture?.(event.pointerId)
          event.currentTarget.setAttribute('data-dragging', '')
        },
        onPointerMove: (event) => {
          const drag = dragging.current
          if (!drag) return
          const element = ref.current
          const width = element?.offsetWidth ?? 520
          setPosition({ left: Math.max(8 - width + 80, Math.min(window.innerWidth - 80, event.clientX - drag.dx)), top: Math.max(8, Math.min(window.innerHeight - 48, event.clientY - drag.dy)) })
        },
        onPointerUp: (event) => { dragging.current = null; event.currentTarget.removeAttribute('data-dragging') },
      }
      const pin = () => {
        if (runtime.pin(popover.threadId, popover.sourceSessionId)) runtime.store.closePopover()
      }
      return h('div', { ref, className: 'sa-popover', 'data-selection-ask-ui': '', role: 'dialog', 'aria-label': t('title'), style: position ? { left: position.left, top: position.top } : { left: -9999, top: 0, visibility: 'hidden' } },
        guarded(t, popover.threadId ?? 'compose', h(ThreadPanel, { runtime, t, mode: 'popover', threadId: popover.threadId, compose: popover.compose, sourceSessionId: popover.sourceSessionId,
          onThread: (id, created) => id ? runtime.store.setPopoverThread(id, created === true) : runtime.store.closePopover(), onClose: () => runtime.store.closePopover(), onPin: pin, headProps }), () => runtime.store.closePopover()))
    }

    function FloatingPill({ runtime, t, pill }) {
      const ref = React.useRef(null)
      const [position, setPosition] = React.useState(null)
      React.useLayoutEffect(() => {
        const element = ref.current
        if (!element) return
        setPosition(placeNear(pill.rect, { width: window.innerWidth, height: window.innerHeight }, { width: element.offsetWidth || 96, height: element.offsetHeight || 30 }, 8, pill.below === true))
      }, [pill])
      return h('div', { ref, className: 'sa-floating-pill', 'data-selection-ask-ui': '', style: position ?? { left: -9999, top: 0, visibility: 'hidden' } },
        h('button', { type: 'button', className: 'sa-pill', onPointerDown: (event) => event.preventDefault(), onClick: () => runtime.store.openCompose(pill) }, h(AskIcon), t('ask')))
    }

    /** Root overlay: detects selections outside native Chat sources and renders pill + popover. */
    function Overlay({ runtime }) {
      const store = runtime.store
      const t = runtime.t
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      React.useEffect(() => runtime.attachDetector(), [runtime])
      const nodes = [state.pill && h(FloatingPill, { key: 'pill', runtime, t, pill: state.pill }), state.popover && h(Popover, { key: state.popover.key, runtime, t, popover: state.popover })]
      if (!state.pill && !state.popover) return null
      const content = h(React.Fragment, null, ...nodes)
      return ReactDOM?.createPortal && typeof document !== 'undefined' ? ReactDOM.createPortal(content, document.body) : content
    }

    function TabBody(props) {
      const runtime = props.selectionAsk
      const t = runtime.t
      const { tab } = props.useTabInfo()
      const sessionId = props.sessionId
      const params = tab.navigation?.params
      const revision = tab.navigation?.revision
      const [threadId, setThreadId] = React.useState(() => params?.threadId ?? runtime.lastThread(sessionId))
      React.useEffect(() => { if (params?.threadId) setThreadId(params.threadId) }, [revision])
      const select = (id) => { setThreadId(id); if (id) runtime.remember(sessionId, id) }
      return h('div', { className: 'sa-tab', 'data-selection-ask-ui': '' },
        guarded(t, threadId ?? 'empty', h(ThreadPanel, { runtime, t, mode: 'tab', threadId, compose: null, sourceSessionId: sessionId, active: tab.visible !== false, onThread: select }), () => select(null)))
    }

    /** Companion action beside the native Quote button for Chat text sources. */
    function CompanionButton({ runtime, sessionId, readText, dismiss, clearSelection }) {
      const t = runtime.t
      return h('button', { type: 'button', className: 'sa-pill', 'data-selection-ask-ui': '', 'aria-label': t('ask'),
        onPointerDown: (event) => event.preventDefault(),
        onClick: () => {
          const text = readText?.()
          if (!text) { dismiss?.(); return }
          const payload = runtime.chatSelection(text, sessionId)
          if (!payload) { runtime.notify(t('noSession')); dismiss?.(); return }
          dismiss?.()
          runtime.store.openCompose(payload)
          clearSelection?.()
        } }, h(AskIcon), t('ask'))
    }

    function registerReplacement(ctx, slot, key, ownId, make) {
      let previous
      let unregister
      let disposed = false
      function reconcile() {
        if (disposed) return
        const original = ctx.slots.entries(slot).find((entry) => entry.options.key === key && entry.options.id !== ownId)
        if (original === previous) return
        previous = original
        unregister?.(); unregister = undefined
        if (!original) return
        unregister = ctx.slots.register({ name: slot, ...original.options, id: ownId, locale: original.locale, inject: original.inject, priority: (original.options.priority ?? 0) - 1 }, make(original.component))
      }
      const unsubscribe = ctx.slots.subscribe(slot, reconcile)
      reconcile()
      return () => { disposed = true; unsubscribe(); unregister?.() }
    }

    function createRuntime(ctx) {
      const t = ctx.locale.bind(NS)
      const transport = globalThis.__DSH_TRANSPORT__
      const send = transport?.fetch ? transport.fetch.bind(transport) : globalThis.fetch.bind(globalThis)
      const api = createApi(send)
      const store = createStore()
      const htmlHosts = new Set()
      const attachedDocuments = new WeakSet()
      const modelCache = new Map()
      const watchedFrames = new WeakSet()
      let storage
      try { storage = globalThis.localStorage } catch { storage = undefined }
      const mounted = () => { try { return ctx.sidebarRight?.mounted?.getSnapshot?.() } catch { return undefined } }
      const runtime = {
        t, api, store,
        createFeed: (threadId, onUpdate) => createFeed({ api, threadId, onUpdate }),
        /** Model catalog plus the source conversation's current model; cached for 30 s per source. */
        models(sourceSessionId) {
          const key = sourceSessionId ?? ''
          const cached = modelCache.get(key)
          if (cached && Date.now() - cached.at < 30000) return cached.promise
          // Shared by every picker; not bound to one caller's abort signal.
          const promise = api('models', sourceSessionId ? { sourceSessionId } : {})
          modelCache.set(key, { at: Date.now(), promise })
          promise.catch(() => { if (modelCache.get(key)?.promise === promise) modelCache.delete(key) })
          return promise
        },
        mountedSession: mounted,
        fileDrag() { try { return ctx.get?.('fileDrag')?.actions } catch { return undefined } },
        openResource(address, options) {
          try { options ? ctx.sidebarRight.openResource(address, options) : ctx.sidebarRight.openResource(address) }
          catch (error) { console.warn('[selection-ask] open file failed:', errorText(error)) }
        },
        openExternal(url) {
          let safe
          try { const parsed = new URL(url); safe = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined } catch { safe = undefined }
          if (!safe) return
          try { if (ctx.get?.('sidebarRightTabs')?.get?.('browser') !== undefined) { ctx.sidebarRight.openTab('browser', { params: { url: safe } }); return } } catch {}
          window.open(safe, '_blank', 'noopener,noreferrer')
        },
        lastThread(sessionId) { try { return JSON.parse(storage?.getItem(LAST_THREAD_KEY) ?? '{}')[sessionId] ?? null } catch { return null } },
        remember(sessionId, threadId) {
          if (!sessionId || !threadId) return
          try { const map = JSON.parse(storage?.getItem(LAST_THREAD_KEY) ?? '{}'); map[sessionId] = threadId; const keys = Object.keys(map); for (const old of keys.slice(0, Math.max(0, keys.length - 200))) delete map[old]; storage?.setItem(LAST_THREAD_KEY, JSON.stringify(map)) } catch {}
        },
        notify(message) { console.warn(`[selection-ask] ${message}`) },
        pin(threadId, sourceSessionId) {
          if (!threadId) return false
          runtime.remember(sourceSessionId, threadId)
          try { ctx.sidebarRight.openTab(KIND, { preferNewPane: true, params: { threadId } }); return true }
          catch (error) { console.warn('[selection-ask] pin failed:', errorText(error)); return false }
        },
        chatSelection(text, sessionId) {
          const sourceSessionId = sessionId || mounted()
          if (!sourceSessionId) return null
          const selection = document.getSelection()
          const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null
          const details = range ? chatDetails(elementOf(range.startContainer)) : { kind: 'chat' }
          const clipped = clipSelection(text)
          const rect = range ? rectOfRange(range) : null
          return { sourceSessionId, rect, selection: { ...details, text: clipped.text, ...(clipped.truncated ? { truncated: true } : {}) } }
        },
        frameSelection(iframe, message) {
          if (!message || typeof message.text !== 'string' || !message.text.trim()) return
          const root = iframe.closest('[data-textpreview-url]')
          const file = parseFileAddress(root?.getAttribute('data-textpreview-url') ?? '')
          const side = sidebarContext(iframe)
          const sourceSessionId = file?.sessionId || side?.sessionId || mounted()
          if (!sourceSessionId) return
          const box = iframe.getBoundingClientRect()
          const rect = message.rect ?? {}
          const pathLabel = root?.querySelector('[data-textpreview-path]')
          const clipped = clipSelection(message.text)
          const text = (value, max) => typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined
          const selection = { kind: 'html', text: clipped.text, path: (pathLabel?.getAttribute('title') || pathLabel?.textContent || file?.path || iframe.getAttribute('title') || side?.title || '').trim() || undefined,
            heading: text(message.heading, 300), before: text(message.before, 1500), after: text(message.after, 1500), ...(clipped.truncated || message.truncated ? { truncated: true } : {}) }
          for (const key of Object.keys(selection)) if (selection[key] === undefined) delete selection[key]
          store.showPill({ origin: 'frame', frame: iframe, sourceSessionId, selection, below: !root,
            rect: { left: box.left + iframe.clientLeft + Number(rect.left || 0), top: box.top + iframe.clientTop + Number(rect.top || 0), width: Number(rect.width || 0), height: Number(rect.height || 0) } })
        },
        /** Track one wrapped HTML preview; static previews are read from the parent. */
        watchHtmlHost(host) {
          if (!host) return () => {}
          const attached = new Map()
          htmlHosts.add(host)
          const attachStatic = (iframe) => {
            if (attached.has(iframe)) return
            const sandbox = iframe.getAttribute('sandbox')
            if (sandbox === null || sandbox.trim() !== '' || !iframe.hasAttribute('srcdoc')) { attached.set(iframe, () => {}); return }
            // Static preview: no scripts may run, so read its selection from the parent.
            // allow-same-origin without allow-scripts keeps every in-document script disabled.
            iframe.setAttribute('sandbox', 'allow-same-origin')
            const onLoad = () => {
              try { selectionBridge(iframe.contentWindow, (message) => runtime.onFrameMessage(iframe, message), (callback) => setTimeout(callback, 0)) } catch (error) { console.warn('[selection-ask] static HTML selection unavailable:', errorText(error)) }
            }
            iframe.addEventListener('load', onLoad)
            iframe.srcdoc = iframe.getAttribute('srcdoc')
            attached.set(iframe, () => iframe.removeEventListener('load', onLoad))
          }
          const scan = () => { for (const iframe of host.querySelectorAll('iframe[data-html-preview]')) attachStatic(iframe) }
          const observer = new MutationObserver(scan)
          observer.observe(host, { childList: true, subtree: true })
          scan()
          return () => { observer.disconnect(); for (const cleanup of attached.values()) cleanup(); htmlHosts.delete(host) }
        },
        /** Attach to a readable (same-origin) iframe in the right sidebar once per document. */
        attachReadableFrame(iframe) {
          if (!(iframe instanceof HTMLIFrameElement) || !iframe.closest('[data-sidebar-right-session]') || iframe.closest('[data-selection-ask-html]')) return
          const attach = () => {
            let doc = null
            try { doc = iframe.contentDocument } catch { doc = null }
            if (!doc || attachedDocuments.has(doc) || doc.readyState === 'loading') return
            attachedDocuments.add(doc)
            try { selectionBridge(iframe.contentWindow, (message) => runtime.onFrameMessage(iframe, message), (callback) => setTimeout(callback, 0)) } catch {}
          }
          if (!watchedFrames.has(iframe)) { watchedFrames.add(iframe); iframe.addEventListener('load', attach) }
          attach()
        },
        onFrameMessage(iframe, message) {
          if (!message || message.source !== MESSAGE_SOURCE) return
          if (message.type === 'selection') runtime.frameSelection(iframe, message)
          else if (store.getSnapshot().pill?.frame === iframe) store.hidePill('frame')
        },
        attachDetector() {
          const doc = document
          let timer = 0
          let frame = 0
          const check = () => {
            timer = 0
            const payload = readDomSelection(doc, mounted())
            if (payload) store.showPill({ origin: 'dom', ...payload })
            else store.hidePill('dom')
          }
          const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 40) }
          const pointerOver = (event) => { if (event.target?.tagName === 'IFRAME') runtime.attachReadableFrame(event.target) }
          const pointerDown = (event) => {
            if (inOwnUi(event.target)) return
            store.hidePill()
            const popover = store.getSnapshot().popover
            if (popover?.compose && !popover.threadId) {
              const field = doc.querySelector('.sa-popover textarea')
              if (!field?.value.trim()) store.closePopover()
            }
          }
          const keyUp = (event) => { if (event.shiftKey || event.key === 'Shift' || (event.key === 'a' && (event.metaKey || event.ctrlKey))) schedule() }
          const selectionChange = () => { const selection = doc.getSelection(); if (!selection || selection.isCollapsed) store.hidePill('dom') }
          const reposition = () => {
            if (frame) return
            frame = requestAnimationFrame(() => {
              frame = 0
              const pill = store.getSnapshot().pill
              if (!pill) return
              if (pill.origin === 'frame') { store.hidePill('frame'); return }
              const selection = doc.getSelection()
              if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) { store.hidePill('dom'); return }
              const rect = rectOfRange(selection.getRangeAt(0))
              if (rect.top < 0 || rect.top > window.innerHeight) store.hidePill('dom')
              else store.showPill({ ...pill, rect })
            })
          }
          const message = (event) => {
            if (event.data?.source !== MESSAGE_SOURCE) return
            for (const host of htmlHosts) for (const iframe of host.querySelectorAll('iframe[data-html-preview]')) {
              if (iframe.contentWindow && iframe.contentWindow === event.source) { runtime.onFrameMessage(iframe, event.data); return }
            }
          }
          doc.addEventListener('pointerup', schedule)
          doc.addEventListener('pointerdown', pointerDown, true)
          doc.addEventListener('pointerover', pointerOver, true)
          doc.addEventListener('keyup', keyUp)
          doc.addEventListener('selectionchange', selectionChange)
          doc.addEventListener('scroll', reposition, true)
          window.addEventListener('resize', reposition)
          window.addEventListener('message', message)
          return () => {
            clearTimeout(timer); cancelAnimationFrame(frame)
            doc.removeEventListener('pointerup', schedule)
            doc.removeEventListener('pointerdown', pointerDown, true)
            doc.removeEventListener('pointerover', pointerOver, true)
            doc.removeEventListener('keyup', keyUp)
            doc.removeEventListener('selectionchange', selectionChange)
            doc.removeEventListener('scroll', reposition, true)
            window.removeEventListener('resize', reposition)
            window.removeEventListener('message', message)
          }
        },
      }
      return runtime
    }

    function writable(ctx, sessionId) {
      try {
        const session = ctx.sessions.binding(sessionId)?.session.getSnapshot()
        return !!session && !session.removed && (session.subagent === null || (session.subagent.address.mode === 'continuable' && session.subagent.parentAvailable === true))
      } catch { return false }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), '[selection-ask] locale')
      const runtime = createRuntime(ctx)
      const t = runtime.t
      ctx.effect(() => ensureStyle(), '[selection-ask] style')
      ctx.effect(() => () => runtime.store.closePopover(), '[selection-ask] popover')
      // Root overlay: selection detection, pill and popover.
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: `${TYPE}.overlay`, locale: NS, inject: () => ({ selectionAsk: runtime }) }, (props) => h(Overlay, { runtime: props.selectionAsk ?? runtime }))), '[selection-ask] overlay')
      // Chat text sources: show "Ask" beside the native Quote action.
      const companionId = `${TYPE}.quote-companion`
      ctx.effect(() => ctx.slots.inject(INTERACTION_SLOT, () => registerReplacement(ctx, INTERACTION_SLOT, 'quote', companionId, (NativeQuote) => function QuoteWithAsk(props) {
        return h('span', { className: 'sa-companion' }, h(NativeQuote, props), h(CompanionButton, { runtime, sessionId: props.sessionId, readText: props.readText, dismiss: props.dismiss, clearSelection: props.clearSelection }))
      })), '[selection-ask] quote companion')
      // When Quote is absent or declines (read-only conversations), open our own action.
      ctx.effect(() => ctx.uiConversation.interactions.register({
        id: KIND,
        onInteraction(request) {
          if (request.trigger !== 'selection' || request.readText() === null) return
          const quote = ctx.slots.entries(INTERACTION_SLOT).some((entry) => entry.options.key === 'quote')
          if (quote && writable(ctx, request.sessionId)) return
          request.open()
        },
      }), '[selection-ask] chat interaction')
      ctx.effect(() => ctx.slots.inject(INTERACTION_SLOT, () => ctx.slots.register({ name: INTERACTION_SLOT, key: KIND, locale: NS }, (props) => h(CompanionButton, { runtime, sessionId: props.sessionId, readText: props.readText, dismiss: props.dismiss, clearSelection: props.clearSelection }))), '[selection-ask] chat action')
      // HTML previews: inject the selection bridge into the rendered document.
      ctx.effect(() => ctx.slots.inject(DOCUMENT_SLOT, () => registerReplacement(ctx, DOCUMENT_SLOT, HTML_BODY_ID, `${TYPE}.html`, (NativeHtml) => function HtmlWithSelection(props) {
        const host = React.useRef(null)
        const content = React.useMemo(() => props.content?.kind === 'bytes' ? { ...props.content, data: injectBridge(props.content.data) } : props.content, [props.content])
        React.useEffect(() => runtime.watchHtmlHost(host.current), [])
        return h('div', { ref: host, 'data-selection-ask-html': '', style: { display: 'contents' } }, h(NativeHtml, { ...props, content }))
      })), '[selection-ask] html bridge')
      // Pinned sidebar tab with history.
      ctx.effect(() => ctx.sidebarRightTabs.register({ id: TYPE, kind: KIND, priority: 'extension', patterns: [], title: () => t('title'),
        guide: [{ id: KIND, order: 30, icon: GuideIcon, title: () => t('title'), description: () => t('guide') }], keepMounted: true }), '[selection-ask] tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE, locale: NS, inject: () => ({ selectionAsk: runtime }) }, TabBody)), '[selection-ask] tab body')
    }

    return {
      name: TYPE,
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'uiConversation'],
      apply,
      // Test surface.
      parseFileAddress, baseName, clipSelection, selectionLabel, modelLabel, isComponent, MarkdownText, sessionFileAddress, resolvePath, createLinks, markdownLabels, linesAround, backoffDelay, relativeTime, placeNear, createApi, createFeed,
      injectBridge, injectBridgeText, selectionBridge, readDomSelection, createStore, sidebarContext, codeMirrorView, codeMirrorSelection, ZH, EN, CSS, MAX_TEXT, OPERATIONS,
    }
  },
})
