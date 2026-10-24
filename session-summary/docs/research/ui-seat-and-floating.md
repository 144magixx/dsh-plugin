# DSH Web GUI — header seats, floating surfaces, tokens, locale, persistence

Research notes for the future **"pinned summary" floating card** client plugin (Codex-style: toggle button at
the top-right of the conversation header; card floats over the transcript at the conversation area's
top-right; pinnable; native look).

- DSH version inspected: **0.2.1-rc.3** (extracted packages under
  `C:\Users\Admin\AppData\Local\Temp\dsh-asar-inspect\<package>\`, abbreviated below as `<X>/` =
  `…\dsh-asar-inspect\dsh-<X>\`).
- Shell bundle: `…\dsh-asar-inspect\index-BXV-oxvX.js` (minified; cited by **character offset**) and
  `index-BNyAYEM7.css`.
- Line numbers are those shown by the file-read tool; they are approximate (±3) because some bundles contain
  very long lines / unusual line separators.
- Everything here is read-only static analysis. **Nothing was verified in a live page**; items marked
  ⚠️ need live confirmation.

---

## 0. TL;DR (decisions for the plugin author)

| Question | Answer |
|---|---|
| Seat for the toggle button | **`conversation.session.header.utilities`** (kind `list`, scope `session`), `id` of your own, **high `order` (e.g. 100)** → renders as the right-most utility, immediately left of the corner seat (right-sidebar opener). |
| Can we use `conversation.session.header.corner`? | **No.** It is kind `single`; only one entry renders. Registering at the same priority **throws**; registering at a lower `priority` **shadows (replaces) the native right-sidebar ExpandButton**. |
| Blank Session | Header shows only `conversation.header.leading` + the corner; **utilities/actions/title/tabs are not rendered** (`hideChrome`). No Session → no `conversation.session.header` at all. So the toggle is invisible on blank/no-session screens. |
| Floating card mount | Native pattern (ui-jobs, ContextMeter, schedule): **`ReactDOM.createPortal(<card/>, document.body)` + `position:fixed`** with coordinates from `useAnchoredPosition` or own measurement. Alternative: the root-scoped **`shell.overlay`** list seat (frame-wide layer, z-index 20, click-through). |
| State that must survive session switch / reload | Session-scoped slot entries **remount on every Session switch** (React key = session generation). Keep `pinned`/`open` in a **plugin-level store**; persist `pinned` with `createSnapshotStore(init, { persist: { name: 'dsh.session-summary.v1' } })` (localStorage) from `@deepseek-ai/dsh-client-store`. |
| Escape / outside click | `useDismissOnOutsidePointer(rootRef, open && !pinned, setOpen, cardRef)`; a `document` `keydown` Escape listener that calls `event.preventDefault()` (keeps it out of the composer's Esc-Esc "stop turn" sequence ⚠️). **Do not** use `role="dialog" aria-modal="true"` or `role="menu"` on a pinned card (would be treated as a modal layer by the shortcut service). |
| Look | Copy ContextMeter panel CSS: `background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); border:0; border-radius: var(--dsw-radius-lg)`. Header button: ui-primitives `Button size="sm"` + `width:28px;padding:0;color:var(--dsw-alias-label-secondary)`, 15px svg, wrapped in `Tooltip side="bottom" delayMs={500}`. |
| Locale | `ctx.effect(() => ctx.locale.register(NS, { zh, en }))`; add `locale: NS` to each slot registration → component receives `t(key, params)` with `{name}` interpolation. `locale/*.json` only carries `meta.title/description` for the Plugin Manager. |

---

## 1. Conversation header seats

### 1.1 Declarations (who declares what, kind, scope)

Source: `ui-conversation/lib/client.js` L20022–20076 (inside `slots.inject("main", function* () {...})`,
L20219–20234). Same data, with docs, in the generated slot catalog
`cordis-client-runner/lib/client.js` L3016–3079 and L3823–4106 (`CLIENT_SLOT_API`, source
`packages/client/ui-conversation/src/client/contract/slots.ts:204–274`).

```js
// ui-conversation/lib/client.js ~L20022
const registerHeader = () => slots.register({
  name: "conversation.header",                     // single, scope session-maybe (declared by main.conversation)
  children: {
    "conversation.header.leading":  { kind: "single", scope: "root" },
    "conversation.session.header":  { kind: "single", scope: "session" }
  }
}, ConversationHeader);

const registerSessionHeader = () => slots.register({
  name: "conversation.session.header",
  locale: NS,
  children: {
    "conversation.session.header.lineage":      { kind: "single", scope: "session" },
    "conversation.session.header.actions":      { kind: "list",   scope: "session" },
    "conversation.session.header.utilities":    { kind: "list",   scope: "session" },
    "conversation.session.header.corner":       { kind: "single", scope: "session" },
    "conversation.session.header.views.actions":{ kind: "list",   scope: "root" }
  },
  store: conversationStore,
  inject: (sessionId, actions) => ({ hooks: { conversationViews, entryPins: viewPins.unpinned, entryActions: viewActions },
                                     setPinned: viewPins.setPinned, open: ..., selectView: ... })
}, ConversationSessionHeader);
```

| Slot | Kind | Scope | Register options | Owner props | Shipped occupants (id / order) | Catalog `replaceRisk` |
|---|---|---|---|---|---|---|
| `conversation.header` | single | session-maybe | — | — | ui-conversation `ConversationHeader` | shadows-shipped-ui |
| `conversation.header.leading` | single | **root** | — | `children?: never` | none shipped | none |
| `conversation.session.header` | single | session | — | (`hideChrome` passed by ConversationHeader) | `ConversationSessionHeader` | shadows-shipped-ui |
| `conversation.session.header.lineage` | single | session | — | `{ lineageSessionId, displayTitle, openTitle? }` | ui-subagent `SubagentHeaderLineage` | shadows-shipped-ui |
| `conversation.session.header.actions` | **list** | session | `id` (required), `order` (default 0, asc), `label` | `children?: never` | agent-team `agent-team` (-20), agent-preset `agent-preset` (-10), ui-jobs `job-list` (20), ui-subagent `subagent-catalog` (10) | none |
| `conversation.session.header.utilities` | **list** | session | `id` (required), `order` (default 0, asc), `label` | `children?: never` | open-in-app `open-in-app` (**-10**), schedule `schedule-catalog` (**-5**), session-log-export `session-log-download` (**0**, the "…" More menu); 3rd-party dsh-better-sidebar uses 10 and 20 | none |
| `conversation.session.header.corner` | **single** | session | — | `children?: never` | ui-sidebar-right `ExpandButton` | **shadows-shipped-ui** |
| `conversation.session.header.views.actions` | list | root | `id`, `order`, `label` | `{ entries, onOpen, onPinnedChange, onDismiss }` | entry-customization | none |

Catalog doc for corner (`cordis-client-runner/lib/client.js` L3926–3927): *"The header's far-right corner, past
the utilities' edge and into the header's own padding, for one control. The corner is laid out only while its
occupant renders something; an occupant with nothing to show renders nothing, and the utilities take the
header's edge."*

Shipped utility orders (verified): `ui-open-in-app/lib/client.js` L846–852 (`order: -10`),
`ui-schedule/lib/client.js` L7509–7513 (`order: -5`), `session-log-export/lib/client.js` L291–308 (no order → 0).
Schedule README L46/L66 confirms "immediately left of the overflow menu".

### 1.2 Rendering (DOM structure, what is shown when)

`ConversationHeader` — `ui-conversation/lib/client.js` L17964–17977:

```js
function ConversationHeader({ sessionId, useSession, useConversation, renderSlot }) {
  const session = useSession((s) => s);
  const conversation = useConversation((s) => s);
  const blank = session === void 0 || conversation === void 0 ||
                session.blank && conversationPhase(session, conversation) === "blank";
  return jsxs("header", {
    className: clsx(css.header, blank && css.headerBlank, sessionId === void 0 && css.headerSessionless),
    "data-window-drag": true,
    children: [
      jsx("div", { className: css.headerLeading, "data-conversation-header-leading": "",
                   children: renderSlot("conversation.header.leading", {}) }),
      sessionId === void 0 ? jsx("div", { className: css.titleRow })
                           : renderSlot("conversation.session.header", { hideChrome: blank })
    ]
  });
}
```

`conversationPhase` (L17378–17380): `activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running ? "active" : session.promptAttempted ? "engaging" : "blank"`.

`ConversationSessionHeader` — L18114–18223 (title row excerpt L18152–18202):

```js
jsxs("div", { className: css.titleRow, children: [
  !hideChrome && jsxs(Fragment, { children: [
    jsxs("div", { className: css.titleCluster, children: [
      jsxs("nav", { className: css.crumbs, "aria-label": t("session.hierarchy"), children: [/* breadcrumbs + lineage slot */] }),
      jsx("div", { className: css.headerActions, children: renderSlot("conversation.session.header.actions", {}) })
    ]}),
    jsx("div", { className: css.headerUtilities, children: renderSlot("conversation.session.header.utilities", {}) })
  ]}),
  jsx("div", { className: css.headerCorner, "data-conversation-header-corner": "",
               children: renderSlot("conversation.session.header.corner", {}) })
]}),
showTabs && /* View tab row, data-conversation-tabs */ ...
```

Left→right in the title row: `[crumbs + actions(list asc)] [utilities(list asc)] [corner]`.

**Blank Session** (`hideChrome === true`): only the corner is rendered in the title row (plus the leading
seat in the header's first grid column). Title, actions, utilities, View tabs are **not rendered at all** (not
just hidden). README L89 confirms: *"A blank Session retains the header's leading and corner controls,
including the right-sidebar opener, while hiding its title, actions, utilities, and View tabs."*
**No Session**: `conversation.session.header` is not rendered; only leading + an empty `titleRow`.

Header CSS (extracted from the `css$4` string just above `var ConversationRoot_module_css_default`,
~L17383–17395; class prefix `an3WzG_`):

```css
.an3WzG_root{background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex;position:relative}
.an3WzG_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;
  grid-template-columns:auto minmax(0,1fr);min-height:76px;padding:10px 28px 0 20px;display:grid}
