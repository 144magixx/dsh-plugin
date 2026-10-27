/** Build an entirely offline browser page from installed DSH artifacts.
 * Only tests/.integration-data/browser is written; app.asar and profiles are read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openArchive } from '../../session-summary/scripts/extract-test-runtime.mjs';

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outputDir = path.join(workspace, 'tests/.integration-data/browser');

export function buildBrowserFixture() {
  fs.mkdirSync(outputDir, { recursive: true });
  const archive = openArchive();
  const packageRoot = 'dsh/node_modules/@deepseek-ai/';
  const read = name => archive.read(packageRoot + name).toString('utf8');
  try {
    const assetRoot = 'dsh-web-frontend/dist/assets/';
    const html = read('dsh-web-frontend/dist/index.html');
    const entry = html.match(/<script\b[^>]*\bsrc="\.\/assets\/(index-[^"/]+\.js)"/)?.[1];
    if (!entry) throw new Error('Installed Web shell entry changed');
    let shell = read(assetRoot + entry);
    const imports = shell.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
    if (!imports) throw new Error('Installed Web shell vendor import changed');
    let vendor = read(assetRoot + imports[2].slice(2));
    const exports = vendor.match(/export\{([^}]+)\};?/);
    if (!exports) throw new Error('Installed vendor export table changed');
    vendor = vendor.replace(exports[0], 'globalThis.__vendor={' + exports[1].split(',').map(binding => {
      const [from, to] = binding.split(' as ');
      return `${JSON.stringify(to ?? from)}:${from}`;
    }).join(',') + '};');
    shell = shell.replace(imports[0], imports[1].split(',').map(binding => {
      const [from, to] = binding.split(' as ');
      return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`;
    }).join(''));
    const boot = [...shell.matchAll(/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*globalThis\.dshDesktopBoot\b/g)];
    if (boot.length !== 1) throw new Error('Installed shell offline boot boundary changed');
    const shared = shell.match(/function (\w+)\(\)\{return\{react:/)?.[1];
    if (!shared) throw new Error('Installed shell shared module table changed');
    shell = shell.slice(0, boot[0].index).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(outputDir, entry)).href));
    fs.writeFileSync(path.join(outputDir, 'vendor.js'), '(function(){' + vendor + '\n})();');
    fs.writeFileSync(path.join(outputDir, 'shell.js'), '(function(){' + shell + `\nglobalThis.__shared=${shared}();\n})();`);

    let css = '';
    const assets = archive.lookup(packageRoot + assetRoot);
    for (const name of Object.keys(assets.files).filter(name => name.endsWith('.css')).sort()) css += read(assetRoot + name) + '\n';
    const theme = read('dsh-client-ui-theme/lib/client.js');
    for (const m of theme.matchAll(/(?:var \w+_css_default|const css(?:\$\d+)?) = ("(?:[^"\\]|\\.)*");/g)) css += JSON.parse(m[1]) + '\n';
    fs.writeFileSync(path.join(outputDir, 'shell.css'), css);

    // Export one internal facade on the fixture COPY only. Its original methods,
    // Lexical editor, stores, binding validation and attachment state stay intact.
    let native = read('dsh-client-ui-conversation/lib/client.js');
    const marker = 'exports.apply = apply;';
    if (native.split(marker).length !== 2) throw new Error('Native Conversation export boundary changed');
    native = native.replace(marker, 'exports.__BrowserTestInputHub = InputHub; ' + marker);
    fs.writeFileSync(path.join(outputDir, 'native-conversation.js'), native);
    fs.copyFileSync(path.join(workspace, '../session-summary/lib/client.js'), path.join(outputDir, 'summary.js'));
    fs.copyFileSync(path.join(workspace, 'lib/client.js'), path.join(outputDir, 'capability.js'));
    fs.copyFileSync(path.join(workspace, 'tests/browser-fixture.js'), path.join(outputDir, 'fixture.js'));
    fs.writeFileSync(path.join(outputDir, 'index.html'), `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Offline capabilities and summary integration</title><link rel="stylesheet" href="shell.css"></head><body><div id="root"></div><script>window.__registrations={};window.__ModuleLoader__={load:r=>window.__registrations[r.id]=r};window.fetch=()=>{throw Error('Offline fixture forbids network fetch')};</script><script src="vendor.js"></script><script src="shell.js"></script><script src="native-conversation.js"></script><script src="summary.js"></script><script src="capability.js"></script><script src="fixture.js"></script></body></html>`);
    return { outputDir, page: pathToFileURL(path.join(outputDir, 'index.html')).href };
  } finally { archive.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(buildBrowserFixture().page);
