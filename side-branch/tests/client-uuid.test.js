import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomFillSync } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Load the shipped browser file in the one context it must survive: plain HTTP,
 * where `crypto.randomUUID` is undefined. The getter throws so any regression
 * names itself instead of failing with a generic "not a function".
 */
async function loadClient() {
  let registered;
  let minted = 0;
  const crypto = {
    getRandomValues(array) { minted += 1; return randomFillSync(array); },
  };
  Object.defineProperty(crypto, 'randomUUID', {
    get() { throw new TypeError('crypto.randomUUID is secure-context only and unavailable over plain HTTP'); },
  });
  const React = new Proxy({ Fragment: Symbol('Fragment') }, {
    get: (target, key) => (key in target ? target[key] : () => ({})),
  });
  const context = {
    crypto,
    console,
    setTimeout,
    clearTimeout,
    window: { __ModuleLoader__: { load: (data) => { registered = data; } } },
  };
  context.globalThis = context;
  vm.runInNewContext(await readFile(new URL('lib/client.js', root), 'utf8'), context);
  const exported = registered.factory((id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected client dependency: ${id}`);
  });
  return { exported, stats: () => minted };
}

test('branch ids are minted without the secure-context-only crypto.randomUUID', async () => {
  const { exported, stats } = await loadClient();
  assert.equal(typeof exported.randomUUID, 'function');
  const ids = new Set();
  for (let index = 0; index < 500; index += 1) {
    const id = exported.randomUUID();
    assert.match(id, UUID_V4);
    ids.add(id);
  }
  assert.equal(ids.size, 500);
  assert.equal(stats(), 500);
});

test('the shipped browser file never calls the secure-context-only crypto.randomUUID', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8');
  assert.doesNotMatch(source, /\bcrypto\.randomUUID\s*\(/);
});
