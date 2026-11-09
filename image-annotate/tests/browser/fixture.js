// Mounts the native ui-attachment composer rail with the shell's real React and
// primitives, applies dsh-image-annotate on top, and emulates the composer's
// append-only attachment store, including intake that reads the attachment list
// captured by the render it was created in (like InputBar's useCallback).
(function () {
  const shared = window.__shared
  const React = shared.react
  const ReactDOMClient = shared['react-dom/client']
  const h = React.createElement
  const log = (line) => { document.getElementById('log').textContent += line + '\n' }
  const require = (id) => { if (id in shared) return shared[id]; throw new Error('missing ' + id) }
  const SLOT = 'conversation.input.attachments'

  // ---- slot registry (ordering: lower priority value wins, like the shell) ----
  const table = new Map()
  const listeners = new Map()
  let version = 0
  const versionListeners = new Set()
  const notify = (name) => { version++; for (const fn of listeners.get(name) || []) fn(); for (const fn of versionListeners) fn() }
  const entriesOf = (name) => (table.get(name) || []).slice().sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))
  const slots = {
    inject: (_, fn) => fn(),
    registerFactory: () => () => {},
    register(options, component) {
      const entry = { options, component, inject: options.inject, locale: options.locale }
      const list = table.get(options.name) || []
      list.push(entry); table.set(options.name, list); notify(options.name)
      return () => { const current = table.get(options.name) || []; const i = current.indexOf(entry); if (i >= 0) { current.splice(i, 1); notify(options.name) } }
    },
    entries: entriesOf, entriesOfSlot: entriesOf,
    subscribe(name, fn) { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn) },
  }

  // ---- composer attachment store ----
  window.toasts = []
  window.limits = { maxImages: 6, maxBytes: 10 * 1024 * 1024 }
  window.rejectNext = false
  window.locked = false
  const store = { ids: [], byId: new Map(), uploads: {}, listeners: new Set(), revoked: [], intakes: [] }
  let snapshot = { ids: [], uploads: {} }
  const publish = () => { snapshot = { ids: store.ids.slice(), uploads: { ...store.uploads } }; for (const fn of store.listeners) fn() }
  let seq = 0
  store.add = (files) => {
    for (const file of files) {
      const id = 'att-' + (++seq)
      store.byId.set(id, { kind: file.type.startsWith('image/') ? 'image' : 'file', id, previewUrl: URL.createObjectURL(file), file })
      store.ids.push(id)
      store.uploads[id] = { status: 'uploading', loaded: 0, total: file.size }
      setTimeout(() => { if (store.uploads[id]) { store.uploads[id] = { status: 'ready' }; publish() } }, 250)
    }
    publish()
  }
  store.remove = (id) => {
    if (!store.ids.includes(id)) return
    store.ids = store.ids.filter((item) => item !== id)
    const attachment = store.byId.get(id)
    if (attachment?.kind === 'image') { URL.revokeObjectURL(attachment.previewUrl); store.revoked.push(id) }
    delete store.uploads[id]
    publish()
  }
  window.store = store

  const t = (key, params) => params ? key + JSON.stringify(params) : key
  function Composer() {
    React.useSyncExternalStore((fn) => { versionListeners.add(fn); return () => versionListeners.delete(fn) }, () => version)
    const snap = React.useSyncExternalStore((fn) => { store.listeners.add(fn); return () => store.listeners.delete(fn) }, () => snapshot)
    const attachments = React.useMemo(() => snap.ids.map((id) => store.byId.get(id)), [snap.ids])
    const intakeFiles = React.useCallback((files) => {
      store.intakes.push(files.map((file) => file.name))
      if (window.locked || files.length === 0) return
      const images = files.filter((file) => file.type.startsWith('image/'))
      const current = attachments.filter((item) => item.kind === 'image').length
      let rejected = null
      if (window.rejectNext) { window.rejectNext = false; rejected = 'image.fileTooLarge' }
      else if (current + images.length > window.limits.maxImages) rejected = 'image.tooMany'
      else if (images.some((file) => file.size > window.limits.maxBytes)) rejected = 'image.fileTooLarge'
      if (rejected) { window.toasts.push(rejected); log('toast: ' + rejected); return }
      store.add(files)
    }, [attachments])
    const entry = entriesOf(SLOT)[0]
    if (!entry) return h('div', null, 'no entry')
    return h(entry.component, {
      ...(entry.inject?.() || {}), attachments, canAcceptDrop: !window.locked, onAddFiles: intakeFiles,
      onRemoveAttachment: (id) => store.remove(id), uploads: snap.uploads, onRetryFile: () => {}, uploadFailureText: (reason) => reason,
      dropLimits: { count: window.limits.maxImages, size: '10 MB' }, t,
    })
  }

  // ---- test images ----
  function makeImage(name, type, width, height, hue) {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const c = canvas.getContext('2d')
    const gradient = c.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, `hsl(${hue} 70% 92%)`); gradient.addColorStop(1, `hsl(${hue + 40} 60% 78%)`)
    c.fillStyle = gradient; c.fillRect(0, 0, width, height)
    c.fillStyle = '#ffffff'; c.fillRect(width * 0.08, height * 0.12, width * 0.84, height * 0.7)
    c.fillStyle = '#1c1c1e'; c.font = `600 ${Math.round(height / 12)}px system-ui`; c.fillText(name, width * 0.12, height * 0.25)
    c.fillStyle = '#8e8e93'
    for (let i = 0; i < 5; i++) c.fillRect(width * 0.12, height * (0.34 + i * 0.08), width * (0.6 - i * 0.07), height * 0.035)
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], name, { type })), type, 0.9))
  }
  window.seed = async () => {
    const files = [await makeImage('screenshot.png', 'image/png', 1200, 800, 210), await makeImage('photo.jpg', 'image/jpeg', 900, 1200, 20), await makeImage('third.webp', 'image/webp', 640, 400, 120)]
    store.add(files)
    return files.map((file) => ({ name: file.name, type: file.type, size: file.size }))
  }
  window.state = () => store.ids.map((id) => { const item = store.byId.get(id); return { id, name: item.file.name, type: item.file.type, size: item.file.size, lastModified: item.file.lastModified } })
  window.readPixel = (id, x, y) => new Promise((resolve) => {
    const image = new Image()
    image.onload = () => { const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight; const g = c.getContext('2d'); g.drawImage(image, 0, 0); resolve({ w: image.naturalWidth, h: image.naturalHeight, rgba: Array.from(g.getImageData(x, y, 1, 1).data) }) }
    image.src = store.byId.get(id).previewUrl
  })

  try {
    window.__registrations['@deepseek-ai/dsh-client-ui-attachment'].factory(require).apply({ slots, fileDrag: { actions: {}, read: () => null } })
    const plugin = window.__registrations['dsh-image-annotate'].factory(require)
    const dictionaries = {}
    window.useEnglish = false
    plugin.apply({
      effect: (fn) => fn(),
      locale: { register(ns, dict) { dictionaries[ns] = dict; return () => {} }, bind: (ns) => (key, params = {}) => String(dictionaries[ns]?.[window.useEnglish ? 'en' : 'zh']?.[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '') },
      slots,
    })
    window.slotEntries = () => entriesOf(SLOT).map((entry) => entry.options.id || 'native')
    ReactDOMClient.createRoot(document.getElementById('composer')).render(h(React.StrictMode, null, h(Composer)))
    log('mounted; slot entries: ' + window.slotEntries().join(', '))
  } catch (error) { window.__errors.push('apply: ' + String(error?.stack || error)); log('ERROR ' + error) }
})()
