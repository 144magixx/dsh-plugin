import '../scripts/offline-test-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { runtimeDir, workspace } from '../scripts/extract-test-runtime.mjs';

// Evaluate the shipped Web shell only up to its explicit boot invocation. This
// exposes the exact bundled React/ReactDOM/Cordis/slots; no replacement packages.
export async function loadOfflineClient() {
  const assets = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
  // Use the current entry point, not a stale hashed file left by an older extraction.
  const html = fs.readFileSync(path.join(assets, '..', 'index.html'), 'utf8');
  const filename = html.match(/<script\b[^>]*\bsrc="\.\/assets\/(index-[^"/]+\.js)"/)?.[1];
  if (!filename) throw new Error('Unsupported installed Web shell: module entry changed');
  let source = fs.readFileSync(path.join(assets, filename), 'utf8');
  const importMatch = source.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
  if (!importMatch) throw new Error('Unsupported installed Web shell: vendor import changed');
  let vendorSource = fs.readFileSync(path.join(assets, importMatch[2]), 'utf8');
  const vendorExport = vendorSource.match(/export\{([^}]+)\};?/);
  if (!vendorExport) throw new Error('Unsupported vendor export table');
  vendorSource = vendorSource.replace(vendorExport[0], 'globalThis.__vendor={' + vendorExport[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `${JSON.stringify(to ?? from)}:${from}`; }).join(',') + '};');
  source = source.replace(importMatch[0], importMatch[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`; }).join(''));
  // The minifier's binding name changes between builds; the Desktop boot API does not.
  const bootMarkers = [...source.matchAll(/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*globalThis\.dshDesktopBoot\b/g)];
  if (bootMarkers.length !== 1) throw new Error('Unsupported installed Web shell: offline boot boundary changed');
  const boundary = bootMarkers[0].index;
  source = source.slice(0, boundary).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(assets, filename)).href));
  const exportsFunction = source.match(/function (\w+)\(\)\{return\{react:/)?.[1];
  if (!exportsFunction) throw new Error('Unsupported installed Web shell: shared module table changed');
  const element = tag => ({ tagName: tag.toUpperCase(), style: {}, dataset: {}, relList: { supports: () => true }, setAttribute() {}, appendChild() {}, append() {}, prepend() {}, remove() {}, addEventListener() {}, removeEventListener() {} });
  const context = vm.createContext({ console, URL, URLSearchParams, AbortController, AbortSignal, TextEncoder, TextDecoder, Request, Response, Headers, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance, structuredClone,
    document: { compatMode: 'CSS1Compat', createElement: element, addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, querySelectorAll: () => [], body: element('body'), head: element('head') },
    navigator: { userAgent: 'DSH isolated offline test' }, location: { href: 'http://offline.invalid/', protocol: 'http:' },
    addEventListener() {}, removeEventListener() {},
    fetch() { throw new Error('Offline client tests cannot fetch'); },
  });
  context.window = context; context.self = context;
  vm.runInContext('(function(){' + vendorSource + '\n})();', context, { filename: 'vendor-offline.js', timeout: 10000 });
  vm.runInContext(source + `\nglobalThis.__offlineStatic = ${exportsFunction}();`, context, { filename, timeout: 10000 });
  const staticModules = context.__offlineStatic;
  let bootstrap;
  context.__ModuleLoader__ = { load: registration => { bootstrap = registration; } };
  const modulePath = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-client-modules/lib/client.js');
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  const bootstrapExports = bootstrap.factory(() => { throw new Error('Module bootstrap requested external dependency'); });
  const facade = { mode: 'queue', pendingQueue: [] };
  const modules = bootstrapExports.createClientModuleSystem(facade, { id: bootstrap.id, exports: bootstrapExports }, {
    boot: { rev: 'isolated-test', release: { version: '0.2.1-rc.2' }, entries: [], batches: [] }, staticModules,
    loadBundle() { throw new Error('Offline module loader cannot load URLs'); },
  });
  context.__ModuleLoader__ = facade;
  function register(relative) {
    const full = path.resolve(workspace, relative);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: full });
  }
  return { context, staticModules, modules, register };
}
