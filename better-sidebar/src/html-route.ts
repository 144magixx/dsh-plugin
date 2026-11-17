/**
 * Pure URL vocabulary of the /sidebar/html route (HTML previewer).
 *
 * Why path-encoded parameters instead of a query string: the previewed
 * page resolves its relative assets (./style.css, img/x.png) against the
 * document URL, and the WHATWG URL algorithm DROPS the query of a
 * path-relative reference — `/sidebar/html?a=1&path=/a/b/` + `./style.css`
 * would lose the session scope and the route would reject the asset.
 * Encoding everything into the URL path keeps relative resolution inside
 * the same route with every request self-contained:
 *
 *   /sidebar/html/<sessionId>/<absolute-path segments, encodeURIComponent'd>
 *   /sidebar/html/S/Users/me/proj/index.html
 *     + ./style.css → /sidebar/html/S/Users/me/proj/style.css
 *   Windows: C:\Users\me\a.html → /sidebar/html/S/C%3A/Users/me/a.html
 *   Home-relative (#713): ~/notes/x.html → /sidebar/html/S/~/notes/x.html —
 *     the '~' first segment survives VERBATIM (the decoder keeps it unslashed
 *     so the route's resolver still expands it against the user's home)
 *   UNC (\\server\share\... or //server/share/...):
 *     → /sidebar/html/S//server/share/proj/a.html  ('//' right after the
 *       sessionId marks the UNC prefix; the WHATWG URL keeps '//' intact so
 *       relative assets still resolve inside the same route)
 *
 * The decoder rebuilds the marker as a forward-slash `//server/share/...`
 * path. That form is intentionally platform-neutral: `node:path` resolves it
 * to `\\server\share\...` on win32 and `/server/share/...` on POSIX, so the
 * host's existing requireAbsolute + isWithin fence needs no platform signal
 * (a leading `//` is a legal POSIX absolute path, so no data is lost on
 * either platform).
 *
 * This module is intentionally dependency-free (no node imports, no wire
 * helpers) so the client bundle can import `encodeHtmlUrl` without tripping
 * the build-time purity gate; the host converts decode failures into
 * SidebarError responses at the route boundary.
 */

/** One decoded route reference. */
export interface HtmlRouteRef {
  sessionId: string
  /** Absolute file path (leading slash; Windows drives keep their colon). */
  path: string
}

/** Decode outcome: the reference, or a client-error description. */
export type HtmlDecodeResult =
  | { ok: true; ref: HtmlRouteRef }
  | { ok: false; status: 400 | 404; message: string }

/** The route prefix both encoders/decoders agree on. */
export const HTML_ROUTE_PREFIX = '/sidebar/html/'

/** Build the route URL for one absolute file path (client + tests). */
export function encodeHtmlUrl(sessionId: string, path: string): string {
  const unc = /^[\\/]{2}[^\\/]/.test(path)
  const segments = path.split(/[\\/]+/).filter(segment => segment !== '')
  return `${HTML_ROUTE_PREFIX}${encodeURIComponent(sessionId)}/${unc ? '/' : ''}${segments.map(encodeURIComponent).join('/')}`
}

/**
 * Decode a route pathname into the session + absolute file path. Rejects
 * a wrong prefix (404), an empty path, malformed percent encoding, and a
 * missing sessionId or file path (400). The caller still must bound the
 * decoded path with the workspace real-path guard — a decoded `..`
 * segment resolves outside the cwd and is refused there.
 */
