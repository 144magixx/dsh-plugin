import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
export function loadClient(timers = { setTimeout, clearTimeout }) {
  let plugin;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(definition) { plugin = definition.factory(() => ({})); } } },
    AbortController, TextDecoder, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });
  return plugin.__test;
}
