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
const ACCESSORY = 'capability-selector.accessories', ACCESSORY_OWNER = 'test-capability-selector-owner';
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
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setSnapshot(next, notify = true) { value = next; if (notify) for (const listener of listeners) listener(); },
  };
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
    const currentSession = observable({ key: undefined }, subscriptions);
    ctx.provide('uiSession', { current: currentSession, adapter: { current: currentSession }, provide: () => () => {} });
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
    let releaseAccessoryOwner;
    const mountAccessoryOwner = () => {
      assert.equal(releaseAccessoryOwner, undefined, 'accessory fixture owner is mounted once');
      releaseAccessoryOwner = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: ACCESSORY_OWNER,
        children: { [ACCESSORY]: { kind: 'list', scope: 'root' } },
      }, () => null));
    };
    const unmountAccessoryOwner = () => { releaseAccessoryOwner?.(); releaseAccessoryOwner = undefined; };
    return { ...client, ctx, dictionaries, diagnostics, subscriptions, shortcuts, forbiddenCalls, localeListeners,
      setLanguage(next) { language = next; revision++; copySnapshot = { language, revision }; for (const listener of localeListeners) listener(); },
      // Change the source snapshot for the API guard without publishing a native
      // Session selection: this fixture never retains or renders a user Session.
      setCurrent(sessionId) { currentSession.setSnapshot({ key: sessionId }, false); },
      mountAccessoryOwner, unmountAccessoryOwner,
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

test('real installed modules mount Guardian only under its accessory owner and preserve the native guide', async t => {
  const f = await fixture(), { ctx } = f;
  try {
    t.diagnostic(`Installed DSH ${f.version}; bundled React ${f.staticModules.react.version}; no live GUI/session/network`);
    assert.equal(f.modules.constructor.name, 'ClientModuleSystem');
    const nativeGuideType = ctx.sidebarRightTabs.get('guide');
    const nativePanelEntries = occupants(ctx, PANEL);
    const nativeGuideEntry = nativePanelEntries.find(entry => entry.options.key === NATIVE_GUIDE);
    const nativeTitleEntries = occupants(ctx, 'sidebar.right.pane.tab.title');
    const nativeChainEntries = occupants(ctx, GUIDE), nativeCards = occupants(ctx, GUIDE_ENTRY);
    const nativeTypes = [...ctx.sidebarRightTabs.entries()], nativeGuideCards = [...ctx.sidebarRightTabs.guide()];
    const nativeDictionaries = [...f.dictionaries.keys()].sort(), nativeShortcuts = [...f.shortcuts.keys()].sort();
    assert.equal(nativeGuideType.id, NATIVE_GUIDE); assert.equal(nativeGuideType.priority, 'builtin');
    assert.ok(nativeGuideEntry, 'native sidebar must own the guide declaration');
    for (const name of [PANEL, GUIDE_ENTRY]) {
      assert.equal(ctx.slots.spec(name).kind, 'keyed'); assert.equal(ctx.slots.spec(name).scope, 'session');
      assert.equal(typeof ctx.slots.spec(name).inject.hooks.tabInfo, 'function');
    }
    assert.equal(ctx.slots.spec(GUIDE).kind, 'chain');
    assert.equal(ctx.slots.spec(ACCESSORY), undefined, 'custom accessory slot belongs to its companion owner');
    const changes = [];
    const unsubscribe = ctx.sidebarRightTabs.subscribe(() => changes.push(ctx.sidebarRightTabs.entries().map(entry => entry.id)));
    try {
      f.registerPlugin();
      const plugin = await f.modules.import(ID);
      assert.deepEqual([...f.modules.loadCache.get(ID).edges], ['react'], 'plugin only requires shell React');
      assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'uiSession']);
      assertBilingualKeys(plugin);
      assert.equal(plugin.GuardianGuide, undefined, 'the former guide card implementation is absent');
      const fiber = ctx.plugin(plugin); await fiber.await();
      assert.equal(fiber.state, 2, String(fiber._error));
      const guardian = ctx.sidebarRightTabs.get(KIND);
      assert.equal(guardian.id, ID); assert.equal(guardian.title(), plugin.EN.title);
      assert.equal(guardian.guide, undefined, 'the detail page contributes no Start-page guide card');
      assert.equal(ctx.sidebarRightTabs.get('guide'), nativeGuideType, 'native guide is not taken over');
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], [...nativeTypes, guardian]);
      assert.deepEqual([...ctx.sidebarRightTabs.guide()], nativeGuideCards, 'native Start-page cards remain unchanged');
      assert.equal(ctx.sidebarRightTabs.guide().some(entry => entry.providerId === ID), false);
      const panelEntries = occupants(ctx, PANEL), panel = panelEntries.find(entry => entry.options.key === ID);
      assert.ok(panel); assert.deepEqual(panelEntries, [...nativePanelEntries, panel]);
      assert.equal(panel.component, plugin.GuardianPanel); assert.equal(panel.locale, NS);
      assert.equal(typeof panel.inject().api, 'function');
      assert.deepEqual(occupants(ctx, GUIDE_ENTRY), nativeCards, 'no Guardian registration in the native guide entry slot');
      assert.equal(occupants(ctx, ACCESSORY).length, 0, 'accessory waits for its companion owner');
      assert.equal(occupants(ctx, PANEL).find(entry => entry.options.key === NATIVE_GUIDE), nativeGuideEntry);
      assert.deepEqual(occupants(ctx, GUIDE), nativeChainEntries, 'whole-guide replacement chain stays untouched');
      assert.deepEqual(occupants(ctx, 'sidebar.right.pane.tab.title'), nativeTitleEntries);
      assert.equal(f.dictionaries.get(NS).zh, plugin.ZH); assert.equal(f.dictionaries.get(NS).en, plugin.EN);
      f.setLanguage('zh'); assert.equal(guardian.title(), plugin.ZH.title); f.setLanguage('en');
      const claim = ctx.sidebarRightTabs.claim('sidebar://task-guardian', KIND);
      assert.equal(claim.kind, KIND); assert.equal(claim.title, plugin.EN.title); assert.equal(claim.contentId, 'sidebar://task-guardian');

      f.mountAccessoryOwner();
      assert.equal(ctx.slots.spec(ACCESSORY).kind, 'list'); assert.equal(ctx.slots.spec(ACCESSORY).scope, 'root');
      assert.equal(occupants(ctx, 'shell.overlay').filter(entry => entry.options.id === ACCESSORY_OWNER).length, 1);
      let accessory = occupants(ctx, ACCESSORY).find(entry => entry.options.id === ID);
      assert.ok(accessory); assert.equal(occupants(ctx, ACCESSORY).length, 1);
      assert.equal(accessory.component, plugin.GuardianAccessory); assert.equal(accessory.locale, NS);
      assert.equal(accessory.options.order, 100); assert.equal(typeof accessory.inject().api, 'function');
      assert.equal(typeof accessory.inject().open, 'function');
      const opened = [];
      const element = plugin.GuardianAccessory({ sessionId: 'synthetic-api-only', api: accessory.inject().api,
        t: key => plugin.EN[key], open: (...args) => opened.push(args) });
      assert.ok(f.staticModules.react.isValidElement(element)); assert.equal(element.props.compact, true);
      assert.equal(element.props.sessionId, 'synthetic-api-only');
      element.props.open(); assert.deepEqual(opened, [['synthetic-api-only']], 'accessory forwards its own session to the guarded opener');
      // A companion unload removes its declaration and the injected entry, but
      // retains the independent detail type. Reinstalling the owner creates one entry.
      f.unmountAccessoryOwner();
      assert.equal(ctx.slots.spec(ACCESSORY), undefined); assert.equal(occupants(ctx, ACCESSORY).length, 0);
      assert.equal(ctx.sidebarRightTabs.get(KIND), guardian);
      assert.equal(occupants(ctx, PANEL).filter(entry => entry.options.key === ID).length, 1);
      f.mountAccessoryOwner();
      accessory = occupants(ctx, ACCESSORY).find(entry => entry.options.id === ID);
      assert.ok(accessory); assert.equal(occupants(ctx, ACCESSORY).length, 1);
      // Collapse the real shell's owner declarations: its nested custom owner
      // and Guardian entries must disappear and remount without orphan effects.
      f.collapseShell();
      for (const name of [PANEL, GUIDE_ENTRY, ACCESSORY]) assert.equal(ctx.slots.spec(name), undefined);
      assert.equal(ctx.sidebarRightTabs.get(KIND), guardian);
      f.restoreShell();
      assert.equal(occupants(ctx, PANEL).filter(entry => entry.options.key === ID).length, 1);
      assert.equal(occupants(ctx, ACCESSORY).filter(entry => entry.options.id === ID).length, 1);
      assert.deepEqual(occupants(ctx, GUIDE_ENTRY), nativeCards);
      assert.equal(occupants(ctx, PANEL).filter(entry => entry.options.key === NATIVE_GUIDE).length, 1);
      assert.equal(occupants(ctx, GUIDE).length, nativeChainEntries.length);
      await fiber.dispose();
      assert.equal(ctx.sidebarRightTabs.get(KIND), undefined); assert.equal(ctx.sidebarRightTabs.get('guide'), nativeGuideType);
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], nativeTypes);
      assert.deepEqual([...ctx.sidebarRightTabs.guide()], nativeGuideCards);
      assert.equal(occupants(ctx, PANEL).some(entry => entry.options.key === ID), false);
      assert.deepEqual(occupants(ctx, GUIDE_ENTRY), nativeCards);
      assert.equal(occupants(ctx, ACCESSORY).some(entry => entry.options.id === ID), false);
      assert.equal(occupants(ctx, PANEL).find(entry => entry.options.key === NATIVE_GUIDE)?.component, nativeGuideEntry.component);
      assert.deepEqual([...f.dictionaries.keys()].sort(), nativeDictionaries); assert.deepEqual([...f.shortcuts.keys()].sort(), nativeShortcuts);
      assert.equal(changes.length, 2, 'one registration and one deregistration notification');
      f.unmountAccessoryOwner(); f.mountAccessoryOwner();
      assert.equal(occupants(ctx, ACCESSORY).length, 0, 'no orphan accessory inject callback after plugin unload');
      f.collapseShell(); f.restoreShell();
      assert.equal(occupants(ctx, PANEL).some(entry => entry.options.key === ID), false, 'no orphan detail inject callback');
      assert.deepEqual(occupants(ctx, GUIDE_ENTRY), nativeCards);
      assert.equal(occupants(ctx, ACCESSORY).length, 0);
      assert.equal(f.context.document, undefined);
      assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
    } finally { unsubscribe(); }
  } finally { await f.close(); }
  assert.equal(f.dictionaries.size, 0); assert.equal(f.shortcuts.size, 0); assert.equal(f.localeListeners.size, 0);
  assert.ok(f.subscriptions.every(listeners => listeners.size === 0), 'root unload releases observable subscriptions');
  assert.deepEqual(offlineGuard.denied, []);
});

