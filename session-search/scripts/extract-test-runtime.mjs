import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only ASAR access; all output is confined to scripts/.runtime.
export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeDir = path.join(workspace, 'scripts', '.runtime');
// Usual install locations of the DSH Desktop app archive. DSH_TEST_ASAR wins.
export function archiveCandidates(platform = process.platform, env = process.env) {
  const app = 'DeepSeek Harness';
  if (platform === 'darwin') return [
    `/Applications/${app}.app/Contents/Resources/app.asar`,
    path.join(os.homedir(), 'Applications', `${app}.app`, 'Contents', 'Resources', 'app.asar'),
  ];
  if (platform === 'win32') return [
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', app, 'resources', 'app.asar'),
    env.ProgramFiles && path.win32.join(env.ProgramFiles, app, 'resources', 'app.asar'),
    `D:\\${app}\\resources\\app.asar`,
  ].filter(Boolean);
  return [`/opt/${app}/resources/app.asar`];
}
export const archivePath = process.env.DSH_TEST_ASAR || archiveCandidates().find(candidate => fs.existsSync(candidate)) || archiveCandidates()[0];
export function openArchive(filename = archivePath) {
  if (!fs.existsSync(filename)) throw new Error(`Installed DSH app.asar not found at ${filename}. Set DSH_TEST_ASAR to its path (macOS: /Applications/DeepSeek Harness.app/Contents/Resources/app.asar; Windows: <install dir>\\resources\\app.asar).`);
  const fd = fs.openSync(filename, 'r');
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, 16, 0);
  const headerSize = prefix.readUInt32LE(4);
  const jsonSize = prefix.readUInt32LE(12);
  const buffer = Buffer.alloc(jsonSize);
  fs.readSync(fd, buffer, 0, jsonSize, 16);
  const header = JSON.parse(buffer.toString());
  const dataOffset = 8 + headerSize;
  const lookup = (name) => name.split('/').filter(Boolean).reduce((node, part) => node?.files?.[part], header);
  function read(name) {
    const item = lookup(name);
    if (!item) throw new Error(`ASAR entry missing: ${name}`);
    if (item.link) return read(item.link);
    if (item.unpacked) return fs.readFileSync(path.join(filename + '.unpacked', ...name.split('/')));
    const bytes = Buffer.alloc(Number(item.size));
    fs.readSync(fd, bytes, 0, bytes.length, dataOffset + Number(item.offset));
    return bytes;
  }
  return { fd, header, lookup, read, close: () => fs.closeSync(fd) };
}

export function extractPackages(packageNames) {
  const archive = openArchive();
  const copied = new Set();
  const missing = new Set();
  let fileCount = 0;
  let byteCount = 0;
  const root = 'dsh/node_modules/';
  function copyTree(source, destination) {
    const node = archive.lookup(source);
    if (!node) throw new Error(`ASAR entry missing: ${source}`);
    if (node.link) return copyTree(node.link, destination);
    if (node.files) {
      for (const name of Object.keys(node.files)) copyTree(`${source}/${name}`, path.join(destination, name));
      return;
    }
    const resolved = path.resolve(destination);
    if (!resolved.startsWith(runtimeDir + path.sep)) throw new Error(`Refusing output outside test runtime: ${resolved}`);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const contents = archive.read(source);
    // Existing identical extracted dependencies need no write.
    if (!fs.existsSync(resolved) || !fs.readFileSync(resolved).equals(contents)) fs.writeFileSync(resolved, contents);
    fileCount++;
    byteCount += contents.length;
  }
  function visit(name, optional = false) {
    if (copied.has(name)) return;
    const location = root + name;
    if (!archive.lookup(location)) {
      if (optional) { missing.add(name); return; }
      throw new Error(`Required installed dependency missing: ${name}`);
    }
    copied.add(name);
    const manifest = JSON.parse(archive.read(location + '/package.json'));
    copyTree(location, path.join(runtimeDir, 'node_modules', ...name.split('/')));
    const optionalNames = new Set(Object.keys(manifest.optionalDependencies || {}));
    for (const dependency of Object.keys(manifest.dependencies || {})) visit(dependency, optionalNames.has(dependency));
    for (const dependency of Object.keys(manifest.optionalDependencies || {})) visit(dependency, true);
    for (const dependency of Object.keys(manifest.peerDependencies || {})) visit(dependency, true);
  }
  try {
    for (const name of packageNames) visit(name);
    const manifest = { type: 'module', private: true, description: 'Isolated read-only copy of installed DSH test dependencies; never a profile' };
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { packages: [...copied].sort(), optionalMissing: [...missing].sort(), fileCount, byteCount, runtimeDir };
  } finally { archive.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requested = process.argv.slice(2);
  const result = extractPackages(requested.length ? requested : ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-session-turn-outline', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-storage-json', '@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-web-frontend']);
  console.log(JSON.stringify(result, null, 2));
}
