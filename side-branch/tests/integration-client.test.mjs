import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfflineClient } from './integration-client-runtime.mjs';

const stable = value => ({ getSnapshot: () => value, subscribe: () => () => {} });

test('installed ClientModuleSystem mounts plugin with real React, slots and native Conversation', async () => {
  const c = await loadOfflineClient();
  const { Context } = c.staticModules['@deepseek-ai/cordis'];
  const React = c.staticModules.react;
  const ctx = new Context();
  const fibers = [];
  const diagnostics = [];
  ctx.logger.exporter({ export: entry => { if (entry.type === 'error') diagnostics.push(entry.args); } });
  async function mount(name) {
    c.register(`scripts/.runtime/node_modules/@deepseek-ai/${name}/lib/client.js`);
    const mod = await c.modules.import('@deepseek-ai/' + name);
    const fiber = ctx.plugin(mod); fibers.push(fiber); await fiber.await();
    if (fiber.state !== 2) throw new Error(`${name}: ${String(fiber._error)} ${JSON.stringify(diagnostics)}`);
    return mod;
  }
  const sessions = { sessionOf: () => bindings.get('child-session')?.session, binding: id => bindings.get(id), scope: id => bindings.get(id)?.ctx, retain: () => { throw new Error('Not used by registration test'); }, refresh: async () => {} };
  const bindings = new Map();
  const providers = []; const tabs = []; const sessionProviders = [];
  const dictionaries = new Map();
  try {
    await mount('dsh-client-ui-renderer');
    ctx.provide('locale', { register: (ns, value) => { dictionaries.set(ns, value); return () => dictionaries.delete(ns); }, bind: ns => key => dictionaries.get(ns)?.en?.[key] ?? key, subscribe: () => () => {} });
    ctx.provide('sessions', sessions);
    ctx.provide('fileUpload', {});
    ctx.provide('uiSession', { provide: value => { sessionProviders.push(value); return () => {}; } });
    ctx.provide('uiWorkspace', { openSession() { throw new Error('Registration cannot navigate'); } });
    ctx.provide('configForms', { get: () => undefined, developerTools: { enabled: stable(false) } });
    ctx.provide('connection', {});
    ctx.provide('sidebarRight', { mounted: stable('source-session'), registerCloseHandler: () => () => {} });
    ctx.provide('sidebarRightTabs', { register: value => { tabs.push(value); return () => {}; } });
    ctx.provide('resources', { register: value => { providers.push(value); return () => {}; } });
    ctx.slots.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    } }, () => null);
    const NativeUser = React.memo(() => null);
    ctx.slots.register({ name: 'conversation.chat.node', key: 'user', locale: 'chat' }, NativeUser);
    const nativeUser = ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'user');
    await mount('dsh-client-ui-conversation');
    // Declare sibling before Side Branch to prove slot contributions coexist.
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'existing-side-chat' }, () => null);
    c.register('lib/client.js');
    const plugin = await c.modules.import('dsh-side-branch');
    const fiber = ctx.plugin(plugin); fibers.push(fiber); await fiber.await();
    assert.equal(fiber.state, 2, String(fiber._error));
    assert.equal(React.version, '18.3.1');
    assert.equal(plugin.nativeCapabilities(ctx), true);
    assert.equal(tabs.length, 1); assert.equal(tabs[0].multiple, true); assert.equal(tabs[0].keepMounted, true);
    assert.equal(providers.length, 1);
    assert.deepEqual([...ctx.slots.entries('sidebar.right.pane.tab')].map(e => e.options.key).sort(), ['dsh-side-branch', 'existing-side-chat']);
    assert.equal(ctx.slots.entries('conversation.chat.assistant-actions').filter(e => e.options.id === 'dsh-side-branch').length, 1);
    const user = ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'user');
    assert.notEqual(user.component, NativeUser, 'plugin shadows the native user cell');
    assert.equal(user.options.priority, -1, 'lower priority wins over native default zero');
    assert.equal(user.locale, nativeUser.locale, 'native locale kit survives replacement');
    assert.ok(ctx.slots.entries('conversation.chat.node').includes(nativeUser), 'native registration remains live');
    assert.equal(ctx.slots.spec('side-branch.conversation').scope, 'session');
    assert.equal(ctx.slots.entries('side-branch.conversation').length, 1);
    assert.ok(ctx.slots.snapshot('factory:conversation.content').length > 0);
    const native = ctx.slots.hostFace().factoryOf('conversation.content');
    assert.equal(native.scope, 'session-maybe');
    assert.ok(native.children['conversation.composer']);
    assert.ok(native.children['conversation.composer.bar']);
    assert.ok(native.children['conversation.input.dock']);
    assert.ok(React.isValidElement(React.createElement(native.component, { variant: 'embedded', phase: 'active', hero: false })));
    assert.equal(diagnostics.length, 0);
    // Actual native draft engine; unrelated session transport is an inert binding.
    const id = 'child-session';
    const session = { sessionId: id, ...stable({ sessionId: id, blank: true, running: false }), projections: { faceOf: key => stable(key === 'inbox' ? { 'next-turn': [], 'next-step': [] } : undefined) } };
    const binding = { sessionId: id, session, ctx };
    bindings.set(id, binding);
    const result = ctx.conversation.input.requestDraftInitialization(binding, { prompt: 'Complete historical question' });
    const shell = ctx.conversation.input.shell(id);
    assert.equal(shell.snapshot.draft, 'Complete historical question');
    shell.actions.setDraft('User revised the question');
    ctx.conversation.input.requestDraftInitialization(binding, { prompt: 'Complete historical question' });
    assert.equal(shell.snapshot.draft, 'User revised the question', 'repeated initialization preserves user edits');
    await fiber.dispose();
    assert.equal(ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'user'), nativeUser, 'unload restores the native user cell');
  } finally {
    for (const fiber of fibers.toReversed()) await fiber.dispose();
    await ctx.fiber.dispose();
  }
});
