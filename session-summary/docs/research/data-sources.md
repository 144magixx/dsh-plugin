# Session-summary plugin — data sources research (DSH 0.2.1-rc.3)

Read-only research for a client plugin that renders a Codex-style "session summary" floating card in the conversation header.
All paths below are relative to `$X = C:\Users\Admin\AppData\Local\Temp\dsh-asar-inspect` unless they start with `E:\`.
Line numbers are approximate (built bundles).

Legend: **[client]** = available in the browser with no new host route · **[host-route]** = needs an existing authenticated HTTP route · **[new-route]** = would need a new host route · **[uncertain]** = inferred, not verified at runtime.

---

## 0. TL;DR / recommended architecture

| Section | Primary source | Open action |
|---|---|---|
| Project | `useSessions(s => s.byId[sessionId]?.cwd)` + `useWorkspaces(...)` (workspace title) + `useProjection('workingDirectory')` | `ctx.sidebarRight.openTab('files')`; OS open: `ctx.remote.session.openWorkspacePath({ path })` |
| Changes | Turn location data `deliverables.changes.seq` (from ui-deliverables) or own Definition on `workspace/changes` → GET `api/changes.summary?sessionId&seq` **[host-route, exists]** | `ctx.sidebarRight.openResource('dsh-resource://changes-review/session/<sid>/<seq>/<turn>', { params: { index } })` |
| Subagents | `useProjection('subagentCatalog')` + `useSessionStatus` + `useSessions(s => s.byId[child].projectionValues.{subagentTiming,tokenUsage,title})` | `ctx.sidebarRight.openResource('dsh-resource://subagentchat/session/<child>?parent=<p>&mode=<m>', { kind: 'subagentchat', preferNewPane: true })` |
| Web sources | Chat `tool-call` nodes, `name` = `web_search` / `web_fetch`, result `meta` | `ctx.sidebarRight.openTab('browser', { params: { url } })` (fallback `window.open`) |
| MCP | Chat `tool-call` nodes with `name` matching `mcp__<server>__<tool>` (+ `list_mcp_resources` / `read_mcp_resource` with `args.server`) | none native (no MCP panel) |
| Skills | `skill` tool calls (`args.name`), `context` nodes with `source.kind === 'skill-invocation'`, user node `data.skillNames` | `ctx.remote.skills.list({ sessionId })` → `path` → `openResource(fileAddressFor(...))` |
| @files / @sessions | user node text (`@path`, `@"path"`), next `context` node with `source.kind === 'session-reference'` (`references[].sessionId/label`) | file: `openResource(fileAddressFor(...))`; session: `ctx.uiWorkspace.openSession(id)` |
| Todo | `useProjection('todos')` → `TodoItem[] \| null` | — |
| Plan | `useProjection('plan')` → `{active, pending}`; submitted plans = chat nodes `kind: 'submitted-plan'` | `openResource('dsh-resource://plan/<sid>/<callId>')` |
| Generated files | Turn location data `deliverables.presented[]` (from `deliverables/presented` events) or `present` tool-call args | `openResource(fileAddressFor(sid, cwd, path))`; native: POST `api/present.open?sessionId&seq&index` |
| Jobs | `ctx.jobs.watchRows(sessionId)` (returns release fn) + `ctx.jobs.state` → `state.rows[sessionId]: JobView[]` | `ctx.jobs.kill(sessionId, jobId)` |
| Related sessions | `useSessions(s => s.byId)`: `parentId` + `origin` (`'subagent'` vs fork); side-branch: fork title suffix / `/api/side-branch/branch` | `ctx.uiWorkspace.openSession(id)`; side-branch tab: `openResource('dsh-resource://side-branch/session/<id>?source=..&mode=..&turn=..')` |

Biggest caveats (details in each section):
1. The Chat snapshot only contains the **loaded event window** (`useSession(s => s.hasMore)`); full-session aggregation needs paging (`ctx.remote.session.follow` + `ctx.remote.session.page`, pattern already used by ui-plan) — no new host route required.
2. Change summaries live only in host memory for the host process lifetime; fork-inherited turns and subagent sessions have none; summing per-turn +/- is churn, not net diff.
3. `web_fetch` meta has no page title.
4. There is no client API listing MCP servers or listing side-branch sessions by source.

---

## A. Standard props / hooks for a session-scoped header slot

### A.1 Which slot
Session-scoped header slots (declared by `ui-conversation`, catalog at `dsh-cordis-client-runner\lib\client.js` ~3830–4106; source cited there as `packages/client/ui-conversation/src/client/contract/slots.ts:214-258`):

| Slot | kind | scope | Notes |
|---|---|---|---|
| `conversation.session.header.actions` | list (needs `id`, optional `order`, `label`) | session | Title-adjacent. Occupants: agent-preset, `job-list` (order 20), `subagent-catalog` (order 10), agent-team. **Recommended** for a trigger button + popover card. |
| `conversation.session.header.utilities` | list | session | Right-aligned. Occupants: open-in-app, schedule-catalog, session-log-download. Also fine. |
| `conversation.session.header.corner` | single | session | Shadows sidebar-right ExpandButton — avoid. |
| `conversation.session.header.lineage` | single | session | Shadows ui-subagent breadcrumb — avoid. |

Registration pattern (from the catalog example and `dsh-client-ui-jobs\lib\client.js` ~627–638):
```js
ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
  name: 'conversation.session.header.actions', id: 'session-summary', order: 30, locale: NS,
  inject: () => ({ hooks: { jobs: ctx.jobs.state }, /* plain callbacks */ }),   // `hooks.x` becomes prop `useX`
}, SummaryAction))
```
Note: blank Sessions hide header actions/utilities (ui-conversation README §Shell: "A blank Session retains ... leading and corner controls ... while hiding its title, actions, utilities").

### A.2 Standard props received (session scope)
Exact list (`dsh-cordis-client-runner\lib\client.js` ~3831–3850):
```
useRemoteAccess, useResource, useWorkspaces, usePanelInfo, useSessions, useSessionStatus,
useSessionRetainInfo, useSessionAccess, useWorkspaceAccess, useChat, useConversation,
useInput, inputActions, useSession, sessionId, useProjection, useAccess, useTrajectory
```
Plus `renderSlot`, `renderFactorySlot`, `SessionProvider`, and `t` when `locale` is set.

Hook signatures (TYPE_API, same file ~1929, ~2269):
- Non-keyed hooks are `SnapshotSelectorHook<T> = <S>(sel: (s: T) => S, eq?) => S` — **a selector is mandatory** (`useChat(s => s)`).
- `useProjection` is a keyed hook: `useProjection(key)` → value | undefined, or `useProjection(key, selector, eq?)`. Implementation: `keyedHooks: { projection: (key) => binding.session.projections.faceOf(key) }` (`dsh-client-ui-session\lib\client.js` ~755–764).
- `useChat` is provided by ui-chat: `ctx.uiSession.provide({ hooks: ['chat'], resolve: binding => ({ hooks: { chat: chatSource(binding) } }) })` (`dsh-client-ui-chat\lib\client.js` ~13106); source = `ctx.uiConversation.binding(binding).target('chat')` (~13096).

### A.3 `useSession` value = `SessionSnapshot` (lifecycle only; **no cwd/title**)
`dsh-cordis-client-runner\lib\client.js` ~2209:
```ts
interface SessionSnapshot {
  sessionId; pendingSubmissions: PendingSubmission[]; running: boolean;
  subagent: { address: SubagentAddress /* {parentSessionId, childSessionId, mode:'one-shot'|'continuable'|'unknown'} */; parentAvailable?: boolean } | null;
  removed; openState: 'cold'|'loading'|'open'|'error'; openError; hasMore: boolean /* older history not loaded */;
  loadingOlder; promptError; blank: boolean; lastAgentError: string|null; promptAttempted; awaitingFirstTurn;
}
```
The `SessionFace` behind it (`ISession`, ~1917) also has `loadOlder()`, `loadThrough(seq)`, `projections.faceOf(key)`, `rename`, `cancel`, `command(line)` — reachable via `ctx.sessions.binding(sessionId).session`.

### A.4 `useSessions` value = `SessionListState` (= `ctx.sessions.list`)
```ts
interface SessionListState { ids: SessionId[]; byId: Record<SessionId, ClientSessionSummary>; phase: 'pending'|'ready';
  projectionsBySession: Record<SessionId, { values: Partial<SessionProjectionMap>; state: 'idle'|'loading'|'ready'|'migration-required'|'error'; error }> }
