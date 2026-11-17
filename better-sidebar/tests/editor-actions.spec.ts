/**
 * [fork] The `editorActions` registry: register / dispose / duplicate guard,
 * `order` ranking with stable registration order, change notification and
 * the feature flag consumers gate on.
 */
import { describe, expect, it, vi } from 'vitest'
import { createBetterSidebarService, SIDEBAR_FEATURES } from '../src/client/service.ts'
import type { SidebarStore } from '../src/client/state.ts'

const store = {} as unknown as SidebarStore

describe('editor actions registry', () => {
  it('advertises the feature', () => {
    expect(SIDEBAR_FEATURES).toContain('editorActions')
  })

  it('registers, ranks by order then registration, and disposes', () => {
    const service = createBetterSidebarService(store)
    const listener = vi.fn()
    service.subscribe(listener)
    const render = () => null
    const disposeB = service.registerEditorAction({ id: 'b', render })
    service.registerEditorAction({ id: 'a', order: -1, render })
    service.registerEditorAction({ id: 'c', render })
    expect(service.getEditorActions().map(action => action.id)).toEqual(['a', 'b', 'c'])
    expect(listener).toHaveBeenCalledTimes(3)
    disposeB()
    disposeB()
    expect(service.getEditorActions().map(action => action.id)).toEqual(['a', 'c'])
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('rejects a duplicate id', () => {
    const service = createBetterSidebarService(store)
    service.registerEditorAction({ id: 'x', render: () => null })
    expect(() => service.registerEditorAction({ id: 'x', render: () => null })).toThrow(/already registered/)
  })
})
