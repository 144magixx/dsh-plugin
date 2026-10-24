/**
 * Copy the exact host icon markup the card uses out of the INSTALLED Web shell
 * (read-only), as the DSH plugin guide recommends ("copy markup ... from the
 * primitive into the plugin" instead of requiring ui-primitives at runtime).
 *
 * Usage: node scripts/extract-host-icons.mjs  -> prints a JSON table that is
 * pasted into lib/client.js as HOST_ICONS. Nothing is written elsewhere.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOfflineClient } from '../tests/integration-client-runtime.mjs';

export const ICON_NAMES = {
  list: 'IconFlatListOutlineRegular',
  pin: 'IconPinOutlineRegular',
  pinFill: 'IconPinFillRegular',
  ellipsis: 'IconEllipsisOutlineRegular',
  close: 'IconCloseOutlineRegular',
  chevronDown: 'IconChevronDownOutlineRegular',
  folder: 'IconFolderCloseRegular',
  file: 'IconDeliverDocRegular',
  globe: 'IconGlobeOutlineRegular',
  api: 'IconApiOutlineRegular',
  skill: 'IconSkillOutlineRegular',
  link: 'IconLinkOutlineRegular',
  branch: 'IconBranchOutlineRegular',
  rightUp: 'IconRightUpOutlineRegular',
  checklist: 'IconChecklistOutlineRegular',
  goal: 'IconGoalOutlineRegular',
  plan: 'IconPlanOutlineRegular',
  copy: 'IconCopyOutlineRegular',
  refresh: 'IconRefreshOutlineRegular',
  tree: 'IconWorkspaceTreeOutlineRegular',
};

function flatten(element, React) {
  if (element === null || element === undefined || typeof element === 'boolean') return [];
  if (Array.isArray(element)) return element.flatMap(child => flatten(child, React));
  if (typeof element.type === 'function') return flatten(element.type(element.props), React);
  if (element.type === React.Fragment) return flatten(element.props.children, React);
  return [element];
}
function describe(element, React) {
  const { children, ...attrs } = element.props;
  for (const key of Object.keys(attrs)) if (attrs[key] === undefined || key === 'className' || key === 'aria-hidden' || key === 'width' || key === 'height' || key === 'xmlns') delete attrs[key];
  const kids = flatten(children, React).map(child => describe(child, React));
  return kids.length ? [element.type, attrs, kids] : [element.type, attrs];
}

export async function extractHostIcons() {
  const runtime = await loadOfflineClient();
  const React = runtime.staticModules.react;
  const primitives = runtime.staticModules['@deepseek-ai/dsh-client-ui-primitives'];
  const table = {};
  for (const [key, name] of Object.entries(ICON_NAMES)) {
    const component = primitives[name];
    if (typeof component !== 'function') throw new Error(`Host icon missing: ${name}`);
    const [svg] = flatten(React.createElement(component, { size: 16 }), React);
    table[key] = describe(svg, React);
  }
  return table;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await extractHostIcons()));
}