```
(TYPE_API ~2165, ~2173.) The **client** summary row is built in `dsh-api-session-controller\lib\types\client\sessions\service.js` `projectList()` ~492–567:
```js
byId[id] = { id, displayTitle, running, retainedBy, blank, updatedAt, formatStatus,
  projectionValues?,      // per-session projection values (subagentTiming, tokenUsage, subagent, title, ...)
  title?, cwd?,           // cwd = SessionHeader.cwd (immutable project root)
  parentId?,              // = host SessionSummary.parentSessionId = SessionHeader.parentSession
  origin? }               // 'subagent' for subagent children; absent for forks/ordinary
```
Subagent children of any session with a loaded `subagentCatalog` are synthesized into `byId` with `origin: 'subagent'`, `parentId`, `projectionValues` (~516–543). Host `SessionSummary` (`dsh-api-session-controller\lib\typert.host.js` ~2967) has `parentSessionId?`, `origin?`, `cwd?`; filled by `listFields(header)` in `lib\index.js` ~2127.
There is **no** `subagentCatalog`/`subagentTiming` at the top level of `useSessions`; they live in `projectionsBySession[id].values.*` and `byId[id].projectionValues.*`.

`useSessionStatus` → `Map<SessionId, { running?: boolean; pendingInteraction?; completionUnread: boolean }>` (`dsh-client-ui-session\lib\client.js` ~976–992).
`useWorkspaces` → `{ items: WorkspaceView[]; phase; state; archivedSessionIds: SessionId[]; pinnedSessionIds: SessionId[] }` with `WorkspaceView = { workspaceId, path, title, sessionIds, createdAt, updatedAt }` (`dsh-client-ui-workspace\lib\client.js` ~3517–3526, TYPE_API ~2341).

### A.5 Projection keys (`useProjection(name)`)
Wire map (`dsh-api-session-controller\lib\typert.host.js` ~2887) plus keys registered elsewhere (`key: "..."` greps):
| key | value | owner |
|---|---|---|
| `todos` | `TodoItem[] \| null`, `TodoItem = { content: string; status: 'pending'\|'in_progress'\|'completed' }` | dsh-tool-todo |
| `plan` | `{ active: boolean; pending: boolean }` | dsh-plan-mode |
| `goal` | `{ goal: GoalSnapshot{objective, phase, blockedReason?, maxGoalRounds, ...}; roundsStarted; createdAt; updatedAt } \| null` | dsh-goal |
| `subagentCatalog` | `SubagentCatalogEntry[]` = `{ id, createdAt, mode: 'one-shot'\|'continuable'\|'external'\|'unknown', label? }` (`dsh-tool-cordis\lib\types\api-catalog.js` ~7767) | dsh-subagent |
| `subagentTiming` | `{ settledMs: number; active?: { since; through }; lastTurnCompleted?: boolean }` | dsh-subagent |
| `subagent` | `{ mode:'one-shot', label?, seq } \| { mode:'continuable', label, seq } \| null` | dsh-subagent |
| `tokenUsage` | `{ uncachedInputTokens; outputTokens; cacheReadTokens; cacheWriteTokens }` | dsh-token-meter |
| `contextPressure`, `contextBreakdown` | token-meter views | dsh-token-meter |
| `turnOutline` | `[{ turn, seq /* turn/start seq */, prompt /* ≤50 chars */, response /* ≤120 chars, '' until settled */ }]` | dsh-session-turn-outline |
| `title` | `string \| null` | dsh-session-title |
| `workingDirectory` | `string \| null` (current cwd; may differ from header cwd) | dsh-working-directory |
| `agentPreset`, `modelSelection`, `permissions`, `sandboxMode`, `inbox`, `userQuestions`, `sessionListMetadata`, `imageLimits`, `agentTeam`, `sessionStats`, `llmRetry`, `timeContext`, `tmuxContext` | various | various |
Absent key ≠ absent feature (projection README: unit table is process-wide).

### A.6 `useChat` snapshot (ChatSnapshot)
Shape (`dsh-client-ui-chat\lib\client.js` ~97–143, builder ~9306–9418):
```ts
{ order: NodeKey[] /* visible nodes, presentation order */,
  nodes: { get(key), source(key), bottomSource(key), processSource(key),
           turnDataSource(turn, kind) /* ObservableSnapshot<data[]> incl. hidden nodes, anchor order */,
           values() /* all materialized nodes incl. hidden */ },
  locations: { getTurn(turn): NodeKey[]; getStep(turn, step): NodeKey[] },
  navigation: { items() },
  timeline: { turnOrder: number[]; turns: Map<number, Turn> },
  legacy: {...} }
