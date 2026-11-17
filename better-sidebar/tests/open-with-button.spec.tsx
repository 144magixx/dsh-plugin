/**
 * [fork] The editor header's "打开 ▾" split button:
 *   - the main half opens the file with its resolved default (OS default when
 *     nothing is configured, an extension rule before the catch-all);
 *   - the chevron lists the OS default, the host apps, the plugin targets
 *     (deduplicated by name) and reveal, with the current default selected;
 *   - picking a row only rewrites the default (catch-all, or the extension
 *     rule while it is scoped) — it does not launch anything;
 *   - the scope row adds / removes the extension rule;
 *   - the host listing is cached per extension (one query, not per render).
 */
// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { OpenWithButton, resetOpenWithButtonCache } from '../src/client/OpenWithButton.tsx'
import type { OpenInApp, OpenInAppEntry } from '../src/client/open-in-app.ts'
import { parseOpenWithConfig, resolveOpenWithTargets, type OpenWithConfig } from '../src/client/open-with.ts'

import { setupReactAct } from './test-utils.ts'
setupReactAct()

beforeAll(() => {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})

const APPS: readonly OpenInAppEntry[] = [
  { id: 'com.google.Chrome', name: 'Google Chrome', icon: null, isDefault: true },
  { id: 'com.apple.Safari', name: 'Safari', icon: 'data:image/png;base64,AA==', isDefault: false },
  { id: 'com.microsoft.VSCode', name: 'VS Code', icon: null, isDefault: false },
]