.an3WzG_header:where(:not(:has(.an3WzG_tabs))){min-height:0;padding-bottom:10px}   /* no tabs → ~50px tall */
.an3WzG_headerBlank{border-bottom:none;min-height:0;padding-bottom:0}
.an3WzG_headerBlank .an3WzG_headerCorner{margin-left:auto}
[data-platform=darwin] .an3WzG_headerLeading,[data-platform=darwin] .an3WzG_headerActions,
[data-platform=darwin] .an3WzG_headerUtilities,[data-platform=darwin] .an3WzG_headerCorner{-webkit-app-region:no-drag}
.an3WzG_titleRow{min-height:30px;grid-column:2;align-items:center;gap:0;
  padding-inline-start:max(0px, calc(var(--dsh-frame-leading-clearance,0px) - 20px));display:flex;container-type:inline-size}
.an3WzG_titleCluster{flex:1;align-items:center;gap:10px;min-width:0;display:flex}
.an3WzG_headerActions{flex:none;align-items:center;gap:8px;display:flex}
.an3WzG_headerUtilities{flex:none;align-items:center;gap:8px;margin-left:20px;display:flex}
.an3WzG_headerUtilities:empty{display:none}
.an3WzG_headerCorner{flex:none;align-items:center;margin-left:8px;margin-right:-16px;display:flex}
.an3WzG_headerCorner:empty{display:none}
```

⚠️ Every `renderSlot()` output is wrapped in `<div data-slot="<key>" style="display:contents">`
(`ui-renderer/lib/client.js` L1116–1127, `SlotOutlet`). So `.headerUtilities`/`.headerCorner` always have a
child element and `:empty` probably never matches; the `display:contents` wrapper takes no layout space,
but the container margins (utilities `margin-left:20px`, corner `margin-left:8px; margin-right:-16px`)
may still apply when nothing visible renders. Harmless for us; verify live if pixel-exact spacing matters.

### 1.3 How registration/ordering actually works (slot runtime)

- **SlotCore.register** (shell bundle, char offset ≈487450): `single` → throws
  `slot "<name>" already has a registration at priority N — register at a different priority to shadow it
  (lowest renders)` when an entry with the same `priority` (default 0) exists; `list` → requires `options.id`,
  throws on duplicate `id` at the same priority; `keyed` → requires `key`; `chain` → requires `select`.
  Entries are sorted by `priority` asc, then (lists) `order` asc; stable by registration order.
- `entriesOfSlot()` (≈ offset after `entriesOfSlot(e){`) de-duplicates by `id` (list) / `key` (keyed), first
  (= lowest priority) wins, and skips crashed ("abdicated") entries.
- **Outlet**: `single` renders `entriesOfSlot(key)[0]` only; `list` sorts rows by `order` and renders all
  (`ui-renderer/lib/client.js` L1173–1221). ⇒ a second `corner` entry can only *replace* the opener.
- `registrant` option is optional diagnostics; defaults to the plugin fiber name
  (`ui-renderer/lib/client.js` L1603–1611). The cordis catalog claims dynamic entries get a lower priority
  than shipped ones (`cordis-client-runner` L4912) — ⚠️ not found in the code paths inspected; assume the
  default `priority: 0` and that `single` collisions throw.

### 1.4 Props a registered component receives

Composition (`ui-renderer/lib/client.js` `standardKit` L736–767, `renderEntry` L792–798):

```
props = { ...standard props of the slot scope,
          renderFactorySlot,                         // always
          t,                                         // only if registration has `locale: NS`
          useStore, actions,                         // only if registration has `store`
          renderSlot, renderSlotChain, SessionProvider, // only if registration declares `children`
          ...inject result (hooks → use<Name>),
          ...slot-level inject, ...owner props }      // owner props win
```

**Standard props for `scope: "session"` header seats** (catalog `standardProps`, e.g. L3931–3950):

```
useRemoteAccess(action) → boolean          useResource: UseResource
useWorkspaces(sel, eq?)                    usePanelInfo(sel)  // { activePanelId: MainPanelId|null }
useSessions(sel, eq?)  // SessionListState { ids, byId, phase, projectionsBySession }
useSessionStatus(sel)  // Map<SessionId, {running, pendingInteraction, ...}>
useSessionRetainInfo   useSessionAccess(sessionId, action)   useWorkspaceAccess(workspaceId, action)
useChat: UseChat       useConversation(sel)  // ConversationSnapshot (activeTargets …)
useInput(sel)          inputActions: InputActions
useSession(sel)        // SessionSnapshot { sessionId, running, blank, openState, subagent, awaitingFirstTurn, promptAttempted, … }
sessionId: SessionId   useProjection(key)  // e.g. useProjection('contextPressure'), useProjection('turnOutline')
useAccess(action) → boolean                useTrajectory: UseTrajectory
```

`SessionSnapshot` full shape: `cordis-client-runner/lib/client.js` L2210. Hook form: `SnapshotSelectorHook<T> =
(sel: (s:T)=>S, eq?: (a:S,b:S)=>boolean) => S` (L2270). Root-scoped seats (`conversation.header.leading`,
`shell.overlay`, `views.actions`) receive only the first 9 (no `sessionId`, no `useSession`).

**`inject` call signature** (`ui-renderer/lib/client.js` L435–442 `runInject`):

```js
function runInject(entry, binding, actions) {
  const args = [];
  if (binding !== void 0) args.push(binding.key);   // session/session-maybe scope → sessionId
  if (actions !== void 0) args.push(actions);       // only when the registration declares `store`
  return bindInjectSources(inject(...args));        // hooks:{name:ObservableSnapshot} → props.use<Name>(sel, eq?)
}
```

- session-scoped slot: `inject(sessionId)` or `inject(sessionId, actions)`; root: `inject()` / `inject(actions)`.
- Result is cached per entry × session binding (L499–519) — keep it cheap & stable.
- `hooks: { fooBar: {getSnapshot, subscribe} }` → prop `useFooBar(selector, eq?)` (L444–459);
  `keyedHooks` → `useX(key, selector?, eq?)`.
- Strict-session entries are rendered with React key `sessionGenerationKeyOf(binding)`
  (`StrictSessionEntry` L1091–1108) ⇒ **component state is reset on every Session switch**.

### 1.5 Best seat for our button

Use **`conversation.session.header.utilities`** with `order: 100` (anything > 20 to stay right of
dsh-better-sidebar's 10/20). It then sits right of the native "…" (session-log More) button and 8px left of the
corner seat (right-sidebar opener; when the right panel is open the opener renders `null` and our button
is the right-most control). The third-party `dsh-better-sidebar` plugin reached the same conclusion
(`C:\Users\Admin\.dsh\profiles\desktop\node_modules\dsh-better-sidebar\lib\client.js` L28915–28920:
*"the header's right corner belongs to the native sidebar's own expand control"*; registrations at
L18910–18920 and L30303–30308):

```js
// dsh-better-sidebar (3rd party) – verified shape
ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
  name: "conversation.session.header.utilities",
  id: HEADER_ENTRY_ID, order: 20, registrant: "dsh-better-sidebar",
  inject: (sessionId) => ({ controller, sessionId, isCurrent: () => mountedSessionId(ctx) === sessionId })
}, ContextDiagnosticsHeader));
ctx.slots.inject("shell.overlay", () => ctx.slots.register({
  name: "shell.overlay", id: HEADER_ENTRY_ID, order: 20, registrant: "dsh-better-sidebar",
  inject: () => ({ controller })
}, ContextDiagnosticsAlert));
```

Limitation: on blank / no-session screens the button is absent (utilities not rendered). A pinned card that
must also show on blank sessions would need the `shell.overlay` approach (§3.4). `conversation.header.leading`
(root) is the only other always-present header seat, but it is at the far **left**.

---

## 2. Native header controls — exact registrations

### 2.1 ui-sidebar-right (corner opener)

`ui-sidebar-right/lib/client.js`:

```js
// L4904–4914
const NS = "sidebarRight";
const inject = ["slots", "layout", "locale", "resources", "sessions", "uiSession", "shortcuts"];