Turn = { turn, start?: event, end?: event, status: 'open'|'closed'|'unknown', steps: Step[], data: { get(key), source(key) } }
Node = { key, kind, id, target: 'chat', anchorSeq, location: {kind:'step'|'turn'|'session'|'unresolved', turn?, step?}, visibility: 'visible'|'hidden', groupTree?, data }
```
**Important:** each publish returns a new snapshot object, but `nodes`, `locations` and every `turn.data` are *mutable, identity-stable* stores (`MutableChatNodeStore`, `MutableLocationDataStore` in ui-conversation ~1941). Cache derivations per snapshot object (WeakMap, like `E:\dsh-plugin\side-branch\lib\client.js` ~107–125) — never on `s.nodes` identity. For live turn-data, subscribe to `turn.data.source(key)` (`useSyncExternalStore`) — **[uncertain]** whether a pure location-data change (e.g. a late `workspace/changes`) always republishes the chat snapshot.

Node kinds seen in ui-chat: `user`, `steering`, `context`, `turn-trigger`, `developer-message`, `system-message`, `request-prompt`, `assistant`, `assistant-step`, `tool-call`, `command`, `compaction`, `model-retry`, `turn-error`, `turn-max-tokens`, `turn-process`, `turn-tail`, `unknown`; plus plugin kinds such as `submitted-plan` (ui-plan, hidden).

**Tool-call node** (`dsh-client-ui-chat\lib\client.js` ~10110–10463): `node.kind === 'tool-call'`, `node.data.root` is one of
```ts
// preparing (streaming args) / start (durable tool/call)
{ phase: 'preparing'|'start', callId, name, argsRaw?: string /* JSON text, 'start' only */, args: PartialArguments, turn, step, time, subCalls: Block[], parentCallId? }
// settled (tool/result) or synthesized interruption
{ kind: 'tool-result', seq, time, callId, name, args, call: { name, argsRaw } | null, callTime,
  content: ContentBlock[] /* e.g. [{type:'text', text}] */, isError: boolean, error?, meta /* = tool/result data.meta = presentationMeta */, subCalls: Block[], parentCallId? }