export function decodeHtmlUrl(pathname: string): HtmlDecodeResult {
  if (!pathname.startsWith(HTML_ROUTE_PREFIX)) {
    return { ok: false, status: 404, message: 'not an html route' }
  }
  const rest = pathname.slice(HTML_ROUTE_PREFIX.length)
  if (rest === '') {
    return { ok: false, status: 400, message: 'invalid html route path' }
  }
  let segments: string[]
  try {
    segments = rest.split('/').map(segment => decodeURIComponent(segment))
  } catch {
    return { ok: false, status: 400, message: 'malformed URL encoding' }
  }
  const [sessionId, ...pathSegments] = segments
  if (sessionId === undefined || sessionId === '') {
    return { ok: false, status: 400, message: 'sessionId and file path are required' }
  }
  // An empty FIRST path segment is the UNC marker (encodeHtmlUrl emits
  // '<sid>//server/share/...' for UNC paths); the encoder filters empty
  // segments everywhere else, so an empty segment can only be the marker or
  // a malformed URL — both handled here.
  const unc = pathSegments[0] === ''
  const tail = unc ? pathSegments.slice(1) : pathSegments
  if (tail.length === 0 || tail.some(segment => segment === '')) {
    return { ok: false, status: 400, message: 'sessionId and file path are required' }
  }
  let path: string
  if (unc) {
    // Rebuild the platform-neutral forward-slash form `//server/share/...`;
    // requireAbsolute() resolves it to the platform's own UNC/POSIX spelling.
    path = `//${tail.join('/')}`
  } else if (tail[0] === '~') {
    // A home-relative path ('~/notes/x.html', #713): keep it VERBATIM. Adding
    // the leading slash would produce the absolute '/~/notes/...' and the
    // route's shared resolver would never expand the '~' against the home.
    path = tail.join('/')
  } else if (/^[A-Za-z]:$/.test(tail[0] ?? '')) {
    // A Windows drive segment ('D:') is the FIRST path segment of an encoded
    // drive path. Rejoining it with a leading slash would yield '/D:/work/...'
    // which node's path.resolve() mangles into 'D:\D:\work\...' on Windows —
    // the html route's workspace fence would then reject every drive path.
    // Keep the drive form slash-free so requireAbsolute() resolves it verbatim.
    path = tail.join('/')
  } else {
    path = `/${tail.join('/')}`
  }
  return { ok: true, ref: { sessionId, path } }
}

/**
 * [fork] The query flag the editor's UNSANDBOXED HTML preview adds to the
 * document URL (relative assets drop the query, which is fine: only the
 * top document's CSP decides its origin).
 */
export const HTML_SAME_ORIGIN_PARAM = 'same-origin'

/** The CSP of every /sidebar/html response (opaque origin). */
export const HTML_ROUTE_CSP = "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'"

/**
 * [fork] The CSP of an unsandboxed editor preview: the same sandbox plus
 * `allow-same-origin` (and forms), so the iframe really shares the GUI origin
 * as the "no sandbox" setting promises — page-level tools such as
 * dsh-page-annotate can then reach the document. Top navigation stays off.
 */
export const HTML_ROUTE_CSP_SAME_ORIGIN = "sandbox allow-scripts allow-popups allow-downloads allow-modals allow-forms allow-same-origin; object-src 'none'"

/**
 * [fork] Pick the CSP for one /sidebar/html request.
 *
 * The same-origin variant needs the query flag, and is refused when the
 * request metadata says it is not a same-origin iframe load:
 * `Sec-Fetch-Dest` other than `iframe` (a top-level load or popup), or
 * `Sec-Fetch-Site` other than `same-origin`. A MISSING header is accepted:
 * DSH Desktop's `dsh-app://` proxy deletes `sec-fetch-site` before it
 * forwards to the Host (and a custom-scheme request may carry no fetch
 * metadata at all), so requiring it would make the flag dead on Desktop.
 *
 * That relaxation does not open the opaque-origin escape it guards against:
 * a CSP `sandbox` directive can only ADD restrictions to the flags the
 * browsing context already has. A frame or popup created by a sandboxed
 * (opaque) preview inherits that preview's sandbox flags — no
 * `allow-same-origin`, no `allow-popups-to-escape-sandbox` — so it stays
 * opaque whatever this header says. Only a context created by same-origin
 * code without a sandbox (the unsandboxed editor preview) becomes
 * same-origin, which is exactly what the "sandbox off" setting promises.
 */
export function htmlRouteCsp(search: URLSearchParams, headers: Record<string, string | string[] | undefined>): string {
  const header = (name: string): string | undefined => {
    const value = headers[name]
    const first = Array.isArray(value) ? value[0] : value
    return first === undefined || first === '' ? undefined : first.toLowerCase()
  }
  if (search.get(HTML_SAME_ORIGIN_PARAM) !== '1') return HTML_ROUTE_CSP
  const dest = header('sec-fetch-dest')
  const site = header('sec-fetch-site')
  if (dest !== undefined && dest !== 'iframe') return HTML_ROUTE_CSP
  if (site !== undefined && site !== 'same-origin') return HTML_ROUTE_CSP
  return HTML_ROUTE_CSP_SAME_ORIGIN
}