// L4972–4975
ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-sidebar-right: dictionaries");

// L4983 store (per-Session, persisted to localStorage "dsh.sidebar-right.v1.<sessionId>", L761/L846–896)
const handle = createSidebarRightStore(() => defaultSeed(tabs));

// L5079–5084  — same store handle shared with "rightbar.session" (one handle across two same-scope seats)
const disposeExpand = ctx.slots.inject("conversation.session.header.corner", () => ctx.slots.register({
  name: "conversation.session.header.corner",
  locale: NS,
  store,
  inject: () => ({ hooks: { shortcuts: ctx.shortcuts.catalog } })
}, ExpandButton));
```

`ExpandButton` + CSS (L656–692):

```js
const css$1 = ".RwosdG_button{width:28px;color:var(--dsw-alias-label-secondary);flex:none;padding:0}" +
              ".RwosdG_button svg{width:15px;height:15px}.RwosdG_icon{transform:scaleX(-1)}";

function ExpandButton({ sessionId, useStore, actions, t, useShortcuts }) {
  const shortcut = useShortcuts((entries) => entries.find((entry) => entry.id === "sidebar.right.toggle"));
  if (useStore((state) => state.bySession[sessionId]?.layout.expanded ?? false)) return null;
  return jsx(P.Tooltip, {
    label: t("chrome.expand"), shortcutKeys: shortcut?.keys, side: "bottom", delayMs: 500,
    children: jsx(P.Button, {
      size: "sm", className: css.button,
      "aria-label": t("chrome.expandAria"), "aria-keyshortcuts": shortcut?.aria,
      "data-sidebar-right-expand": true,
      onClick: () => { actions.setExpanded(sessionId, true); },
      children: jsx(P.IconPanelLeftOutlineRegular, { className: css.icon })
    })
  });
}
```

`package.json` `dsh.client` (L29–41):

```json
"dsh": { "client": { "inject": [
  "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-client-resources",
  "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-layout",
  "@deepseek-ai/dsh-client-ui-session", "@deepseek-ai/dsh-client-shortcuts" ],
  "platform": "web" } }
```

### 2.2 ui-jobs (title-adjacent action + body popover)

`ui-jobs/lib/client.js` L613–639:

```js
const inject = ["jobs", "slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register("job", { zh, en }), "ui-jobs: dictionaries");
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "job-list",
    order: 20,
    locale: "job",
    inject: () => ({
      hooks: { jobs: ctx.jobs.state },
      watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
      observe: (sessionId, id) => ctx.jobs.observe(sessionId, id),
      killJob: async (sessionId, jobId) => (await ctx.jobs.kill(sessionId, jobId)).ok
    })
  }, JobListAction));
}
```

`package.json`:

```json
"dsh": { "client": { "inject": [
  "@deepseek-ai/dsh-api-job-controller", "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-primitives" ],
  "platform": "web" } }
```

### 2.3 Other native header-icon buttons (for visual parity)

- session-log-export "…" More (`session-log-export/lib/client.js` L172–230): `Button size="sm"` +
  `.K0RNnq_moreButton{width:28px;color:var(--dsw-alias-label-secondary);flex:none;padding:0}
  .K0RNnq_moreButton svg{width:15px;height:15px}`, `aria-haspopup="menu"`, `aria-expanded`, `aria-busy`,
  child `IconEllipsisOutlineRegular`; `Menu align="end" dense` (non-portal).
- Views "More" (`ui-conversation` L18049–18083): `Tooltip label portal` → `Button size="sm"` with
  `.viewsMore[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}` (pressed look).
- Schedule clock (`ui-schedule/lib/client.js` L1818–1890): plain `<button>` with `IconClockOutlineRegular size 16`,
  portal `<ul>` positioned with `useAnchoredPosition({ side:"bottom", gap:5, margin:16 })`, Escape on the list
  `preventDefault()` + refocus trigger.

**Recommended button** (matches sidebar-right/session-log exactly):

```js
h(P.Tooltip, { label: t('toggle.tooltip'), side: 'bottom', delayMs: 500 },
  h(P.Button, { size: 'sm', className: 'sps-headerButton',
    'aria-label': t('toggle.aria'), 'aria-expanded': open, 'aria-pressed': pinned || undefined,
    'aria-controls': open ? CARD_ID : undefined, 'data-session-summary-toggle': '',
    onClick: toggle },
    h(P.IconListPenOutlineRegular /* or IconChecklistOutlineRegular */, {})))