```
Parse args with `JSON.parse(root.argsRaw ?? root.call?.argsRaw)`. PTC (`run_code`) nested calls appear in `root.subCalls` (recursive) with already-parsed arguments — recurse to find web/MCP/skill calls made inside code.

**User nodes** (`messageDefinition` ~9844–9895): `kind: 'user'|'steering'`, `data = { kind, seq, time, content /* user/message content blocks */, source: {kind:'user',...}, referenceLabels?: string[], skillNames?: string[], messageId? }`. Injected context: `kind: 'context'` with `data.source` (see E/§4d).

---

## B. Changes (变更)

How ui-deliverables does it (`dsh-client-ui-deliverables\lib\client.js`):
1. A target-neutral Conversation Definition `deliverablesDefinition` (~1160–1253) matches `turn/start`, `tool/call`, `tool/result`, `deliverables/presented`, `workspace/changes` and publishes **turn location data** under key `"deliverables"`:
   ```ts
   turn.data.get('deliverables') = { produced: [{seq, path, argumentPath?}], presented?: [{path, description?, seq, index}], changes?: { seq } /* latest workspace/changes in that turn */ }
   ```
   `workspace/changes` event data is just `{ turn }` (validated by `isChangesEvent`, ~81). Registered with `ctx.uiConversation.events.register(deliverablesDefinition)` (~2268).
2. Summary read: `GET api/changes.summary?sessionId=<sid>&seq=<seq>` (document-relative; constants ~13–28; `changesSummaryUrl` ~90). Plain `fetch(url, {signal})` (~208). Response (host handler `dsh-client-ui-deliverables\lib\index.js` ~170–185):
   ```ts
   { turn: number, files: [{ path /* rel to cwd or absolute */, display, added, deleted, binary?: true, oversized?: true }], total, added, deleted }
   ```
   404 when the host no longer has it. Diff: `GET api/changes.diff?sessionId&seq&index` → `{kind:'text', path, display, before, after, coarse, hunks:[{oldStart,oldLines,newStart,newLines,lines}]} | {kind:'binary'|'oversized', path, display}`. Native open: `POST api/changes.open?sessionId&seq&index[&action=reveal]` (needs host desktop, 409/422 otherwise).
3. Open review tab (~2294–2296):
   ```js
   ctx.sidebarRight.openResource(`dsh-resource://changes-review/session/${encodeURIComponent(sessionId)}/${seq}/${turn}`, { params: { index } })
   ```
   Tab type `changes-review`, pattern `dsh-resource://changes-review/**`, builtin (~2005–2025). `index` = original index in that summary's `files`.
4. Open whole file instead: `openResource(fileAddressFor(sessionId, cwd, file.path))` (~1966).

Plugin options to find announcements client-side:
- (a) read `snapshot.timeline.turns.get(t)?.data.get('deliverables')?.changes?.seq` for each `t` in `timeline.turnOrder` (depends on ui-deliverables being loaded);
- (b) register its own Definition (distinct `kind` and location key) on `workspace/changes` (table form `match: { 'workspace/changes': fn }` is supported, ui-chat ~10453);
- (c) for history outside the loaded window, page events (see §K).

**Aggregation across turns — yes, client-side**, by fetching each turn's summary and merging by `path`. Caveats:
- Summed `added/deleted` per path = per-turn churn, not the net session diff (no net route exists; a true net diff would need **[new-route]**).
- Clicking an aggregated file can only open a per-turn review: choose the latest turn containing that path, and its `index` in that turn's `files`.
- Summaries exist only while the host process keeps the Session (`dsh-workspace-changes\README.md` §Use, Known Limitations); after a host restart earlier turns 404.
- Subagent sessions and sessions with `delegationDepth > 0` are never recorded (`dsh-workspace-changes\lib\types\index.js` ~28–29).
- **[uncertain]** Fork-inherited turns: the summary is keyed by the recording Session id; querying the fork id with an inherited seq most likely 404s.
- ui-deliverables only shows the card when Coding Tools is on (`ctx.configForms.developerTools.enabled`), a UI choice, not an API gate.
- Files changed only by shell outside a git repo are absent.

---

