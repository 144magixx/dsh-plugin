import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Activation across DSH releases: 0.2.1 (Windows Desktop 0.2.1-rc.5) has no
// `uiConversation.interactions`; calling it unguarded made the whole Client
// entry fail ("web boot: 1 entry did not activate / dsh-selection-ask: failed").
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function loadClient() {
  let registration;
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
    URL, URLSearchParams, AbortController, AbortSignal, TextEncoder, TextDecoder, console, setTimeout, clearTimeout,
    crypto: globalThis.crypto, fetch: async () => { throw new Error('no network in tests'); },
  }, { filename: 'dsh-selection-ask/client.js', timeout: 1000 });
  const React = Object.freeze({ createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), createContext: (value) => ({ Provider: 'Provider', _default: value }), Fragment: 'Fragment' });
  return registration.factory((id) => { if (id === 'react') return React; throw new Error(`Unavailable in Node: ${id}`); });
}

/** A Client ctx double; `declared` slots run their inject callbacks like the real slots service. */
function fakeCtx({ interactions }) {
  const disposers = [];
  const registered = { slots: [], tabs: [], interactions: [] };
  const declared = new Set(['shell.overlay', 'sidebar.right.pane.tab', 'sidebar.right.tab.document', ...(interactions ? ['conversation.chat.text-interaction'] : [])]);
  const ctx = {
    effect(fn) { const dispose = fn(); disposers.push(dispose); return () => dispose?.(); },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject(key, callback) { return declared.has(key) ? ctx.effect(callback) : () => {}; },
      register(options) { registered.slots.push(options); return () => {}; },
      entries: () => [],
      subscribe: () => () => {},
    },
    sidebarRight: {},
    sidebarRightTabs: { register(definition) { registered.tabs.push(definition.id); return () => {}; } },
    sessions: {},
    uiConversation: interactions ? { interactions: { register(definition) { registered.interactions.push(definition.id); return () => {}; } } } : {},
  };
  return { ctx, registered, dispose: () => { for (const dispose of disposers.toReversed()) dispose?.(); } };
}

test('the Client activates on DSH 0.2.1, which has no native text interactions', () => {
  const client = loadClient();
  const host = fakeCtx({ interactions: false });
  assert.equal(client.hasInteractions(host.ctx), false);
  assert.doesNotThrow(() => client.apply(host.ctx));
  assert.deepEqual(host.registered.interactions, []);
  assert.ok(host.registered.slots.some((options) => options.name === 'shell.overlay'), 'overlay selection detector still registers');
  assert.deepEqual(host.registered.tabs, ['dsh-selection-ask']);
  assert.doesNotThrow(host.dispose);
});

test('the Client uses native text interactions on DSH 0.2.2+', () => {
  const client = loadClient();
  const host = fakeCtx({ interactions: true });
  assert.equal(client.hasInteractions(host.ctx), true);
  client.apply(host.ctx);
  assert.deepEqual(host.registered.interactions, ['selection-ask']);
  assert.ok(host.registered.slots.some((options) => options.name === 'conversation.chat.text-interaction' && options.key === 'selection-ask'));
  host.dispose();
});
