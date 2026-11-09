/**
 * Build tests/browser/.real/ : a page that runs lib/client.js against the
 * installed DSH shell's real React, ReactDOM and ui-primitives (read-only
 * extraction from app.asar), with a fake transport for the plugin routes.
 * Serve the plugin directory over HTTP and open /tests/browser/.real/index.html.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractPackages, runtimeDir, workspace } from '../../scripts/extract-test-runtime.mjs';

extractPackages(['@deepseek-ai/dsh-web-frontend']);
const out = path.join(workspace, 'tests/browser/.real');
fs.mkdirSync(out, { recursive: true });
const assets = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
const indexHtml = fs.readFileSync(path.join(assets, '../index.html'), 'utf8');
const entryName = indexHtml.match(/src="\.\/assets\/(index-[^"/]+\.js)"/)?.[1];
if (!entryName) throw new Error('installed shell entry not found');
let shell = fs.readFileSync(path.join(assets, entryName), 'utf8');
const imports = shell.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
let vendor = imports ? fs.readFileSync(path.join(assets, imports[2]), 'utf8') : '';
if (imports) {
  const vendorExports = vendor.match(/export\{([^}]+)\};?/);
  vendor = vendor.replace(vendorExports[0], 'globalThis.__vendor={' + vendorExports[1].split(',').map(b => { const [from, to] = b.split(' as '); return `${JSON.stringify(to ?? from)}:${from}`; }).join(',') + '};');
  shell = shell.replace(imports[0], imports[1].split(',').map(b => { const [from, to] = b.split(' as '); return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`; }).join(''));
}
const markers = [...shell.matchAll(/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*globalThis\.dshDesktopBoot\b/g)];
if (markers.length !== 1) throw new Error('offline boot boundary changed');
const sharedName = shell.match(/function (\w+)\(\)\{return\{react:/)?.[1];
shell = shell.slice(0, markers[0].index).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(assets, entryName)).href));
fs.writeFileSync(path.join(out, 'vendor.js'), '(function(){' + vendor + '\n})();');
fs.writeFileSync(path.join(out, 'shell.js'), '(function(){' + shell + `\nglobalThis.__shared=${sharedName}();\n})();`);
for (const css of fs.readdirSync(assets).filter(name => name.endsWith('.css'))) fs.copyFileSync(path.join(assets, css), path.join(out, css));
const cssTags = fs.readdirSync(assets).filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="${name}">`).join('');
fs.copyFileSync(path.join(workspace, 'tests/browser/real-fixture.js'), path.join(out, 'fixture.js'));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>selection-ask real-shell check</title>${cssTags}
<style>body{padding:24px}</style>
<section data-conversation-scroll><div data-chat-flow-kind="turn-process" data-chat-turn="2"><pre id="tool">npm test passed: 28 tests</pre></div></section>
<div id="overlay"></div><div id="tab" style="position:fixed;right:0;top:0;width:460px;height:100vh;border-left:1px solid #ddd"></div>
<script>window.__ModuleLoader__={load:r=>{window.__registration=r}};window.__errors=[];addEventListener('error',e=>window.__errors.push(String(e.error?.stack||e.message)));</script>
<script src="vendor.js"></script><script src="shell.js"></script>
<script src="../../../lib/client.js"></script><script>
  const which = new URLSearchParams(location.search).get('real');
  if (which) { const request = new XMLHttpRequest(); request.open('GET', 'real-views.json', false); request.send(); window.__REAL_VIEW = JSON.parse(request.responseText)[which]; }
</script><script src="fixture.js"></script>`);
console.log(out);
