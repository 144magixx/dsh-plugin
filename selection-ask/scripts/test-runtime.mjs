import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { runtimeDir } from './extract-test-runtime.mjs';

const require = createRequire(path.join(runtimeDir, 'package.json'));
export function installRuntimeResolution() {
  return registerHooks({ resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':')) {
      try { return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(runtimeDir, 'package.json')).href }); }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }
    }
    return nextResolve(specifier, context);
  }});
}
export async function runtimeImport(name) { return import(pathToFileURL(require.resolve(name)).href); }
export function runtimeFile(name) { return require.resolve(name); }
export function assertRuntimeExtracted() {
  if (!fs.existsSync(path.join(runtimeDir, 'package.json'))) throw new Error('Run scripts/extract-test-runtime.mjs first (uses only the installed ASAR).');
}
