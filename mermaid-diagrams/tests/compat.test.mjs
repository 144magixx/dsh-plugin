import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoomAction } from '../src/keys.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('zoom keys work without modifiers and never swallow host zoom shortcuts', () => {
  assert.equal(zoomAction({ key: '+' }), 'in');
  assert.equal(zoomAction({ key: '=' }), 'in');
  assert.equal(zoomAction({ key: '-' }), 'out');
  assert.equal(zoomAction({ key: '_', shiftKey: true }), 'out');
  assert.equal(zoomAction({ key: '0' }), 'fit');
  assert.equal(zoomAction({ key: 'a' }), null);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const key of ['+', '=', '-', '0']) assert.equal(zoomAction({ key, [modifier]: true }), null, `${modifier}+${key} stays with the host`);
  }
});

test('engines.dsh keeps the 0.2.1 release candidates the adapter was verified against', () => {
  // Host-side contract (slots, locale, theme, chat assistant-step) is identical from 0.2.1-rc.2.
  assert.equal(manifest.engines.dsh, '>=0.2.1-rc.2 <0.3.0');
  assert.equal(manifest.engines.node, '>=22');
});

test('client declares only host modules that exist in 0.2.1-rc.2', () => {
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-ui-chat']);
});
