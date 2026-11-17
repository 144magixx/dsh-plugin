/**
 * The file tree's "open with" vocabulary: which external editors / file
 * managers the context menu can hand a row's path to, how the per-user
 * configuration (custom editors, SSH host, pinned ids) is parsed out of the
 * persisted blob, and how the external URL is built (local `file` URLs and
 * VSCode-family SSH-remote URLs).
 *
 * Pure by design (no React / no `api`), so the whole surface is unit-testable
 * without a DOM or a host route. The menu and the settings panel only consume
 * the exported types and functions.
 */
import type { CopyKey } from './locales.ts'

/** One user-configured editor (persisted in `pluginSettings['editor'].openWith`). */
export interface CustomEditor {
  id: string
  /** Human label shown in the menu (e.g. "Windsurf"). */
  name: string
  /** URL template with a `{path}` placeholder (e.g. `cursor://file/{path}`). */
  urlTemplate: string
  /** Whether the editor speaks the VSCode URL dialect — the only editors
   *  with an SSH-remote form (`<scheme>://vscode-remote/ssh-remote+<host>/…`). */
  isVscodeFamily: boolean
}

/** The per-user "open with" configuration (one key of the editor blob). */
export interface OpenWithConfig {
  /** SSH host (user@host or an ~/.ssh/config alias); '' = local workspace. */
  sshHost: string
  /** User-defined editors, appended after the built-ins. */
  customEditors: CustomEditor[]
  /** Ids of open-with targets pinned to the menu's top level
   *  ('explorer' | 'vscode' | 'cursor' | 'zed' | 'custom:<id>'). */
  pinned: string[]
  /**
   * [fork] The editor header's "打开 ▾" split button: the default external
   * opener, keyed by lower-cased extension ('.html') or '*' for every other
   * file. See {@link resolveDefaultOpen}.
   */
  defaults: Record<string, OpenWithDefault>
}

/**
 * [fork] One remembered default opener.
 *
 * `target` vocabulary:
 * - `system` — the OS default handler (the host's open-in-app without an app);
 * - `app:<id>` — one OS handler the host reported for the file;
 * - `plugin:<id>` — one plugin target (`vscode` / `cursor` / `zed` /
 *   `explorer` / `custom:<id>`);
 * - `reveal` — reveal in the OS file manager.
 *
 * `name` is the label captured when the default was chosen, so the button
 * can render before the host's handler listing arrives.
 */
export interface OpenWithDefault {
  target: string
  name: string
}

/** [fork] The catch-all key of {@link OpenWithConfig.defaults}. */
export const OPEN_WITH_DEFAULT_ANY = '*'

/** One menu-visible open target (built-in or custom, SSH-filtered). */
export interface OpenWithTarget {
  /** Stable id (`explorer` / `vscode` / `cursor` / `zed` / `custom:<id>`). */
  id: string
  /** Locale key of a built-in label (custom editors carry `name` instead). */
  nameKey?: CopyKey
  /** User-defined label (custom editors only; '' for built-ins). */
  name: string
  /** 'reveal' = show in the OS file manager; 'url' = open a URL. */
  kind: 'reveal' | 'url'
  /** URL template with `{path}`; undefined for reveal targets. */
  urlTemplate?: string
  /** Whether the editor talks the VSCode URL dialect. */
  isVscodeFamily: boolean
  /** Hidden in SSH mode (a host-local opener cannot reach a remote path). */
  localOnly: boolean
}

/** The default open-with configuration (fresh documents). */
export const OPEN_WITH_DEFAULTS: OpenWithConfig = {
  sshHost: '',
  customEditors: [],
  pinned: [],
  defaults: {},
}

/** The built-in open targets, in menu order. */
export const OPEN_WITH_BUILTINS: readonly OpenWithTarget[] = [
  {
    id: 'explorer',
    nameKey: 'openWithExplorer',
    name: '',
    kind: 'reveal',
    isVscodeFamily: false,
    localOnly: true,
  },
  {
    id: 'vscode',
    nameKey: 'openWithVscode',
    name: '',
    kind: 'url',
    urlTemplate: 'vscode://file/{path}',
    isVscodeFamily: true,
    localOnly: false,
  },
  {
    id: 'cursor',
    nameKey: 'openWithCursor',
    name: '',
    kind: 'url',
    urlTemplate: 'cursor://file/{path}',
    isVscodeFamily: true,
    localOnly: false,
  },
  {
    id: 'zed',
    nameKey: 'openWithZed',
    name: '',
    kind: 'url',
    urlTemplate: 'zed://file/{path}',
    isVscodeFamily: false,
    localOnly: true,
  },
]

