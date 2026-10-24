/**
 * Offline visual preview of the summary card.
 *
 * Builds `tests/.integration-data/preview/index.html` from the INSTALLED DSH
 * Web shell (read-only from app.asar via extract-test-runtime.mjs): the real
 * React, react-dom, ui-primitives and theme CSS, plus this package's shipped
 * lib/client.js. Nothing contacts the running DSH; the page is opened by a
 * headless browser from disk (see scripts/preview.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractPackages, runtimeDir, workspace } from './extract-test-runtime.mjs';

extractPackages(['@deepseek-ai/dsh-web-frontend', '@deepseek-ai/dsh-client-ui-theme']);
const assets = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
const outDir = path.join(workspace, 'tests', '.integration-data', 'preview');
fs.mkdirSync(outDir, { recursive: true });

// 1. Shell JS -> classic scripts exposing the shared module table.
const indexName = fs.readdirSync(assets).find(name => /^index-.*\.js$/.test(name));
let source = fs.readFileSync(path.join(assets, indexName), 'utf8');
const importMatch = source.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
if (!importMatch) throw new Error('Unsupported installed Web shell: vendor import changed');
let vendorSource = fs.readFileSync(path.join(assets, importMatch[2]), 'utf8');
const vendorExport = vendorSource.match(/export\{([^}]+)\};?/);
if (!vendorExport) throw new Error('Unsupported vendor export table');
vendorSource = vendorSource.replace(vendorExport[0], 'globalThis.__vendor={' + vendorExport[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `${JSON.stringify(to ?? from)}:${from}`; }).join(',') + '};');
source = source.replace(importMatch[0], importMatch[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`; }).join(''));
const bootMarkers = [...source.matchAll(/const \w+=globalThis\.dshDesktopBoot/g)];
if (bootMarkers.length !== 1) throw new Error('Unsupported installed Web shell: boot boundary changed');
const boundary = bootMarkers[0].index;
const exportsFunction = source.match(/function (\w+)\(\)\{return\{react:/)?.[1];
if (!exportsFunction) throw new Error('Unsupported installed Web shell: shared module table changed');
source = source.slice(0, boundary).replaceAll('import.meta.url', JSON.stringify('file:///preview/' + indexName));
fs.writeFileSync(path.join(outDir, 'vendor.js'), '(function(){' + vendorSource + '\n})();');
fs.writeFileSync(path.join(outDir, 'shell.js'), '(function(){' + source + `\nglobalThis.__shared = ${exportsFunction}();\n})();`);

// 2. CSS: shell bundles plus the theme plugin's design tokens (string literals).
let css = '';
for (const name of fs.readdirSync(assets).filter(name => name.endsWith('.css')).sort()) css += fs.readFileSync(path.join(assets, name), 'utf8') + '\n';
const theme = fs.readFileSync(path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8');
for (const match of theme.matchAll(/(?:var \w+_css_default|const css) = ("(?:[^"\\]|\\.)*");/g)) css += JSON.parse(match[1]) + '\n';
fs.writeFileSync(path.join(outDir, 'shell.css'), css);

// 3. This package's shipped client and the fixture page.
fs.copyFileSync(path.join(workspace, 'lib', 'client.js'), path.join(outDir, 'client.js'));
fs.copyFileSync(path.join(workspace, 'tests', 'preview-fixture.js'), path.join(outDir, 'fixture.js'));
fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>dsh-session-summary preview</title>
<link rel="stylesheet" href="shell.css">
<style>html,body{margin:0;height:100%}body{font-family:var(--dsh-font-family-text-default);background:var(--dsw-alias-bg-base)}#root{display:flex;gap:24px;padding:24px;align-items:flex-start;flex-wrap:wrap}</style>
</head><body>
<div id="root"></div>
<script>window.__ModuleLoader__={load:function(r){window.__registration=r}};</script>
<script src="vendor.js"></script>
<script src="shell.js"></script>
<script src="client.js"></script>
<script src="fixture.js"></script>
</body></html>
`);
console.log(`Preview written to ${path.join(outDir, 'index.html')}`);
