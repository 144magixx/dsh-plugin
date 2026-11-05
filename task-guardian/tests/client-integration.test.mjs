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
  assert.ok(keys.length > 20, 'alert controls and states have a complete bilingual dictionary');
  for (const key of keys) for (const [language, dictionary] of [['zh', plugin.ZH], ['en', plugin.EN]]) {
    assert.equal(typeof dictionary[key], 'string', `${language}.${key}`);
    assert.ok(dictionary[key].trim(), `${language}.${key} cannot be empty`);
  }
}

test('real installed modules mount only the standalone alert accessory and leave sidebar settings untouched', async t => {
  const f = await fixture(), { ctx } = f;
  try {
    t.diagnostic(`Installed DSH ${f.version}; bundled React ${f.staticModules.react.version}; no live GUI/session/network`);
    const nativeTypes = [...ctx.sidebarRightTabs.entries()], nativePanels = occupants(ctx, PANEL);
    const nativeGuide = ctx.sidebarRightTabs.get('guide'), nativeCards = occupants(ctx, GUIDE_ENTRY);
    const nativeDictionaries = [...f.dictionaries.keys()].sort();
    const changes = [], unsubscribe = ctx.sidebarRightTabs.subscribe(() => changes.push('tabs changed'));
    try {
      f.registerPlugin();
      const plugin = await f.modules.import(ID);
      assert.deepEqual([...f.modules.loadCache.get(ID).edges], ['react']);
      assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'uiWorkspace']);
      assertBilingualKeys(plugin);
      assert.equal(plugin.ZH.title, '任务异常提醒');
      for (const name of ['GuardianPanel', 'GuardianAccessory', 'GuardianAlerts', 'Switch', 'Shield', 'effectiveGuardianText', 'retryDecisionText', 'failureTimingText']) assert.equal(plugin[name], undefined, `${name} was removed`);
      const fiber = ctx.plugin(plugin); await fiber.await();
      assert.equal(fiber.state, 2, String(fiber._error));
      assert.equal(ctx.sidebarRightTabs.get(KIND), undefined, 'there is no task-guardian settings tab');
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], nativeTypes);
      assert.deepEqual(occupants(ctx, PANEL).map(entry => [entry.options.key, entry.component]), nativePanels.map(entry => [entry.options.key, entry.component]));
      assert.deepEqual(occupants(ctx, GUIDE_ENTRY), nativeCards);
      assert.equal(ctx.sidebarRightTabs.get('guide'), nativeGuide);
      assert.equal(occupants(ctx, ACCESSORY).length, 0, 'card waits for the original right-side owner');
      assert.equal(occupants(ctx, 'shell.bottom').length, 0);
      assert.equal(f.dictionaries.get(NS).zh, plugin.ZH); assert.equal(f.dictionaries.get(NS).en, plugin.EN);
      f.setLanguage('zh'); assert.equal(ctx.locale.bind(NS)('title'), '任务异常提醒'); f.setLanguage('en');
      f.mountAccessoryOwner();
      assert.equal(ctx.slots.spec(ACCESSORY).kind, 'list'); assert.equal(ctx.slots.spec(ACCESSORY).scope, 'root');
      let accessory = occupants(ctx, ACCESSORY).find(entry => entry.options.id === ID);
      assert.ok(accessory); assert.equal(occupants(ctx, ACCESSORY).length, 1);
      assert.equal(accessory.options.order, 100); assert.equal(accessory.component, plugin.TaskAlertsCard); assert.equal(accessory.locale, NS);
      const injected = accessory.inject(), store = injected.store;
      assert.deepEqual(Object.keys(injected).sort(), ['open', 'store'], 'no settings API, session state or detail opener is exposed');
      assert.equal(typeof store.refresh, 'function'); assert.equal(typeof injected.open, 'function');
      f.setCurrent('session-a'); assert.equal(accessory.inject().store, store);
      f.setCurrent('session-b'); assert.equal(accessory.inject().store, store);
      f.unmountAccessoryOwner();
      assert.equal(ctx.slots.spec(ACCESSORY), undefined);
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], nativeTypes);
      f.mountAccessoryOwner();
      accessory = occupants(ctx, ACCESSORY).find(entry => entry.options.id === ID);
      assert.equal(accessory.inject().store, store, 'companion remount reuses the plugin-owned global catalog');
      f.collapseShell();
      assert.equal(ctx.slots.spec(ACCESSORY), undefined);
      f.restoreShell();
      assert.equal(occupants(ctx, ACCESSORY).find(entry => entry.options.id === ID).inject().store, store);
      assert.deepEqual(occupants(ctx, PANEL).map(entry => [entry.options.key, entry.component]), nativePanels.map(entry => [entry.options.key, entry.component]));
      await fiber.dispose();
      assert.equal(occupants(ctx, ACCESSORY).length, 0);
      assert.deepEqual([...ctx.sidebarRightTabs.entries()], nativeTypes);
      assert.deepEqual(occupants(ctx, PANEL).map(entry => [entry.options.key, entry.component]), nativePanels.map(entry => [entry.options.key, entry.component]));
      assert.deepEqual([...f.dictionaries.keys()].sort(), nativeDictionaries);
      assert.deepEqual(changes, [], 'the passive card never registers a sidebar detail tab');
      f.unmountAccessoryOwner(); f.mountAccessoryOwner();
      assert.equal(occupants(ctx, ACCESSORY).length, 0, 'no orphan callback after plugin unload');
      assert.equal(f.context.document, undefined);
      assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
    } finally { unsubscribe(); }
  } finally { await f.close(); }
  assert.equal(f.dictionaries.size, 0); assert.equal(f.shortcuts.size, 0); assert.equal(f.localeListeners.size, 0);
  assert.ok(f.subscriptions.every(listeners => listeners.size === 0));
  assert.deepEqual(offlineGuard.denied, []);
});