## C. Subagents (子智能体)

Exact derivation in `dsh-client-ui-subagent\lib\client.js`:
- Catalog: `useSessions(s => s.projectionsBySession)[rootId].values.subagentCatalog` (~358–377) — in a session-scoped slot `useProjection('subagentCatalog')` gives the current session's catalog directly.
- Activity (~369): `(statuses.get(entry.id)?.running ?? summaries[entry.id]?.running) === true ? 'running' : 'inactive'` (statuses = `useSessionStatus(v => v)`, summaries = `useSessions(s => s.byId)`).
- Completed vs idle (~203): `entry.activity === 'inactive' && summaries[id]?.projectionValues?.subagentTiming?.lastTurnCompleted === true` → "completed", else "not running". StateDot: running→`ongoing`, completed→`done`, else `idle`.
- `mode === 'external'` rows are non-navigable leaves without status.
- Label: `entry.label ?? entry.id`; title: `summaries[id]?.title`; mode label one-shot/continuable/unknown/external.
- Tokens (~65): `u.uncachedInputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens` with `u = summaries[id]?.projectionValues?.tokenUsage`.
- Elapsed (~69–76):
  ```js
  const t = summary.projectionValues?.subagentTiming
  ms = t.active === undefined ? t.settledMs : t.settledMs + Math.max(0, (activity === 'running' ? Date.now() : t.active.through) - t.active.since)
  ```
  tick with a 1 s interval only while some child is running.
