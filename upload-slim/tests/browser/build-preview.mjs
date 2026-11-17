/**
 * Build tests/.test-data/preview/: a static page that runs lib/client.js on React 18
 * with a fake Host, and image variants encoded by DSH's own sharp build using the same
 * algorithm as dsh-attachment-local createRequestImage (pixel budget, then JPEG 85→75→60
 * down to the byte target; WebP when the source has alpha).
 *
 *   PREVIEW_IMAGES=/path/to/pngs node tests/browser/build-preview.mjs
 *   npx http-server tests/.test-data/preview  (or any static server) → open index.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractPackages, runtimeDir, workspace } from '../../scripts/extract-test-runtime.mjs';
import { BASELINE, STRATEGIES, base64Bytes, requestTarget, strategyFields } from '../../lib/core.js';

extractPackages(['sharp']);
const sharp = createRequire(path.join(runtimeDir, 'package.json'))('sharp');
const reactDir = path.join(workspace, '../mermaid-diagrams-preview/node_modules');
const source = process.env.PREVIEW_IMAGES;
if (!source) throw new Error('Set PREVIEW_IMAGES to a directory with a few PNG/JPEG screenshots.');
const out = path.join(workspace, 'tests/.test-data/preview');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'img'), { recursive: true });

async function requestVersion(data, meta, target) {
  if (target.width >= meta.width && target.height >= meta.height && data.byteLength <= target.maxBytes) return { data, mediaType: `image/${meta.format}`, width: meta.width, height: meta.height };
  const byWidth = meta.width >= meta.height;
  const type = meta.hasAlpha ? 'webp' : 'jpeg';
  let smallest;
  for (const quality of [85, 75, 60]) {
    const base = sharp(data).toColourspace('srgb').resize({ ...(byWidth ? { width: target.width } : { height: target.height }), withoutEnlargement: true });
    const { data: bytes, info } = await (type === 'webp' ? base.webp({ quality, effort: 0 }) : base.jpeg({ quality })).toBuffer({ resolveWithObject: true });
    const value = { data: bytes, mediaType: `image/${type}`, width: info.width, height: info.height };
    if (!smallest || bytes.byteLength < smallest.data.byteLength) smallest = value;
    if (bytes.byteLength <= target.maxBytes) return value;
  }
  return smallest;
}

const files = fs.readdirSync(source).filter(name => /\.(png|jpe?g)$/i.test(name)).sort().slice(0, Number(process.env.PREVIEW_COUNT || 6));
const variants = [BASELINE, ...STRATEGIES.map(strategy => strategy.id)];
const images = [], estimate = { ok: true, images: [], totals: Object.fromEntries(variants.map(v => [v, 0])), failures: [], uplinkKBps: 80 };
for (const [index, name] of files.entries()) {
  const data = fs.readFileSync(path.join(source, name));
  const meta = await sharp(data).metadata();
  const id = `sha256:${String(index).padStart(64, '0')}`;
  const ref = { attachmentId: id, width: meta.width, height: meta.height, mediaType: `image/${meta.format}`, bytes: data.byteLength, name };
  fs.writeFileSync(path.join(out, 'img', `${index}__source`), data);
  const entry = { id, versions: {} };
  for (const variant of variants) {
    const version = await requestVersion(data, meta, requestTarget(ref, strategyFields(variant)));
    fs.writeFileSync(path.join(out, 'img', `${index}__${variant}`), version.data);
    entry.versions[variant] = { bytes: version.data.byteLength, width: version.width, height: version.height, mediaType: version.mediaType };
    estimate.totals[variant] += base64Bytes(version.data.byteLength);
  }
  images.push({ ...ref, id, sessionId: 's', current: index < 2 });
  estimate.images.push(entry);
}
const state = {
  ok: true, enabled: true, strategy: 'balanced', routes: null, uplinkKBps: 80, targets: ['claude-relay', 'codex-relay', 'google'], applied: ['claude-relay', 'codex-relay', 'google'], drift: [],
  available: ['claude-relay', 'codex-relay', 'google'].map(id => ({ id, displayName: id, api: { 'claude-relay': 'anthropic-messages', 'codex-relay': 'openai-responses' }[id], pixels: 1440000, maxBytes: 204800, managed: true })),
  strategies: STRATEGIES, notice: '# Upload slimming\n(preview)', capabilities: { settings: true, attachments: true, sessions: true },
};
fs.writeFileSync(path.join(out, 'fixture.json'), JSON.stringify({ state, samples: { ok: true, images }, estimate }));
fs.copyFileSync(path.join(reactDir, 'react/umd/react.development.js'), path.join(out, 'react.js'));
fs.copyFileSync(path.join(reactDir, 'react-dom/umd/react-dom.development.js'), path.join(out, 'react-dom.js'));
fs.copyFileSync(path.join(workspace, 'lib/client.js'), path.join(out, 'client.js'));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Upload Slim preview</title>
<style>html,body,#root{margin:0;height:100%}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}</style>
<div id="root"></div>
<script src="react.js"></script><script src="react-dom.js"></script>
<script>let registration; window.__ModuleLoader__ = { load: value => { registration = value } }</script>
<script src="client.js"></script>
<script>
(async () => {
  const fixture = await (await fetch('fixture.json')).json()
  const client = registration.factory(() => React)
  const T = client.__test
  const t = (key, params = {}) => String(T.ZH[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, n) => params[n])
  let state = fixture.state
  const call = async input => {
    if (input.action === 'state') return state
    if (input.action === 'update') { state = { ...state, ...input }; return state }
    if (input.action === 'samples') return fixture.samples
    if (input.action === 'estimate') return fixture.estimate
  }
  const fetchImpl = url => { const q = new URL(url, location.href).searchParams; return fetch('img/' + Number(q.get('id').slice(7)) + '__' + q.get('variant')) }
  const store = T.createStore(call)
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(T.Page, { store, t, fetchImpl }))
})()
</script>`);
console.log(`preview built: ${files.length} images → ${out}/index.html`);
for (const variant of variants) console.log(variant.padEnd(12), `${(estimate.totals[variant] / 1048576).toFixed(2)} MB in request`);
