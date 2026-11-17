/**
 * The plugin's view of the Lead Session's `agentTeam` projection — the team
 * board, read straight off the client snapshot.
 *
 * 0.1.6 exposed the board through the experimental service's Remote vocabulary
 * (`agentTeams.remoteView`) and the page had to poll it. 0.1.7 publishes the
 * same state as a Session projection instead:
 * `SessionListState.projectionsBySession[leadId].values.agentTeam`. This
 * module is therefore a pure adapter — no request, no poller, no observer —
 * exactly like ./subagent-catalog.ts for the catalog.
 *
 * [fork] THE PROJECTION IS HOST-OWNED AND ITS SHAPE MOVES. Two shapes exist:
 *
 * - DSH ≤ 0.2.2-rc.1 (`dsh-experimental-agent-team`): `{ members, tasks,
 *   failure? }`, members `{ id, name, role, phase, error? }`, published only
 *   for a session that leads a team.
 * - DSH 0.2.2-rc.2+ (`dsh-agent-team`): `{ enabled, tasks, failure? }`. Team
 *   is a MODE of every root session, so EVERY root carries the projection
 *   (`enabled: false` for an ordinary one); the roster is gone — "current
 *   subagents are supplied separately by the existing `subagentCatalog`
 *   projection" — and tasks carry `ownerId` (a session id); reassign takes a
 *   session id instead of a member name.
 *
 * Reading the 0.2.2-rc.2 value with the old type crashed the whole Tasks page
 * (`team.members.map` on undefined). So the adapter now follows three rules
 * that keep the next shape change from doing the same:
 *
 * 1. VALIDATE AT THE BOUNDARY. The snapshot value is `unknown`;
 *    {@link teamProjectionOf} normalizes it field by field, drops malformed
 *    rows, and answers undefined ("no team") for anything it cannot read —
 *    never a throw.
 * 2. DETECT BY SHAPE, NOT BY VERSION. A published `members` array is the
 *    legacy roster; without one the roster is derived from the catalog. An
 *    `enabled` flag is honoured when present.
 * 3. IDENTIFY BY SESSION ID. Task ownership matches `ownerId` first and the
 *    display name only as a fallback; each roster row carries the exact
 *    `assignKey` its host's reassign expects.
 *
 * TURN ACTIVITY is still derived, not invented: a member's running flag comes
 * from the session's own status (`byId[id].running`), with the
 * `subagents.live` residency flag as the fallback (see ./subagent-catalog.ts).
 */
import type {
  SidebarChildLiveView,
  SidebarSessionList,
  SidebarSessionSummary,
  SidebarTeamMemberProjection,
  SidebarTeamProjection,
  SidebarTeamTaskView,
} from '../context-types.ts'
import type { SubagentCatalogView } from './subagent-catalog.ts'
import { isSideThreadSummary } from './subagent-detect.ts'

/**
 * One roster row as this page consumes it: the projection's durable half plus
 * the derived runtime status. A THIRD type next to the host service's
 * `SidebarTeamMemberView` on purpose — that one is the 0.1.6 `listMembers`
 * shape (status/description/provider/model) this plugin no longer reads, and
 * conflating the two is exactly how the field drift that broke the board went
 * unnoticed.
 */
export interface TeamMemberRow {
  /** The member's session id (the teammate's child session under the lead). */
  id: string
  name: string
  role: 'lead' | 'teammate'
  /** Durable lifecycle, as the projection publishes it (derived rows: `active`). */
  phase: SidebarTeamMemberProjection['phase']
  /** Derived display status: durable phase wins, else the live activity flag. */
  status: 'running' | 'idle' | 'provisioning' | 'failed'
  /** The durable provisioning error as a one-item list (see the header). */
  diagnostics: string[]
  /**
   * [fork] The value the host's `reassign` action expects as `owner`: the
   * member NAME on the legacy roster (resolved by name), the session ID on a
   * derived roster (DSH 0.2.2-rc.2+ resolves a session id).
   */
  assignKey: string
}

/** The roster the host publishes for the root's own name (both shapes). */
const LEAD_NAME = 'lead'

