// One active scope per serialized Mermaid render. These are real DOM nodes.
let currentRoot;
export function setRenderRoot(root) { currentRoot = root; }
export function renderRoot() {
  if (!currentRoot) throw new Error('Mermaid render scope is not active');
  return currentRoot;
}
export function renderQuery(selector) {
  return selector === 'body' ? renderRoot() : renderRoot().querySelector(selector);
}
export function renderElement(id) {
  return renderRoot().querySelector(`[id="${CSS.escape(String(id))}"]`);
}
export function renderSelect(select, target) {
  return select(typeof target === 'string' ? renderQuery(target) : target);
}
