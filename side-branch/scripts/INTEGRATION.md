# Isolated installed-runtime integration harness

The harness runs against the installed Desktop `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.2` packages, using bundled Node `v24.21.0`. It opens no sockets and needs no Web server. It does not load or change the Desktop profile, contact the running GUI, or invoke a model API.

Run from the plugin workspace with Node.js 22 or newer (any system Node, or the bundled one under `~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/`). The command is the same on Windows and macOS:

```sh
node scripts/run-integration.mjs    # or: npm run test:integration
```

The [runner](run-integration.mjs) extracts the required dependency closure directly from the installed Desktop `app.asar`, then runs the integration test files. [extract-test-runtime.mjs](extract-test-runtime.mjs) looks in the usual install locations: on macOS `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` and `~/Applications/…`; on Windows `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`, `%ProgramFiles%\…` and `D:\DeepSeek Harness\…`. Override the archive location with `DSH_TEST_ASAR` if the installed runtime lives elsewhere. Native addons are copied from the same installation's `app.asar.unpacked`, so they always match the current OS and CPU. There are no downloads, global installs, package-manager invocations, dependency scripts, or current-profile reads. The current closure contains 112 packages, approximately 35.9 MiB. Extraction includes package JavaScript, manifests, resource files, and the necessary installed native addon; it does not copy the entire application archive.

The extracted packages live under the ignored `scripts/.runtime/` directory. Each host gets a new UUID directory under the ignored `tests/.integration-data/` directory. Persistence is deliberately retained for failure inspection. Reopen tests reuse only their own UUID directory. The runner sets the child process's `DSH_HOME` to the test data directory as an additional isolation measure.

[offline-test-guard.mjs](offline-test-guard.mjs) fails immediately on socket bind/connect, HTTP(S), fetch, WebSocket, UDP, HTTP/2, or child process execution inside each test worker. The guard itself has an acceptance test. Every LLM request is handled by the in-process `OfflineAdapter`, registered as the sole `offline-test` provider. It records requests and emits deterministic stream chunks. No real provider plugins, credentials, proxy, telemetry, shell executor, server, or Desktop bridge are composed.

## Exact host composition

[integration-host.mjs](../tests/integration-host.mjs) creates a fresh native Cordis `Context`, mounts each package with `ctx.plugin(...)`, awaits activation, and disposes consumers before providers in reverse order. All these services are the installed runtime implementation:

| Services | Configuration |
|---|---|
| TypertRegistry, SessionStore, SessionProjectionRegistry | Defaults |
| JSONL persistence | `root: <test-root>/sessions`, `compression: 'none'` |
| Storage hub, JSON backend, DomainFacility | `root: <test-root>/storage`, `backend: 'json'` |
| WorkspaceRegistry | Workspace rooted at `<test-root>/workspace` |
| SystemPrompt, ToolRuntime | Defaults; no real execution tools registered |
| LlmRuntime | Only `OfflineAdapter` for provider `offline-test` |
| AgentRegistry, AgentLoop, SessionQuery, TurnOutline | Defaults; no declarative agents |
| AgentDefaultModel | `offline-test/global-model`, effort `low` |
| ApprovalService | `policy: 'ask'` |
| SandboxPolicy | `mode: 'workspace-write'`, workspace root confined to test directory |
| PermissionPresetService | Native presets, default `workspace-write` |
| SessionTitle | Fallback 8 words / 200 bytes, maximum 500 bytes |
| SessionController | `nativeOpen: false` |
| Side Branch host plugin | Actual plugin `apply(ctx)` and durable `side_branch` domain |

The unrelated `connection`, `shell`, `fs`, `remoteAccess`, `fileUploads`, and attachment transport services are inert doubles. `shell` advertises a default sandbox mode but cannot execute commands. Therefore these tests prove permission event/projection inheritance, not filesystem sandbox enforcement. Connection collects the real plugin's registered routes but does not serve them; route body validation is exercised by direct `Request` objects. Authentication enforcement itself is not tested.

