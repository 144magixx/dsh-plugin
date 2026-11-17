/**
 * Unit tests for the `agentTeam` projection adapter: reading the Lead
 * Session's board off the client snapshot, and overlaying runtime activity
 * onto the durable roster.
 *
 * The shape under test is DSH 0.1.7's `TeamProjection` (see the experimental
 * package's `lib/types/types.d.ts`): `{ members: {id,name,role,phase,error?},
 * tasks: TeamTaskView[], failure? }`. There is no `available` flag and no
 * `model` field — a projection that is absent means "this session leads no
 * team" (or the deployment never mounted the layer), which is the same silent
 * degradation either way.
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeTeamProjection, taskOwnedBy, teamMembersOf, teamProjectionOf, type TeamMemberRow,
} from '../src/client/team-projection.ts'
import type { SubagentCatalogView } from '../src/client/subagent-catalog.ts'
import type {
  SidebarChildLiveView,
  SidebarSessionList,
  SidebarSessionSummary,
  SidebarSubagentCatalogEntry,
  SidebarTeamMemberProjection,
  SidebarTeamProjection,
  SidebarTeamTaskView,
} from '../src/context-types.ts'

/** One durable roster row. */
function member(over: Partial<SidebarTeamMemberProjection> = {}): SidebarTeamMemberProjection {
  return { id: 'w', name: 'writer', role: 'teammate', phase: 'active', ...over }
}

/** One Lead Session projection. */
function team(over: Partial<SidebarTeamProjection> = {}): SidebarTeamProjection {
  return { members: [member()], tasks: [], ...over }
}

/** The snapshot's projection map with one session's team installed. */
function projections(
  rootId: string,
  teamValue: SidebarTeamProjection,
): SidebarSessionList['projectionsBySession'] {
  return { [rootId]: { values: { agentTeam: teamValue }, state: 'ready', error: null } }
}

/** A summary row. */
function summary(id: string, over: Partial<SidebarSessionSummary> = {}): SidebarSessionSummary {
  return { id, displayTitle: id, ...over }
}

describe('teamProjectionOf', () => {
  it('reads the root session own projection', () => {
    const value = team()
    expect(teamProjectionOf(projections('root', value), 'root')).toEqual(value)
  })

  it('keeps one normalized value per raw projection (stable memo dependencies)', () => {
    const map = projections('root', team())
    expect(teamProjectionOf(map, 'root')).toBe(teamProjectionOf(map, 'root'))
  })

  it('answers undefined without a root, without a snapshot, or without a team', () => {
    expect(teamProjectionOf(projections('root', team()), undefined)).toBeUndefined()
    expect(teamProjectionOf(undefined, 'root')).toBeUndefined()
    // A session the projection store knows, but which leads no team (the
    // deployment without the experimental layer, or a plain subagent tree).
    const other: SidebarSessionList['projectionsBySession'] = {
      root: { values: {}, state: 'ready', error: null },
    }
    expect(teamProjectionOf(other, 'root')).toBeUndefined()
    expect(teamProjectionOf(projections('root', team()), 'someone-else')).toBeUndefined()
  })
})

describe('teamMembersOf', () => {
  const noLive: Record<string, SidebarChildLiveView | undefined> = {}

  it('answers an empty roster without a team', () => {
    expect(teamMembersOf(undefined, noLive, {})).toEqual([])
  })

  it('carries the durable phase and the member identity through', () => {
    const rows = teamMembersOf(
      team({ members: [member({ id: 'lead', name: 'lead', role: 'lead' }), member({ id: 'w' })] }),
      noLive,
      {},
    )
    expect(rows).toEqual([
      { id: 'lead', name: 'lead', role: 'lead', phase: 'active', status: 'idle', diagnostics: [], assignKey: 'lead' },
      { id: 'w', name: 'writer', role: 'teammate', phase: 'active', status: 'idle', diagnostics: [], assignKey: 'writer' },
    ])
  })

  it('reads an active member activity from the live channel', () => {
    const live: Record<string, SidebarChildLiveView | undefined> = { w: { running: true } }
    expect(teamMembersOf(team(), live, {})[0]?.status).toBe('running')
  })

  it('falls back to the session list running flag (the Lead is no live child)', () => {
    const byId = { lead: summary('lead', { running: true }) }
    const rows = teamMembersOf(
      team({ members: [member({ id: 'lead', name: 'lead', role: 'lead' })] }),
      noLive,
      byId,
    )
    expect(rows[0]?.status).toBe('running')
  })

  it('never claims a running turn while the durable phase disagrees', () => {
    const live: Record<string, SidebarChildLiveView | undefined> = { w: { running: true } }
    const provisioning = teamMembersOf(team({ members: [member({ phase: 'provisioning' })] }), live, {})
    expect(provisioning[0]?.status).toBe('provisioning')
    const failed = teamMembersOf(team({ members: [member({ phase: 'failed' })] }), live, {})
    expect(failed[0]?.status).toBe('failed')
  })

  it('ignores the live channel residency when the summary says the agent is not running (issue #800)', () => {
    // The live flag is the catalog's SESSION RESIDENCY: a retained session
    // whose agent died in a crash-restart reads `running` there while the
    // authoritative summary stays false. The summary wins.
    const live: Record<string, SidebarChildLiveView | undefined> = { w: { running: true } }
    const byId = { w: summary('w', { running: false }) }
    expect(teamMembersOf(team(), live, byId)[0]?.status).toBe('idle')
  })

  it('takes the Summary running bit even when the live channel says otherwise', () => {
    const live: Record<string, SidebarChildLiveView | undefined> = { w: { running: false } }
    const byId = { w: summary('w', { running: true }) }
    expect(teamMembersOf(team(), live, byId)[0]?.status).toBe('running')
  })

  it('exposes the durable member error as the diagnostics list', () => {
    const rows = teamMembersOf(
      team({ members: [member({ phase: 'failed', error: 'spawn rejected' })] }),
      noLive,
      {},
    )
    expect(rows[0]?.diagnostics).toEqual(['spawn rejected'])
  })

  it('treats a member the live channel has not mentioned as idle', () => {
    const live: Record<string, SidebarChildLiveView | undefined> = { other: { running: true } }
    expect(teamMembersOf(team(), live, {})[0]?.status).toBe('idle')
  })
})

