import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectionAskService, SESSION_PREFIX } from '../lib/service.js';
import { client } from './client-core.mjs';

function service(ctx = {}) {
  const table = { entries: () => [].entries(), get: () => undefined, put: async () => {}, delete: async () => {} };
  return new SelectionAskService({ get: () => undefined, ...ctx }, table);
}

test('model choice uses agent.model.select (DSH >= 0.2.2) and falls back to selectForNextRequest (0.2.1)', () => {
  const picked = { provider: 'p', model: 'm', reasoningEffort: 'high' };
  const modern = []; const legacy = [];
  service().selectAgentModel({ model: { select: value => modern.push(value) } }, picked);
  assert.deepEqual(modern, [picked]);
  const agent = { id: 'a' };
  const old = service({ get: name => name === 'sessionController' ? { agents: { selectForNextRequest(target, value) { legacy.push([target, value]); } } } : undefined });
  old.selectAgentModel(agent, picked);
  assert.deepEqual(legacy, [[agent, picked]]);
  assert.throws(() => service().selectAgentModel(agent, picked), error => error.code === 'unsupported-runtime' && error.status === 409);
});

test('image admission checks the recorded thread model when the host exposes no agent.model', async () => {
  const lookups = [];
  const s = service({
    llm: { resolveModelInfo: async (provider, model) => { lookups.push(`${provider}/${model}`); return { name: 'Text only', inputModalities: ['text'] }; } },
    get: name => name === 'attachments' ? { admitPromptContent: async content => content } : undefined,
  });
  await assert.rejects(s.userMessage({}, 'hi', [{ type: 'image', data: 'AA==', mediaType: 'image/png' }], { provider: 'p', model: 'm' }), error => error.code === 'model-no-images');
  assert.deepEqual(lookups, ['p/m']);
});

test('apply registers every surface on a DSH without the 0.2.2 conversation interaction registry', () => {
  for (const uiConversation of [{}, undefined, { interactions: {} }]) {
    const effects = []; const injected = []; let tabs = 0; let registrations = 0;
    const ctx = {
      uiConversation,
      effect(callback, label) { const dispose = callback(); assert.equal(typeof dispose, 'function', `${label} returns a disposer`); effects.push(label); return dispose; },
      locale: { register: () => () => {}, bind: () => key => key },
      slots: { inject(name, factory) { injected.push(name); factory(); return () => {}; }, register() { registrations++; return () => {}; }, entries: () => [], subscribe: () => () => {} },
      sidebarRight: { mounted: { getSnapshot: () => 's1' } },
      sidebarRightTabs: { register() { tabs++; return () => {}; } },
      sessions: {},
    };
    assert.doesNotThrow(() => client.apply(ctx));
    assert.equal(tabs, 1, 'the pinned tab is still registered');
    assert.ok(effects.includes('[selection-ask] tab body'), 'registration continues past the interaction step');
    assert.ok(injected.includes('shell.overlay') && injected.includes('sidebar.right.tab.document'));
    assert.ok(registrations >= 2);
  }
});

test('hidden session ids keep the plugin prefix', () => assert.ok(`${SESSION_PREFIX}x`.startsWith('selection-ask-')));