/** Whether a persisted value makes a structurally valid custom-editor row.
 *  Name/template may be empty — the settings panel edits rows in place and
 *  an in-progress row must survive the round-trip; the MENU hides rows that
 *  fail the stricter {@link isValidCustomEditor} check. */
function isCustomEditor(value: unknown): value is CustomEditor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id !== ''
    && typeof record.name === 'string'
    && typeof record.urlTemplate === 'string'
    && typeof record.isVscodeFamily === 'boolean'
}

/**
 * Parse the persisted `openWith` blob (tolerant): malformed fields fall back
 * to the defaults, malformed custom-editor rows are dropped, and pinned ids
 * are kept verbatim (unknown ids are pruned when the targets are resolved —
 * the menu is the only consumer of the resolved list).
 */
export function parseOpenWithConfig(raw: unknown): OpenWithConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...OPEN_WITH_DEFAULTS }
  const record = raw as Record<string, unknown>
  const sshHost = typeof record.sshHost === 'string' ? record.sshHost : ''
  const customEditors = Array.isArray(record.customEditors)
    ? record.customEditors.filter(isCustomEditor)
    : []
  const pinned = Array.isArray(record.pinned)
    ? record.pinned.filter((id): id is string => typeof id === 'string' && id !== '')
    : []
  return { sshHost, customEditors, pinned, defaults: parseDefaults(record.defaults) }
}

/** [fork] Whether a key is a valid defaults key ('*' or '.ext'). */
function isDefaultKey(key: string): boolean {
  return key === OPEN_WITH_DEFAULT_ANY || /^\.[^./\\\s]+$/.test(key)
}

/** [fork] Whether a target id is in the default-opener vocabulary. */
export function isDefaultTarget(target: string): boolean {
  return target === 'system' || target === 'reveal'
    || (/^(app|plugin):./.test(target))
}

/** [fork] Tolerant parse of the `defaults` map (bad rows dropped). */
function parseDefaults(raw: unknown): Record<string, OpenWithDefault> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, OpenWithDefault> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDefaultKey(key) || value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    if (typeof row.target !== 'string' || !isDefaultTarget(row.target)) continue
    out[key] = { target: row.target, name: typeof row.name === 'string' ? row.name : '' }
  }
  return out
}

/**
 * [fork] The defaults key of one path: the lower-cased last extension
 * ('.html'), or '*' for dotfiles and extension-less names.
 */
export function defaultKeyOf(path: string): string {
  const base = normalizeUrlPath(path).split('/').pop() ?? ''
  const at = base.lastIndexOf('.')
  if (at <= 0 || at === base.length - 1) return OPEN_WITH_DEFAULT_ANY
  const key = base.slice(at).toLowerCase()
  return isDefaultKey(key) ? key : OPEN_WITH_DEFAULT_ANY
}

/** [fork] The resolved default opener of one path. */
export interface ResolvedDefaultOpen {
  /** The path's own extension key ('*' when it has none). */
  key: string
  /** Whether an extension-specific rule decided (vs the catch-all / system). */
  scoped: boolean
  /** The chosen opener; `system` when nothing is configured. */
  choice: OpenWithDefault
}

/**
 * [fork] Resolve the default opener of a path: its extension rule, else the
 * catch-all rule, else the OS default handler.
 */
export function resolveDefaultOpen(config: OpenWithConfig, path: string): ResolvedDefaultOpen {
  const key = defaultKeyOf(path)
  const scopedRule = key === OPEN_WITH_DEFAULT_ANY ? undefined : config.defaults[key]
  if (scopedRule !== undefined) return { key, scoped: true, choice: scopedRule }
  const any = config.defaults[OPEN_WITH_DEFAULT_ANY]
  return { key, scoped: false, choice: any ?? { target: 'system', name: '' } }
}

/**
 * [fork] A config with one defaults rule set (or removed with `null`).
 * Pure: the caller persists the result through the settings blob.
 */