- `projectionValues` of a child may be missing until read: ui-subagent calls `ctx.sessions.refreshProjections(childId)` on expansion/retry (~974–976). **[uncertain]** that this alone fills `byId[child].projectionValues` for never-opened children (service.js ~522 uses `manager.projectionValues(childId)`).
- Navigation (~964–973):
  ```js
  ctx.uiWorkspace.openSession({ parentSessionId, childSessionId, mode })          // main view
  ctx.sidebarRight.openResource(subagentChatAddress(address), { kind: 'subagentchat', preferNewPane: true })   // right sidebar
  // subagentChatAddress: `dsh-resource://subagentchat/session/${encodeURIComponent(child)}?${new URLSearchParams({ parent, mode })}`   (~709–715)
  ```
  `mode` must be `one-shot|continuable|unknown` (parser ~733).

---

## D. Web sources

- Tool names: `web_search`, `web_fetch` (`dsh-tool-web\README.md`; ui-tool keys ~4585–4590).
- Args: `web_search { queries: string[] }`, `web_fetch { url: string }`.
- Result meta (`root.meta` on a `tool-result` block; produced by `presentationMeta`, `dsh-tool-web\lib\index.js` ~103–124, ~670–676):
  ```ts
  web_search: { sources: [{ url, title?, snippet?, publishedAt? }], truncated: boolean, answer?: string }
  web_fetch:  { url /* final URL */, statusCode: number, truncated: boolean }      // NO title
  ```
  ui-tool's validator `webCardModel` (`dsh-client-ui-tool\lib\client.js` ~1031–1094) ignores sub-calls (`parentCallId`) and errored results; `webFetchHref` (~1100) reads `args.url` (http/https only).
- Title for fetched pages is unavailable; fallbacks: matching `title` from an earlier search source with the same URL, or hostname. The model-facing text starts `Fetched <finalUrl> (HTTP <code>)` — no title either.
- Open in built-in browser (ui-chat `openExternalLink`, `dsh-client-ui-chat\lib\client.js` ~13250–13253):
  ```js
  if (ctx.get('sidebarRightTabs')?.get('browser') !== undefined) ctx.sidebarRight.openTab('browser', { params: { url } })
  else window.open(url, '_blank', 'noopener,noreferrer')
  ```
  Documented API: `ctx.sidebarRight.openTab('browser', { params: { url } })` (`dsh-client-ui-sidebar-browser\README.md` l.43). Browser is **disabled by default on Web profiles**, enabled on Desktop; each open creates a new tab. ui-chat additionally honours the `ui-chat.linkOpening` preference (`sidebar` default) — not exposed to plugins except via `ctx.configForms.get(...)` **[uncertain]**.

---

## E. MCP & skills

### MCP
- Public tool name: `mcp__<serverName>__<rawName>` (`dsh-mcp-client\lib\index.js` `publicToolName` ~96–102). If chars outside `[A-Za-z0-9_-]` or length > 64, it becomes `normalized.slice(0, 51) + '_' + sha256hex12` — then rawName is not recoverable.
- `serverName` matches `[A-Za-z0-9_-]{1,32}` (README l.58) — may itself contain `__` in theory; parse with `/^mcp__(.+?)__(.+)$/` and accept ambiguity.
- No special Chat renderer for MCP: they render via the generic tool row. Result content = text/image blocks; `meta` not specified.
- Resource tools (`dsh-mcp-resources\lib\index.js` ~56–79): `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` with `args.server`.
- **No client API lists configured/connected MCP servers** (no `mcp*/` remote in `dsh-api-remotes`). Server list = servers seen in tool names only; a full list would need **[new-route]**.

### Skills
Three sources in the Chat snapshot:
1. Model loads: `tool-call` with `name === 'skill'`, `args = { name }` (`dsh-tool-skill\lib\index.js` ~787–894). Result content = `<skill_content ...>` text; output value `{ name, provider, resourceBase?: {kind:'directory',path}|{kind:'url',url}|{kind:'opaque',description}, content }` — **[uncertain]** whether this structured value is visible client-side (only rendered text is guaranteed in `content`).
2. User `/name` invocations: a `context` node whose `data.source = { kind: 'skill-invocation', name, form: 'instructions' }` (~912–923; Chat helper `skillInvocationName`, `dsh-client-ui-chat\lib\client.js` ~7787).
3. The user node itself carries `data.skillNames: string[]` (SkillNameProjector ~8931–9118).
Ignore `source.kind === 'skill-catalog'` (the catalog, not usage).

Open a skill's SKILL.md (ui-skill `openReference`, `dsh-client-ui-skill\lib\client.js` ~376–466):
```js
const r = await ctx.remote.skills.list({ sessionId }, signal)   // inject: 'remote', 'remote.skills'; needs retained, open session
const path = r.ok && r.value.skills.find(s => s.name === name)?.path   // skills: [{name, description, modelInvocable, path?}]
if (path) ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))
```

### §4d @-references in user prompts
- **@file / @folder**: raw text stays in the durable user message. Grammar (`dsh-client-ui-reference\lib\client.js` ~68–111):
  ```js
  const tokens = /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu
  // unquoted: strip trailing [.,;:!?，。；：！？]+ ; path = raw.slice(1) without quotes ; folder iff path.endsWith('/')
  ```
  Open: `ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))` (~282–285). Note: false positives possible (`@someone`), same as native.
- **@session**: the composer sends `@[label](dsh-session:<base64url(JSON.stringify(id))>)`, but the host rewrites the stored message text to `@label` (`dsh-session-reference\lib\types\uri.js` `parseSessionReferenceText`; `prepare()` receives already-normalized content, `types\index.js` ~275). Structured ids are in the **immediately following** `context` node (`seq = message.seq + 1`):
  ```ts
  source = { kind: 'session-reference', form: 'recall', version: 1,
             references: [{ sessionId, label, capturedThroughSeq, truncated, omittedMessages, ... , inputIndex }] }
  ```
  (`dsh-session-reference\lib\types\index.js` ~304–316; Chat pairing `followingRecall` ~8865–8871; user node also gets `referenceLabels`.) If a raw `@[label](dsh-session:...)` survives in text (e.g. pending echoes), decode with `JSON.parse(atob(base64url))`. Navigate with `ctx.uiWorkspace.openSession(sessionId)` (native chips are non-interactive).
- Subagent `@label` mentions are plain text (ui-subagent README) — no identity.

---

## F. Todo / plan

- Todo dock reads the projection directly (`dsh-client-ui-conversation\lib\client.js` ~19473–19491):
  ```js
  function TodoDock({ useProjection, t }) { return h(TodoPanel, { todos: useProjection('todos') ?? [], t }) }   // slot 'conversation.input.dock', id 'todo'
  ```
  Item `{ content, status: 'pending'|'in_progress'|'completed' }`; status dots: completed→`done`, in_progress→`ongoing`, pending→`idle`. History of `todo_write` calls also exists as `tool-call` nodes (`args.todos`) and ui-tool's target `tool-todo-history`.
- Plan mode: `useProjection('plan')` → `{active, pending}`; effective = `pending ? !active : active` (ui-plan README).
- Submitted plans = `exit_plan_mode` tool calls with `args.plan` (Markdown starting with `# Title`). ui-plan publishes hidden chat nodes `kind: 'submitted-plan'`, `data = { callId, markdown, title }` (`dsh-client-ui-plan\lib\client.js` ~240–263, ~314–341); per turn: `snapshot.nodes.turnDataSource(turn, 'submitted-plan')`.
- Open a plan (~269–278, ~638–651):
  ```js
  // ordinary session
  ctx.sidebarRight.openResource(`dsh-resource://plan/${encodeURIComponent(sessionId)}/${encodeURIComponent(callId)}`)
  // subagent session: dsh-resource://plan/subagent/<parent>/<child>/<mode>/<callId> (each segment URI-encoded); use ctx.sessions.subagentAddress(sessionId)
  ```
  Temporary pending review previews use `dsh-resource://plan-review/<sid>/<requestKey>` with `params.planReview` (not useful for a summary).

---

## G. Generated files (`present`)

