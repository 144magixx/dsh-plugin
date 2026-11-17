import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';

/** Fake Cordis context that records what apply() registers. */
function harness() {
  let stored;
  const sections = [], listeners = [], routes = new Map();
  const storageDomain = { async open({ global }) { stored = structuredClone(global.initial); return { global: { get: () => structuredClone(stored), set: async value => { stored = global.schema.parse(structuredClone(value)); } }, async close() {} }; } };
  const layer = { revision: 1, user: {} };
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision: layer.revision, user: { providers: structuredClone(layer.user) }, value: { providers: { 'claude-relay': { ...layer.user['claude-relay'] }, google: { ...layer.user.google } } } }],
    async mutate(_ns, ops, revision) {
      assert.equal(revision, layer.revision);
      for (const op of ops) { const [, route, field] = op.path; layer.user[route] ??= {}; if (op.op === 'set') layer.user[route][field] = op.value; else delete layer.user[route][field]; }
      layer.revision++;
    },
  };
  const child = {
    systemPrompt: { section: section => sections.push(section) },
    on: (name, listener) => { listeners.push({ name, listener }); return () => {}; },
    effect: fn => fn(),
    settings,
  };
  const ctx = {
    storageDomain,
    connection: { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    effect: fn => fn(),
    inject: (_deps, callback) => callback(child),
  };
  const post = async body => (await routes.get(plugin.ACTION_ROUTE).fetch(new Request('http://localhost' + plugin.ACTION_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))).json();
  return { ctx, sections, listeners, routes, post };
}

const assembly = (provider, text = '') => ({ sections: [{ name: 'other', text: 'x' }, { name: plugin.SECTION, text, interpolate: false }], variables: provider === undefined ? {} : { provider } });

test('notice follows context.modelSelection (DSH 0.2.2) and falls back to variables.provider after the waterfall (DSH 0.2.1)', async () => {
  const h = harness();
  plugin.apply(h.ctx);
  assert.deepEqual([...h.routes.keys()].sort(), [plugin.ACTION_ROUTE, plugin.IMAGE_ROUTE].sort());
  assert.equal(h.sections.length, 1);
  const [{ name, text }] = h.sections;
  assert.equal(name, plugin.SECTION);
  const hook = h.listeners.find(entry => entry.name === 'system-prompt/assemble')?.listener;
  assert.equal(typeof hook, 'function', 'assembly waterfall listener registered');

  // Off: no host shape yields a notice and the assembly is returned untouched.
  const off = assembly('claude-relay');
  assert.equal(text({ modelSelection: { provider: 'claude-relay' } }), '');
  assert.equal(await hook({}, {}, async () => off), off);

  const result = await h.post({ action: 'update', enabled: true, strategy: 'saver', routes: ['claude-relay'] });
  assert.equal(result.ok, true, JSON.stringify(result));

  // 0.2.2: the section text itself carries the notice; the listener leaves it alone.
  assert.match(text({ modelSelection: { provider: 'claude-relay' } }), /921,600 pixels/);
  assert.equal(text({ modelSelection: { provider: 'google' } }), '');
  const current = assembly('claude-relay', 'from-section');
  assert.equal(await hook({}, { modelSelection: { provider: 'claude-relay' } }, async () => current), current);

  // 0.2.1: no modelSelection in the context, the route arrives as variables.provider.
  assert.equal(text({}), '');
  const filled = await hook({}, {}, async () => assembly('claude-relay'));
  assert.match(filled.sections.find(section => section.name === plugin.SECTION).text, /921,600 pixels/);
  assert.equal(filled.sections.find(section => section.name === 'other').text, 'x', 'other sections untouched');
  assert.equal(filled.sections.find(section => section.name === plugin.SECTION).interpolate, false);
  const other = assembly('google');
  assert.equal(await hook({}, {}, async () => other), other, 'other routes get no notice');
  const unknown = assembly(undefined);
  assert.equal(await hook({}, {}, async () => unknown), unknown, 'no route reported: nothing to add');
});