test('accessory transport and opener fence mutations to the currently selected synthetic session', async () => {
  const f = await fixture();
  let originalOpenTab;
  try {
    f.mountAccessoryOwner();
    const calls = [], opened = [];
    const transport = { async fetch(url, options) {
      assert.equal(this, transport, 'transport.fetch retains its receiver'); calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, sessionId: JSON.parse(options.body).sessionId }) };
    } };
    f.context.__DSH_TRANSPORT__ = transport; f.registerPlugin();
    const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin); await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    assert.equal(f.ctx.uiSession.current, f.ctx.uiSession.adapter.current, 'native adapter and API fence share one source');
    const panel = occupants(f.ctx, PANEL).find(entry => entry.options.key === ID);
    const accessory = occupants(f.ctx, ACCESSORY).find(entry => entry.options.id === ID);
    const api = accessory.inject().api, open = accessory.inject().open, controller = new AbortController();
    assert.notEqual(api, panel.inject().api, 'accessory mutations use the current-session wrapper');
    originalOpenTab = f.ctx.sidebarRight.openTab;
    f.ctx.sidebarRight.openTab = (...args) => opened.push(args);
    const target = 'synthetic-api-only';
    // Read-only snapshots remain available before selection; mutation/open do not.
    const result = await api('snapshot', { sessionId: target }, controller.signal);
    assert.equal(result.sessionId, target); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/task-guardian/snapshot'); assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].options.body), { sessionId: target }); assert.equal(calls[0].options.signal, controller.signal);
    const mutation = { sessionId: target, epoch: 0, settings: { enabled: true } };
    await assert.rejects(api('configure', mutation, controller.signal), error => error.code === 'settings_changed_reload');
    await assert.rejects(api('startup', { sessionId: target, enabled: true }, controller.signal), error => error.code === 'settings_changed_reload');
    open(target); assert.equal(opened.length, 0); assert.equal(calls.length, 1, 'unselected mutations never reach transport');

    f.setCurrent(target);
    assert.equal(f.ctx.uiSession.current.getSnapshot().key, target);
    await api('configure', mutation, controller.signal);
    assert.equal(calls.length, 2); assert.equal(calls[1].url, '/api/task-guardian/configure');
    assert.deepEqual(JSON.parse(calls[1].options.body), mutation); assert.equal(calls[1].options.signal, controller.signal);
    await api('startup', { sessionId: target, enabled: true }, controller.signal);
    assert.equal(calls.length, 3); assert.equal(calls[2].url, '/api/task-guardian/startup');
    open(target); assert.deepEqual(opened, [[KIND]], 'the valid current-session opener uses the public sidebar API');
    // A stale rendered accessory cannot configure/startup or open after selection changes.
    f.setCurrent('another-synthetic-session');
    const before = calls.length;
    await assert.rejects(api('configure', mutation, controller.signal), error => error.code === 'settings_changed_reload');
    await assert.rejects(api('startup', { sessionId: target, enabled: false }, controller.signal), error => error.code === 'settings_changed_reload');
    open(target); assert.equal(opened.length, 1); assert.equal(calls.length, before);
    await api('snapshot', { sessionId: target }, controller.signal);
    assert.equal(calls.length, before + 1, 'stale-session snapshots remain read-only');
    open('another-synthetic-session'); assert.deepEqual(opened, [[KIND], [KIND]]);
    f.setCurrent(undefined); open('another-synthetic-session'); assert.equal(opened.length, 2);
    await assert.rejects(plugin.requestJSON(async () => ({ ok: false, json: async () => ({ ok: false, error: 'settings_changed_reload' }) }),
      'configure', {}, controller.signal), error => error.code === 'settings_changed_reload');
    await fiber.dispose();
    assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
  } finally { if (originalOpenTab) f.ctx.sidebarRight.openTab = originalOpenTab; await f.close(); }
  assert.deepEqual(offlineGuard.denied, []);
});