- Tool `present`, args `{ files: [{ path, description? }] }` (≤ `maxFiles`, default 8). On success the host appends `deliverables/presented` with `{ turn, callId, files: [{ path /* absolute for new declarations */, description? }] }` (`dsh-client-ui-deliverables\lib\client.js` `isPresentedData` ~323; tool README).
- Client data: `turn.data.get('deliverables')?.presented` → `[{ path, description?, seq /* event seq */, index }]`; ui-deliverables keeps the last declaration per path (`presentedForClosing` ~1267).
- Preview (native card click): the chat `openFile` → `ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))` (`dsh-client-ui-chat\lib\client.js` ~13243–13249; document-preview handles the `dsh-resource://file/**` address).
- Native default-app open: `POST api/present.open?sessionId&seq&index` (+`&action=reveal` or `&application=...`); availability `GET api/present.host` → `{ name, available, fileManager }` (~273–468; host `lib\index.js` ~48–168). 422 = no verified host path.

---

## H. Jobs

`ctx.jobs` (`dsh-api-job-controller\lib\client.js` ~192–270; plugin inject `'jobs'`):
```ts
ctx.jobs.state            // ObservableSnapshot<{ rows: Record<SessionId, JobView[]>, observed: Record<JobId, OutputView> }>
ctx.jobs.watchRows(sid)   // opens/shares the `job.list` stream; returns an idempotent release() — call on unmount
ctx.jobs.observe(sid, id) // opens/shares the `job.follow` output stream; returns release()
ctx.jobs.kill(sid, id)    // Promise<RemoteResult>
JobView = { id /* '<kind>-<16hex>' */, kind, label, owner?, outputLimitBytes?, status: 'running'|'stopping'|'completed'|'killed'|'failed',
            progress?, detail?, startedAt, finishedAt?, output: { total, earliest, spillPaths? } }   // typert.host.js ~303
```
Kinds seen: `bash`, `pwsh`, `subagent`, `workflow`. ui-jobs usage (`dsh-client-ui-jobs\lib\client.js` ~323–368, ~627–638):
```js
inject: () => ({ hooks: { jobs: ctx.jobs.state }, watchRows: sid => ctx.jobs.watchRows(sid), observe: (sid, id) => ctx.jobs.observe(sid, id) })
// component
const jobs = useJobs(s => s.rows[sessionId]) ?? NO_JOBS
useEffect(() => watchRows(sessionId), [sessionId, watchRows])      // release on unmount
```
Live = `running|stopping`; observable = live or `output.total > 0`; dots: running→ongoing, stopping/killed→warning, completed→done, failed→error. Empty roster ⇒ key absent. Rows only exist while someone watches (refcounted, shared with the native header control).

---

## I. Related sessions

- Header lineage only walks **subagent** ancestry (`deriveAncestry`, `dsh-client-ui-conversation\lib\client.js` ~18084–18102: stops when `origin !== 'subagent'`); forks get no breadcrumb.
- Data: `useSessions(s => s.byId)`:
  - current subagent parent: `useSession(s => s.subagent?.address.parentSessionId)` or `byId[sid].origin === 'subagent' && byId[sid].parentId`.
  - fork source: `byId[sid].parentId` with `origin === undefined` (dsh-session fork sets `parentSession: liveSource.id`, `dsh-session\lib\types\index.js` ~1198; mapped by `listFields`).
  - forks of this session: `ids.filter(id => byId[id].parentId === sid && byId[id].origin !== 'subagent')`.
  - children: `useProjection('subagentCatalog')` (preferred) or `byId` rows with `origin === 'subagent' && parentId === sid`.
  - Archived: filter/flag via `useWorkspaces(s => s.archivedSessionIds)`; **[uncertain]** whether the list always includes archived rows (ui-workspace filters them itself).
- Navigation: `ctx.uiWorkspace.openSession(target)` where `target = SessionId | SubagentAddress` (SERVICE_API ~1494). Fork creation: `ctx.uiWorkspace.forkSession(id)` / `ctx.sessions.fork({...})`.
- dsh-side-branch (`E:\dsh-plugin\side-branch`):
  - "continue" and "edit turn ≥2" branches are native forks → `parentId === source` (`lib\service.js` ~134–136); "edit turn 1" uses `sessionController.create` → **no parentSession**.
  - Branch title is renamed to `<source title> · 自第 N 轮` / `· 改第 N 轮` (service.js ~189–190) — heuristic marker.
  - Authoritative per-session check: `POST /api/side-branch/branch {sessionId}` → `{ok:true, branch:{sessionId, sourceSessionId, mode, turn, ...}, ownUserMessages, running, ...}` or `{ok:false, code:'not-owned'}` (client `createApi` ~91–104; service `branch()` ~223–233). **No "list by source" route** — enumerating edit-turn-1 branches from the source needs **[new-route]** in side-branch.
  - Inside a branch, the first admitted turn carries a durable user message with `source.kind === 'plugin:side-branch'` (`lib\history.js` l.8) → Chat `context` node.
  - Open as side-branch tab: `ctx.sidebarRight.openResource(`dsh-resource://side-branch/session/${encodeURIComponent(id)}?${new URLSearchParams({ source, mode, turn: String(turn) })}`)` (client.js ~66–69); guard with `ctx.sidebarRightTabs.get('side-branch')`.

