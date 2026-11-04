import React from 'react';
import DOMPurify from 'dompurify';
import { diagramType, validateSource } from './parse.mjs';
import { setRenderRoot } from './render-scope.mjs';
import { mermaidConfig, typeName } from './palette.mjs';
import { iconSvg } from './icons.mjs';
import css from './style.css';

const h = React.createElement;
const KNOWN_ERRORS = ['sourceTooLarge', 'customConfig', 'externalStyle', 'invalidSvg', 'elkUnsupported', 'pngError'];
const CACHE_LIMIT = 60;
const MIN_FIT_SCALE = 0.72;
const cache = new Map();
let enginePromise;
let prewarmScheduled = false;
let configKey = '';
let queue = Promise.resolve();
let sequence = 0;
// Resolved palette per theme state, so remounted cards can hit the cache before paint.
const surfaces = new Map();
const surfaceSlot = (theme, dark) => `${theme?.revision ?? ''}|${dark}`;

function loadEngine() {
  return (enginePromise ||= import('mermaid').then(module => module.default));
}

/** Load and evaluate Mermaid during idle time once a diagram exists. */
export function prewarm() {
  if (enginePromise || prewarmScheduled) return;
  prewarmScheduled = true;
  const idle = window.requestIdleCallback || (callback => setTimeout(callback, 120));
  idle(() => { loadEngine(); }, { timeout: 1200 });
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (entry) { cache.delete(key); cache.set(key, entry); }
  return entry;
}
function cachePut(key, entry) {
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function surfaceFor(element, dark) {
  const style = getComputedStyle(element);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const surface = {
    dark,
    canvas: read('--dsw-alias-markdown-code-block', dark ? '#1b1b1c' : '#f9fafb'),
    text: read('--dsw-alias-label-primary', dark ? '#f9fafb' : '#0f1115'),
    muted: read('--dsw-alias-label-secondary', dark ? '#cfd3d6' : '#61666b')
  };
  surface.key = [surface.dark, surface.canvas, surface.text, surface.muted].join('|');
  return surface;
}

async function renderDiagram(source, container, surface, key) {
  validateSource(source);
  const engine = await loadEngine();
  const started = performance.now();
  // Mermaid keeps one global configuration; initialize only when the palette changes.
  if (surface.key !== configKey) { engine.initialize(mermaidConfig(surface)); configKey = surface.key; }
  let svg;
  setRenderRoot(container);
  try {
    ({ svg } = await engine.render(`dsh-mermaid-${++sequence}`, source, container));
  } finally {
    container.replaceChildren();
    setRenderRoot(undefined);
  }
  const fragment = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'iframe'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  });
  const root = fragment.firstElementChild;
  if (!root || root.localName !== 'svg') throw new Error('invalidSvg');
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/href$/i.test(attribute.name) && !attribute.value.startsWith('#')) element.removeAttribute(attribute.name);
    }
  }
  const view = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const width = view.length === 4 && view[2] > 0 ? view[2] : Number(root.getAttribute('width')) || 600;
  const height = view.length === 4 && view[3] > 0 ? view[3] : Number(root.getAttribute('height')) || 300;
  root.removeAttribute('style');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('width', String(Math.ceil(width)));
  root.setAttribute('height', String(Math.ceil(height)));
  root.setAttribute('role', 'img');
  const entry = { svg: root, width, height, background: surface.canvas };
  cachePut(key, entry);
  performance.measure?.('dsh-mermaid:render', { start: started, end: performance.now() });
  return entry;
}

function exportMarkup(entry) {
  const copy = entry.svg.cloneNode(true);
  copy.style.backgroundColor = entry.background;
  return new XMLSerializer().serializeToString(copy);
}

