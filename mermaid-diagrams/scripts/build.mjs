import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { mermaidPlugin, REQUIRED_PATCHES } from './mermaid-plugin.mjs';

const patchedFiles = [];
const result = await build({
  entryPoints: ['src/client.jsx'], bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react'], loader: { '.css': 'text' }, plugins: [mermaidPlugin(patchedFiles)],
  minify: true, legalComments: 'inline', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' }
});
for (const prefix of REQUIRED_PATCHES) {
  if (!patchedFiles.some(file => file.startsWith(prefix))) throw new Error(`Missing owned-DOM adaptation: ${prefix}`);
}
if (Object.keys(result.metafile.inputs).some(file => /[/\\]elkjs[/\\]/.test(file))) throw new Error('ELK engine was bundled');
const code = result.outputFiles[0].text;
const artifact = `window.__ModuleLoader__.load({id:'dsh-mermaid-diagrams',factory(require){var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`;
await fs.mkdir('lib', { recursive: true });
await fs.writeFile('lib/client.js', artifact);
console.log(JSON.stringify({ output: 'lib/client.js', bytes: Buffer.byteLength(artifact), externalModules: ['react'] }));