---

## J. Open / navigation API reference

`ctx.sidebarRight` (README `dsh-client-ui-sidebar-right\README.md` §ctx.sidebarRight):
```ts
openResource(address: `dsh-resource://<type>/…`, options?: { kind?, params?, replaceTab?, paneId?, revealIfOpened?: boolean, preferNewPane?: boolean }): void
openTab(kind: string, options?: { params?, paneId?, replaceTab?, revealIfOpened? }): void
mounted: ObservableSnapshot<SessionId | undefined>; close(tabId); active(); isExpanded(); toggleExpanded(); focus/split/float/dock
```
Throws on unclaimed addresses / unregistered kinds — check `ctx.sidebarRightTabs.get(kind)` (or `.candidates(address)` / `.claim(address)`) first. Expands the panel automatically.

| Target | Call |
|---|---|
| Workspace file / file line | `openResource('dsh-resource://file/session/<encSid>/<encPath>', { params: { line } })`; build with `fileAddressFor(sid, cwd, path)` (copy from `dsh-client-ui-deliverables\lib\client.js` ~573–637: relative or inside-cwd → relative; outside → absolute path segment-encoded, `:` kept) |
| File tree | `openTab('files')` (kind `files`, `dsh-client-ui-sidebar-files\lib\client.js` ~14–37; no deep-link to a folder) |
| Browser | `openTab('browser', { params: { url } })` |
| Turn review | `openResource('dsh-resource://changes-review/session/<encSid>/<seq>/<turn>', { params: { index } })` |
| Subagent chat | `openResource('dsh-resource://subagentchat/session/<encChild>?parent=<p>&mode=<m>', { kind: 'subagentchat', preferNewPane: true })` |
| Plan | `openResource('dsh-resource://plan/<encSid>/<encCallId>')` |
| Side branch | `openResource('dsh-resource://side-branch/session/<encId>?source=..&mode=..&turn=..')` |
| Session (main view) | `ctx.uiWorkspace.openSession(id \| {parentSessionId, childSessionId, mode})` |
| OS default app / reveal | `ctx.remote.session.openWorkspacePath({ path, action?: 'reveal', application? })`, availability `ctx.remote.session.canOpenWorkspacePath()` (`dsh-client-ui-open-in-app\lib\client.js` ~439–475) |

---

## K. Full-history access without a new host route

The Chat snapshot covers only loaded events (`useSession(s => s.hasMore)`; ui-chat README Known Limitations). Options:
1. `ctx.sessions.binding(sid).session.loadThrough(seq)` / `loadOlder()` — extends the **shared UI window** (affects the transcript; visible side effect).
2. Independent read, proven by ui-plan's resource provider (`dsh-client-ui-plan\lib\client.js` ~397–461; inject `'remote'`, `'remote.session'`):
   ```js
   let snap; for await (const f of ctx.remote.session.follow({ address: { kind: 'session', sessionId } }, signal)) if (f.type === 'snapshot') { snap = f; break }
   let page = { records: snap.records, hasMore: snap.hasMore }
   while (page.hasMore) { const r = await ctx.remote.session.page({ address, throughSeq: snap.cursor, beforeSeq: page.records[0].event.seq }, signal); if (!r.ok) break; page = r.value; /* records: [{type:'event', event:{type, seq, time, data}}] */ }
   ```
   (`session/page` schema: `dsh-api-session-controller\lib\typert.remote-client.js` ~1716; optional `maxMessages`, `turnWindow`.) Use sparingly (on card open), filter `tool/call`, `tool/result` (`data.meta`, `data.message.source.callId`), `user/message` (`data.source`, `data.content`), `workspace/changes`, `deliverables/presented`.

---

## L. Plugin wiring checklist
- Bundle form: `window.__ModuleLoader__.load({ id, factory: (require) => ({ name, inject: [...], apply }) })` like `E:\dsh-plugin\side-branch\lib\client.js`.
- `inject`: `slots`, `locale`, `sessions`, `uiWorkspace`, `sidebarRight`, `sidebarRightTabs`, `jobs`, `remote`, `remote.session`, `remote.skills`, optionally `uiConversation` (own Definitions).
- HTTP routes: native code uses document-relative `fetch('api/changes.summary?...')`; side-branch uses `globalThis.__DSH_TRANSPORT__?.fetch ?? fetch`. Mirror ui-deliverables (relative) — **[uncertain]** on Desktop `dsh-app:` pages, prefer the transport fetch when present.
- Unmount hygiene: release `watchRows`/`observe`, abort fetch/follow controllers, clear subagent tick intervals.