test('native transport polls only alerts and exposes only explicit read acknowledgements across session changes', async () => {
  const f = await fixture();
  try {
    f.mountAccessoryOwner();
    const calls = [];
    const item = { id: 'other-incident', sessionId: 'session-other', title: 'Other task', state: 'retrying', kind: 'retrying', attempt: 8, nextRetryAt: 9000, at: 1000 };
    let alerts = [item];
    const transport = { async fetch(url, options) {
      assert.equal(this, transport); calls.push({ url, options });
      assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin');
      assert.equal(options.headers['content-type'], 'application/json');
      if (url === '/api/task-guardian/acknowledge' || url === '/api/task-guardian/acknowledgeAll') alerts = [];
      return { ok: true, json: async () => ({ ok: true, mode: 'alerts-only', alerts, total: alerts.length, readToken: 'read-one', fault: null, serverNow: 2000 }) };
    } };
    f.context.__DSH_TRANSPORT__ = transport; f.registerPlugin();
    const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin); await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    const store = occupants(f.ctx, ACCESSORY).find(entry => entry.options.id === ID).inject().store;
    assert.equal(calls.length, 0, 'registering UI does not execute or poll a session');
    store.start(); await store.refresh();
    assert.deepEqual(calls.map(call => call.url), ['/api/task-guardian/alerts']);
    assert.deepEqual(JSON.parse(calls[0].options.body), {});
    assert.equal(store.getSnapshot().alerts[0].state, 'retrying');
    f.setCurrent('session-a'); await store.refresh();
    f.setCurrent('session-b'); await store.refresh();
    assert.ok(calls.every(call => call.url === '/api/task-guardian/alerts'), 'long retry observations never call any execution endpoint');
    await store.acknowledge(item);
    const single = calls.find(call => call.url.endsWith('/acknowledge'));
    assert.deepEqual(JSON.parse(single.options.body), { sessionId: 'session-other', alertId: 'other-incident' });
    assert.equal(store.getSnapshot().total, 0);
    alerts = [item]; await store.refresh();
    await store.acknowledgeAll();
    const bulk = calls.find(call => call.url.endsWith('/acknowledgeAll'));
    assert.deepEqual(JSON.parse(bulk.options.body), { readToken: 'read-one' });
    assert.equal(store.getSnapshot().total, 0);
    assert.ok(calls.every(call => /\/api\/task-guardian\/(alerts|acknowledge|acknowledgeAll)$/.test(call.url)));
    assert.deepEqual(f.forbiddenCalls, [], 'no native start, resume, retain, rightbar, or automatic action was invoked');
    await fiber.dispose();
    assert.deepEqual(f.denied, []); assert.deepEqual(f.diagnostics, []);
  } finally { await f.close(); }
});

test('alert navigation uses the public SessionTarget service without current-session fencing or acknowledgement', async () => {
  const f = await fixture();
  try {
    const opened = [];
    f.ctx.uiWorkspace.openSession = target => { opened.push(target); };
    f.registerPlugin(); const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin); await fiber.await();
    f.mountAccessoryOwner();
    const entry = occupants(f.ctx, ACCESSORY).find(entry => entry.options.id === ID), { store, open } = entry.inject();
    f.setCurrent('session-current'); open('session-other');
    assert.deepEqual(opened, ['session-other']);
    assert.equal(store.getSnapshot().status, 'loading', 'navigation does not start API calls or acknowledge');
    f.setCurrent('session-third');
    assert.equal(occupants(f.ctx, ACCESSORY).find(entry => entry.options.id === ID).inject().store, store);
    open('session-other'); assert.deepEqual(opened, ['session-other', 'session-other']);
    await fiber.dispose(); assert.equal(occupants(f.ctx, 'shell.bottom').length, 0);
    assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []);
  } finally { await f.close(); }
});

test('root context unload removes the passive accessory and aborts its pending catalog request', async () => {
  const f = await fixture(), tabs = f.ctx.sidebarRightTabs, slots = f.ctx.slots;
  const requests = [];
  try {
    f.context.__DSH_TRANSPORT__ = { fetch(url, options) { requests.push({ url, options }); return new Promise(() => {}); } };
    f.mountAccessoryOwner(); f.registerPlugin();
    const plugin = await f.modules.import(ID), fiber = f.ctx.plugin(plugin); await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    assert.equal(tabs.get(KIND), undefined);
    assert.equal(f.dictionaries.has(NS), true);
    assert.equal(occupants(f.ctx, PANEL).some(entry => entry.options.key === ID), false);
    const entry = occupants(f.ctx, ACCESSORY).find(entry => entry.options.id === ID);
    assert.ok(entry); entry.inject().store.start();
    assert.equal(requests.length, 1); assert.equal(requests[0].url, '/api/task-guardian/alerts');
    assert.equal(requests[0].options.signal.aborted, false);
  } finally { await f.close(); }
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(tabs.entries().length, 0);
  for (const name of ['root', 'shell.overlay', 'shell.bottom', PANEL, GUIDE_ENTRY, GUIDE, ACCESSORY]) assert.equal([...slots.entries(name)].length, 0);
  assert.equal(slots.spec(ACCESSORY), undefined);
  assert.equal(f.dictionaries.size, 0); assert.equal(f.shortcuts.size, 0); assert.equal(f.localeListeners.size, 0);
  assert.ok(f.subscriptions.every(listeners => listeners.size === 0));
  assert.deepEqual(f.denied, []); assert.deepEqual(f.forbiddenCalls, []); assert.deepEqual(f.diagnostics, []);
  assert.deepEqual(offlineGuard.denied, []);
});
