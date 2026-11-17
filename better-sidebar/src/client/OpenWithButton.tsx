/**
 * [fork] The editor header's "打开 ▾" split button.
 *
 * - The main half opens the current file with its DEFAULT external opener in
 *   one click (no context menu, no submenu).
 * - The chevron half lists every opener this file can use — the OS default,
 *   the host-detected applications (`openInApp.fileApps`), the plugin's own
 *   targets (VS Code / Cursor / Zed / custom editors) and reveal — and picking
 *   one makes it the default (the main half then opens with it).
 * - "仅对 .ext 文件生效" scopes the rule to the current extension; unchecking
 *   removes the extension rule so the file falls back to the catch-all.
 *
 * Rules live in `pluginSettings['editor'].openWith.defaults` (see
 * `resolveDefaultOpen` in open-with.ts), next to the tree menu's pins and the
 * custom editors, so the settings page and every window share one value.
 *
 * Steady-state cost: one `fileApps` host query per extension per page,
 * cached in a bounded module-level map; nothing polls.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutlineRegular,
  IconCodeOutlineRegular,
  IconFolderOpenRegular,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SiCursor, SiZedindustries } from 'react-icons/si'
import { VscLinkExternal } from 'react-icons/vsc'
import { IconVscode16 } from './icons.tsx'
import type { OpenInApp, OpenInAppEntry } from './open-in-app.ts'
import {
  OPEN_WITH_DEFAULT_ANY,
  defaultKeyOf,
  resolveDefaultOpen,
  withDefaultOpen,
  type OpenWithConfig,
  type OpenWithDefault,
  type OpenWithTarget,
} from './open-with.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** Host handler listings, keyed by extension key (bounded, LRU-ish). */
const APPS_CACHE = new Map<string, readonly OpenInAppEntry[]>()
const APPS_CACHE_MAX = 64

/** Test seam: drop the module cache. */
export function resetOpenWithButtonCache(): void {
  APPS_CACHE.clear()
}

/** One menu-visible opener choice. */
interface Choice {
  target: string
  name: string
  icon: ReactNode
}

/** The leading glyph of a host application. */
function AppIcon(props: { entry: OpenInAppEntry | undefined }): ReactNode {
  const icon = props.entry?.icon
  if (icon === undefined || icon === null || icon === '') return <VscLinkExternal size={14} />
  return <img className={css.explorerAppIcon} src={icon} alt="" width={14} height={14} />
}

/** The brand glyph of a plugin target. */
function pluginIcon(target: OpenWithTarget): ReactNode {
  if (target.kind === 'reveal') return <IconFolderOpenRegular size={14} />
  if (target.id === 'vscode') return <IconVscode16 size={14} />
  if (target.id === 'cursor') return <SiCursor size={14} />
  if (target.id === 'zed') return <SiZedindustries size={14} />
  return <IconCodeOutlineRegular size={14} />
}

/** The label of a plugin target. */
function pluginName(target: OpenWithTarget, ssh: boolean): string {
  const name = target.nameKey !== undefined ? t(target.nameKey) : target.name
  return ssh && !target.localOnly ? `${name}${t('openWithSshSuffix')}` : name
}

export interface OpenWithButtonProps {
  /** Absolute file path (directories never reach this component). */
  path: string
  /** Whether the hosting tab is on screen (gates the host query). */
  visible: boolean
  openInApp: OpenInApp
  config: OpenWithConfig
  targets: readonly OpenWithTarget[]
  ssh: boolean
  /** Launch one plugin target (EditorHost's `openWith`). */
  onOpenWith: (targetId: string, absolute: string) => Promise<boolean>
  /** Persist a new open-with config (the editor blob's `openWith`). */
  onConfigChange: (next: OpenWithConfig) => void
}