The installed `dsh-app-boot` entry point is also importable. Its direct-config signature is `boot(binName, absoluteConfigPath, patches, prepare, bareModuleBaseUrl)`: it constructs a Cordis context, installs Loader, runs `prepare`, mounts the config through Include, awaits Loader, then audits startup. Package documentation explicitly permits this helper for lower-level embedders/tests. The harness uses direct service composition instead, because the tested boundary is native services plus the plugin and no launch/profile/environment composition is necessary. Full Desktop profile boot has not been attempted.

## What is exercised

[integration-native.test.mjs](../tests/integration-native.test.mjs) uses real native SessionController creation/fork, AgentLoop execution, V4 JSONL persistence, query observations, projections, permissions, workspace attachment/archive and the plugin service:

- Five-turn source; edit turn two; exact inherited event prefix, original prompt, native parent/cwd, current model and high reasoning, current full-access permission, no global default change.
- Fake-model request includes the retained first turn and revised question, excludes the old second question and later unique secret `ZEBRA-42`.
- Source events remain byte-for-byte equal through creation, child prompts, repeated prompts and archive. Exactly one branch notice is persisted across repeated turns.
- Host disposal and fresh-host replay preserve ready branch metadata; the source stays cold and unchanged; the first resumed child request gets its notice and selected model.
- First-turn edit has no inherited turns and uses a native empty session in the source workspace, immediately before the source in native workspace ordering; closing an unused branch archives it without a model request.
- A transient initialization failure followed by host disposal/recreation retries the same child and request ID, without a second fork; successful retry removes only the plugin's failure archive.
- Native Auto admission is mounted for a regression: a currently custom permission state replaces a historical Auto identity and preserves exact sandbox and approval values.
- The actual WorkingDirectory service preserves the immutable original project header and workspace membership while applying the current nested working directory for both first-turn and later-turn edits.
- A future human prompt queued while the previous source turn is running is cleared only in the new child's inbox. It never reaches the child's fake-model request.
- Creating and archiving a branch while the source is actively running leave the source status and log unchanged.
- Route registration and content type, method, request size and JSON object validation.

The tests exposed two actual installed-runtime behaviors that required plugin fixes: native forks inherit pending inbox items from before the cut; graceful AgentLoop disposal cancels an unsent injected context item. The plugin now clears the child's inherited inbox and supplies the notice through the native pre-step decision, with durable branch metadata and committed-message detection for recovery/idempotence.

## Offline client scope

[integration-client-runtime.mjs](../tests/integration-client-runtime.mjs) reads the installed Web shell and vendor bundle. In memory, it exposes the shell's shared-module table and omits the final application boot invocation. It then evaluates the installed `dsh-client-modules` bundle and constructs the real `ClientModuleSystem` with an empty offline manifest. All loading is from local files; an unexpected URL load fails.

[integration-client.test.mjs](../tests/integration-client.test.mjs) mounts actual browser Cordis, SlotRegistry/renderer and native Conversation with the actual plugin client factory. React is the installed **18.3.1**, not a mocked implementation. It verifies:

- The plugin activates with the real loader and registry, and native capability detection succeeds.
- Sidebar and assistant-action registrations have valid native slot declarations; child conversation scope is `session`.
- An existing sibling tab registration remains present; Side Branch declares multiple retained tabs.
- The actual `conversation.content` factory exists with native composer/bar/dock children and accepts an embedded React element.
- The actual native composer draft engine initializes the full historical prompt, then preserves user edits on repeated initialization.

The offline client supplies small inert transport/session-binding/UI-navigation fixtures. A minimal document supports module initialization and styles only. It does **not** mount React into a real browser DOM, render pixels, perform layout, exercise focus/scroll behavior, restore actual sidebar layout, or answer visible approval/question/plan cards. The test validates the embedded factory contract and native draft behavior; it is not a substitute for later visual acceptance. The installed third-party side-chat plugin is not loaded; coexistence is tested at the shared native keyed-slot boundary.

## Result

The complete guarded runner passed **11 tests, 0 failures**, including installed-runtime host and offline client tests. The last recorded run took approximately 1.1 seconds for test execution, plus local archive extraction. The existing Desktop instance at `http://127.0.0.1:1867` was not contacted or modified by the harness.
