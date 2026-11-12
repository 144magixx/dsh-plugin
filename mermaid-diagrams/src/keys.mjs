/**
 * Zoom shortcut for the expanded diagram. Cmd/Ctrl/Alt combinations belong to the
 * host (app and browser zoom: Cmd+= / Ctrl+=, Cmd+- / Ctrl+-, Cmd+0 / Ctrl+0).
 * @returns {'in'|'out'|'fit'|null}
 */
export function zoomAction(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-' || event.key === '_') return 'out';
  if (event.key === '0') return 'fit';
  return null;
}
