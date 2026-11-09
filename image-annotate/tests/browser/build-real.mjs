/**
 * Build tests/browser/.real/ : a page that runs lib/client.js against the
 * installed DSH shell's real React, ReactDOM and ui-primitives plus the real
 * native ui-attachment composer rail (read-only extraction from app.asar).
 * Serve the plugin directory over HTTP and open /tests/browser/.real/index.html.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractPackages, runtimeDir, workspace } from '../../scripts/extract-test-runtime.mjs';

extractPackages(['@deepseek-ai/dsh-web-frontend', '@deepseek-ai/dsh-client-ui-attachment']);
const out = path.join(workspace, 'tests/browser/.real');
fs.mkdirSync(out, { recursive: true });
const modules = path.join(runtimeDir, 'node_modules/@deepseek-ai');
const assets = path.join(modules, 'dsh-web-frontend/dist/assets');
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
if (!sharedName) throw new Error('shared module table not found');
shell = shell.slice(0, markers[0].index).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(assets, entryName)).href));
fs.writeFileSync(path.join(out, 'vendor.js'), '(function(){' + vendor + '\n})();');
fs.writeFileSync(path.join(out, 'shell.js'), '(function(){' + shell + `\nglobalThis.__shared=${sharedName}();\n})();`);
fs.copyFileSync(path.join(modules, 'dsh-client-ui-attachment/lib/client.js'), path.join(out, 'ui-attachment.js'));
const cssFiles = fs.readdirSync(assets).filter(name => name.endsWith('.css'));
for (const css of cssFiles) fs.copyFileSync(path.join(assets, css), path.join(out, css));
const cssTags = cssFiles.map(name => `<link rel="stylesheet" href="${name}">`).join('');
fs.copyFileSync(path.join(workspace, 'tests/browser/fixture.js'), path.join(out, 'fixture.js'));
const version = JSON.parse(fs.readFileSync(path.join(modules, 'dsh-client-ui-attachment/package.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>image-annotate real-shell check (ui-attachment ${version})</title>${cssTags}
<style>body{margin:0;padding:40px;background:var(--dsw-alias-bg-l1,#fff);font:14px system-ui}#composer{max-width:720px;margin:120px auto 0;border:1px solid #ddd;border-radius:20px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}#log{font:12px monospace;white-space:pre-wrap;color:#555;margin-top:12px}</style>
<div id="composer"></div><div id="log"></div>
<script>window.__registrations={};window.__ModuleLoader__={load:r=>{window.__registrations[r.id]=r}};window.__errors=[];addEventListener('error',e=>window.__errors.push(String(e.error?.stack||e.message)));</script>
<script src="vendor.js"></script><script src="shell.js"></script>
<script src="ui-attachment.js"></script>
<script src="../../../lib/client.js"></script><script src="fixture.js"></script>`);
console.log(JSON.stringify({ out, uiAttachment: version }));
