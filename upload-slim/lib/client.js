/** 上行瘦身 · Upload Slim: switch, strategy picker with real before/after previews. Only React is imported. */
window.__ModuleLoader__.load({
  id: 'dsh-upload-slim',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAME = 'dsh-upload-slim', NS = 'upload-slim'
    const ACTION = '/api/upload-slim/action', IMAGE = '/api/upload-slim/image'
    const BASELINE = 'dsh-default'
    const ZH = {
      title: '上行瘦身', subtitle: '发图前按策略缩小、重新编码，减少每轮请求的上传量。只改 DSH 自带的图片参数，关闭后恢复原值。',
      on: '已开启', off: '未开启', toggle: '开启上行瘦身',
      statusOn: '已对 {count} 条路由生效：{routes}', statusOff: '未开启：图片按 DSH 默认（每张最多 2048×2048 像素、约 1 MB）上传。',
      statusNoRoutes: '已开启，但没有选中的路由。',
      strategies: '压缩策略', routes: '应用到哪些模型路由', compare: '压缩前后对比', estimateTitle: '估算',
      fidelity: '保真', balanced: '均衡', saver: '省流', minimal: '极省', [BASELINE]: 'DSH 默认（关闭时）', source: '存储原图',
      fidelityDesc: '几乎看不出差别，适合核对细节、配色。', balancedDesc: '小字仍清楚，体积大幅下降。推荐。',
      saverDesc: '优先速度，彩色细字边缘会发虚。', minimalDesc: '只看大致布局，细节明显损失。',
      params: '≤ {w}×{h} 像素 · 约 {kb} KB/张', recommended: '推荐',
      sample: '样本 {count} 张：{total}', perRequest: '这些图每轮约需 {sec} 秒上传（{speed} KB/s）', saving: '比默认少 {pct}%',
      computing: '正在用 DSH 的真实编码计算 {count} 张图…', noImages: '最近的会话里还没有图片。发过图片的会话会出现在这里。',
      imagesFrom: '来自当前与最近会话的真实图片（发给模型的就是右侧这种版本）', left: '左', right: '右', zoom: '放大',
      fit: '适应宽度', pixelated: '像素放大', reload: '重新取样', uplink: '你的上行速度', kbps: 'KB/s',
      managed: '插件管理中', current: '当前：{params}', allRoutes: '全部路由', apiLabel: '协议 {api}',
      notesTitle: '说明', note1: '切换开关或策略后，进行中会话的下一轮请求提示词缓存会失效一次，之后恢复命中。',
      note2: '不改“单次请求图片总量 / 张数上限”：调低它们会让 DSH 永久省略旧图，关闭插件也找不回来。',
      note3: '开启时，只在已瘦身路由的系统提示词里告诉 Agent 图片是压缩预览，看不清时去原图裁剪局部。',
      showNotice: '查看给 Agent 的说明', hideNotice: '收起',
      drift: '{routes} 的图片参数被别处改过，与当前策略不一致。', reapply: '重新应用',
      settingsMissing: 'DSH 设置服务不可用，无法修改模型路由配置。', loadFailure: '暂时无法读取状态', retry: '重试',
      failure: '操作未完成：{message}', saved: '已应用', openPage: '打开上行瘦身', chip: '瘦身·{name}',
      bytes: '{kb} KB', base64: '请求中 {kb} KB', dims: '{w}×{h}', loadingImage: '加载中…', imageFailed: '图片加载失败',
    }
    const EN = {
      title: 'Upload Slim', subtitle: 'Downscale and re-encode images before upload to cut per-turn upload size. Only DSH\'s own image settings are changed; turning it off restores them.',
      on: 'On', off: 'Off', toggle: 'Enable Upload Slim',
      statusOn: 'Active on {count} route(s): {routes}', statusOff: 'Off: images upload at DSH defaults (up to 2048×2048 px, ~1 MB each).',
      statusNoRoutes: 'On, but no route is selected.',
      strategies: 'Strategy', routes: 'Apply to model routes', compare: 'Before / after', estimateTitle: 'Estimate',
      fidelity: 'Fidelity', balanced: 'Balanced', saver: 'Saver', minimal: 'Minimal', [BASELINE]: 'DSH default (off)', source: 'Stored original',
      fidelityDesc: 'Nearly indistinguishable; for checking details and colors.', balancedDesc: 'Small text stays readable, much smaller. Recommended.',
      saverDesc: 'Speed first; thin colored text gets soft edges.', minimalDesc: 'Layout only; details are clearly lost.',
      params: '≤ {w}×{h} px · ~{kb} KB each', recommended: 'Recommended',
      sample: '{count} sample images: {total}', perRequest: 'about {sec}s per turn to upload these ({speed} KB/s)', saving: '{pct}% smaller than default',
      computing: 'Encoding {count} images with DSH\'s real pipeline…', noImages: 'No images in recent conversations yet.',
      imagesFrom: 'Real images from current and recent conversations (the right side is what the model receives)', left: 'Left', right: 'Right', zoom: 'Zoom',
      fit: 'Fit width', pixelated: 'Pixelated', reload: 'Resample', uplink: 'Your upload speed', kbps: 'KB/s',
      managed: 'Managed', current: 'Current: {params}', allRoutes: 'All routes', apiLabel: 'API {api}',
      notesTitle: 'Notes', note1: 'Changing the switch or strategy invalidates the prompt cache once for running conversations.',
      note2: 'Request-wide image caps are not changed: lowering them makes DSH drop old images permanently.',
      note3: 'When on, the system prompt of slimmed routes tells the Agent images are lossy previews and how to inspect originals.',
      showNotice: 'Show the Agent notice', hideNotice: 'Hide',
      drift: '{routes} image settings were changed elsewhere and no longer match.', reapply: 'Re-apply',
      settingsMissing: 'DSH settings service is unavailable; routes cannot be changed.', loadFailure: 'Could not load state', retry: 'Retry',
      failure: 'Not applied: {message}', saved: 'Applied', openPage: 'Open Upload Slim', chip: 'Slim · {name}',
      bytes: '{kb} KB', base64: '{kb} KB in request', dims: '{w}×{h}', loadingImage: 'Loading…', imageFailed: 'Image failed to load',
    }
    const VARIANTS = ['source', BASELINE, 'fidelity', 'balanced', 'saver', 'minimal']
    const ZOOMS = ['fit', '1', '2', '3']
    const kb = bytes => Math.max(1, Math.round((bytes || 0) / 1024))
    const mb = bytes => `${((bytes || 0) / 1048576).toFixed(1)} MB`
    const b64 = bytes => Math.ceil((bytes || 0) / 3) * 4
    const fmt = (value, digits = 0) => Number(value).toFixed(digits)
    const ratioSide = (pixels, w = 16, hh = 9) => ({ w: Math.round(Math.sqrt(pixels * w / hh)), h: Math.round(Math.sqrt(pixels * hh / w)) })
    const mediaLabel = type => String(type || '').replace('image/', '').toUpperCase()

    async function requestJSON(fetchImpl, input, signal) {
      const response = await fetchImpl(ACTION, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal })
      let value
      try { value = await response.json() } catch { throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'invalid_response' }) }
      if (!response.ok || value?.ok !== true) throw Object.assign(new Error(value?.message || value?.error || `HTTP ${response.status}`), { code: value?.error || 'operation_failed' })
      return value
    }

    /** One store per window; every call is a finite request, nothing stays open. */
    function createStore(call, { currentSession = () => null } = {}) {
      let state = { status: 'loading', data: null, error: '', busy: false, toast: '', samples: null, samplesError: '', estimate: null, estimating: false, selected: null }
      const listeners = new Set(), lifetime = new AbortController()
      let disposed = false, sampleSeq = 0
      const set = patch => { if (disposed) return; state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; for (const listener of [...listeners]) listener() }
      const run = input => call(input, lifetime.signal)
      async function load() {
        try { set({ data: await run({ action: 'state' }), status: 'ready', error: '' }) }
        catch (error) { if (!disposed) set({ status: state.data ? 'ready' : 'error', error: error.message }) }
      }
      async function update(patch) {
        set({ busy: true, toast: '' })
        try { set({ data: await run({ action: 'update', ...patch }), busy: false, toast: 'saved', error: '' }) }
        catch (error) { await load(); set({ busy: false, toast: '', error: error.message }) }
      }
      async function sample() {
        const seq = ++sampleSeq
        set({ samples: null, samplesError: '', estimate: null, estimating: false })
        try {
          const value = await run({ action: 'samples', sessionId: currentSession() || undefined, limit: 24 })
          if (seq !== sampleSeq) return
          set(s => ({ samples: value.images, selected: value.images.some(image => image.id === s.selected) ? s.selected : value.images[0]?.id ?? null, estimating: value.images.length > 0 }))
          if (!value.images.length) return
          const estimate = await run({ action: 'estimate', ids: value.images.map(image => image.id) })
          if (seq === sampleSeq) set({ estimate, estimating: false })
        } catch (error) { if (seq === sampleSeq) set({ samplesError: error.message, estimating: false, samples: state.samples ?? [] }) }
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        load, update, sample, select: id => set({ selected: id }), clearToast: () => set({ toast: '' }),
        dispose() { if (disposed) return; disposed = true; lifetime.abort(); listeners.clear() },
      }
    }

    function useStore(store) { return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) }
    function useLocale(locale) {
      React.useSyncExternalStore(callback => locale?.subscribe ? locale.subscribe(callback) : () => {}, () => locale?.getSnapshot?.().revision ?? 0, () => 0)
    }

    /** Fetch an image through the authenticated transport and expose it as an object URL. */
    function useBlobURL(fetchImpl, url) {
      const [value, setValue] = React.useState({ url: null, failed: false })
      React.useEffect(() => {
        if (!url) { setValue({ url: null, failed: false }); return }
        const controller = new AbortController()
        let objectURL = null
        setValue({ url: null, failed: false })
        fetchImpl(url, { credentials: 'same-origin', signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.blob() })
          .then(blob => { if (controller.signal.aborted) return; objectURL = globalThis.URL.createObjectURL(blob); setValue({ url: objectURL, failed: false }) })
          .catch(() => { if (!controller.signal.aborted) setValue({ url: null, failed: true }) })
        return () => { controller.abort(); if (objectURL) globalThis.URL.revokeObjectURL(objectURL) }
      }, [url])
      return value
    }
    const imageURL = (id, variant) => `${IMAGE}?id=${encodeURIComponent(id)}&variant=${encodeURIComponent(variant)}`

    const ICON = ['M4 17l4-4 3 3 5-6 4 5', 'M4 5h16v14H4z', 'M12 2v4', 'M10 4l2 2 2-2']
    function Icon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        ICON.map((d, i) => h('path', { key: i, d })))
    }

    function Switch({ checked, disabled, onChange, label }) {
      return h('button', { type: 'button', role: 'switch', className: 'dus-switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange(!checked) })
    }

    function StrategyCard({ strategy, active, disabled, estimate, uplink, t, onPick }) {
      const side = ratioSide(strategy.pixels)
      const total = estimate?.totals?.[strategy.id], base = estimate?.totals?.[BASELINE]
      const count = estimate?.images?.length ?? 0
      return h('button', { type: 'button', role: 'radio', 'aria-checked': active, className: `dus-card${active ? ' is-active' : ''}`, disabled, onClick: () => onPick(strategy.id) },
        h('div', { className: 'dus-card-head' }, h('span', { className: 'dus-card-name' }, t(strategy.id)), strategy.id === 'balanced' ? h('span', { className: 'dus-badge' }, t('recommended')) : null),
        h('div', { className: 'dus-card-desc' }, t(`${strategy.id}Desc`)),
        h('div', { className: 'dus-card-meta' }, t('params', { w: side.w, h: side.h, kb: kb(strategy.maxBytes) })),
        total !== undefined && count ? h('div', { className: 'dus-card-est' },
          h('div', null, t('sample', { count, total: mb(total) }), base ? h('b', null, ` · ${t('saving', { pct: Math.max(0, Math.round((1 - total / base) * 100)) })}`) : null),
          h('div', { className: 'dus-muted' }, t('perRequest', { sec: fmt(total / (uplink * 1024), 0), speed: uplink }))) : null)
    }

    function Pane({ fetchImpl, image, variant, meta, zoom, pixelated, paneRef, onScroll, t }) {
      const blob = useBlobURL(fetchImpl, image ? imageURL(image.id, variant) : null)
      const width = zoom === 'fit' ? '100%' : `${image.width * Number(zoom)}px`
      const info = variant === 'source'
        ? [t('dims', { w: image.width, h: image.height }), mediaLabel(image.mediaType), t('bytes', { kb: kb(image.bytes) })]
        : meta ? [t('dims', { w: meta.width, h: meta.height }), mediaLabel(meta.mediaType), t('bytes', { kb: kb(meta.bytes) }), t('base64', { kb: kb(b64(meta.bytes)) })] : []
      return h('div', { className: 'dus-pane' },
        h('div', { className: 'dus-pane-view', ref: paneRef, onScroll },
          blob.url ? h('img', { src: blob.url, alt: '', style: { width, imageRendering: pixelated ? 'pixelated' : 'auto' }, draggable: false })
            : h('div', { className: 'dus-muted dus-pad' }, blob.failed ? t('imageFailed') : t('loadingImage'))),
        h('div', { className: 'dus-pane-info' }, info.join(' · ')))
    }

    function Thumb({ fetchImpl, image, active, onPick }) {
      const blob = useBlobURL(fetchImpl, imageURL(image.id, 'minimal'))
      return h('button', { type: 'button', className: `dus-thumb${active ? ' is-active' : ''}`, onClick: () => onPick(image.id), title: image.name || image.id.slice(7, 19) },
        blob.url ? h('img', { src: blob.url, alt: '' }) : h('span', { className: 'dus-thumb-ph' }))
    }

    function Compare({ store, state, fetchImpl, t }) {
      const [left, setLeft] = React.useState(BASELINE)
      const [right, setRight] = React.useState(null)
      const [zoom, setZoom] = React.useState('fit')
      const [pixelated, setPixelated] = React.useState(false)
      const leftRef = React.useRef(null), rightRef = React.useRef(null), syncing = React.useRef(false)
      const rightVariant = right ?? state.data?.strategy ?? 'balanced'
      const samples = state.samples
      const image = samples?.find(item => item.id === state.selected)
      const versions = state.estimate?.images?.find(item => item.id === image?.id)?.versions
      const sync = (from, to) => () => {
        if (syncing.current || !from.current || !to.current) return
        syncing.current = true
        to.current.scrollLeft = from.current.scrollLeft; to.current.scrollTop = from.current.scrollTop
        requestAnimationFrame(() => { syncing.current = false })
      }
      const select = (value, onChange) => h('select', { className: 'dus-select', value, onChange: event => onChange(event.target.value) }, VARIANTS.map(variant => h('option', { key: variant, value: variant }, t(variant))))
      if (samples === null) return h('div', { className: 'dus-muted' }, t('computing', { count: '…' }))
      if (!samples.length) return h('div', { className: 'dus-muted' }, state.samplesError || t('noImages'))
      return h('div', { className: 'dus-compare' },
        h('div', { className: 'dus-muted' }, t('imagesFrom')),
        h('div', { className: 'dus-thumbs' }, samples.map(item => h(Thumb, { key: item.id, fetchImpl, image: item, active: item.id === state.selected, onPick: store.select }))),
        h('div', { className: 'dus-toolbar' },
          h('label', null, `${t('left')} `, select(left, setLeft)),
          h('label', null, `${t('right')} `, select(rightVariant, setRight)),
          h('label', null, `${t('zoom')} `, h('select', { className: 'dus-select', value: zoom, onChange: event => setZoom(event.target.value) }, ZOOMS.map(value => h('option', { key: value, value }, value === 'fit' ? t('fit') : `${value}×`)))),
          h('label', { className: 'dus-check' }, h('input', { type: 'checkbox', checked: pixelated, onChange: event => setPixelated(event.target.checked) }), t('pixelated')),
          h('button', { type: 'button', className: 'dus-btn', onClick: () => void store.sample() }, t('reload'))),
        image ? h('div', { className: 'dus-panes' },
          h(Pane, { fetchImpl, image, variant: left, meta: versions?.[left], zoom, pixelated, paneRef: leftRef, onScroll: sync(leftRef, rightRef), t }),
          h(Pane, { fetchImpl, image, variant: rightVariant, meta: versions?.[rightVariant], zoom, pixelated, paneRef: rightRef, onScroll: sync(rightRef, leftRef), t })) : null)
    }

    function Page({ store, t, locale, fetchImpl }) {
      useLocale(locale)
      const state = useStore(store)
      const [showNotice, setShowNotice] = React.useState(false)
      React.useEffect(() => { void store.load(); void store.sample() }, [])
      React.useEffect(() => { if (!state.toast) return; const timer = setTimeout(store.clearToast, 2000); return () => clearTimeout(timer) }, [state.toast])
      const data = state.data
      if (state.status === 'loading') return h('div', { className: 'dus-page' }, h(Style), h('div', { className: 'dus-muted dus-pad' }, '…'))
      if (state.status === 'error') return h('div', { className: 'dus-page' }, h(Style), h('div', { className: 'dus-pad' }, t('loadFailure'), ' ', h('button', { type: 'button', className: 'dus-btn', onClick: () => void store.load() }, t('retry'))))
      const canWrite = data.capabilities.settings
      const selected = new Set(data.routes ?? data.available.map(route => route.id))
      const toggleRoute = id => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id); else next.add(id)
        void store.update({ routes: data.available.map(route => route.id).filter(route => next.has(route)) })
      }
      const status = !data.enabled ? t('statusOff') : data.targets.length ? t('statusOn', { count: data.targets.length, routes: data.targets.join('、') }) : t('statusNoRoutes')
      const uplink = data.uplinkKBps
      return h('div', { className: 'dus-page' }, h(Style),
        h('div', { className: 'dus-head' },
          h('div', null, h('h1', null, t('title')), h('p', { className: 'dus-muted' }, t('subtitle'))),
          h('div', { className: 'dus-head-switch' }, h('span', null, data.enabled ? t('on') : t('off')),
            h(Switch, { checked: data.enabled, disabled: state.busy || !canWrite, label: t('toggle'), onChange: enabled => void store.update({ enabled }) }))),
        h('div', { className: `dus-status${data.enabled ? ' is-on' : ''}` }, status, state.toast === 'saved' ? h('span', { className: 'dus-toast' }, ` ✓ ${t('saved')}`) : null),
        !canWrite ? h('div', { className: 'dus-warn' }, t('settingsMissing')) : null,
        state.error ? h('div', { className: 'dus-warn' }, t('failure', { message: state.error })) : null,
        data.drift.length ? h('div', { className: 'dus-warn' }, t('drift', { routes: data.drift.join('、') }), ' ', h('button', { type: 'button', className: 'dus-btn', disabled: state.busy, onClick: () => void store.update({ reapply: true }) }, t('reapply'))) : null,
        h('section', null, h('h2', null, t('strategies')),
          h('div', { className: 'dus-cards', role: 'radiogroup', 'aria-label': t('strategies') },
            data.strategies.map(strategy => h(StrategyCard, { key: strategy.id, strategy, active: data.strategy === strategy.id, disabled: state.busy, estimate: state.estimate, uplink, t, onPick: id => void store.update({ strategy: id }) }))),
          state.estimate?.totals?.[BASELINE] ? h('div', { className: 'dus-muted dus-baseline' }, `${t(BASELINE)}：${t('sample', { count: state.estimate.images.length, total: mb(state.estimate.totals[BASELINE]) })} · ${t('perRequest', { sec: fmt(state.estimate.totals[BASELINE] / (uplink * 1024)), speed: uplink })}`)
            : state.estimating ? h('div', { className: 'dus-muted dus-baseline' }, t('computing', { count: state.samples?.length ?? '…' })) : null,
          h('label', { className: 'dus-uplink' }, `${t('uplink')} `, h('input', { type: 'number', min: 1, step: 10, defaultValue: uplink, key: uplink, onBlur: event => { const value = Number(event.target.value); if (value >= 1 && value !== uplink) void store.update({ uplinkKBps: value }) } }), ` ${t('kbps')}`)),
        h('section', null, h('h2', null, t('compare')), h(Compare, { store, state, fetchImpl, t })),
        h('section', null, h('h2', null, t('routes')),
          h('div', { className: 'dus-routes' }, data.available.map(route => h('label', { key: route.id, className: 'dus-route' },
            h('input', { type: 'checkbox', checked: selected.has(route.id), disabled: state.busy || !canWrite, onChange: () => toggleRoute(route.id) }),
            h('span', { className: 'dus-route-name' }, route.displayName !== route.id ? `${route.displayName} (${route.id})` : route.id),
            route.api ? h('span', { className: 'dus-muted' }, t('apiLabel', { api: route.api })) : null,
            h('span', { className: 'dus-muted' }, t('current', { params: `${ratioSide(route.pixels).w}×${ratioSide(route.pixels).h} · ${kb(route.maxBytes)} KB` })),
            route.managed ? h('span', { className: 'dus-badge' }, t('managed')) : null)))),
        h('section', null, h('h2', null, t('notesTitle')),
          h('ul', { className: 'dus-notes' }, h('li', null, t('note1')), h('li', null, t('note2')), h('li', null, t('note3'))),
          h('button', { type: 'button', className: 'dus-btn', onClick: () => setShowNotice(value => !value) }, showNotice ? t('hideNotice') : t('showNotice')),
          showNotice ? h('pre', { className: 'dus-notice' }, data.notice) : null))
    }

    /** Small chip in the conversation header while slimming is on. */
    function Chip({ store, t, locale, openPage }) {
      useLocale(locale)
      const state = useStore(store)
      React.useEffect(() => { if (!state.data) void store.load() }, [])
      if (!state.data?.enabled || !state.data.targets.length) return null
      return h('button', { type: 'button', className: 'dus-chip', title: t('openPage'), onClick: openPage }, h(Style), h(Icon, { size: 14 }), h('span', null, t('chip', { name: t(state.data.strategy) })))
    }

    const CSS = `
.dus-page{height:100%;overflow:auto;padding:calc(var(--dsh-frame-top-clearance,0px) + 20px) 28px 40px;color:var(--dsw-alias-label-primary,#1c1c1e);background:var(--dsw-alias-bg-base,#fff);font-size:13px;line-height:1.5;box-sizing:border-box}
.dus-page h1{font-size:20px;margin:0 0 4px}.dus-page h2{font-size:14px;margin:22px 0 10px}
.dus-muted{color:var(--dsw-alias-label-secondary,#6b6b70)}.dus-pad{padding:16px}
.dus-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.dus-head p{margin:0;max-width:720px}
.dus-head-switch{display:flex;align-items:center;gap:8px;white-space:nowrap}
.dus-switch{position:relative;width:38px;height:22px;border-radius:11px;border:0;background:var(--dsw-alias-bg-layer-3,#d1d1d6);padding:0;cursor:pointer;flex:none}
.dus-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}
.dus-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#34c759)}.dus-switch[aria-checked=true]::after{left:18px}.dus-switch:disabled{opacity:.5;cursor:default}
.dus-status{margin-top:14px;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f2f2f7)}.dus-status.is-on{border-left:3px solid var(--dsw-alias-brand-primary,#34c759)}
.dus-toast{color:var(--dsw-alias-brand-primary,#34c759)}
.dus-warn{margin-top:10px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary,#ff3b30);color:var(--dsw-alias-state-error-primary,#ff3b30)}
.dus-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.dus-card{text-align:left;padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#d1d1d6);background:var(--dsw-alias-bg-layer-1,#fafafa);color:inherit;cursor:pointer;font:inherit}
.dus-card.is-active{border-color:var(--dsw-alias-brand-primary,#007aff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#007aff)}.dus-card:disabled{opacity:.6}
.dus-card-head{display:flex;gap:6px;align-items:center}.dus-card-name{font-weight:600;font-size:14px}
.dus-card-desc{margin:4px 0;color:var(--dsw-alias-label-secondary,#6b6b70)}.dus-card-meta{font-size:12px}.dus-card-est{margin-top:6px;font-size:12px}
.dus-badge{font-size:11px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#e5e5ea)}
.dus-baseline{margin-top:8px}.dus-uplink{display:inline-block;margin-top:8px}.dus-uplink input{width:80px}
.dus-btn{font:inherit;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#d1d1d6);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;cursor:pointer}
.dus-select{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#d1d1d6);border-radius:6px}
.dus-thumbs{display:flex;gap:6px;overflow-x:auto;padding:8px 0}
.dus-thumb{flex:none;width:96px;height:56px;padding:0;border-radius:6px;border:2px solid transparent;background:var(--dsw-alias-bg-layer-2,#e5e5ea);overflow:hidden;cursor:pointer}
.dus-thumb.is-active{border-color:var(--dsw-alias-brand-primary,#007aff)}.dus-thumb img{width:100%;height:100%;object-fit:cover;display:block}.dus-thumb-ph{display:block;width:100%;height:100%}
.dus-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:6px 0}.dus-check{display:flex;gap:4px;align-items:center}
.dus-panes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.dus-pane{min-width:0}
.dus-pane-view{height:min(62vh,640px);overflow:auto;border:1px solid var(--dsw-alias-border-l2,#d1d1d6);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f2f7)}
.dus-pane-view img{display:block;max-width:none}.dus-pane-info{font-size:12px;margin-top:4px;color:var(--dsw-alias-label-secondary,#6b6b70)}
.dus-routes{display:flex;flex-direction:column;gap:6px}.dus-route{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dus-route-name{font-weight:500}
.dus-notes{margin:0 0 8px;padding-left:18px}
.dus-notice{white-space:pre-wrap;font-size:12px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#f2f2f7)}
.dus-chip{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;padding:2px 8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#d1d1d6);background:transparent;color:var(--dsw-alias-label-secondary,#6b6b70);cursor:pointer}
@media(prefers-reduced-motion:reduce){.dus-switch::after{transition:none}}`
    function Style() { return h('style', null, CSS) }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), `${NAME}: locale`)
      const t = ctx.locale.bind(NS)
      const transport = globalThis.__DSH_TRANSPORT__
      const fetchImpl = transport?.fetch ? transport.fetch.bind(transport) : (...args) => globalThis.fetch(...args)
      const currentSession = () => { try { return ctx.uiSession?.current?.getSnapshot?.()?.key || null } catch { return null } }
      const store = createStore((input, signal) => requestJSON(fetchImpl, input, signal), { currentSession })
      ctx.effect(() => () => store.dispose(), `${NAME}: store`)
      const openPage = () => ctx.layout.selectPanel(NAME)
      const shared = () => ({ store, t, locale: ctx.locale, fetchImpl, openPage })
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NAME, order: 37, locale: NS, label: () => t('title') }, props => h(Icon, { size: props.size || 18 }))), `${NAME}: entry`)
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NAME, locale: NS, inject: shared }, Page)), `${NAME}: page`)
      ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: `${NAME}.chip`, order: 25, locale: NS, label: () => t('title'), inject: shared }, Chip)), `${NAME}: chip`)
    }
    return { name: NAME, inject: ['slots', 'locale', 'layout', 'uiSession'], apply,
      __test: { createStore, requestJSON, Page, Chip, Compare, StrategyCard, ZH, EN, CSS, ratioSide, imageURL } }
  },
})