// CSS
.sps-headerButton{width:28px;color:var(--dsw-alias-label-secondary);flex:none;padding:0}
.sps-headerButton svg{width:15px;height:15px}
.sps-headerButton[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
```

---

## 3. Floating surfaces

### 3.1 ui-jobs popover (body portal + MenuSurface)

`ui-jobs/lib/client.js` L62–71, L323–521:

```js
const VIEWPORT_MARGIN = 12, MENU_GAP = 5;
const MEASURE_STYLE = { visibility: "hidden", left: 0, top: 0 };   // first frame: laid out but hidden, so it can be measured
...
const rootRef = useRef(null), triggerRef = useRef(null), menuRef = useRef(null);
const menuPosition = P.useAnchoredPosition({ open, anchorRef: rootRef, panelRef: menuRef, gap: MENU_GAP, margin: VIEWPORT_MARGIN });
P.useDismissOnOutsidePointer(rootRef, open, setOpen, menuRef);
const onKeyDown = (event) => {            // attached to the root <div> that wraps trigger (+ portal events bubble through React tree)
  if (!open) return;
  if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
  /* Tab cycling between trigger and menu focusables */
};
return jsxs("div", { ref: rootRef, onKeyDown, children: [
  jsxs("button", { ref: triggerRef, type: "button", className: css.trigger, "aria-expanded": open, "aria-label": countLabel, onClick, children: [...] }),
  open ? ReactDOM.createPortal(jsx(P.MenuSurface, {
           ref: menuRef, className: css.menu, style: menuPosition ?? MEASURE_STYLE,
           children: jsxs("ul", { className: css.menuBody, "aria-label": t("list.aria"), children: [...] })
         }), document.body) : null ]});
```

Popover CSS: `.Ag-ohG_menu{z-index:100;box-sizing:border-box;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);
--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
width:500px;max-width:min(560px,100vw - 32px);max-height:min(480px,100vh - 140px);box-shadow:var(--dsw-elevation-prominent);
flex-direction:column;display:flex;position:fixed;overflow:hidden}` (L12). ⚠️ ui-jobs also uses
`--dsw-alias-fill-l1/-l2` and `--dsw-font-mono`, which are **not defined** by ui-theme 0.2.1-rc.3 — avoid them.

### 3.2 Closest native analog for a *card*: ContextMeter panel

`ui-conversation/lib/client.js` L18711–18850 — a non-menu panel, plain `<div role="dialog">` portaled to body:

```js
const position = P.useAnchoredPosition({ open: open && available, anchorRef: rootRef, panelRef, side: "top", gap: 8, margin: 12 });
P.useDismissOnOutsidePointer(rootRef, open && available, setOpen, panelRef);
useEffect(() => { if (!open || !available) return;
  const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
  document.addEventListener("keydown", onKeyDown); return () => document.removeEventListener("keydown", onKeyDown);
}, [available, open]);
...
open && ReactDOM.createPortal(jsxs("div", { ref: panelRef, className: css.panel,
  style: position ?? { visibility: "hidden", left: 0, top: 0 }, role: "dialog", "aria-label": t("context.used"), children: [...] }), document.body)
```

```css
.A6Bq1a_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);
  width:min(264px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:12px;
  font-size:12px;line-height:20px;position:fixed}
```

Other fixed panels for reference: ui-cordis `.Fu0XRq_panel{isolation:isolate;z-index:30;…;width:420px;max-height:60vh;
box-shadow:var(--dsw-elevation-prominent);border-radius:12px;position:fixed}`; documentpreview
`.eze_pW_panel{z-index:100;width:min(340px,100vw - 24px);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-lg);
box-shadow:var(--dsw-elevation-prominent);padding:16px;font-size:13px;line-height:1.6;position:fixed}`.

### 3.3 Primitive signatures (from the shell bundle export table at offset ≈861000; definitions cited by offset)

> ⚠️ Policy note: the shipped plugin-development skill (`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md` L35)
> says *"Do not `require('@deepseek-ai/dsh-client-ui-primitives')` … they change without notice … copy markup, CSS and
> behavior into the plugin"*, and `references/ui-plugin.md` says *"Do not … append a second application to
> `document.body`"*. The module **is** in the baseline table and native packages use it, but treat these signatures as
> version-pinned to 0.2.1-rc.3 and guard against absence. `createPortal` into `document.body` is what native
> packages do (React-managed), which is different from appending a second app root.

```ts
// Button — forwardRef, offset ≈640858
Button({ variant = "ghost" /* "ghost"|"primary"|"outline"|"toolbar" */, size = "md" /* "md" 36px | "sm" 28px */,
         icon?: ReactNode /* rendered in a 16×16 span before children */, className, children, ...buttonProps }, ref)
// always type="button"; classes: _button(+variant+size). sm: height 28px; font 12/18; padding 0 10px; radius var(--dsw-radius-sm)
// ghost hover: --dsw-alias-interactive-bg-hover; active: --dsw-alias-interactive-bg-active; disabled: opacity .4

// Tooltip — offset ≈773410
Tooltip({ label: string | (() => string), shortcutKeys?: string[], side = "right" /* "top"|"bottom"|"left"|"right" */,
          align = "center" /* |"end" */, delayMs = 0, focusDelayMs = 0, gap = 8, disabled = false,
          portal = false /* true → bubble portaled to body, z-index 1100 (else 100, position:fixed) */,
          maxWidth?: number, openOnClick = false, children: ReactElement /* cloned: ref + mouse/focus/click handlers */ })

// MenuSurface — forwardRef, offset ≈649195. NOT itself portaled (caller portals it).
MenuSurface({ compact = false, className, style, children, ...divProps }, ref)
// renders <div data-menu-material="translucent" class="_surface (+_compact)" style={{...style, '--dsh-menu-anchor': …}}>
//   <div aria-hidden class="_material"/>{children}</div>
// + a body-portaled <div data-menu-backing aria-hidden> (macOS only visible) anchored with CSS anchor positioning.
// CSS: radius var(--dsw-radius-lg) (compact: md); _material: position:absolute; inset:0; z-index:-1;
//      background:var(--dsw-menu-surface-fill); backdrop-filter:var(--dsw-menu-backdrop-filter). No shadow → caller adds
//      box-shadow:var(--dsw-elevation-prominent) + --dsw-elevation-stroke-color, z-index, position:fixed.

// useAnchoredPosition — offset ≈659701
useAnchoredPosition({ open: boolean, anchorRef: Ref<Element>, panelRef: Ref<HTMLElement>,
                      side = "bottom" /* |"top" */, align = "start" /* |"end" */, gap: number, margin: number })
  → { left: number, top: number } | null      // null while closed / before first measure
// left = align==="end" ? anchor.right - panel.offsetWidth : anchor.left; top = side==="top" ? anchor.top-gap-h : anchor.bottom+gap
// clamped to [margin, innerWidth-w-margin] and [topLimit(margin), innerHeight-h-margin];
// topLimit(m) = max(m, --dsh-frame-top-clearance + 20) unless html[data-fullscreen]. Recomputes on window scroll (capture),
// resize, and ResizeObserver(panel). Does NOT observe the anchor's size.

