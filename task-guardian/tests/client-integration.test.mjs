import '../../session-summary/scripts/offline-test-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { openArchive } from '../../session-summary/scripts/extract-test-runtime.mjs';
import { offlineGuard } from '../../session-summary/scripts/offline-test-guard.mjs';

const ID = 'dsh-task-guardian', KIND = 'task-guardian', NS = 'taskGuardian';
const NATIVE_GUIDE = '@deepseek-ai/dsh-client-ui-sidebar-right/guide';
const PANEL = 'sidebar.right.pane.tab', GUIDE_ENTRY = 'sidebar.right.tab.guide.entry', GUIDE = 'sidebar.right.tab.guide';
const pluginFile = new URL('../lib/client.js', import.meta.url);

/** Adapt the existing integration-client-runtime without its extraction writes. */
function installedClient() {
  const archive = openArchive();
  try {
    const assets = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets';
    const filename = Object.keys(archive.lookup(assets).files).find(name => /^index-.*\.js$/.test(name));
    assert.ok(filename, 'installed Web shell index bundle');
    let shell = archive.read(`${assets}/${filename}`).toString();
    const vendorImport = shell.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
    assert.ok(vendorImport, 'installed Web shell vendor import changed');
    let vendor = archive.read(`${assets}/${vendorImport[2].slice(2)}`).toString();
    const vendorExport = vendor.match(/export\{([^}]+)\};?/);
    assert.ok(vendorExport, 'installed vendor export table changed');
    vendor = vendor.replace(vendorExport[0], 'globalThis.__vendor={' + vendorExport[1].split(',').map(binding => {
      const [from, to] = binding.split(' as ');
      return `${JSON.stringify(to ?? from)}:${from}`;
    }).join(',') + '};');
    shell = shell.replace(vendorImport[0], vendorImport[1].split(',').map(binding => {
      const [from, to] = binding.split(' as ');
      return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`;
    }).join(''));
    const boundaries = [...shell.matchAll(/const \w+=globalThis\.dshDesktopBoot/g)];
    assert.equal(boundaries.length, 1, 'installed Web shell offline boot boundary changed');
    shell = shell.slice(0, boundaries[0].index).replaceAll('import.meta.url', JSON.stringify('http://offline.invalid/index.js'));
    const sharedTable = shell.match(/function (\w+)\(\)\{return\{react:/)?.[1];
    assert.ok(sharedTable, 'installed shared-module table changed');
    const denied = [];
    const forbid = operation => () => { denied.push(operation); throw new Error(`Offline test forbids ${operation}`); };
    // Environment to evaluate the installed shell before boot, without an app
    // root, browser connection, user DOM, session or mock HTML preview.
    const element = tag => ({ tagName: tag.toUpperCase(), style: {}, dataset: {}, relList: { supports: () => true },
      setAttribute() {}, appendChild() {}, append() {}, prepend() {}, remove() {}, addEventListener() {}, removeEventListener() {} });
    const context = vm.createContext({ console, URL, URLSearchParams, AbortController, AbortSignal, TextEncoder, TextDecoder,
      Request, Response, Headers, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      performance, structuredClone,
      document: { compatMode: 'CSS1Compat', createElement: element, addEventListener() {}, removeEventListener() {},
        querySelector: () => null, getElementById: () => null, querySelectorAll: () => [], body: element('body'), head: element('head') },
      navigator: { userAgent: 'DSH isolated Task Guardian API test' }, location: { href: 'http://offline.invalid/', protocol: 'http:' },
      addEventListener() {}, removeEventListener() {}, fetch: forbid('fetch'),
      WebSocket: class { constructor() { forbid('WebSocket')(); } },
    });
    context.window = context; context.self = context;
    vm.runInContext(`(function(){${vendor}\n})();`, context, { filename: 'installed-vendor.js', timeout: 10000 });
    vm.runInContext(`${shell}\nglobalThis.__testStatic=${sharedTable}();`, context, { filename, timeout: 10000 });
    const staticModules = context.__testStatic;
    // Native CSS/focus observers are irrelevant. Any plugin DOM access now fails.
    context.document = undefined;
    let bootstrap;
    context.__ModuleLoader__ = { load: registration => { bootstrap = registration; } };
    const bootstrapFile = 'dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js';
    vm.runInContext(archive.read(bootstrapFile).toString(), context, { filename: bootstrapFile, timeout: 10000 });
    const bootstrapExports = bootstrap.factory(forbid('bootstrap external require'));
    const facade = { mode: 'queue', pendingQueue: [] };
    const version = JSON.parse(archive.read('dsh/package.json')).version;
    const modules = bootstrapExports.createClientModuleSystem(facade, { id: bootstrap.id, exports: bootstrapExports }, {
      boot: { rev: 'offline-task-guardian-test', release: { version }, entries: [], batches: [] },
      staticModules, loadBundle: forbid('bundle URL load'),
    });
    context.__ModuleLoader__ = facade;
    const registered = new Set();
    function registerInstalled(specifier) {
      if (Object.hasOwn(staticModules, specifier)) return;
      const name = specifier.endsWith('/client') ? specifier.slice(0, -7) : specifier;
      if (registered.has(name) || name === bootstrap.id) return;
      const file = `dsh/node_modules/${name}/lib/client.js`;
      let registration;
      context.__ModuleLoader__ = { load: value => { registration = value; } };
      try { vm.runInContext(archive.read(file).toString(), context, { filename: file, timeout: 10000 }); }
      finally { context.__ModuleLoader__ = facade; }
      assert.equal(registration?.id, name, `installed bundle identity for ${specifier}`);
      registered.add(name);
      // Recursively arrange factory arrival; the real module system owns
      // require(), memoization and edges. Native exports are not substituted.
      facade.load({ ...registration, factory: require => {
        const recursiveRequire = dependency => { registerInstalled(dependency); return require(dependency); };
        recursiveRequire.async = require.async;
        return registration.factory(recursiveRequire);
      } });
    }
    async function importInstalled(name) { registerInstalled(name); return modules.import(name); }
    function registerPlugin() {
      vm.runInContext(fs.readFileSync(pluginFile, 'utf8'), context, { filename: pluginFile.pathname, timeout: 10000 });
    }
    return { archive, context, staticModules, modules, importInstalled, registerPlugin, denied, version };
  } catch (error) { archive.close(); throw error; }
}

function observable(value, subscriptions) {
  const listeners = new Set(); subscriptions.push(listeners);
  return { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

async function fixture() {
  const client = installedClient();
  const { Context } = client.staticModules['@deepseek-ai/cordis'];
  const ctx = new Context(), diagnostics = [], dictionaries = new Map(), subscriptions = [], shortcuts = new Map(), forbiddenCalls = [];
  let language = 'en', revision = 0, copySnapshot = { language, revision };
  const localeListeners = new Set();
  const forbid = operation => () => { forbiddenCalls.push(operation); throw new Error(`Registration cannot ${operation}`); };
  ctx.logger.exporter({ export: entry => { if (entry.type === 'error') diagnostics.push(entry.args); } });
  async function mount(name) {
    const plugin = await client.importInstalled(name), fiber = ctx.plugin(plugin);
    await fiber.await();
    assert.equal(fiber.state, 2, `${name}: ${String(fiber._error)} ${JSON.stringify(diagnostics)}`);
    return fiber;
  }
  function declareShell() {
    return ctx.slots.register({ name: 'root', children: {
      rightbar: { kind: 'single', scope: 'root' }, main: { kind: 'keyed', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' }, 'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    } }, () => null);
  }
  try {
    await mount('@deepseek-ai/dsh-client-ui-renderer');
    ctx.provide('locale', {
      register(namespace, value) {
        assert.equal(dictionaries.has(namespace), false, `duplicate locale ${namespace}`);
        dictionaries.set(namespace, value); return () => dictionaries.delete(namespace);
      },
      bind: namespace => key => dictionaries.get(namespace)?.[language]?.[key] ?? key,
      getSnapshot: () => copySnapshot,
      subscribe(listener) { localeListeners.add(listener); return () => localeListeners.delete(listener); },
    });
    ctx.provide('layout', { panelInfo: observable({ activePanelId: null }, subscriptions), openRightbar: forbid('open rightbar'), closeRightbar: forbid('close rightbar') });
    ctx.provide('sessions', { sessionOf: () => undefined, binding: () => undefined, scope: () => undefined,
      retain: forbid('retain user session'), refresh: forbid('refresh sessions') });
    ctx.provide('uiSession', { adapter: { current: observable({ key: undefined }, subscriptions) }, provide: () => () => {} });
    ctx.provide('uiWorkspace', { openSession: forbid('navigate user session') });
    ctx.provide('fileUpload', {}); ctx.provide('resources', { pin: forbid('pin resource') });
    const registerShortcut = definition => {
      assert.equal(shortcuts.has(definition.id), false);
      shortcuts.set(definition.id, definition);
      return () => shortcuts.delete(definition.id);
    };
    const fixedInputs = new Set(); subscriptions.push(fixedInputs);
    ctx.provide('shortcuts', { catalog: observable([], subscriptions), closeWindow: forbid('close window'), stopSequenceMs: 500,
      register: registerShortcut, registerFixed: registerShortcut,
      describeBinding: binding => ({ keys: [...binding.modifiers, binding.code] }),
      observeFixedInput(listener) { fixedInputs.add(listener); return () => fixedInputs.delete(listener); } });
    ctx.provide('configForms', { get: () => undefined, developerTools: { enabled: observable(false, subscriptions) } });
    ctx.provide('connection', {});
    let releaseShell = declareShell();
    await mount('@deepseek-ai/dsh-client-ui-conversation');
    await mount('@deepseek-ai/dsh-client-ui-sidebar-right');
    return { ...client, ctx, dictionaries, diagnostics, subscriptions, shortcuts, forbiddenCalls, localeListeners,
      setLanguage(next) { language = next; revision++; copySnapshot = { language, revision }; for (const listener of localeListeners) listener(); },
      collapseShell() { releaseShell(); }, restoreShell() { releaseShell = declareShell(); },
      async close() { try { await ctx.fiber.dispose(); } finally { client.archive.close(); } },
    };
  } catch (error) { await ctx.fiber.dispose(); client.archive.close(); throw error; }
}

const occupants = (ctx, name) => [...ctx.slots.entries(name)];

function assertBilingualKeys(plugin) {
  const keys = Object.keys(plugin.ZH).sort();
  assert.deepEqual(keys, Object.keys(plugin.EN).sort());
  assert.ok(keys.length > 40, 'a real dictionary rather than an empty key set');
  for (const key of keys) for (const [language, dictionary] of [['zh', plugin.ZH], ['en', plugin.EN]]) {
    assert.equal(typeof dictionary[key], 'string', `${language}.${key}`);
    assert.ok(dictionary[key].trim(), `${language}.${key} cannot be empty`);
  }
}

test('real installed modules keep Guardian separate from native guide and clean all registrations on unload', async t => {
  const f = await fixture(), { ctx } = f;
  try {
    t.diagnostic(`Installed DSH ${f.version}; bundled React ${f.staticModules.react.version}; no live GUI/session/network`);
    assert.equal(f.modules.constructor.name, 'ClientModuleSystem');
    const nativeGuideType = ctx.sidebarRightTabs.get('guide');
    const nativePanelEntries = occupants(ctx, PANEL);
    const nativeGuideEntry = nativePanelEntries.find(entry => entry.options.key === NATIVE_GUIDE);
    const nativeTitleEntries = occupants(ctx, 'sidebar.right.pane.tab.title');
    const nativeChainEntries = occupants(ctx, GUIDE), nativeCards = occupants(ctx, GUIDE_ENTRY);
    const nativeTypes = [...ctx.sidebarRightTabs.entries()];
    const nativeDictionaries = [...f.dictionaries.keys()].sort(), nativeShortcuts = [...f.shortcuts.keys()].sort();
    assert.equal(nativeGuideType.id, NATIVE_GUIDE); assert.equal(nativeGuideType.priority, 'builtin');
    assert.ok(nativeGuideEntry, 'native sidebar must own the guide declaration');
    for (const name of [PANEL, GUIDE_ENTRY]) {
      assert.equal(ctx.slots.spec(name).kind, 'keyed'); assert.equal(ctx.slots.spec(name).scope, 'session');
      assert.equal(typeof ctx.slots.spec(name).inject.hooks.tabInfo, 'function');
    }
    assert.equal(ctx.slots.spec(GUIDE).kind, 'chain');
    const changes = [];
    const unsubscribe = ctx.sidebarRightTabs.subscribe(() => changes.push(ctx.sidebarRightTabs.entries().map(entry => entry.id)));
    try {
      f.registerPlugin();
      const plugin = await f.modules.import(ID);
      assert.deepEqual([...f.modules.loadCache.get(ID).edges], ['react'], 'plugin only requires shell React');
      assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'sidebarRightTabs']);
      assertBilingualKeys(plugin);
      const fiber = ctx.plugin(plugin); await fiber.await();
      assert.equal(fiber.state, 2, String(fiber._error));
      const guardian = ctx.sidebarRightTabs.get(KIND);
      assert.equal(guardian.id, ID); assert.equal(guardian.title(), plugin.EN.title);
      assert.equal(ctx.sidebarRightTabs.get('guide'), nativeGuideType, 'native guide is not taken over');
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], [...nativeTypes, guardian]);
      const cards = ctx.sidebarRightTabs.guide().filter(entry => entry.providerId === ID);
      assert.equal(cards.length, 1); assert.equal(cards[0].id, KIND); assert.equal(cards[0].kind, KIND);
      assert.equal(cards[0].title(), plugin.EN.title); assert.equal(cards[0].description(), plugin.EN.description);
      assert.equal(cards[0].icon, plugin.Shield); assert.equal(cards[0].order, 100);
      const panelEntries = occupants(ctx, PANEL), panel = panelEntries.find(entry => entry.options.key === ID);
      const guide = occupants(ctx, GUIDE_ENTRY).find(entry => entry.options.key === ID);
      assert.deepEqual(panelEntries, [...nativePanelEntries, panel]);
      assert.deepEqual(occupants(ctx, GUIDE_ENTRY), [...nativeCards, guide]);
      assert.equal(panel.component, plugin.GuardianPanel); assert.equal(guide.component, plugin.GuardianGuide);
      assert.equal(panel.locale, NS); assert.equal(guide.locale, NS);
      assert.equal(typeof panel.inject().api, 'function'); assert.equal(typeof guide.inject().api, 'function');
      assert.equal(occupants(ctx, PANEL).find(entry => entry.options.key === NATIVE_GUIDE), nativeGuideEntry);
      assert.deepEqual(occupants(ctx, GUIDE), nativeChainEntries, 'whole-guide replacement chain stays untouched');
      assert.deepEqual(occupants(ctx, 'sidebar.right.pane.tab.title'), nativeTitleEntries);
      assert.equal(f.dictionaries.get(NS).zh, plugin.ZH); assert.equal(f.dictionaries.get(NS).en, plugin.EN);
      f.setLanguage('zh'); assert.equal(guardian.title(), plugin.ZH.title); assert.equal(cards[0].description(), plugin.ZH.description);
      f.setLanguage('en');
      const claim = ctx.sidebarRightTabs.claim('sidebar://task-guardian', KIND);
      assert.equal(claim.kind, KIND); assert.equal(claim.title, plugin.EN.title); assert.equal(claim.contentId, 'sidebar://task-guardian');
      // Check the actual native contextual hook forwarding and the guide action.
      const ownerHook = () => ({ tab: { actions: { openTab() {} } } });
      assert.equal(ctx.slots.spec(GUIDE_ENTRY).inject.hooks.tabInfo({}, ownerHook), ownerHook);
      const opened = [];
      const element = plugin.GuardianGuide({ sessionId: 'synthetic-api-only', api: guide.inject().api, t: key => plugin.EN[key],
        useTabInfo: () => ({ tab: { actions: { openTab: (...args) => opened.push(args) } } }) });
      assert.ok(f.staticModules.react.isValidElement(element)); assert.equal(element.props.compact, true);
      element.props.open(); assert.equal(opened.length, 1); assert.equal(opened[0][0], KIND); assert.equal(opened[0][1].replaceTab, true);
      // Collapse the real owner's declarations, then ensure inject remounts once.
      f.collapseShell();
      assert.equal(ctx.slots.spec(PANEL), undefined); assert.equal(ctx.slots.spec(GUIDE_ENTRY), undefined);
      assert.equal(ctx.sidebarRightTabs.get(KIND), guardian);
      f.restoreShell();
      assert.equal(occupants(ctx, PANEL).filter(entry => entry.options.key === ID).length, 1);
      assert.equal(occupants(ctx, GUIDE_ENTRY).filter(entry => entry.options.key === ID).length, 1);
      assert.equal(occupants(ctx, PANEL).filter(entry => entry.options.key === NATIVE_GUIDE).length, 1);
      assert.equal(occupants(ctx, GUIDE).length, nativeChainEntries.length);
      await fiber.dispose();
      assert.equal(ctx.sidebarRightTabs.get(KIND), undefined); assert.equal(ctx.sidebarRightTabs.get('guide'), nativeGuideType);
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], nativeTypes);
      assert.equal(ctx.sidebarRightTabs.guide().some(entry => entry.providerId === ID), false);
      assert.equal(occupants(ctx, PANEL).some(entry => entry.options.key === ID), false);
      assert.equal(occupants(ctx, GUIDE_ENTRY).some(entry => entry.options.key === ID), false);
      assert.equal(occupants(ctx, PANEL).find(entry => entry.options.key === NATIVE_GUIDE)?.component, nativeGuideEntry.component);
      assert.deepEqual([...f.dictionaries.keys()].sort(), nativeDictionaries); assert.deepEqual([...f.shortcuts.keys()].sort(), nativeShortcuts);
      assert.equal(changes.length, 2, 'one registration and one deregistration notification');
      f.collapseShell(); f.restoreShell();
      assert.equal(occupants(ctx, PANEL).some(entry => entry.options.key === ID), false, 'no orphan panel inject callback');
      assert.equal(occupants(ctx, GUIDE_ENTRY).some(entry => entry.options.key === ID), false, 'no orphan guide inject callback');
      assert.equal(f.context.document, undefined);
      assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
    } finally { unsubscribe(); }
  } finally { await f.close(); }
  assert.equal(f.dictionaries.size, 0); assert.equal(f.shortcuts.size, 0); assert.equal(f.localeListeners.size, 0);
  assert.ok(f.subscriptions.every(listeners => listeners.size === 0), 'root unload releases observable subscriptions');
  assert.deepEqual(offlineGuard.denied, []);
});

test('injected API preserves transport binding without a network request', async () => {
  const f = await fixture();
  try {
    const calls = [];
    const transport = { async fetch(url, options) {
      assert.equal(this, transport, 'transport.fetch retains its receiver'); calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, sessionId: 'synthetic-api-only' }) };
    } };
    f.context.__DSH_TRANSPORT__ = transport; f.registerPlugin();
    const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin); await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    const panel = occupants(f.ctx, PANEL).find(entry => entry.options.key === ID);
    const guide = occupants(f.ctx, GUIDE_ENTRY).find(entry => entry.options.key === ID), controller = new AbortController();
    const result = await panel.inject().api('snapshot', { sessionId: 'synthetic-api-only' }, controller.signal);
    assert.equal(result.sessionId, 'synthetic-api-only'); assert.equal(guide.inject().api, panel.inject().api); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/task-guardian/snapshot'); assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].options.body), { sessionId: 'synthetic-api-only' }); assert.equal(calls[0].options.signal, controller.signal);
    await assert.rejects(plugin.requestJSON(async () => ({ ok: false, json: async () => ({ ok: false, error: 'settings_changed_reload' }) }),
      'configure', {}, controller.signal), error => error.code === 'settings_changed_reload');
    await fiber.dispose();
    assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
  } finally { await f.close(); }
  assert.deepEqual(offlineGuard.denied, []);
});

test('root context unload cleans a still-active Guardian and all native service registrations', async () => {
  const f = await fixture();
  const tabs = f.ctx.sidebarRightTabs, slots = f.ctx.slots;
  try {
    f.registerPlugin();
    const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin);
    await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    assert.equal(tabs.get(KIND).id, ID);
    assert.equal(f.dictionaries.has(NS), true);
    assert.equal(occupants(f.ctx, PANEL).some(entry => entry.options.key === ID), true);
    assert.equal(occupants(f.ctx, GUIDE_ENTRY).some(entry => entry.options.key === ID), true);
  } finally { await f.close(); }
  assert.equal(tabs.entries().length, 0);
  assert.equal(tabs.guide().length, 0);
  for (const name of ['root', PANEL, GUIDE_ENTRY, GUIDE]) {
    assert.equal([...slots.entries(name)].length, 0, `root disposal removes ${name} registrations`);
  }
  assert.equal(f.dictionaries.size, 0); assert.equal(f.shortcuts.size, 0); assert.equal(f.localeListeners.size, 0);
  assert.ok(f.subscriptions.every(listeners => listeners.size === 0));
  assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
  assert.deepEqual(offlineGuard.denied, []);
});

/**
 * Deterministic Hook scheduler, separate from the native API tests above.
 * Export useGuardian from a VM-only copy; execute its actual current body with
 * deferred API promises, React-like state/ref/effect lifetimes and fake timers.
 * This is a concurrency regression test, not a React renderer or HTML preview.
 */
function guardianHookHarness() {
  const cells = [], effects = [], timers = new Map(), calls = [], postUnmountWrites = [];
  let cursor = 0, nextTimer = 0, mounted = true, dirty = true, sessionId, current;
  const dependenciesEqual = (left, right) => left !== undefined && right !== undefined
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const api = (action, payload, signal) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ action, payload, signal, promise, resolve, reject });
    return promise;
  };
  const React = {
    createElement() { throw new Error('Hook-only test must not create DOM or preview elements'); },
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], next => {
        if (!mounted) { postUnmountWrites.push(index); return; }
        const value = typeof next === 'function' ? next(cells[index]) : next;
        if (!Object.is(cells[index], value)) { cells[index] = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!dependenciesEqual(cells[index]?.dependencies, dependencies)) cells[index] = { callback, dependencies };
      return cells[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (dependenciesEqual(cells[index]?.dependencies, dependencies)) return;
      const previous = cells[index];
      cells[index] = { dependencies, cleanup: undefined };
      effects.push(() => { previous?.cleanup?.(); cells[index].cleanup = callback(); });
    },
  };
  const schedule = (kind, callback, delay) => {
    const id = ++nextTimer; timers.set(id, { kind, callback, delay }); return id;
  };
  let registration;
  const source = fs.readFileSync(pluginFile, 'utf8');
  const marker = 'return { apply, inject, GuardianPanel,';
  assert.equal(source.split(marker).length, 2, 'VM-only Hook export marker changed');
  vm.runInNewContext(source.replace(marker, 'return { useGuardian, apply, inject, GuardianPanel,'), {
    window: { __ModuleLoader__: { load: value => { registration = value; } } }, AbortController,
    setTimeout: (callback, delay) => schedule('timeout', callback, delay), clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => schedule('interval', callback, delay), clearInterval: id => timers.delete(id),
  }, { filename: 'task-guardian-hook-test-copy.js', timeout: 10000 });
  const { useGuardian } = registration.factory(name => { assert.equal(name, 'react'); return React; });
  function render(nextSessionId = sessionId) {
    assert.equal(mounted, true, 'cannot render an unmounted Hook');
    if (nextSessionId !== sessionId) { sessionId = nextSessionId; dirty = true; }
    let renders = 0;
    while (dirty) {
      assert.ok(++renders < 20, 'Hook scheduler must settle');
      dirty = false; cursor = 0; current = useGuardian(sessionId, api);
      for (const effect of effects.splice(0)) effect();
    }
    return current;
  }
  return {
    calls, timers, postUnmountWrites, render,
    get current() { return render(); },
    async settle() {
      // Drain both VM and host Promise continuations at one event-loop turn;
      // application clocks and polling remain entirely under fake-timer control.
      await new Promise(resolve => setImmediate(resolve));
      if (mounted) render();
    },
    firePoll() {
      const pending = [...timers].find(([, timer]) => timer.kind === 'timeout' && timer.delay === 5000);
      assert.ok(pending, 'the effect scheduled the next native polling interval');
      timers.delete(pending[0]);
      return pending[1].callback();
    },
    unmount() {
      if (!mounted) return;
      for (const cell of cells) if (typeof cell?.cleanup === 'function') cell.cleanup();
      mounted = false;
    },
  };
}

function guardianSnapshot(sessionId, { enabled = false, epoch = 0, revision = 0 } = {}) {
  return { ok: true, sessionId, serverNow: 1000,
    record: { epoch, revision, settings: { enabled, recoverAfterRestart: false, autoSelectFirst: false } } };
}

test('a delayed old poll and lower-revision snapshots cannot undo a successful configure', async () => {
  const hook = guardianHookHarness();
  try {
    assert.equal(hook.render('session-a').value, null);
    assert.equal(hook.calls.length, 1);
    hook.calls[0].resolve(guardianSnapshot('session-a'));
    await hook.settle();
    assert.equal(hook.current.value.record.settings.enabled, false);
    assert.equal(hook.current.value.record.epoch, 0);
    const oldPoll = hook.firePoll();
    const oldRead = hook.calls[1];
    assert.equal(oldRead.action, 'snapshot');
    const configure = hook.current.change('enabled', true);
    const mutation = hook.calls[2];
    assert.equal(mutation.action, 'configure');
    assert.equal(mutation.payload.epoch, 0);
    assert.equal(mutation.payload.settings.enabled, true);
    assert.equal(hook.current.busy, true);
    await hook.current.load();
    await hook.current.change('enabled', false);
    assert.equal(hook.calls.length, 3, 'reads and duplicate mutations are suppressed during configure');
    mutation.resolve(guardianSnapshot('session-a', { enabled: true, epoch: 1, revision: 2 }));
    await configure; await hook.settle();
    assert.equal(hook.current.busy, false);
    assert.equal(hook.current.value.record.settings.enabled, true);
    assert.equal(hook.current.value.record.epoch, 1);
    oldRead.resolve(guardianSnapshot('session-a', { enabled: false, epoch: 0, revision: 0 }));
    await oldPoll; await hook.settle();
    assert.equal(hook.current.value.record.settings.enabled, true, 'pending pre-configure poll cannot revert the switch');
    assert.equal(hook.current.value.record.epoch, 1, 'pending pre-configure poll cannot revert the epoch');
    assert.equal(hook.current.value.record.revision, 2);
    const lowerRevision = hook.current.load();
    hook.calls[3].resolve(guardianSnapshot('session-a', { enabled: false, epoch: 0, revision: 1 }));
    await lowerRevision; await hook.settle();
    assert.equal(hook.current.value.record.settings.enabled, true, 'even a new request cannot publish an older server revision');
    assert.equal(hook.current.value.record.revision, 2);
    const freshRead = hook.current.load();
    hook.calls[4].resolve(guardianSnapshot('session-a', { enabled: false, epoch: 2, revision: 3 }));
    await freshRead; await hook.settle();
    assert.equal(hook.current.value.record.settings.enabled, false, 'a genuinely newer server state is still accepted');
    assert.equal(hook.current.value.record.epoch, 2);
    assert.equal(hook.current.value.record.revision, 3);
    assert.equal(hook.current.error, null);
  } finally { hook.unmount(); }
  assert.equal(hook.timers.size, 0);
  assert.deepEqual(hook.postUnmountWrites, []);
});

test('effect cleanup fences pending old-session snapshots, configure responses and unmount callbacks', async () => {
  const hook = guardianHookHarness();
  try {
    hook.render('session-a');
    hook.calls[0].resolve(guardianSnapshot('session-a'));
    await hook.settle();
    const oldRead = hook.current.load(), pendingRead = hook.calls[1];
    const oldChange = hook.current.change('enabled', true), pendingChange = hook.calls[2];
    assert.equal(hook.current.busy, true);
    hook.render('session-b');
    assert.equal(pendingRead.signal.aborted, true);
    assert.equal(pendingChange.signal.aborted, true);
    assert.equal(hook.current.value, null);
    assert.equal(hook.current.busy, false);
    const sessionBRead = hook.calls[3];
    assert.equal(sessionBRead.payload.sessionId, 'session-b');
    sessionBRead.resolve(guardianSnapshot('session-b', { enabled: true, epoch: 4, revision: 40 }));
    await hook.settle();
    pendingRead.resolve(guardianSnapshot('session-a', { enabled: false, epoch: 10, revision: 100 }));
    await oldRead; await hook.settle();
    pendingChange.resolve(guardianSnapshot('session-a', { enabled: false, epoch: 11, revision: 101 }));
    await oldChange; await hook.settle();
    assert.equal(hook.current.value.sessionId, 'session-b');
    assert.equal(hook.current.value.record.settings.enabled, true);
    assert.equal(hook.current.value.record.epoch, 4);
    assert.equal(hook.current.value.record.revision, 40);
    assert.equal(hook.current.busy, false);
    assert.equal(hook.current.error, null);
    const afterUnmount = hook.current.load(), pendingUnmount = hook.calls[4];
    hook.unmount();
    assert.equal(pendingUnmount.signal.aborted, true);
    assert.equal(hook.timers.size, 0, 'cleanup clears the polling timeout and clock interval');
    pendingUnmount.resolve(guardianSnapshot('session-b', { enabled: false, epoch: 5, revision: 41 }));
    await afterUnmount; await hook.settle();
    assert.deepEqual(hook.postUnmountWrites, [], 'late requests perform no state writes after cleanup');
  } finally { hook.unmount(); }
});
