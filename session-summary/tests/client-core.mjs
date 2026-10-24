/**
 * Node ESM test adapter for the exact shipped classic-script Client factory.
 * Pure helpers are tested here; React rendering is covered by the real shell
 * runtime (integration test) and the headless preview.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
export const requested = [];
let registration;
runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
  URL, URLSearchParams, AbortController, console,
}, { filename: 'dsh-session-summary/client.js', timeout: 1000 });
if (registration?.id !== 'dsh-session-summary') throw new Error('Unexpected Client module registration');

const ReactStub = Object.freeze({
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  createContext: (value) => ({ Provider: 'Provider', _default: value }),
  Fragment: 'Fragment',
});
export const client = registration.factory((id) => {
  requested.push(id);
  if (id !== 'react') throw new Error(`Unexpected browser import: ${id}`);
  return ReactStub;
});
