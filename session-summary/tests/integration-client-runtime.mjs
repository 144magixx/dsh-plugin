import '../scripts/offline-test-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { extractPackages, runtimeDir, workspace } from '../scripts/extract-test-runtime.mjs';

export const RUNTIME_PACKAGES = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-web-frontend'];

/**
 * Evaluate the installed Web shell only up to its explicit boot invocation.
 * This exposes the exact bundled React/ReactDOM/Cordis/slots/primitives; no
 * replacement packages. Read-only extraction from the installed app.asar.
 */
export async function loadOfflineClient() {
  extractPackages(RUNTIME_PACKAGES);
  const assets = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
  const filename = fs.readdirSync(assets).find(name => /^index-.*\.js$/.test(name));
  let source = fs.readFileSync(path.join(assets, filename), 'utf8');
  const importMatch = source.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
  if (!importMatch) throw new Error('Unsupported installed Web shell: vendor import changed');
  let vendorSource = fs.readFileSync(path.join(assets, importMatch[2]), 'utf8');
  const vendorExport = vendorSource.match(/export\{([^}]+)\};?/);
  if (!vendorExport) throw new Error('Unsupported vendor export table');
  vendorSource = vendorSource.replace(vendorExport[0], 'globalThis.__vendor={' + vendorExport[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `${JSON.stringify(to ?? from)}:${from}`; }).join(',') + '};');
  source = source.replace(importMatch[0], importMatch[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`; }).join(''));
  const markers = [...source.matchAll(/const \w+=globalThis\.dshDesktopBoot/g)];
  if (markers.length !== 1) throw new Error('Unsupported installed Web shell: offline boot boundary changed');
  source = source.slice(0, markers[0].index).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(assets, filename)).href));
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
    boot: { rev: 'isolated-test', release: { version: '0.2.1-rc.3' }, entries: [], batches: [] }, staticModules,
    loadBundle() { throw new Error('Offline module loader cannot load URLs'); },
  });
  context.__ModuleLoader__ = facade;
  function register(relative) {
    const full = path.resolve(workspace, relative);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: full });
  }
  return { context, staticModules, modules, register };
}