interface Harness {
  open: ReturnType<typeof vi.fn>
  reveal: ReturnType<typeof vi.fn>
  fileApps: ReturnType<typeof vi.fn>
  onOpenWith: ReturnType<typeof vi.fn>
  onConfigChange: ReturnType<typeof vi.fn>
  rerender: (config: OpenWithConfig, path?: string) => Promise<void>
  unmount: () => void
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function mount(config: OpenWithConfig, path = '/r/index.html', ready = true): Promise<Harness> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const open = vi.fn(async () => true)
  const reveal = vi.fn(async () => true)
  const fileApps = vi.fn(async () => APPS)
  const openInApp: OpenInApp = {
    available: () => ready,
    probe: async () => ready,
    directoryApps: async () => [],
    fileApps,
    open,
    reveal,
  }
  const onOpenWith = vi.fn(async () => true)
  const onConfigChange = vi.fn()
  const render = async (next: OpenWithConfig, nextPath: string): Promise<void> => {
    await act(async () => {
      root?.render(createElement(OpenWithButton, {
        path: nextPath,
        visible: true,
        openInApp,
        config: next,
        targets: resolveOpenWithTargets(next),
        ssh: false,
        onOpenWith,
        onConfigChange,
      }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  await render(config, path)
  return {
    open, reveal, fileApps, onOpenWith, onConfigChange,
    rerender: (next, nextPath = path) => render(next, nextPath),
    unmount: () => { act(() => { root?.unmount() }); container?.remove() },
  }
}

function mainButton(): HTMLButtonElement {
  const button = container?.querySelector<HTMLButtonElement>('[data-open-default] button')
  if (button === null || button === undefined) throw new Error('main button missing')
  return button
}

function chevron(): HTMLButtonElement {
  const button = container?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
  if (button === null || button === undefined) throw new Error('chevron missing')
  return button
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function labels(): string[] {
  return items().map(item => item.textContent?.trim() ?? '')
}

async function openMenu(): Promise<void> {
  await act(async () => { chevron().click(); await Promise.resolve() })
}

async function pick(label: string): Promise<void> {
  const item = items().find(el => el.textContent?.trim() === label)
  if (item === undefined) throw new Error(`menuitem not found: ${label} in ${labels().join(' | ')}`)
  await act(async () => { item.click(); await Promise.resolve() })
}

let harness: Harness
beforeEach(() => { resetOpenWithButtonCache() })
afterEach(() => { harness.unmount() })

describe('OpenWithButton main half', () => {
  it('opens with the OS default handler when nothing is configured', async () => {
    harness = await mount(parseOpenWithConfig({}))
    expect(mainButton().title).toBe('Open with System default (Google Chrome)')
    await act(async () => { mainButton().click(); await Promise.resolve() })
    expect(harness.open).toHaveBeenCalledWith('/r/index.html')
  })

  it('opens with a host app rule', async () => {
    harness = await mount(parseOpenWithConfig({ defaults: { '.html': { target: 'app:com.apple.Safari', name: 'Safari' } } }))
    await act(async () => { mainButton().click(); await Promise.resolve() })
    expect(harness.open).toHaveBeenCalledWith('/r/index.html', 'com.apple.Safari')
  })

  it('routes plugin targets through onOpenWith and prefers the extension rule', async () => {
    harness = await mount(parseOpenWithConfig({
      defaults: {
        '*': { target: 'plugin:zed', name: 'Zed' },
        '.html': { target: 'plugin:cursor', name: 'Cursor' },
      },
    }))
    await act(async () => { mainButton().click(); await Promise.resolve() })
    expect(harness.onOpenWith).toHaveBeenCalledWith('cursor', '/r/index.html')
    expect(harness.open).not.toHaveBeenCalled()
  })

  it('reveals through the host, falling back to the plugin explorer', async () => {
    harness = await mount(parseOpenWithConfig({ defaults: { '*': { target: 'reveal', name: '' } } }), '/r/a.ts')
    harness.reveal.mockResolvedValueOnce(false)
    await act(async () => { mainButton().click(); await Promise.resolve(); await Promise.resolve() })
    expect(harness.reveal).toHaveBeenCalledWith('/r/a.ts')
    expect(harness.onOpenWith).toHaveBeenCalledWith('explorer', '/r/a.ts')
  })

  it('flags a failed launch on the button', async () => {
    harness = await mount(parseOpenWithConfig({}))
    harness.open.mockResolvedValueOnce(false)
    await act(async () => { mainButton().click(); await Promise.resolve(); await Promise.resolve() })
    expect(mainButton().title).toBe('Could not open: /r/index.html')
  })
})

describe('OpenWithButton menu', () => {
  it('lists OS default, host apps, deduplicated plugin targets and reveal', async () => {
    harness = await mount(parseOpenWithConfig({}))
    await openMenu()
    const all = labels()
    expect(all.slice(0, 3)).toEqual(['System default (Google Chrome)', 'Safari', 'VS Code'])
    // The plugin's VS Code target is deduplicated against the host's.
    expect(all.filter(label => label === 'VS Code')).toHaveLength(1)
    expect(all).toContain('Cursor')
    expect(all).toContain('Zed')
    expect(all).toContain('Reveal in File Manager')
    expect(all).toContain('Only for .html files')
    // The explorer plugin target is replaced by the host reveal row.
    expect(all).not.toContain('File Manager')
  })

  it('picking a row rewrites the catch-all default without launching', async () => {
    harness = await mount(parseOpenWithConfig({}))
    await openMenu()
    await pick('Cursor')
    expect(harness.onConfigChange).toHaveBeenCalledTimes(1)
    const next = harness.onConfigChange.mock.calls[0]?.[0] as OpenWithConfig
    expect(next.defaults).toEqual({ '*': { target: 'plugin:cursor', name: 'Cursor' } })
    expect(harness.open).not.toHaveBeenCalled()
    expect(harness.onOpenWith).not.toHaveBeenCalled()
  })

  it('picking while scoped rewrites only the extension rule', async () => {
    harness = await mount(parseOpenWithConfig({ defaults: { '.html': { target: 'system', name: '' } } }))
    await openMenu()
    await pick('Safari')
    const next = harness.onConfigChange.mock.calls[0]?.[0] as OpenWithConfig
    expect(next.defaults).toEqual({ '.html': { target: 'app:com.apple.Safari', name: 'Safari' } })
  })

  it('the scope row adds and removes the extension rule', async () => {
    const base = parseOpenWithConfig({ defaults: { '*': { target: 'plugin:zed', name: 'Zed' } } })
    harness = await mount(base)
    await openMenu()
    await pick('Only for .html files')
    const scoped = harness.onConfigChange.mock.calls[0]?.[0] as OpenWithConfig
    expect(scoped.defaults['.html']).toEqual({ target: 'plugin:zed', name: 'Zed' })
    await harness.rerender(scoped)
    await pick('Only for .html files')
    const unscoped = harness.onConfigChange.mock.calls[1]?.[0] as OpenWithConfig
    expect(unscoped.defaults).toEqual({ '*': { target: 'plugin:zed', name: 'Zed' } })
  })

  it('hides the scope row for extension-less files', async () => {
    harness = await mount(parseOpenWithConfig({}), '/r/Makefile')
    await openMenu()
    expect(labels().some(label => label.startsWith('Only for'))).toBe(false)
  })

  it('omits host rows when the host cannot open paths', async () => {
    harness = await mount(parseOpenWithConfig({}), '/r/index.html', false)
    await openMenu()
    expect(harness.fileApps).not.toHaveBeenCalled()
    const all = labels()
    expect(all).not.toContain('Safari')
    expect(all).toContain('VS Code')
    expect(all).toContain('Reveal in File Manager')
  })

  it('caches the host listing per extension', async () => {
    harness = await mount(parseOpenWithConfig({}), '/r/a.html')
    await harness.rerender(parseOpenWithConfig({}), '/r/b.html')
    expect(harness.fileApps).toHaveBeenCalledTimes(1)
  })
})