/**
 * [fork] Shape drift. DSH 0.2.2-rc.2 moved the projection to
 * `{ enabled, tasks, failure? }` on every root; anything the adapter cannot
 * read must degrade to "no team", never throw.
 */
describe('normalizeTeamProjection (host shape drift)', () => {
  const task = {
    id: 'task-1', revision: 2, subject: 's', description: 'd', status: 'pending',
    blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
  }

  it('reads the 0.2.2-rc.2+ shape (no roster, owner ids)', () => {
    const value = normalizeTeamProjection({ enabled: true, tasks: [{ ...task, ownerId: 'c1', ownerName: 'root/w' }] })
    expect(value).toEqual({ tasks: [{ ...task, ownerId: 'c1', ownerName: 'root/w' }] })
    expect(value?.members).toBeUndefined()
  })

  it('answers "no team" when Team mode is off, for non-objects and for unknown shapes', () => {
    expect(normalizeTeamProjection({ enabled: false, tasks: [task] })).toBeUndefined()
    for (const raw of [undefined, null, 1, 'x', [], { version: 9 }, { tasks: 'nope' }]) {
      expect(normalizeTeamProjection(raw)).toBeUndefined()
    }
  })

  it('drops unreadable rows and fills optional fields instead of throwing', () => {
    const value = normalizeTeamProjection({
      enabled: true,
      tasks: [null, { id: 'x' }, { ...task, status: 'archived' }, { id: 'ok', subject: 'k', status: 'completed', extra: 1 }],
      members: [{ id: 'a' }, { id: 'b', name: 'bee', role: 'boss', phase: 'weird' }],
      failure: 42,
    })
    expect(value).toEqual({
      tasks: [{
        id: 'ok', revision: 0, subject: 'k', description: '', status: 'completed',
        blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
      }],
      members: [{ id: 'b', name: 'bee', role: 'teammate', phase: 'active' }],
    })
  })

  it('teamProjectionOf never throws on a malformed snapshot', () => {
    const broken = { root: { values: null, state: 'ready', error: null } } as unknown as SidebarSessionList['projectionsBySession']
    expect(teamProjectionOf(broken, 'root')).toBeUndefined()
  })
})

describe('teamMembersOf without a published roster (DSH 0.2.2-rc.2+)', () => {
  const noLive: Record<string, SidebarChildLiveView | undefined> = {}
  const ready = (entries: SidebarSubagentCatalogEntry[]): SubagentCatalogView => ({ entries, state: 'ready', error: null })

  it('derives Lead + continuable descendants, keyed for reassign by session id', () => {
    const catalogs: Record<string, SubagentCatalogView> = {
      root: ready([
        { id: 'c1', createdAt: 1, mode: 'continuable', label: 'writer' },
        { id: 'c2', createdAt: 2, mode: 'one-shot', label: 'probe' },
      ]),
      c1: ready([{ id: 'c3', createdAt: 3, mode: 'continuable', label: 'helper' }]),
    }
    const rows = teamMembersOf({ tasks: [] }, noLive, {}, { rootId: 'root', catalogs })
    expect(rows.map(row => [row.id, row.name, row.role, row.assignKey])).toEqual([
      ['root', 'lead', 'lead', 'root'],
      ['c1', 'writer', 'teammate', 'c1'],
      ['c3', 'helper', 'teammate', 'c3'],
    ])
  })

  it('prefers the name a task recorded for that owner', () => {
    const catalogs = { root: ready([{ id: 'c1', createdAt: 1, mode: 'continuable', label: 'writer' }]) }
    const team: SidebarTeamProjection = {
      tasks: [{
        id: 't', revision: 1, subject: 's', description: '', status: 'in_progress', ownerId: 'c1',
        ownerName: 'root/writer', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
      }],
    }
    expect(teamMembersOf(team, noLive, {}, { rootId: 'root', catalogs })[1]?.name).toBe('root/writer')
  })

  it('matches ownership by session id first, by name only without an id', () => {
    const member: TeamMemberRow = {
      id: 'c1', name: 'writer', role: 'teammate', phase: 'active', status: 'idle', diagnostics: [], assignKey: 'c1',
    }
    const base: SidebarTeamTaskView = {
      id: 't', revision: 1, subject: 's', description: '', status: 'pending',
      blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
    }
    expect(taskOwnedBy({ ...base, ownerId: 'c1' }, member)).toBe(true)
    expect(taskOwnedBy({ ...base, ownerId: 'c9', ownerName: 'writer' }, member)).toBe(false)
    expect(taskOwnedBy({ ...base, ownerName: 'writer' }, member)).toBe(true)
    expect(taskOwnedBy(base, member)).toBe(false)
  })
})