export function OpenWithButton(props: OpenWithButtonProps): ReactNode {
  const { path, visible, openInApp, config, targets, ssh, onOpenWith, onConfigChange } = props
  const key = defaultKeyOf(path)
  const resolved = resolveDefaultOpen(config, path)
  const [open, setOpen] = useState(false)
  const [appReady, setAppReady] = useState<boolean | null>(() => openInApp.available())
  const [apps, setApps] = useState<readonly OpenInAppEntry[] | null | undefined>(() => APPS_CACHE.get(key))
  const [failed, setFailed] = useState(false)
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Probe the host once, then list the handlers of this extension (cached).
  useEffect(() => {
    if (!visible || path === '') return
    let cancelled = false
    const cached = APPS_CACHE.get(key)
    setApps(cached)
    void openInApp.probe().then((ready) => {
      if (cancelled) return
      setAppReady(ready)
      if (!ready || cached !== undefined) return
      void openInApp.fileApps(path).then((entries) => {
        if (cancelled) return
        if (entries !== null) {
          APPS_CACHE.set(key, entries)
          if (APPS_CACHE.size > APPS_CACHE_MAX) {
            const oldest = APPS_CACHE.keys().next().value
            if (oldest !== undefined) APPS_CACHE.delete(oldest)
          }
        }
        setApps(entries)
      }).catch(() => { if (!cancelled) setApps(null) })
    }).catch(() => { if (!cancelled) setAppReady(false) })
    return () => { cancelled = true }
  }, [visible, path, key, openInApp])

  useEffect(() => () => {
    if (failTimer.current !== null) clearTimeout(failTimer.current)
  }, [])

  const osDefault = apps?.find(entry => entry.isDefault)

  /** Every choice in menu order (OS default, host apps, plugin targets, reveal). */
  const choices = useMemo<Choice[]>(() => {
    const list: Choice[] = []
    if (appReady === true) {
      list.push({
        target: 'system',
        name: osDefault !== undefined ? t('openDefaultSystemWith', { name: osDefault.name }) : t('openDefaultSystem'),
        icon: <AppIcon entry={osDefault} />,
      })
      for (const entry of apps ?? []) {
        if (entry.isDefault) continue
        list.push({ target: `app:${entry.id}`, name: entry.name, icon: <AppIcon entry={entry} /> })
      }
    }
    const seen = new Set(list.map(choice => choice.name.toLowerCase()))
    for (const target of targets) {
      // The host's reveal row replaces the plugin explorer while it is ready.
      if (target.kind === 'reveal') continue
      const name = pluginName(target, ssh)
      if (seen.has(name.toLowerCase())) continue
      list.push({ target: `plugin:${target.id}`, name, icon: pluginIcon(target) })
    }
    list.push({ target: 'reveal', name: t('revealInFileManager'), icon: <IconFolderOpenRegular size={14} /> })
    return list
  }, [appReady, apps, osDefault, targets, ssh])

  /** The current default as a renderable choice (a stale rule keeps its saved name). */
  const current = useMemo<Choice>(() => {
    const hit = choices.find(choice => choice.target === resolved.choice.target)
    if (hit !== undefined) return hit
    if (resolved.choice.target === 'system') {
      return { target: 'system', name: t('openDefaultSystem'), icon: <VscLinkExternal size={14} /> }
    }
    const pluginId = resolved.choice.target.startsWith('plugin:') ? resolved.choice.target.slice(7) : undefined
    const plugin = pluginId === undefined ? undefined : targets.find(target => target.id === pluginId)
    return {
      target: resolved.choice.target,
      name: resolved.choice.name !== '' ? resolved.choice.name : resolved.choice.target,
      icon: plugin !== undefined ? pluginIcon(plugin) : <VscLinkExternal size={14} />,
    }
  }, [choices, resolved.choice, targets])

  const flagFailure = useCallback(() => {
    setFailed(true)
    if (failTimer.current !== null) clearTimeout(failTimer.current)
    failTimer.current = setTimeout(() => { setFailed(false) }, 3000)
  }, [])

  /** Launch one choice on the current file. */
  const launch = useCallback((target: string): void => {
    let pending: Promise<boolean>
    if (target === 'system') pending = openInApp.open(path)
    else if (target.startsWith('app:')) pending = openInApp.open(path, target.slice(4))
    else if (target.startsWith('plugin:')) pending = onOpenWith(target.slice(7), path)
    else if (target === 'reveal') {
      pending = openInApp.reveal(path).then(ok => ok ? true : onOpenWith('explorer', path))
    } else pending = Promise.resolve(false)
    void pending.then((ok) => { if (!ok) flagFailure() }).catch(flagFailure)
  }, [openInApp, path, onOpenWith, flagFailure])

  /** Persist one choice as the default for the current scope. */
  const remember = (choice: OpenWithDefault): void => {
    onConfigChange(withDefaultOpen(config, resolved.scoped ? key : OPEN_WITH_DEFAULT_ANY, choice))
  }

  /** Toggle the extension scope: on copies the current default, off removes it. */
  const toggleScope = (): void => {
    if (key === OPEN_WITH_DEFAULT_ANY) return
    if (resolved.scoped) onConfigChange(withDefaultOpen(config, key, null))
    else onConfigChange(withDefaultOpen(config, key, { target: current.target, name: current.name }))
  }

  const entries: MenuEntry[] = [
    { type: 'label', id: 'heading', text: t('openDefaultHeading') },
    ...(appReady === true && apps === undefined
      ? [{ id: 'loading', label: t('loading'), disabled: true }]
      : []),
    ...choices.map(choice => ({ id: `choice:${choice.target}`, icon: choice.icon, label: choice.name })),
  ]
  /** The scope row, pinned below the scrolling list (absent without an extension). */
  const footer: MenuEntry[] = key === OPEN_WITH_DEFAULT_ANY
    ? []
    : [{ id: 'scope', label: t('openDefaultScoped', { ext: key }) }]
  const selectedIds = [`choice:${current.target}`, ...(resolved.scoped ? ['scope'] : [])]

  const title = failed ? t('openInAppFailed', { path }) : t('openDefaultTitle', { name: current.name })

  return (
    <div className={clsx(css.openDefault, failed && css.openDefaultFailed)} data-open-default="">
      <button
        type="button"
        className={css.openDefaultMain}
        title={title}
        aria-label={title}
        onClick={() => { launch(current.target) }}
      >
        <span className={css.openDefaultIcon} aria-hidden>{current.icon}</span>
        <span className={css.openDefaultText}>{t('openDefaultButton')}</span>
      </button>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        portal
        compact
        align="end"
        autoFocus
        className={css.openDefaultAnchor}
        anchor={(
          <button
            type="button"
            className={css.openDefaultChevron}
            title={t('openDefaultMenu')}
            aria-label={t('openDefaultMenu')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconChevronDownOutlineRegular size={14} />
          </button>
        )}
        items={entries}
        footer={footer}
        selectedIds={selectedIds}
        onSelect={(id) => {
          if (id === 'scope') {
            toggleScope()
            return
          }
          if (!id.startsWith('choice:')) return
          const target = id.slice('choice:'.length)
          const choice = choices.find(item => item.target === target)
          if (choice === undefined) return
          // Picking only switches the default; the main half opens.
          setOpen(false)
          remember({ target: choice.target, name: choice.name })
        }}
      />
    </div>
  )
}
