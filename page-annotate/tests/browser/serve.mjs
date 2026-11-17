// Static server for the browser fixture. `report.html` is served with the same
// response headers dsh-better-sidebar's /sidebar/html route sends, so the
// fixture reproduces the real preview's origin rules:
//   report.html                 → opaque-origin CSP (upstream behaviour)
//   report.html?same-origin=1   → same-origin CSP unless fetch metadata says it
//                                 is not a same-origin iframe (mirrors htmlRouteCsp)
// Usage: node page-annotate/tests/browser/serve.mjs [port]   (from the repo root)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.cwd()
const port = Number(process.argv[2] ?? 8765)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const file = normalize(join(root, decodeURIComponent(url.pathname)))
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
  try {
    const body = await readFile(file)
    const headers = { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }
    if (file.endsWith('report.html')) {
      const dest = req.headers['sec-fetch-dest']
      const site = req.headers['sec-fetch-site']
      // `force=1` (fixture only) answers same-origin regardless of fetch
      // metadata — used to show sandbox-flag inheritance still keeps frames and
      // popups of an opaque page opaque.
      const sameOrigin = url.searchParams.get('same-origin') === '1'
        && (url.searchParams.get('force') === '1'
          || ((dest === undefined || dest === 'iframe') && (site === undefined || site === 'same-origin')))
      headers['content-security-policy'] = sameOrigin
        ? "sandbox allow-scripts allow-popups allow-downloads allow-modals allow-same-origin allow-forms; object-src 'none'"
        : "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'"
    }
    res.writeHead(200, headers)
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/page-annotate/tests/browser/index.html`))
