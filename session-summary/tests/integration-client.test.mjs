import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfflineClient } from './integration-client-runtime.mjs';
import { extractHostIcons } from '../scripts/extract-host-icons.mjs';

const stable = value => ({ getSnapshot: () => value, subscribe: () => () => {} });

test('installed ClientModuleSystem mounts the plugin beside native header seats and the frame overlay', async () => {
  const c = await loadOfflineClient();
  const { Context } = c.staticModules['@deepseek-ai/cordis'];
  const React = c.staticModules.react;
  const ctx = new Context();
  const fibers = [];
  const diagnostics = [];
  ctx.logger.exporter({ export: entry => { if (entry.type === 'error') diagnostics.push(entry.args); } });
  async function mount(name, id = '@deepseek-ai/' + name, file = `scripts/.runtime/node_modules/@deepseek-ai/${name}/lib/client.js`) {
    c.register(file);
    const mod = await c.modules.import(id);
    const fiber = ctx.plugin(mod); fibers.push(fiber); await fiber.await();
    if (fiber.state !== 2) throw new Error(`${name}: ${String(fiber._error)} ${JSON.stringify(diagnostics)}`);
    return mod;
  }
  const dictionaries = new Map();
  try {
    await mount('dsh-client-ui-renderer');
    ctx.provide('locale', { register: (ns, value) => { if (dictionaries.has(ns)) throw new Error(`duplicate ${ns}`); dictionaries.set(ns, value); return () => dictionaries.delete(ns); }, bind: ns => key => dictionaries.get(ns)?.en?.[key] ?? key, subscribe: () => () => {} });
    ctx.provide('sessions', { sessionOf: () => undefined, binding: () => undefined, scope: () => undefined, retain: () => { throw new Error('not used'); }, refresh: async () => {} });
    ctx.provide('fileUpload', {});
    ctx.provide('uiSession', { provide: () => () => {} });
    ctx.provide('uiWorkspace', { openSession() { throw new Error('Registration cannot navigate'); } });
    ctx.provide('configForms', { get: () => undefined, developerTools: { enabled: stable(false) } });
    ctx.provide('connection', {});
    ctx.slots.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    } }, () => null);
    await mount('dsh-client-ui-conversation');
    // Native-like neighbours registered first prove list contributions coexist.
    ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'session-log-download' }, () => null);
    ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'dsh-better-sidebar:bottom-toggle', order: 10 }, () => null);
    ctx.slots.register({ name: 'shell.overlay', id: 'native-toast', order: 0 }, () => null);

    c.register('lib/client.js');
    const plugin = await c.modules.import('dsh-session-summary');
    const fiber = ctx.plugin(plugin); fibers.push(fiber); await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    assert.equal(React.version, '18.3.1');

    const utilities = ctx.slots.spec('conversation.session.header.utilities');
    assert.equal(utilities.kind, 'list');
    assert.equal(utilities.scope, 'session');
    const toggles = [...ctx.slots.entries('conversation.session.header.utilities')];
    assert.deepEqual(toggles.map(entry => entry.options.id).sort(), ['dsh-better-sidebar:bottom-toggle', 'dsh-session-summary.toggle', 'session-log-download']);
    const toggle = toggles.find(entry => entry.options.id === 'dsh-session-summary.toggle');
    assert.equal(toggle.options.order, 100, 'right-most utility, left of the corner opener');
    assert.equal(toggle.locale ?? toggle.options.locale, 'session-summary', `entry keys: ${Object.keys(toggle)} / ${Object.keys(toggle.options)}`);
    assert.equal(typeof (toggle.inject ?? toggle.options.inject)().api.open, 'function');
    assert.equal(ctx.slots.spec('conversation.session.header.corner').kind, 'single');
    assert.equal([...ctx.slots.entries('conversation.session.header.corner')].some(entry => entry.options.id === 'dsh-session-summary.toggle'), false, 'the native corner opener is never shadowed');

    const overlay = [...ctx.slots.entries('shell.overlay')];
    assert.deepEqual(overlay.map(entry => entry.options.id).sort(), ['dsh-session-summary.card', 'native-toast']);
    assert.equal(ctx.slots.spec('shell.overlay').scope, 'root');
    assert.ok(dictionaries.has('session-summary'));
    assert.equal(dictionaries.get('session-summary').zh.title, '会话摘要');
    assert.ok(React.isValidElement(React.createElement(plugin.SummaryToggle, { sessionId: 's', api: (toggle.inject ?? toggle.options.inject)().api, t: key => key })));
    assert.deepEqual(diagnostics, []);

    // Disposal removes every contribution.
    await fiber.dispose();
    fibers.splice(fibers.indexOf(fiber), 1);
    assert.equal([...ctx.slots.entries('conversation.session.header.utilities')].some(entry => entry.options.id === 'dsh-session-summary.toggle'), false);
    assert.equal([...ctx.slots.entries('shell.overlay')].some(entry => entry.options.id === 'dsh-session-summary.card'), false);
    assert.equal(dictionaries.has('session-summary'), false);
  } finally {
    for (const fiber of fibers.toReversed()) await fiber.dispose();
    await ctx.fiber.dispose();
  }
});

test('copied host icon markup still matches the installed ui-primitives', async () => {
  const host = await extractHostIcons();
  let registration;
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { registration = value; } } }, URL, URLSearchParams, AbortController, console });
  const client = registration.factory(() => ({ createElement: () => null, createContext: () => ({}), Fragment: 'F' }));
  assert.deepEqual(JSON.parse(JSON.stringify(client.HOST_ICONS)), JSON.parse(JSON.stringify(host)));
});