// useAnchoredMaxHeight — offset ≈659318
useAnchoredMaxHeight(elementRef, maxHeight: number, dep: unknown, margin = 12) → number
// = min(maxHeight, element.getBoundingClientRect().bottom - topLimit(margin)); for upward-opening lists (bottom-anchored).

// useDismissOnOutsidePointer — offset ≈660527
useDismissOnOutsidePointer(rootRef, open: boolean, setOpen: (v:false)=>void, panelRef?)
// document 'pointerdown' listener while open; calls setOpen(false) when target is outside rootRef and panelRef.

// StateDot — offset ≈638112
StateDot({ state: "ongoing"|"done"|"warning"|"error"|"idle"|…, size?: number /* default 14 for ongoing (spinner), else 10 */,
           className, appearance = "dot" /* |"step" */ })

// Pill — offset ≈641112
Pill({ active = false, className, children, onClick, ...rest })   // <button> when onClick, else <span>; 24px tall, radius 999px
// Tag — offset ≈642323
Tag({ tone = "outline" /* "outline"|"solid"|"neutral"|"quiet"|"success"|"info"|"warning"|"danger" */, className, children })
// PathLabel — offset ≈642449
PathLabel({ path: string, className, ...spanProps })   // directory + name with middle clipping, title=path, data-path-label
// FileTypeIcon — offset ≈766408
FileTypeIcon({ path: string, context? } | { kind: FileType }, { size = 28, className })
// relativeTime — offset ≈793594 (pure; NO localization)
relativeTime(from: number, now: number) → { unit: "now"|"minutes"|"hours"|"days"|"months"|"years", n: number }
// usage (ui-workspace L1890): unit === "now" ? t("time.now") : t(`time.${unit}`, { n })
// HoverCard — offset ≈662235
HoverCard({ anchor: ReactNode, content: ReactNode, openDelayMs = 500, disabled = false, grouped = false,
            copyText?, copyLabel?, copiedLabel?, variant = "compact" /* |"preview" */, widthAnchorRef?, inline = false })
// MenuItemButton — offset ≈649848
MenuItemButton({ children, shortcut?: {keys, aria}, icon?, current?, disabled = false, danger = false,
                 separatorBefore = false, onSelect })   // role="menuitem"
// Menu — offset ≈650643
Menu({ open, anchor, items = [], children, selectedId, selectedIds, onSelect, onClose, align = "start", side = "bottom",
       portal = false, closeOnPointerLeave = false, dense = false, compact = false, autoFocus = false,
       selection = "check", getAnchorRect, minWidthFromAnchor = false, footer, className, listClassName })
// Icons — e.g. IconPanelLeftOutlineRegular offset ≈566248
Icon*Regular({ size = 16, className })  // <svg width=size height=size viewBox="0 0 16 16" aria-hidden> strokeWidth 1
Icon*Medium({ size = 16, className })   // same, ICON_MEDIUM_STROKE. Only size/className are honored (no prop spread).
```

Modal-layer helpers (offset ≈647400–649100):

```ts
modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'
useModalLayer(ref, open, onClose)  // pushes a document-level layer: autofocus [data-modal-autofocus] or first focusable,
                                   // Escape (top layer only, not defaultPrevented/composing) → onClose, Tab trap, focus restore
closeTopModal(document)            // closes the top useModalLayer entry if it is the last modalSelector match
isBehindModal(element) → boolean   // true when a useModalLayer layer is open and does not contain element
```

### 3.4 `shell.overlay` (frame-wide layer) — alternative mount

Declared by **ui-layout** in its `root` registration (`ui-layout/lib/client.js` L623–653):

```js
ctx.slots.register({ name: "root", locale: "common", children: {
  "sidebar":       { kind: "single", scope: "root" },
  "main":          { kind: "keyed",  scope: "root" },
  "rightbar":      { kind: "single", scope: "root" },
  "shell.bottom":  { kind: "single", scope: "root" },
  "shell.overlay": { kind: "list",   scope: "root" },
  "shell.leading": { kind: "single", scope: "root" } }, store }, AppFrame);
