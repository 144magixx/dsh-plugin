import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const requested = []
let registration
runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { registration = value } } },
  console, setTimeout, clearTimeout, Uint8Array, btoa, AbortController, AbortSignal,
}, { filename: 'dsh-page-annotate/client.js', timeout: 1000 })
const ReactStub = Object.freeze({ createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment', useState() {}, useRef() {}, useEffect() {}, useCallback() {}, useSyncExternalStore() {} })
const client = registration.factory((id) => {
  requested.push(id)
  if (id === 'react') return ReactStub
  throw new Error(`Unavailable in Node: ${id}`)
})
const t = client.makeT(client.ZH)

test('registers under the package id, requires only shell modules, and inlines the vendor', () => {
  assert.equal(registration.id, 'dsh-page-annotate')
  assert.deepEqual([...new Set(requested)].sort(), ['react', 'react-dom/client'])
  assert.equal(client.name, 'dsh-page-annotate')
  assert.deepEqual([...client.inject], ['betterSidebar', 'locale'])
  assert.ok(client.VENDOR_SRC_LENGTH > 10000, 'html-to-image is inlined')
  assert.deepEqual(Object.keys(client.ZH).sort(), Object.keys(client.EN).sort(), 'zh and en dictionaries match')
  for (const field of client.STYLE_FIELDS) assert.ok(client.ZH[`field.${field.key}`], `label for ${field.key}`)
})

test('html path matching', () => {
  assert.equal(client.isHtmlPath('/a/report.html'), true)
  assert.equal(client.isHtmlPath('/a/INDEX.HTM'), true)
  assert.equal(client.isHtmlPath('/a/x.xhtml'), true)
  assert.equal(client.isHtmlPath('/a/x.md'), false)
  assert.equal(client.isHtmlPath(undefined), false)
})

test('element description and selector', () => {
  const el = (tag, attrs = {}, parent = null) => {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), id: attrs.id ?? '', className: attrs.className ?? '', parentElement: parent, children: [] }
    if (parent) parent.children.push(node)
    return node
  }
  const html = el('html')
  const body = el('body', {}, html)
  const main = el('main', {}, body)
  el('h2', {}, main)
  const h2 = el('h2', { className: 'section-title big extra pa-x' }, main)
  assert.equal(client.describeElement(h2), 'h2.section-title.big')
  assert.equal(client.describeElement(el('div', { id: 'app' })), 'div#app')
  assert.equal(client.selectorFor(h2), 'body > main > h2:nth-of-type(2)')
  const inner = el('span', {}, el('section', { id: 'intro' }, main))
  assert.match(client.selectorFor(inner), /^section#intro > span$/)
})

test('rects, paths, text', () => {
  assert.deepEqual({ ...client.normalizeRect({ x: 50, y: 10 }, { x: 10, y: 40 }) }, { left: 10, top: 10, width: 40, height: 30 })
  assert.equal(client.displayPath('/w/proj/report/a.html', '/w/proj'), 'report/a.html')
  assert.equal(client.displayPath('/w/proj/report/a.html', '/w/proj/'), 'report/a.html')
  assert.equal(client.displayPath('/elsewhere/a.html', '/w/proj'), '/elsewhere/a.html')
  assert.equal(client.displayPath('C:\\w\\a.html', 'C:\\w'), 'a.html')
  assert.equal(client.textExcerpt('  a\n\n b  ', 80), 'a b')
  assert.equal(client.textExcerpt('x'.repeat(10), 5), 'xxxx…')
})

test('color and number parsing', () => {
  assert.equal(client.colorToHex('rgb(17, 17, 17)'), '#111111')
  assert.equal(client.colorToHex('rgba(37, 99, 235, 0.5)'), '#2563eb')
  assert.equal(client.colorToHex('rgba(0, 0, 0, 0)'), '')
  assert.equal(client.colorToHex('#ABC'), '#aabbcc')
  assert.equal(client.colorToHex('red'), '')
  assert.equal(client.pxOf('32px'), 32)
  assert.equal(client.lineRatio('normal', '16px'), 1.2)
  assert.equal(client.lineRatio('24px', '16px'), 1.5)
  assert.equal(client.lineRatio('1.6', '16px'), 1.6)
  const computed = { getPropertyValue: (key) => ({ 'font-size': '32.4px', color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)', 'font-weight': '600', 'line-height': 'normal', padding: '0px' })[key] ?? '' }
  const field = (key) => client.STYLE_FIELDS.find((item) => item.key === key)
  assert.equal(client.fieldValue(field('font-size'), computed), 32)
  assert.equal(client.fieldValue(field('color'), computed), '#000000')
  assert.equal(client.fieldValue(field('background-color'), computed), '')
  assert.equal(client.fieldValue(field('font-weight'), computed), '600')
  assert.equal(client.cssValue(field('font-size'), 28), '28px')
  assert.equal(client.cssValue(field('line-height'), 1.5), '1.5')
})

test('screenshot ratio stays under the pixel budget', () => {
  assert.equal(client.shotRatio(300, 200, 2), 2)
  assert.equal(client.shotRatio(300, 200, 1), 1)
  const ratio = client.shotRatio(4000, 4000, 2)
  assert.ok(4000 * 4000 * ratio * ratio <= 4_000_000 + 1)
})

test('meaningful annotations and numbering', () => {
  assert.equal(client.isMeaningful({ comment: '  ' , styles: [] }), false)
  assert.equal(client.isMeaningful({ comment: 'x', styles: [] }), true)
  assert.equal(client.isMeaningful({ comment: '', styles: [{}] }), true)
  assert.equal(client.isMeaningful({ comment: '', styles: [], queued: true }), true)
  assert.equal(client.nextNumber([]), 1)
  assert.equal(client.nextNumber([{ number: 1 }, { number: 4 }]), 5)
})

test('prompt lists every annotation with its image reference', () => {
  const text = client.buildPrompt({
    path: '/w/proj/report/joyrisk.html',
    cwd: '/w/proj',
    t,
    notes: [
      { number: 1, kind: 'element', label: 'h2.section-title', selector: 'body > h2', text: '1. 我对 JoyRisk 的整体理解', comment: '字号改小\n颜色换品牌蓝', styles: [{ prop: 'font-size', before: '32px', after: '28px' }, { prop: 'color', before: '#111111', after: '#2563eb' }], textChange: null, hasShot: true },
      { number: 2, kind: 'area', rect: { left: 24.4, top: 680, width: 320, height: 140 }, contains: ['p.intro', 'ul'], text: '具体来说', comment: '', styles: [], textChange: null, hasShot: false },
      { number: 3, kind: 'element', label: '', selector: 'p', text: '旧', comment: '换个说法', styles: [], textChange: { before: '旧', after: '新的文字' }, hasShot: true },
    ],
  })
  assert.match(text, /# 页面批注（3 条）/)
  assert.match(text, /来源文件：`\/w\/proj\/report\/joyrisk\.html`/)
  assert.match(text, /提问或疑惑应结合页面解释/)
  assert.match(text, /不要擅自修改/)
  assert.match(text, /1\. \[元素\] `h2\.section-title`（选择器 `body > h2`）/)
  assert.match(text, /批注：字号改小\n颜色换品牌蓝/)
  assert.match(text, /预览中试调的样式：font-size 32px → 28px；color #111111 → #2563eb/)
  assert.match(text, /附图：annotation-1\.png/)
  assert.match(text, /2\. \[区域\] 320×140，位于页面 \(24, 680\)/)
  assert.match(text, /包含：`p\.intro`、`ul`/)
  assert.match(text, /批注：（未填写/)
  assert.doesNotMatch(text, /annotation-2\.png/)
  assert.match(text, /预览中试调的文字：“新的文字”/)
  assert.match(text, /annotation-3\.png/)
})

test('draft append keeps one blank line', () => {
  assert.equal(client.appendBlock('', 'X'), 'X')
  assert.equal(client.appendBlock('hello  \n', 'X'), 'hello\n\nX')
})

test('native reference preserves the draft and carries a compact label, including Windows separators', () => {
  let captured
  const actx = {}
  const input = { state: { getSnapshot: () => ({draft: '解释这些批注 ', draftRev: 12, phase: 'plain'}) },
    insertReference(ref, span) { captured = { ref, span }; return true },
    setDraft() { throw Error('must not replace draft') } }
  const ctx = { get(name) {
    if (name === 'sessions') return { scope: id => id === 's1' ? actx : undefined }
    if (name === 'conversation') return { input: { for: scope => { assert.equal(scope, actx); return input } } }
  } }
  const saved = { count: 2, relativePath: '.dsh\\annotations\\2026-11-15-1234\\2条批注.md' }
  assert.equal(client.insertAnnotationReference(ctx, 's1', saved), true)
  assert.equal(captured.ref.label, '2 条批注')
  assert.equal(captured.ref.appearance, 'file')
  assert.equal(captured.ref.ref, '@".dsh/annotations/2026-11-15-1234/2条批注.md"')
  assert.equal(captured.span.draftRev, 12)
  assert.equal(captured.span.start, '解释这些批注 '.length)
  assert.equal(client.insertAnnotationReference(ctx, 'missing', saved), false)
  input.insertReference = () => false
  assert.equal(client.insertAnnotationReference(ctx, 's1', saved), false)
  for (const path of ['../x.md', '.dsh/annotations/../x.md', '.dsh/annotations/x"y.md', '.dsh/annotations/x\ny.md']) {
    assert.equal(client.insertAnnotationReference(ctx, 's1', { ...saved, relativePath: path }), false)
  }
})

test('questions and empty comments have no blanket edit instruction', () => {
  const text = client.buildPrompt({path: 'C:/项目/docs/a.html', notes:[{number:1,kind:'element',selector:'h2',text:'页面原文',comment:'哦',styles:[],hasShot:false}],t})
  assert.match(text, /批注：哦/)
  assert.match(text, /意图不明确时先确认/)
  assert.doesNotMatch(text, /请根据以下页面批注修改|附图：/)
})

test('images are serialized for storage, failed or oversized captures remain honest', async () => {
  const notes = [
    { number:1, shot:Promise.resolve(new Blob(['PNG fixture'], {type:'image/png'})) },
    { number:2, shot:Promise.reject(Error('capture failed')) },
    { number:3, shot:Promise.resolve({size:9*1024*1024}) },
  ]
  const images = await client.collectImages(notes)
  assert.equal(images.length, 1)
  assert.equal(images[0].number, 1)
  assert.equal(Buffer.from(images[0].data,'base64').toString(), 'PNG fixture')
  assert.deepEqual(notes.map(n=>n.hasShot), [true,false,false])
})

test('frameState reports why the overlay cannot attach', () => {
  assert.equal(client.frameState(null).reason, 'edit')
  assert.equal(client.frameState({ querySelector: () => null }).reason, 'edit')
  assert.equal(client.frameState({ querySelector: () => ({ contentDocument: null, hasAttribute: () => true }) }).reason, 'sandbox')
  assert.equal(client.frameState({ querySelector: () => ({ contentDocument: null, hasAttribute: () => false }) }).reason, 'origin')
  assert.equal(client.frameState({ querySelector: () => ({ contentDocument: { readyState: 'loading', body: {}, URL: 'x' } }) }).reason, 'wait')
  assert.equal(client.frameState({ querySelector: () => ({ contentDocument: { readyState: 'complete', body: {}, URL: 'http://h/sidebar/html/x' } }) }).reason, null)
})

test('apply registers the editor action through the better-sidebar service and cleans up', () => {
  const effects = []
  const registered = []
  const disposed = []
  const ctx = {
    effect(fn) { effects.push(fn()) },
    locale: { register: () => () => {}, bind: () => (key) => key },
    betterSidebar: { registerEditorAction(descriptor) { registered.push(descriptor); return () => disposed.push(descriptor.id) } },
  }
  const savedDocument = globalThis.document
  client.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, client.ACTION_ID)
  assert.equal(registered[0].match('/a/b.html'), true)
  assert.equal(registered[0].match('/a/b.ts'), false)
  for (const dispose of effects) if (typeof dispose === 'function') dispose()
  assert.deepEqual(disposed, [client.ACTION_ID])
  assert.equal(globalThis.document, savedDocument)
})

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const queuedNote = (id = 'one', comment = 'original') => ({
  id, number: 1, kind: 'area', rect: { left: 0, top: 0, width: 10, height: 10 },
  comment, styles: [], textChange: null, queued: true, shot: Promise.resolve(null),
})

test('pending submission freezes edits and only submits once', async () => {
  const gate = deferred()
  let calls = 0
  const controller = client.createController({ t, onSend: async notes => {
    calls++
    await gate.promise
    assert.equal(notes[0].comment, 'original')
    return { imagesAttached: true }
  } })
  try {
    controller._addNote(queuedNote(), true)
    const work = controller.sendAll()
    assert.equal(controller.getSnapshot().sending, true)
    controller.editNote('one')
    controller.updateDraft({ comment: 'lost update' })
    controller.removeNote('one')
    controller.clearAll()
    controller._addNote(queuedNote('two'), true)
    await controller.sendAll()
    assert.equal(controller._notes().length, 1)
    assert.equal(controller._notes()[0].comment, 'original')
    assert.equal(controller.getSnapshot().draftId, null)
    gate.resolve()
    await work
    await controller.sendAll()
    assert.equal(calls, 1)
    assert.equal(controller._notes().length, 0)
    assert.equal(controller.getSnapshot().sending, false)
  } finally { controller.dispose() }
})

test('failed submission retains empty queued notes through reopening, closing and retry', async () => {
  let calls = 0
  const controller = client.createController({ t, onSend: async () => {
    if (++calls === 1) throw Error('offline')
    return { imagesAttached: false }
  } })
  try {
    controller._addNote(queuedNote('one', ''), true)
    await controller.sendAll()
    assert.equal(controller.getSnapshot().status.kind, 'error')
    assert.equal(controller._notes().length, 1)
    controller.editNote('one')
    controller.closeDraft()
    assert.equal(controller.getSnapshot().queueCount, 1)
    await controller.sendAll()
    assert.equal(controller._notes().length, 0)
    assert.equal(calls, 2)
  } finally { controller.dispose() }
})

test('composer rejection reuses saved files; changed content saves a fresh batch', async () => {
  const current = { ctx: {}, scope: { sessionId: 's1' }, path: 'C:\\项目\\a.html' }
  let uploads = 0, insertions = 0, accepted = false
  const sender = client.createBatchSender({ t, getCurrent: () => current,
    save: async body => { uploads++; return { count: body.count, relativePath: '.dsh/annotations/b/1条批注.md' } },
    insert: () => { insertions++; return accepted },
  })
  try {
    const notes = [queuedNote()]
    await assert.rejects(sender.send(notes), /批注已保留/)
    await assert.rejects(sender.send(notes), /批注已保留/)
    assert.equal(uploads, 1)
    notes[0].comment = 'changed'
    await assert.rejects(sender.send(notes), /批注已保留/)
    assert.equal(uploads, 2)
    accepted = true
    await sender.send(notes)
    assert.equal(uploads, 2)
    assert.equal(insertions, 4)
  } finally { sender.dispose() }
})

test('save failure never inserts a reference and allows a successful retry', async () => {
  let uploads = 0, inserted = 0
  const sender = client.createBatchSender({ t, getCurrent: () => ({ ctx: {}, scope: { sessionId: 's' }, path: '/w/a.html' }),
    save: async () => { if (++uploads === 1) throw Error('503'); return { count: 1 } },
    insert: () => { inserted++; return true },
  })
  try {
    await assert.rejects(sender.send([queuedNote()]), /503/)
    assert.equal(inserted, 0)
    await sender.send([queuedNote()])
    assert.equal(uploads, 2)
    assert.equal(inserted, 1)
  } finally { sender.dispose() }
})

test('unmount aborts an upload and never inserts its late result', async () => {
  const gate = deferred(), started = deferred()
  let signal, inserted = 0
  const sender = client.createBatchSender({ t, getCurrent: () => ({ ctx: {}, scope: { sessionId: 's' }, path: '/w/a.html' }),
    save: async (_body, value) => { signal = value; started.resolve(); return gate.promise },
    insert: () => { inserted++; return true },
  })
  const work = sender.send([queuedNote()])
  await started.promise
  sender.dispose()
  assert.equal(signal.aborted, true)
  gate.resolve({ count: 1 })
  await assert.rejects(work, /已取消/)
  assert.equal(inserted, 0)
  await assert.rejects(sender.send([queuedNote()]), /已取消/)
})

test('apply degrades without the editorActions feature', () => {
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    client.apply({ effect(fn) { fn() }, locale: { register: () => () => {}, bind: () => (key) => key }, betterSidebar: {} })
  } finally {
    console.warn = original
  }
  assert.ok(warnings.some((message) => message.includes('editorActions')))
})
