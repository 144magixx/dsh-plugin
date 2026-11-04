import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scopePath = fileURLToPath(new URL('../src/render-scope.mjs', import.meta.url));

/** Build-time adaptation of Mermaid: owned render root, no external images, no ELK. */
export function mermaidPlugin(patchedFiles = []) {
  return {
    name: 'mermaid-owned-dom',
    setup(builder) {
      // ELK is reachable only through layout configuration, which the plugin rejects,
      // or the explicit flowchart-elk keyword. Replace its 1.5 MB engine with an error.
      builder.onResolve({ filter: /^elkjs(?:\/|$)/ }, () => ({ path: 'elk-unsupported', namespace: 'dshmd-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'dshmd-stub' }, () => ({
        contents: 'export default class ELK { constructor() { throw new Error("elkUnsupported"); } }',
        loader: 'js'
      }));
      builder.onLoad({ filter: /(?:mermaid|cytoscape)[/\\].*\.(?:mjs|js)$/ }, async ({ path: file }) => {
        let content = await fs.readFile(file, 'utf8');
        const original = content;
        // Rewrite only calls in the renderer's bundled modules. Never patch d3 or document globally.
        content = content.replace(/(?<![\w.])(select\d*|d3select)\(/g, '__dshSelect($1, ');
        content = content.replace(/(?<![\w.])document\.body\b/g, '__dshRoot()');
        content = content.replace(/(?<![\w.])document\.querySelector\(/g, '__dshQuery(');
        content = content.replace(/(?<![\w.])document\.getElementById\(/g, '__dshElement(');
        content = content.replace('async function imageSquare(parent, node, { config: { flowchart } }) {', 'async function imageSquare(parent, node, { config: { flowchart } }) { throw new Error("externalStyle");');
        content = content.replace(/container: __dshElement\("cy"\)/g, 'container: renderEl.node()');
        if (content === original) return;
        patchedFiles.push(path.basename(file));
        content = `import {renderRoot as __dshRoot,renderQuery as __dshQuery,renderElement as __dshElement,renderSelect as __dshSelect} from ${JSON.stringify(scopePath)};\n` + content;
        return { contents: content, loader: 'js', resolveDir: path.dirname(file) };
      });
    }
  };
}

export const REQUIRED_PATCHES = ['chunk-6MUBBAK2', 'chunk-BG4553SI', 'chunk-HFQBQIA3', 'cose-bilkent-', 'architectureDiagram-', 'mermaid.core'];