const TASK_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed', 'deleted'])
const MEMBER_PHASES: ReadonlySet<string> = new Set(['provisioning', 'active', 'failed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * One task row, or undefined when it lacks what the board cannot draw without
 * (an id, a subject, a status the page knows). Optional extras degrade to
 * their empty value; unknown extra fields are ignored.
 */
function normalizeTask(raw: unknown): SidebarTeamTaskView | undefined {
  if (!isRecord(raw)) return undefined
  const id = stringOf(raw.id)
  const subject = stringOf(raw.subject)
  const status = stringOf(raw.status)
  if (id === undefined || id === '' || subject === undefined || status === undefined || !TASK_STATUSES.has(status)) {
    return undefined
  }
  const revision = typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) ? raw.revision : 0
  const ownerId = stringOf(raw.ownerId)
  const ownerName = stringOf(raw.ownerName)
  return {
    id,
    revision,
    subject,
    description: stringOf(raw.description) ?? '',
    status: status as SidebarTeamTaskView['status'],
    ...(ownerId !== undefined && ownerId !== '' ? { ownerId } : {}),
    ...(ownerName !== undefined && ownerName !== '' ? { ownerName } : {}),
    blockedBy: stringsOf(raw.blockedBy),
    writeScopes: stringsOf(raw.writeScopes),
    // The host derives readiness; a host that stops publishing it reads as
    // "ready" — the safe direction for a status dot (no false "blocked").
    ready: typeof raw.ready === 'boolean' ? raw.ready : true,
    writeScopeWarnings: stringsOf(raw.writeScopeWarnings),
  }
}

/** One legacy roster row, or undefined when it is unreadable. */
function normalizeMember(raw: unknown): SidebarTeamMemberProjection | undefined {
  if (!isRecord(raw)) return undefined
  const id = stringOf(raw.id)
  const name = stringOf(raw.name)
  if (id === undefined || id === '' || name === undefined) return undefined
  const phase = stringOf(raw.phase)
  const error = stringOf(raw.error)
  return {
    id,
    name,
    role: raw.role === 'lead' ? 'lead' : 'teammate',
    phase: phase !== undefined && MEMBER_PHASES.has(phase) ? phase as SidebarTeamMemberProjection['phase'] : 'active',
    ...(error !== undefined ? { error } : {}),
  }
}

/**
 * Normalize one host `agentTeam` value into the board's view.
 *
 * Answers undefined — "draw no Teams block" — when the value is not an object,
 * when the host says Team mode is off (`enabled: false`, which 0.2.2-rc.2+
 * publishes for every ordinary root), or when it carries neither a task list
 * nor a roster (a shape this plugin does not know yet).
 *
 * @param raw - `projectionsBySession[rootId].values.agentTeam`, unvalidated.
 */
export function normalizeTeamProjection(raw: unknown): SidebarTeamProjection | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.enabled === false) return undefined
  const hasTasks = Array.isArray(raw.tasks)
  const hasMembers = Array.isArray(raw.members)
  if (!hasTasks && !hasMembers) return undefined
  const tasks = hasTasks
    ? (raw.tasks as unknown[]).map(normalizeTask).filter((task): task is SidebarTeamTaskView => task !== undefined)
    : []
  const members = hasMembers
    ? (raw.members as unknown[]).map(normalizeMember)
      .filter((member): member is SidebarTeamMemberProjection => member !== undefined)
    : undefined
  const failure = stringOf(raw.failure)
  return {
    ...(members !== undefined ? { members } : {}),
    tasks,
    ...(failure !== undefined ? { failure } : {}),
  }
}

/**
 * The team board led by `rootId`, or undefined when that session leads none.
 *
 * ABSENT MEANS NO TEAM: the deployment never mounted the layer, the root is a
 * teammate rather than the Lead, Team mode is off, or the host published a
 * value this plugin cannot read. All collapse into "the page draws no Teams
 * block" — never a page crash.
 *
 * Results are memoized per raw value (the snapshot keeps an unchanged
 * projection's identity), so the page's `useMemo` dependencies stay stable.
 *
 * @param projections - `SessionListState.projectionsBySession`.
 * @param rootId - the tree's root session (the only session that can be Lead).
 */
export function teamProjectionOf(
  projections: SidebarSessionList['projectionsBySession'],
  rootId: string | undefined,
): SidebarTeamProjection | undefined {
  if (rootId === undefined) return undefined
  const raw: unknown = projections?.[rootId]?.values?.agentTeam
  if (!isRecord(raw)) return undefined
  const cached = normalizedByRaw.get(raw)
  if (cached !== undefined) return cached.value
  const value = normalizeTeamProjection(raw)
  normalizedByRaw.set(raw, { value })
  return value
}

const normalizedByRaw = new WeakMap<object, { value: SidebarTeamProjection | undefined }>()

/** Inputs of the derived roster (DSH 0.2.2-rc.2+, see {@link teamMembersOf}). */
export interface TeamRosterSource {
  /** The team's root (the Lead). */
  rootId: string
  /** Per-parent catalog views (./subagent-catalog.ts). */
  catalogs: Readonly<Record<string, SubagentCatalogView | undefined>>
}