export function withDefaultOpen(config: OpenWithConfig, key: string, choice: OpenWithDefault | null): OpenWithConfig {
  if (!isDefaultKey(key)) return config
  const defaults = { ...config.defaults }
  if (choice === null) delete defaults[key]
  else defaults[key] = { target: choice.target, name: choice.name }
  return { ...config, defaults }
}

/** Whether a custom editor id belongs to this config (id prefix match). */
function customIdOf(id: string): string {
  return `custom:${id}`
}

/**
 * The menu-visible open targets, in order (built-ins then custom editors).
 * In SSH mode the local-only URL openers (Zed, custom editors without the
 * VSCode dialect) are dropped — they cannot reach a remote path. The
 * `explorer` target is NOT dropped: it reveals a path in the file manager of
 * the machine that owns the workspace, which is exactly where the host half
 * runs, and it is the only reveal left when the DSH host's own open-in-app
 * capability is unavailable (older host, no desktop session). A headless
 * remote cannot raise a file manager anyway — that is the same silent
 * no-op the other external launches already have. Unknown pinned ids are
 * pruned here too.
 */
export function resolveOpenWithTargets(config: OpenWithConfig): OpenWithTarget[] {
  const ssh = config.sshHost.trim() !== ''
  const targets: OpenWithTarget[] = [
    ...OPEN_WITH_BUILTINS,
    ...config.customEditors
      .filter(isValidCustomEditor)
      .map((editor): OpenWithTarget => ({
        id: customIdOf(editor.id),
        name: editor.name,
        kind: 'url',
        urlTemplate: editor.urlTemplate,
        isVscodeFamily: editor.isVscodeFamily,
        localOnly: !editor.isVscodeFamily,
      })),
  ]
  return targets.filter(target => !(ssh && target.localOnly && target.kind !== 'reveal'))
}

/** The SSH hint appended to a target's label in remote mode. */
export function openWithSshActive(config: OpenWithConfig): boolean {
  return config.sshHost.trim() !== ''
}

/**
 * The URL to open for one resolved target, or undefined when the target has
 * no URL form (reveal) or the template is malformed. The path is inserted
 * RAW into the template (browsers percent-encode as needed; VSCode-family
 * URL parsers consume the absolute path with its leading slash, e.g.
 * `vscode://file//home/u/f.ts` or `vscode://file/C:/Users/u/f.ts`).
 */
export function openWithUrl(target: OpenWithTarget, path: string, config: OpenWithConfig): string | undefined {
  if (target.kind !== 'url' || target.urlTemplate === undefined) return undefined
  const normalized = normalizeUrlPath(path)
  const ssh = openWithSshActive(config)
  if (ssh && target.isVscodeFamily) {
    const scheme = schemeOf(target.urlTemplate)
    if (scheme === undefined) return undefined
    // `ssh-remote+<host>` owns NO slash of its own: the path keeps its
    // leading slash, so `/home/u/f.ts` lands as `…+host/home/u/f.ts`.
    return `${scheme}://vscode-remote/ssh-remote+${config.sshHost.trim()}${normalized}`
  }
  if (!target.urlTemplate.includes('{path}') || !hasUrlScheme(target.urlTemplate)) return undefined
  return target.urlTemplate.replace('{path}', normalized)
}

/** Whether a template starts with a `scheme://` prefix (the only shape the
 *  host's external opener accepts and the settings panel suggests). */
function hasUrlScheme(template: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(template)
}

/** The scheme of a URL template (the part before the first ':'), or undefined. */
function schemeOf(template: string): string | undefined {
  const at = template.indexOf(':')
  if (at <= 0) return undefined
  const scheme = template.slice(0, at)
  return /^[a-z][a-z0-9+.-]*$/i.test(scheme) ? scheme : undefined
}

/** Normalize a filesystem path for embedding in a URL (backslashes → '/'). */
export function normalizeUrlPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** A fresh custom-editor id (uuid when available, time-based fallback). */
export function newCustomEditorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** Validate one custom-editor row before the settings panel accepts it. */
export function isValidCustomEditor(row: { name: string; urlTemplate: string }): boolean {
  return row.name.trim() !== ''
    && row.urlTemplate.includes('{path}')
    && /^[a-z][a-z0-9+.-]*:\/\//i.test(row.urlTemplate.trim())
}
