/**
 * Node adapter for the exact shipped classic-script Client factory. Only pure
 * helpers run here; DOM behavior is covered by the real-shell browser check.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
export const requested = [];
let registration;
runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
  console, setTimeout, clearTimeout,
}, { filename: 'dsh-image-annotate/client.js', timeout: 1000 });
if (registration?.id !== 'dsh-image-annotate') throw new Error('Unexpected Client module registration');
const ReactStub = Object.freeze({ createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useState() {}, useRef() {}, useEffect() {}, useLayoutEffect() {}, useCallback() {} });
export const client = registration.factory((id) => {
  requested.push(id);
  if (id === 'react') return ReactStub;
  throw new Error(`Unavailable in Node: ${id}`);
});