test('root context unload cleans a still-active Guardian accessory, detail and all native registrations', async () => {
  const f = await fixture();
  const tabs = f.ctx.sidebarRightTabs, slots = f.ctx.slots;
  try {
    f.mountAccessoryOwner(); f.registerPlugin();
    const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin);
    await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    assert.equal(tabs.get(KIND).id, ID); assert.equal(tabs.get(KIND).guide, undefined);
    assert.equal(f.dictionaries.has(NS), true);
    assert.equal(occupants(f.ctx, PANEL).some(entry => entry.options.key === ID), true);
    assert.equal(occupants(f.ctx, GUIDE_ENTRY).some(entry => entry.options.key === ID), false);
    assert.equal(occupants(f.ctx, ACCESSORY).some(entry => entry.options.id === ID), true);
  } finally { await f.close(); }
  assert.equal(tabs.entries().length, 0);
  assert.equal(tabs.guide().length, 0);
  for (const name of ['root', 'shell.overlay', PANEL, GUIDE_ENTRY, GUIDE, ACCESSORY]) {
    assert.equal([...slots.entries(name)].length, 0, `root disposal removes ${name} registrations`);
  }
  assert.equal(slots.spec(ACCESSORY), undefined);
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
function guardianHookHarness({ deferEffectStateUpdates = false, transformSource = source => source } = {}) {
  const cells = [], effects = [], pendingEffectState = [], timers = new Map(), calls = [], postUnmountWrites = [];
  let cursor = 0, nextTimer = 0, mounted = true, dirty = true, applyingEffects = false, sessionId, current;
  const flushEffectState = () => { for (const commit of pendingEffectState.splice(0)) commit(); };
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
        const commit = () => {
          const value = typeof next === 'function' ? next(cells[index]) : next;
          if (!Object.is(cells[index], value)) { cells[index] = value; dirty = true; }
        };
        if (deferEffectStateUpdates && applyingEffects) pendingEffectState.push(commit);
        else { flushEffectState(); commit(); }
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
  const source = transformSource(fs.readFileSync(pluginFile, 'utf8'));
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
      applyingEffects = true;
      try { for (const effect of effects.splice(0)) effect(); }
      finally { applyingEffects = false; }
    }
    return current;
  }
  return {
    calls, timers, postUnmountWrites, render,
    forceRender() { dirty = true; return render(); },
    flushEffectState() { flushEffectState(); return render(); },
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
      pendingEffectState.length = 0;
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

async function assertLowRevisionSessionSwitch(hook) {
  try {
    hook.render('session-a'); hook.flushEffectState();
    hook.calls[0].resolve(guardianSnapshot('session-a'));
    await hook.settle();
    const configureA = hook.current.change('enabled', true), mutationA = hook.calls[1];
    assert.equal(mutationA.action, 'configure'); assert.equal(mutationA.payload.epoch, 0);
    mutationA.resolve(guardianSnapshot('session-a', { enabled: true, epoch: 1, revision: 1 }));
    await configureA; await hook.settle();
    assert.equal(hook.current.value.sessionId, 'session-a');
    assert.equal(hook.current.value.record.settings.enabled, true);
    assert.equal(hook.current.value.record.revision, 1);

    // React may leave an effect's setValue(null) queued while the parent renders
    // the new session again. Keep that clear uncommitted to exercise the old
    // ref/revision window rather than hiding it with an immediate mock update.
    const firstWaitingFrame = hook.render('session-b');
    assert.equal(firstWaitingFrame.value, null, 'the first B frame must not expose A settings');
    const pendingB = hook.calls[2];
    assert.equal(pendingB.action, 'snapshot'); assert.equal(pendingB.payload.sessionId, 'session-b');
    assert.equal(pendingB.signal.aborted, false);
    const parentRerender = hook.forceRender();
    assert.equal(parentRerender.value, null, 'a parent rerender must not expose A while B is pending');
    assert.equal(parentRerender.busy, false);
    assert.equal(hook.calls.length, 3, 'the parent rerender does not restart the B request');
    pendingB.resolve(guardianSnapshot('session-b', { enabled: false, epoch: 0, revision: 0 }));
    await hook.settle();
    assert.equal(hook.current.value?.sessionId, 'session-b', 'B must accept revision zero independently of A revision one');
    assert.equal(hook.current.value.record.settings.enabled, false, 'B does not inherit the enabled A switch');
    assert.equal(hook.current.value.record.epoch, 0);
    assert.equal(hook.current.value.record.revision, 0);
    assert.equal(hook.current.error, null);

    const configureB = hook.current.change('enabled', true), mutationB = hook.calls[3];
    assert.equal(mutationB.action, 'configure'); assert.equal(mutationB.payload.sessionId, 'session-b');
    assert.equal(mutationB.payload.epoch, 0, 'B configures from its own initial epoch rather than A epoch one');
    assert.equal(mutationB.payload.settings.enabled, true);
    mutationB.resolve(guardianSnapshot('session-b', { enabled: true, epoch: 1, revision: 1 }));
    await configureB; await hook.settle();
    assert.equal(hook.current.value.sessionId, 'session-b');
    assert.equal(hook.current.value.record.settings.enabled, true);
    assert.equal(hook.current.value.record.epoch, 1);
    assert.equal(hook.current.busy, false);
  } finally { hook.unmount(); }
  assert.equal(hook.timers.size, 0);
  assert.deepEqual(hook.postUnmountWrites, []);
}

test('switching from enabled revision one to a fresh revision-zero session survives an extra parent render', async () => {
  await assertLowRevisionSessionSwitch(guardianHookHarness({ deferEffectStateUpdates: true }));
});