async function exportPng(entry) {
  const url = URL.createObjectURL(new Blob([exportMarkup(entry)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(2, 8192 / Math.max(entry.width, entry.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(entry.width * scale);
    canvas.height = Math.ceil(entry.height * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = entry.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('pngError')), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Short, localized summary plus Mermaid's full message for the tooltip. */
function describeError(failure, t) {
  const message = String(failure?.message || failure || '');
  if (KNOWN_ERRORS.includes(message)) return { summary: t(message), detail: t(message) };
  const detail = message.slice(0, 1200);
  const line = message.match(/(?:Parse|Lexical) error on line (\d+)/i);
  if (line) return { summary: t('parseError').replace('{line}', line[1]), detail };
  const first = message.split('\n').find(text => text.trim()) || t('renderError');
  return { summary: first.slice(0, 200), detail };
}

function estimateHeight(source, type) {
  const lines = source.split('\n').filter(line => line.trim() && !line.trim().startsWith('%%')).length;
  if (type === 'sequenceDiagram') return Math.min(900, 90 + lines * 40);
  if (/^(?:flowchart|graph)\s+(?:LR|RL)/.test(source.trim())) return 180;
  return Math.min(520, 120 + lines * 28);
}

const Icon = ({ name }) => h('span', { className: 'dshmd-glyph', dangerouslySetInnerHTML: { __html: iconSvg(name) } });
const IconButton = ({ icon, label, ...rest }) => h('button', { type: 'button', className: 'dshmd-icon dshmd-tip', 'data-tip': label, 'aria-label': label, ...rest }, h(Icon, { name: icon }));

function DownloadButton({ t, disabled, onPick }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const outside = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const pick = format => { setOpen(false); onPick(format); };
  return h('div', { className: 'dshmd-dl', ref },
    h(IconButton, { icon: 'download', label: t('download'), disabled, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(value => !value) }),
    open && h('div', { className: 'dshmd-menu', role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', autoFocus: true, onClick: () => pick('svg') }, t('downloadSvg')),
      h('button', { type: 'button', role: 'menuitem', onClick: () => pick('png') }, t('downloadPng'))));
}

function Expanded({ entry, title, t, onClose, onDownload }) {
  const dialogRef = React.useRef(null);
  const stageRef = React.useRef(null);
  const drag = React.useRef(null);
  const [view, setView] = React.useState({ x: 0, y: 0, s: 1 });
  const fit = React.useCallback(() => {
    const box = stageRef.current.getBoundingClientRect();
    const s = Math.min(box.width / entry.width * 0.92, box.height / entry.height * 0.92, 1.6);
    setView({ s, x: (box.width - entry.width * s) / 2, y: (box.height - entry.height * s) / 2 });
  }, [entry]);
  const zoomAt = React.useCallback((factor, cx, cy) => setView(current => {
    const s = Math.min(8, Math.max(0.1, current.s * factor));
    const k = s / current.s;
    return { s, x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k };
  }), []);
  const zoomCenter = factor => { const box = stageRef.current.getBoundingClientRect(); zoomAt(factor, box.width / 2, box.height / 2); };
  React.useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    const svg = entry.svg.cloneNode(true);
    svg.style.width = `${entry.width}px`;
    svg.style.height = `${entry.height}px`;
    stageRef.current.replaceChildren(svg);
    fit();
    return () => { if (dialog.open) dialog.close(); };
  }, [entry, fit]);
  React.useLayoutEffect(() => {
    const svg = stageRef.current.firstElementChild;
    if (svg) svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }, [view]);
  React.useEffect(() => {
    const stage = stageRef.current;
    const wheel = event => {
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      // Pinch and Ctrl/Cmd+wheel zoom; plain wheel or two-finger scroll pans.
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - box.left, event.clientY - box.top);
      else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => stage.removeEventListener('wheel', wheel);
  }, [zoomAt]);
  const pointer = {
    onPointerDown: event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = '';
    },
    onPointerMove: event => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      const dx = event.clientX - state.x, dy = event.clientY - state.y;
      state.x = event.clientX; state.y = event.clientY;
      setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    },
    onPointerUp: event => { drag.current = null; delete event.currentTarget.dataset.dragging; },
    onPointerCancel: event => { drag.current = null; delete event.currentTarget.dataset.dragging; }
  };
  const keys = event => {
    if (event.target.closest?.('.dshmd-menu')) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomCenter(1.25); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomCenter(0.8); }
    else if (event.key === '0') { event.preventDefault(); fit(); }
  };
  return h('dialog', { ref: dialogRef, className: 'dshmd-dialog', 'aria-label': title, onCancel: onClose, onClose, onKeyDown: keys },
    h('div', { className: 'dshmd-head dshmd-dialog-head' },
      h('span', { className: 'dshmd-title' }, title),
      h('div', { className: 'dshmd-actions' },
        h(IconButton, { icon: 'zoomOut', label: t('zoomOut'), onClick: () => zoomCenter(0.8) }),
        h('button', { type: 'button', className: 'dshmd-zoom dshmd-tip', 'data-tip': t('fit'), 'aria-label': t('fit'), onClick: fit }, `${Math.round(view.s * 100)}%`),
        h(IconButton, { icon: 'zoomIn', label: t('zoomIn'), onClick: () => zoomCenter(1.25) }),
        h(DownloadButton, { t, onPick: onDownload }),
        h(IconButton, { icon: 'close', label: t('close'), autoFocus: true, onClick: onClose }))),
    h('div', { className: 'dshmd-stage', ref: stageRef, ...pointer }));
}

export function Diagram({ source, theme, localeId, t }) {
  const type = diagramType(source);
  const title = typeName(type, localeId);
  const dark = theme?.active?.colorScheme === 'dark';
  const rootRef = React.useRef(null);
  const measureRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const copyTimer = React.useRef(null);
  const [surface, setSurface] = React.useState(() => surfaces.get(surfaceSlot(theme, dark)) || null);
  const cacheKey = surface ? `${surface.key}\n${source}` : '';
  const initial = cacheKey ? cacheGet(cacheKey) : undefined;
  const [entry, setEntry] = React.useState(() => initial?.svg ? initial : undefined);
  const [error, setError] = React.useState(() => initial?.failure || null);
  const [status, setStatus] = React.useState('');
  const [sourceView, setSourceView] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [retry, setRetry] = React.useState(0);

  React.useLayoutEffect(() => {
    const next = surfaceFor(rootRef.current, dark);
    surfaces.set(surfaceSlot(theme, dark), next);
    if (surfaces.size > 8) surfaces.delete(surfaces.keys().next().value);
    setSurface(current => current?.key === next.key ? current : next);
  }, [theme, dark]);
  React.useEffect(() => {
    prewarm();
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(item => item.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '800px 0px' });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => () => clearTimeout(copyTimer.current), []);
  React.useEffect(() => {
    if (!cacheKey) return;
    const hit = cacheGet(cacheKey);
    if (hit?.svg) { setEntry(hit); setError(null); return; }
    if (hit?.failure) { setEntry(undefined); setError(hit.failure); return; }
    if (!visible) return;
    let disposed = false;
    setError(null);
    const target = measureRef.current;
    // Mermaid uses global state; renders stay serialized. Cache hits skip the queue.
    queue = queue.catch(() => {}).then(async () => {
      if (disposed || !target.isConnected) return;
      try {
        const rendered = await renderDiagram(source, target, surface, cacheKey);
        if (!disposed) setEntry(rendered);
      } catch (failure) {
        if (disposed) return;
        const described = describeError(failure, t);
        cachePut(cacheKey, { failure: described });
        setError(described);
      }
    });
    return () => { disposed = true; };
  }, [cacheKey, visible, retry]);

  const showDiagram = entry && !sourceView && !error;
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!showDiagram || !canvas) return;
    const svg = entry.svg.cloneNode(true);
    svg.setAttribute('aria-label', `${title}`);
    canvas.replaceChildren(svg);
    const fit = () => {
      const style = getComputedStyle(canvas);
      const available = canvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (available > 0 && available / entry.width < MIN_FIT_SCALE) {
        canvas.dataset.scroll = '';
        svg.style.width = `${Math.round(entry.width * MIN_FIT_SCALE)}px`;
      } else {
        delete canvas.dataset.scroll;
        svg.style.width = '';
      }
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [entry, showDiagram, title]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setStatus('');
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setStatus(t('copyError'));
      setSourceView(true);
    }
  };
  const download = async format => {
    if (!entry) return;
    const base = `mermaid-${type.replace(/[^a-z0-9-]/gi, '') || 'diagram'}`;
    try {
      if (format === 'png') saveBlob(await exportPng(entry), `${base}.png`);
      else saveBlob(new Blob([exportMarkup(entry)], { type: 'image/svg+xml;charset=utf-8' }), `${base}.svg`);
      setStatus('');
    } catch {
      setStatus(t('pngError'));
    }
  };
  const state = error ? 'error' : entry ? 'ready' : 'loading';
  return h('section', { className: 'dshmd-card', ref: rootRef, 'aria-label': title, 'data-dsh-mermaid': '', 'data-state': state },
    h('style', null, css),
    h('div', { className: 'dshmd-head' },
      h('span', { className: 'dshmd-title' }, title),
      h('div', { className: 'dshmd-actions' },
        h(IconButton, { icon: sourceView ? 'diagram' : 'source', label: sourceView ? t('viewDiagram') : t('viewSource'), 'aria-pressed': sourceView, disabled: !!error, onClick: () => setSourceView(value => !value) }),
        h(IconButton, { icon: copied ? 'check' : 'copy', label: copied ? t('copied') : t('copy'), onClick: copy }),
        h(IconButton, { icon: 'expand', label: t('expand'), disabled: !entry || !!error, onClick: () => setExpanded(true) }),
        h(DownloadButton, { t, disabled: !entry || !!error, onPick: download }))),
    h('div', { className: 'dshmd-measure', ref: measureRef, 'aria-hidden': true }),
    status && h('p', { className: 'dshmd-status', role: 'status' }, status),
    error && h('div', { className: 'dshmd-error', role: 'status' },
      h('strong', null, t('renderError')),
      h('span', { title: error.detail }, error.summary),
      h('button', { type: 'button', className: 'dshmd-link', onClick: () => { cache.delete(cacheKey); setRetry(value => value + 1); } }, t('retry'))),
    sourceView || error
      ? h('pre', { className: 'dshmd-source', tabIndex: 0 }, h('code', null, source))
      : entry
        ? h('div', { className: 'dshmd-canvas', ref: canvasRef })
        : h('div', { className: 'dshmd-skeleton', role: 'status', 'aria-label': t('rendering'), style: { height: `${estimateHeight(source, type)}px` } }),
    expanded && entry && h(Expanded, { entry, title, t, onClose: () => setExpanded(false), onDownload: download }));
}