/**
 * Overlay runtime activity onto the roster.
 *
 * The roster itself comes from the projection when the host publishes one
 * (legacy shape) and is DERIVED otherwise, the way the host's own task board
 * resolves an assignee: the Lead plus every CONTINUABLE descendant of the root
 * in the catalogs (side threads excluded). A derived row's name is the name a
 * task already recorded for that owner, else the catalog label.
 *
 * Status precedence is deliberately narrow: the durable phase wins for the two
 * states it owns (`failed` never becomes "running" because a retry is in
 * flight, `provisioning` is not yet a turn), and only an `active` member asks
 * the live channel whether it is running right now. A member the channel does
 * not mention yet reads as `idle`, which is the safe direction.
 *
 * @param team - the Lead's projection ({@link teamProjectionOf}).
 * @param live - the `subagents.live` map (`session id → live view`).
 * @param byId - the session list by id (the Lead's own running flag lives here).
 * @param source - root + catalogs; required to derive a roster the host did not publish.
 */
export function teamMembersOf(
  team: SidebarTeamProjection | undefined,
  live: Readonly<Record<string, SidebarChildLiveView | undefined>>,
  byId: Readonly<Record<string, SidebarSessionSummary | undefined>>,
  source?: TeamRosterSource,
): TeamMemberRow[] {
  if (team === undefined) return []
  if (team.members !== undefined) {
    return team.members.map(member => ({
      id: member.id,
      name: member.name,
      role: member.role,
      phase: member.phase,
      status: memberStatus(member, live, byId),
      diagnostics: member.error === undefined ? [] : [member.error],
      assignKey: member.name,
    }))
  }
  if (source === undefined) return []
  return derivedRoster(team, source, byId).map(member => ({
    ...member,
    status: memberStatus(member, live, byId),
    diagnostics: [],
    assignKey: member.id,
  }))
}

/** The Lead plus the root's continuable descendants, in catalog pre-order. */
function derivedRoster(
  team: SidebarTeamProjection,
  source: TeamRosterSource,
  byId: Readonly<Record<string, SidebarSessionSummary | undefined>>,
): SidebarTeamMemberProjection[] {
  /** The name the host recorded for an owner (`ownerName` = its agent path). */
  const recordedName = new Map<string, string>()
  for (const task of team.tasks) {
    if (task.ownerId !== undefined && task.ownerName !== undefined) recordedName.set(task.ownerId, task.ownerName)
  }
  const roster: SidebarTeamMemberProjection[] = [{
    id: source.rootId,
    name: recordedName.get(source.rootId) ?? LEAD_NAME,
    role: 'lead',
    phase: 'active',
  }]
  const seen = new Set<string>([source.rootId])
  const visit = (parentId: string): void => {
    const catalog = source.catalogs[parentId]
    if (catalog?.state !== 'ready') return
    for (const entry of catalog.entries) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const summary = byId[entry.id]
      if (summary !== undefined && isSideThreadSummary(summary)) continue
      if (entry.mode === 'continuable') {
        roster.push({
          id: entry.id,
          name: recordedName.get(entry.id) ?? entry.label ?? summary?.displayTitle ?? entry.id,
          role: 'teammate',
          phase: 'active',
        })
      }
      visit(entry.id)
    }
  }
  visit(source.rootId)
  return roster
}

/**
 * Whether `task` belongs to `member`: the owner's session id when the host
 * recorded one, the display name only for a task that carries no id.
 */
export function taskOwnedBy(task: SidebarTeamTaskView, member: TeamMemberRow): boolean {
  if (task.ownerId !== undefined) return task.ownerId === member.id
  return task.ownerName !== undefined && task.ownerName === member.name
}

/** One member's runtime status (see {@link teamMembersOf} for the rule). */
function memberStatus(
  member: SidebarTeamMemberProjection,
  live: Readonly<Record<string, SidebarChildLiveView | undefined>>,
  byId: Readonly<Record<string, SidebarSessionSummary | undefined>>,
): TeamMemberRow['status'] {
  if (member.phase === 'failed') return 'failed'
  if (member.phase === 'provisioning') return 'provisioning'
  // The summary's `running` is the authoritative run bit; the live channel's
  // flag is the catalog's RESIDENCY, which reads `running` for a retained
  // session that no agent is driving (a crash-restart — issue #800). Same rule
  // as the task tree: authoritative wins, the live flag only stands in when the
  // host's summaries do not carry the field.
  const running = byId[member.id]?.running ?? live[member.id]?.running
  return running === true ? 'running' : 'idle'
}