```

Rendered by `AppFrame` (L313, L349–353) as the last frame child:
`<div class="mP3x-q_overlayLayer" data-shell-overlay>{renderSlot("shell.overlay", {})}</div>` with
`.mP3x-q_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}` and
`.mP3x-q_overlayLayer>*{pointer-events:auto}` (CSS L73). The frame is `position:relative;overflow:hidden`.

- Kind **list**, scope **root**; options `id` (required), `order`, `label`; owner props none; props = root
  standard props only (`useSessions`, `useWorkspaces`, `usePanelInfo`, `useSessionStatus`, `useResource`,
  `useRemoteAccess`, `useSessionAccess`, `useWorkspaceAccess`, `useSessionRetainInfo`) + `t`/inject.
  Catalog (`cordis-client-runner` L5481–5539): *"the additive seat for a frame-wide surface of your own … click-through
  — entries opt back into pointer events"*. Shipped occupants are toasts/dialog hosts (quota notice, plugin refresh toast,
  shortcuts reference, rename/archive dialogs …).
- ⚠️ Because of the `display:contents` `data-slot` wrapper (§1.2) the wrapper div is the direct child that gets
  `pointer-events:auto`, and `pointer-events` is inherited — so **your entry must set `pointer-events:none` on any
  full-size wrapper itself and `pointer-events:auto` only on the card.** (Native toasts are small fixed boxes, so they
  don't care.)
- Suitable for the card if it must survive blank/no-session screens, but you must yourself: (a) know the on-screen
  Session (`ctx.uiSession.adapter.current.getSnapshot().key` + `subscribe`, as sidebar-right does at L4927–4932; or
  `ctx.sidebarRight.mounted` observable — "the selected Session while the Conversation fills the main column,
  undefined while a global panel replaces it"), (b) hide when `usePanelInfo(i => i.activePanelId) !== null`,
  (c) find the header via DOM, (d) you get no session-scoped hooks (`useSession`, `useProjection`) unless you
  declare a session child slot and use `SessionProvider`.
- Recommendation: **mount the card from the header toggle entry via `createPortal(…, document.body)`** (native
  pattern; session hooks available; unmounts automatically on blank/no-session/global panels); fall back to
  `shell.overlay` only if the card must exist without the button.

---

## 4. DOM geometry & layering

### 4.1 Stable hooks in the conversation DOM

| Element | Selector / attributes | Source |
|---|---|---|
| Conversation root (main occurrence) | `.an3WzG_root[data-phase="hero"\|"settling"\|"active"]` (flex column; header then body) | `ConversationMainPanel` L17603–17623 |
| Header | `<header class="an3WzG_header [an3WzG_headerBlank] [an3WzG_headerSessionless]" data-window-drag>` | L17964–17977 |
| Leading seat | `[data-conversation-header-leading]` | L17973 |
| Corner seat | `[data-conversation-header-corner]` | L18200 |
| View tabs | `[data-conversation-tabs]` (role=tablist) | L18209 |
| Body (content) | `.an3WzG_body[data-conversation-content][data-conversation-session=<id>][data-conversation-region="chat"][data-content-phase]`, `position:relative` | `ConversationContent` L17929–17944 |
| Transcript scroller | `[data-conversation-scroll]` (`overflow-y:auto; scrollbar-gutter:stable; margin-right:2px`) | L17937 |
| Composer seat | `[data-composer-seat][data-conversation-region="composer"]` (sticky, z-index 7; 9 while trigger menu open) | L17922–17928 |
| Width handles | `[data-width-handle="left\|right"]` | L17534–17544 |
| Slot wrappers | `[data-slot="<slot key>"]` (display:contents) | ui-renderer L1123–1126 |
| Frame / columns | `.mP3x-q_frame[data-sidebar-collapsed][data-rightbar-collapsed][data-rightbar-fullscreen]`, `[data-rightbar-col]`, `[data-shell-overlay]`, `[data-shell-bottom]`, `[data-shell-leading]` | ui-layout L316–358 |
| Embedded conversations | side-branch & others render `conversation.content` with `variant:"embedded"` → `.an3WzG_embeddedBody` also carries `data-conversation-content` → **scope DOM queries to the header's own root** | L17931 |

Anchoring recipe (button lives in the header, so no global query needed):

```js
const header = buttonRef.current?.closest('header');          // the .an3WzG_header of THIS conversation
const r = header.getBoundingClientRect();
// card: position:fixed; top = r.bottom + 8; right edge = r.right - 16   (clears transcript scrollbar ~5px + 2px margin)
// re-measure on: window resize, ResizeObserver(header) (catches sidebar collapse / right-panel push), header remount
```

or reuse `useAnchoredPosition({ open, anchorRef: headerRef, panelRef: cardRef, side: 'bottom', align: 'end', gap: 8, margin: 12 })`
(right edge flush with the center column edge; it does not observe the anchor's size, so also re-render on resize).

### 4.2 CSS variables published by the shell

- `--dsh-conversation-column-width` (px, on the conversation root) and `--dsh-chat-user-width` — set by
  `ConversationWidthControls` (L17551–17570); `--dsh-chat-content-width`, `--dsh-composer-card-max-width`,
  `--dsh-composer-side-clearance:16px` on `.an3WzG_body`; `--dsh-composer-height`, `--dsh-conversation-viewport-height`
  on the scroller (L17823–17834). Width pref persisted in `localStorage["dsh.conversation.contentWidth"]` (L17435).
- ui-layout (CSS L73, README L39–43): `html[data-platform=darwin]{--dsh-frame-top-clearance:48px}`,
  `html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);--dsh-frame-chrome-top:…}`,
  `--dsh-frame-overlay-top: calc(var(--dsh-frame-top-clearance) + 20px)` (20px in `[data-fullscreen]`),
  `--dsh-frame-leading-clearance` (macOS collapsed sidebar), `--dsh-windows-content-radius:16px`,
  `--dsh-windows-sidebar-width`. **Plain browser documents publish none of these.** The header already sits below the
  window chrome (frame `padding-top: var(--dsh-windows-titlebar-height)` on Windows), so measuring the header rect
  needs no extra clearance.
- `--dsh-scrollbar-width` (5px WebKit default), `--dsh-scrollbar-thumb[-hover]` (rebind to `-l2` on elevated surfaces).
- macOS: header is a window-drag row (`data-window-drag`); its controls are `no-drag`. Add
  `-webkit-app-region:no-drag` to the card defensively (dsh-better-sidebar does the same for its body host).

### 4.3 z-index conventions (observed)

| Layer | z-index |
|---|---|
| Conversation tab row | 1 |
| Width handle (idle / dragging) | 0 / 8 |
| Composer seat (sticky) | 7 (9 with trigger menu) |
| Sidebar-right dock layer / fullscreen dock / floating panels | 10 / 40 / 60 (`--dsh-dockkit-*-layer`) |
| AppFrame resize handles | 11 |
| `shell.leading` seat | 15 |
| `shell.overlay` layer | 20 |
| 3rd-party better-sidebar panel host | 25 (panels 40) |
| ui-cordis fixed panel | 30 |
| Non-portal menus (`Menu` list), ui-jobs / ui-schedule / input-trigger popovers, HoverCard, non-portal Tooltip | 100 (submenu 101) |
| Modal root / lightbox backdrop | 1000 |
| Portal menus (`Menu portal`), portal Tooltip, Toast, ContextMeter panel, model-selection menu | 1100 |

Recommendation for a **persistent** pinned card: **z-index ≈ 30** (above conversation & shell.overlay toasts, below
right-panel fullscreen (40)/floats (60), menus, modals). A transient popover may use 100. Don't use 1100 for a pinned
card (it would cover modals). ⚠️ This assumes the app root container is not its own stacking context; verify live.

### 4.4 Escape / outside-click / shortcut-service integration

- Shortcut service DOM adapter (`client-shortcuts/lib/client.js` L1360–1463): listens `window` `keydown` (bubble) and
  computes `context.modal` from the last `modalSelector` match (`data-shortcut-modal` names it). A MutationObserver on
  `role`/`aria-modal` changes resets pending key sequences. Configurable dispatch ignores events with
  `defaultPrevented` (L1283).
- Composer **Esc Esc = stop running turn** (ui-conversation README L117): *"A menu, approval, modal, … breaks the
  sequence."* A `document`-level keydown listener runs before the `window` listener, so closing the card with
  `event.preventDefault()` should keep that Escape out of the stop sequence (⚠️ verify live; fixed observers receive
  `defaultPrevented`, L2546–2557).
- Suggested handling:
  ```js
  useEffect(() => { if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (P.isBehindModal?.(cardRef.current)) return;          // a Modal/menu layer is on top
      if (pinned && !cardRef.current?.contains(document.activeElement)) return;  // pinned: only from inside the card (design choice)
      e.preventDefault(); setOpen(false); buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [open, pinned]);
  P.useDismissOnOutsidePointer(toggleRootRef, open && !pinned, setOpen, cardRef);
  ```
- Use `role="dialog"` **without** `aria-modal` (like ContextMeter) or `role="region"` + `aria-label`. Do **not** use
  `useModalLayer` (focus trap + modal semantics) for a non-modal pinned card.

---

## 5. Theme tokens (ui-theme 0.2.1-rc.3)

Tokens are applied on `document.body` (ui-layout `ThemePresenter`, L503–585: dark palette ⇔
`body[data-ds-dark-theme]`, user font sizes/families as body variables). Anything portaled into `document.body`
inherits them. Values from `ui-theme/lib/client.js` L1407 (`base.css`), L1413 (`design-platform.css`), L1425
(`gradient-shadow-text.css`):

| Token | Light | Dark |
|---|---|---|
| `--dsw-alias-bg-base` | neutral-bluish-00 (#fff) | neutral-bluish-950 |
| `--dsw-alias-bg-layer-1 / -2 / -3` | #fff / #fff / #fff | bluish-875 / -850 / -800 |
| `--dsw-specific-menu` (overlay fill) | `var(--dsw-menu-surface-fill)` = `#f8f9fa94`; macOS `#f8f9faf0` | `#43454a73`; macOS `#303136f0` |
| `--dsw-menu-backdrop-filter` | `blur(40px) saturate(150%)` | same |
| `--dsw-alias-border-l1/l2/l3/l4` | #0000000a / #0000001a / #0000001f / #00000029 | #ffffff0f / #ffffff1f / #ffffff29 / #fff3 |
| `--dsw-alias-label-primary/secondary/tertiary/caption` | bluish-1000 / -700 / -600 / -400 | bluish-50 / -300 / -400 / -600 |
| `--dsw-alias-interactive-bg-hover / -active` | #2631480f / #2631481a | #ffffff14 / #ffffff24 |
| `--dsw-alias-state-business-primary` (accent) | deepseek-500 (#4176e6) | deepseek-400 (#7aaaff) |
| `--dsw-alias-tooltip-bg` | bluish-850 | bluish-750 |
| `--dsw-alias-menu-icon` | bluish-800 | label-primary-dimmed |
| `--dsw-alias-scrollbar-bg-l2` | neutral-200 | neutral-600 |

Elevation (`body, body *` re-declared per element): `--dsw-elevation-stroke: 0 0 0 .5px var(--dsw-elevation-stroke-color)`;
`--dsw-elevation-panel: stroke, 0 3px 8px #00000008, 0 0 16px #00000005`;
`--dsw-elevation-prominent: stroke, 0 3px 8px #0000000a, 0 0 20px #0000000d`;
`--dsw-elevation-soft: stroke, 0 4px 16px #00000008, 0 0 24px #00000008`; default stroke color `--dsw-alias-border-l4`,
`[data-menu-material]` in dark → `border-l3`. README L84: elevated surfaces set `border:0` and rebind
`--dsw-elevation-stroke-color` (menus/panels use `--dsw-alias-border-l1`). README L53: overlays other than
`MenuSurface` paint `--dsw-specific-menu` **and** `backdrop-filter: var(--dsw-menu-backdrop-filter)`.

Radii (`:root`): `--dsw-radius-xs:4px; -sm:8px; -md:12px; -lg:16px; -xl:20px; -panel:28px`.
Fonts: `--dsw-font-family` (text stack, user override first), `--ds-font-family-code`; shorthands
`--dsw-font-xxxs-11`, `--dsw-font-xxs-12` (12px/18px), `--dsw-font-xs-13` (13px/20px), `--dsw-font-s-14` (14px/22px),
`-strong-` variants, `--dsw-font-m-18`, `--dsw-font-l-20`, markdown ladder `--dsw-font-markdown-*`; user content size
`--dsh-content-font-size` (default 14px), secondary `--dsh-content-font-size-secondary`. Motion: `--ds-ease-in-out:
cubic-bezier(.4,0,.2,1)`, `--ds-transition-duration-fast/.1s`, `-:.2s`, `-slow:.3s`. Focus: `--dsw-focus-ring-color`
fallback to business-primary, `--dsw-focus-ring-width:2px`.

**Recommended card CSS** (ContextMeter-style):

```css
.sps-card{position:fixed;z-index:30;box-sizing:border-box;width:min(360px,calc(100vw - 24px));max-height:min(60vh,520px);
  display:flex;flex-direction:column;overflow:hidden;border:0;border-radius:var(--dsw-radius-lg);
  background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);
  --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);
  color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);-webkit-app-region:no-drag}
.sps-card[hidden]{display:none}
.sps-card__header{display:flex;align-items:center;gap:6px;padding:8px 8px 6px 12px;
  border-bottom:.5px solid var(--dsw-alias-border-l2);font:var(--dsw-font-xxs-strong-12);color:var(--dsw-alias-label-secondary)}
.sps-card__body{overflow:auto;padding:10px 12px 12px;color:var(--dsw-alias-label-secondary)}
.sps-iconBtn{width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;
  color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.sps-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.sps-iconBtn[aria-pressed=true]{color:var(--dsw-alias-state-business-primary)}
```

Icons available for pin/close: `IconPinOutlineRegular`, `IconPinFillRegular`, `IconCloseOutlineRegular`,
`IconListPenOutlineRegular`, `IconChecklistOutlineRegular`, `IconSparkleRegular`, `IconFlatListOutlineRegular`.

Native CSS injection pattern (all packages): inside the factory/apply, append
`<style data-plugin="<pkg>" data-plugin-css="<pkg>/<file>.css">` to `document.head` once; the module system removes
owned styles on unload ("evicting unused modules and styles", client-modules README L42). The skill guidance prefers
registering styles in `apply` via `ctx.effect` (or rendering `<style>` as a React element, as side-branch does).

---

## 6. Locale

- Service API (`cordis-client-runner/lib/client.js` L1170–1264; implementation `client-locale/lib/client.js`
  L1387–1428):
  - `ctx.locale.register(ns, { zh: {...}, en: {...} })` → disposer. Throws on duplicate `(ns, locale)`;
    locale ids must be BCP-47-like. At runtime it does **not** enforce key parity (that is a TS-only check).
  - `ctx.locale.register(ns, 'ja', dict)` single-locale form (language packs).
  - `ctx.locale.bind(ns)` → stable `t(key, params?)`; lookup = active locale's fallback chain in `ns`, then in
    `common`, else the key itself; params interpolate `{name}` (regex `/\{(\w+)\}/g`).
  - `ctx.locale.getLocale()` / `getSnapshot()` / `subscribe()`; event `locale/change`.
- Slot registrations take `locale: NS` → component gets `t` bound to `NS` (`ui-renderer` L742–746); copy updates live
  on locale switch (outlets subscribe to the locale revision). `label` options accept `() => string` thunks.
- Pattern (side-branch `lib/client.js` L433–434, ui-jobs L623–626, sidebar-right L4972–4975):
  ```js
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), '<plugin>: locale')
  const t = ctx.locale.bind(NS)                 // for non-React code
  ctx.slots.register({ name: ..., id: ..., locale: NS, ... }, Component)  // Component receives props.t
  ```
- `locale/*.json` files contain **only** `{ "meta": { "title", "description" } }` — read by Plugin Manager/Settings
  without activating the plugin (`cordis-plugin-development/references/host-plugin.md` L31–41). Export
  `"./locale/*.json"` and include `locale/*.json` in `files`. Runtime dictionaries must be registered in code.
- Locale preference itself is Host-persisted (`locale.preference`), not our concern.

---

## 7. Persisting "pinned" state

### 7.1 `@deepseek-ai/dsh-client-store` (baseline module) — recommended

Exports (shell bundle offset ≈484550): `createSnapshotStore`, `defineStore`, `notifySubscribers`, `shallowEqual`.

```ts
createSnapshotStore<T>(init: T, opts?: { persist?: { name: string }, flush?: 'raf' })
  → { getSnapshot(): T, subscribe(fn): () => void, update(recipe: (draft) => void) /* immer */, set(next: T) }
// persist: rehydrates JSON from localStorage[name] at creation, writes the WHOLE state on every change
// (try/catch, console.error on failure). Values are deep-frozen.
defineStore({ init: () => T, persist?: string, actions: { name: (draft, ...args) => void } })
  → handle { spec, create(scopeKey?) → { actions, getSnapshot, subscribe, store, clearPersisted() } }
// persisted key = persist, or `${persist}.${scopeKey}` for session-scoped instances.
// A store handle passed as `store:` in a session-scope registration gets one instance per Session (ui-renderer L1713–1729);
// Factory "exclusive" stores cannot declare persistence (L1741).
```

Usage for the plugin (plugin-lifetime, survives Session switches and reloads):

```js
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const prefs = createSnapshotStore({ pinned: false }, { persist: { name: 'dsh.session-summary.v1' } }) // durable
const ui    = createSnapshotStore({ open: false })                                                     // transient
// pass to slot entries as inject hooks: inject: () => ({ hooks: { summaryPrefs: prefs, summaryUi: ui }, ... })
// → props.useSummaryPrefs(s => s.pinned), props.useSummaryUi(s => s.open)
// visible = prefs.pinned || ui.open ; on Session change (header entry remount) reset ui.open=false unless pinned
```

⚠️ Create these stores inside `apply` (or guard re-creation) so HMR/reload does not leak; module bodies run at
materialization.

localStorage key conventions seen: `dsh.conversation.contentWidth`, `dsh.sidebar-right.v1.<sessionId>`,
`dsh.keybindings.v1`, `dsh.side-branch.recovery.v1` (side-branch). Web: origin-local per browser profile; Desktop:
Electron profile storage. Not shared between browsers.

### 7.2 Host-backed settings (heavier; shared across browsers)

ui-conversation's busy-Enter preference ("Host-backed `ui-conversation` settings namespace"):

- Host half (`ui-conversation/lib/index.js` L1–28): `export const Config = z.object({ busyEnter: schema.volatile() })`
  (schemastery) and `apply(ctx){ ctx.inject(["settings"], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)); }); }`.
- Client half (`ui-conversation/lib/client.js` L15989–16064, L19722): `ctx.configForms.get('ui-conversation')` →
  form with `getSnapshot().value`, `subscribe`, `set(field, value)`, `unset`, `mutate` (ui-settings README L34).
  Client plugin must `inject: ['configForms']` (ui-settings).
- ⚠️ Requires a Host-side Config schema and the `@deepseek-ai/schemastery` dependency in a third-party bundle; entry-id
  semantics for third-party rows not verified. Use only if pinned state must roam across browsers.

---

## 8. Package / module conventions for the new plugin

- Classic-script bundle: `window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => ({ name, inject, apply }) })`
  (side-branch L7–468; skill template `templates/decoration/client.js`). Factory must be side-effect free; register
  effects in `apply`.
- `require()` only baseline modules: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
  `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`
  (anything else → `dsh.client.external`).
- Plugin `inject` (cordis services): minimum `['slots', 'locale']`; add `'uiSession'`/`'layout'` only if used;
  optional services via `ctx.get('sidebarRight')` (undefined-checked).
- `package.json` `dsh.client`: `{ "platform": "web", "inject": [...] }` — `dsh.client.inject` lists **package names**
  and only orders activation (providers before consumers). Suggested:
  `["@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-session",
  "@deepseek-ai/dsh-client-locale"]` (+ `"@deepseek-ai/dsh-client-ui-sidebar-right"` if you touch `ctx.sidebarRight`).
  The skill template also sets `"immediately": true` (⚠️ semantics not documented in the inspected READMEs; shipped
  kernel packages like client-locale/connection use it; ui-jobs/sidebar-right do not).
- Register through `ctx.slots.inject(<declared key>, () => ctx.slots.register(...))` so the entry follows the
  declaration's lifetime (native packages call it directly in `apply`; side-branch wraps it in `ctx.effect` — both work).
- A throwing component blanks only its own entry (`slot entry crashed in '<slot>'`, `data-slot-error`).

### 8.1 Skeleton (untested sketch)

```js
window.__ModuleLoader__.load({
  id: 'dsh-session-summary',
  factory: (require) => {
    const React = require('react'); const h = React.createElement
    const { createPortal } = require('react-dom')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')   // version-pinned; see §3.3 caveat
    const NS = 'session-summary', CARD_ID = 'dsh-session-summary-card'
    const ZH = { 'toggle.tooltip': '会话摘要', 'toggle.aria': '显示会话摘要', 'card.title': '摘要', 'pin': '固定', 'unpin': '取消固定', 'close': '关闭' }
    const EN = { 'toggle.tooltip': 'Session summary', 'toggle.aria': 'Show session summary', 'card.title': 'Summary', 'pin': 'Pin', 'unpin': 'Unpin', 'close': 'Close' }

    function SummaryToggle({ sessionId, useSession, usePrefs, useUi, prefs, ui, t }) {
      const pinned = usePrefs((s) => s.pinned), openUi = useUi((s) => s.open)
      const open = pinned || openUi
      const rootRef = React.useRef(null), btnRef = React.useRef(null), cardRef = React.useRef(null)
      const [pos, setPos] = React.useState(null)
      React.useLayoutEffect(() => {                               // anchor: header bottom-right
        if (!open) return
        const header = btnRef.current?.closest('header'); if (!header) return
        const place = () => { const r = header.getBoundingClientRect(); setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right + 16) }) }
        place(); const ro = new ResizeObserver(place); ro.observe(header); window.addEventListener('resize', place)
        return () => { ro.disconnect(); window.removeEventListener('resize', place) }
      }, [open])
      P.useDismissOnOutsidePointer(rootRef, open && !pinned, (v) => ui.set({ open: v }), cardRef)
      // + Escape effect from §4.4
      const card = open && createPortal(h('section', { id: CARD_ID, ref: cardRef, className: 'sps-card', role: 'dialog',
          'aria-label': t('card.title'), style: pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden', top: 0, right: 0 } },
        /* header: title + pin toggle (prefs.set({pinned:!pinned})) + close; body: summary for sessionId */), document.body)
      return h('span', { ref: rootRef, style: { display: 'inline-flex' } },
        h(P.Tooltip, { label: t('toggle.tooltip'), side: 'bottom', delayMs: 500 },
          h(P.Button, { ref: btnRef, size: 'sm', className: 'sps-headerButton', 'aria-label': t('toggle.aria'),
            'aria-expanded': open, 'aria-controls': open ? CARD_ID : undefined,
            onClick: () => { if (open) { prefs.set({ pinned: false }); ui.set({ open: false }) } else ui.set({ open: true }) } },
            h(P.IconListPenOutlineRegular, {}))), card)
    }

    function apply(ctx) {
      const prefs = createSnapshotStore({ pinned: false }, { persist: { name: 'dsh.session-summary.v1' } })
      const ui = createSnapshotStore({ open: false })
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'session-summary: locale')
      ctx.effect(() => { /* inject <style data-plugin-css> into head; return remover */ }, 'session-summary: styles')
      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities', id: 'session-summary.toggle', order: 100, locale: NS,
        inject: () => ({ hooks: { prefs, ui }, prefs, ui })      // → usePrefs / useUi + raw stores
      }, SummaryToggle)), 'session-summary: header toggle')
    }
    return { name: 'dsh-session-summary', inject: ['slots', 'locale'], apply }
  }
})
```

Notes on the sketch: `Tooltip` clones its child with a merged callback ref that also forwards to the child's own
`ref` (shell offset ≈773410: `const z=y.ref, M=useCallback(W=>{S.current=W; typeof z=="function"?z(W):z!=null&&(z.current=W)})`),
and `Button` is `forwardRef`, so `btnRef` is populated (code-verified, not live-tested). Reset `ui.open` when `sessionId` changes
and not pinned (the entry remounts per Session; an effect on mount can do `if (!prefs.getSnapshot().pinned) ui.set({open:false})`).
When the right panel is fullscreen, a z-30 card is covered by it (z 40) — acceptable.

---

## 9. Open questions / to verify live

1. Whether `.headerUtilities`/`.headerCorner` `:empty` rules ever apply given the `display:contents` slot wrapper.
2. Stacking: body-portaled `z-index:30` vs. frame layers (assumes no stacking context on the React root container).
3. Escape `preventDefault()` really excludes the press from the composer Esc-Esc stop sequence.
4. (resolved in code) Ref forwarding through `Tooltip` → `Button` works; still confirm in the live page.
5. `dsh.client.immediately` meaning; `priority` assignment for dynamic plugins (catalog claims lower priority = shadowing).
6. Whether `ctx.configForms.get(<third-party entry id>)` works for a third-party bundle (only needed for roaming prefs).
