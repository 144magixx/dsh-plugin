/**
 * [fork] The editor header's "打开 ▾" default-opener rules: tolerant parse of
 * `openWith.defaults`, the extension key of a path, resolution order
 * (extension rule → catch-all → OS default) and the pure rule writer.
 */
import { describe, expect, it } from 'vitest'
import {
  defaultKeyOf,
  isDefaultTarget,
  parseOpenWithConfig,
  resolveDefaultOpen,
  withDefaultOpen,
} from '../src/client/open-with.ts'

describe('defaultKeyOf', () => {
  it('lower-cases the last extension', () => {
    expect(defaultKeyOf('/a/b/Report.HTML')).toBe('.html')
    expect(defaultKeyOf('/a/b/archive.tar.gz')).toBe('.gz')
    expect(defaultKeyOf('C:\\u\\x.md')).toBe('.md')
  })

  it('falls back to the catch-all for dotfiles, bare names and trailing dots', () => {
    expect(defaultKeyOf('/a/.gitignore')).toBe('*')
    expect(defaultKeyOf('/a/Makefile')).toBe('*')
    expect(defaultKeyOf('/a/name.')).toBe('*')
    expect(defaultKeyOf('')).toBe('*')
  })
})

describe('openWith.defaults parsing', () => {
  it('keeps valid rules and drops junk keys / values', () => {
    const config = parseOpenWithConfig({
      defaults: {
        '*': { target: 'plugin:vscode', name: 'VS Code' },
        '.html': { target: 'app:com.google.Chrome', name: 'Google Chrome' },
        '.md': { target: 'bogus', name: 'x' },
        'html': { target: 'system', name: '' },
        '.a/b': { target: 'system', name: '' },
        '.txt': 'junk',
        '.log': { target: 'reveal' },
      },
    })
    expect(config.defaults).toEqual({
      '*': { target: 'plugin:vscode', name: 'VS Code' },
      '.html': { target: 'app:com.google.Chrome', name: 'Google Chrome' },
      '.log': { target: 'reveal', name: '' },
    })
  })

  it('treats a missing / malformed map as empty', () => {
    expect(parseOpenWithConfig({}).defaults).toEqual({})
    expect(parseOpenWithConfig({ defaults: [] }).defaults).toEqual({})
    expect(parseOpenWithConfig({ defaults: 'x' }).defaults).toEqual({})
  })

  it('isDefaultTarget accepts only the documented vocabulary', () => {
    for (const ok of ['system', 'reveal', 'app:x', 'plugin:custom:1']) expect(isDefaultTarget(ok)).toBe(true)
    for (const bad of ['', 'app:', 'plugin:', 'vscode', 'url:x']) expect(isDefaultTarget(bad)).toBe(false)
  })
})

describe('resolveDefaultOpen', () => {
  const config = parseOpenWithConfig({
    defaults: {
      '*': { target: 'plugin:vscode', name: 'VS Code' },
      '.html': { target: 'app:chrome', name: 'Chrome' },
    },
  })

  it('prefers the extension rule', () => {
    expect(resolveDefaultOpen(config, '/r/index.html')).toEqual({
      key: '.html', scoped: true, choice: { target: 'app:chrome', name: 'Chrome' },
    })
  })

  it('falls back to the catch-all rule', () => {
    expect(resolveDefaultOpen(config, '/r/a.ts')).toEqual({
      key: '.ts', scoped: false, choice: { target: 'plugin:vscode', name: 'VS Code' },
    })
  })

  it('falls back to the OS default handler with no rules', () => {
    expect(resolveDefaultOpen(parseOpenWithConfig({}), '/r/a.ts')).toEqual({
      key: '.ts', scoped: false, choice: { target: 'system', name: '' },
    })
  })
})

describe('withDefaultOpen', () => {
  it('sets and removes one rule without mutating the input', () => {
    const base = parseOpenWithConfig({ pinned: ['zed'] })
    const set = withDefaultOpen(base, '.html', { target: 'plugin:cursor', name: 'Cursor' })
    expect(set.defaults).toEqual({ '.html': { target: 'plugin:cursor', name: 'Cursor' } })
    expect(set.pinned).toEqual(['zed'])
    expect(base.defaults).toEqual({})
    const removed = withDefaultOpen(set, '.html', null)
    expect(removed.defaults).toEqual({})
  })

  it('ignores invalid keys', () => {
    const base = parseOpenWithConfig({})
    expect(withDefaultOpen(base, 'html', { target: 'system', name: '' })).toBe(base)
  })

  it('round-trips through the parser (the persisted blob shape)', () => {
    const next = withDefaultOpen(parseOpenWithConfig({}), '*', { target: 'reveal', name: 'Finder' })
    expect(parseOpenWithConfig(JSON.parse(JSON.stringify(next)))).toEqual(next)
  })
})
