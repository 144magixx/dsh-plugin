/**
 * Validate the packed npm tarball without extracting or executing anything:
 * every member is a regular file under package/, matches the workspace bytes,
 * the manifest has no install scripts or runtime dependencies, and only the
 * declared distribution files are present. Writes <tgz>.sha256.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.resolve(process.argv[2] ?? path.join(root, 'artifacts', 'dsh-session-summary-0.1.0.tgz'));
if (path.dirname(archive) !== path.join(root, 'artifacts')) throw new Error('Only inspect this workspace artifact directory');
const tar = zlib.gunzipSync(fs.readFileSync(archive));
const required = new Set(['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'LICENSE']);
// The user guide and the screenshots it embeds ship with the package.
const userDocs = new Set(['docs/使用文档.md', 'docs/preview/card-light.png', 'docs/preview/card-dark.png', 'docs/preview/card-light-bottom.png']);
const seen = new Set();
let paxPath;
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  const size = parseInt(field(124, 12).trim() || '0', 8);
  const type = field(156, 1) || '0';
  const body = tar.subarray(offset + 512, offset + 512 + size);
  offset += 512 + Math.ceil(size / 512) * 512;
  if (type === 'x') { paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1]; continue; } // pax: UTF-8 path of the next member
  if (type === 'g') continue;
  const name = paxPath ?? ((field(345, 155) ? field(345, 155) + '/' : '') + field(0, 100));
  paxPath = undefined;
  const parts = name.split('/');
  if (parts[0] !== 'package' || parts.includes('..')) throw new Error(`Unexpected member path: ${name}`);
  if (type !== '0') throw new Error(`Unexpected non-regular member: ${name}`);
  const relative = parts.slice(1).join('/');
  if (seen.has(relative)) throw new Error(`Duplicate member: ${relative}`);
  if (!userDocs.has(relative) && /(^|\/)(\.runtime|\.integration-data|node_modules|\.git|tests|docs|scripts|artifacts)(\/|$)/.test(relative)) throw new Error(`Development file packed: ${relative}`);
  seen.add(relative);
  const expected = fs.readFileSync(path.join(root, relative));
  if (relative === 'package.json') {
    const actual = JSON.parse(body.toString('utf8'));
    if (JSON.stringify(actual) !== JSON.stringify(JSON.parse(expected.toString('utf8')))) throw new Error('Packed manifest differs');
    if (actual.name !== 'dsh-session-summary' || actual.version !== '0.1.0') throw new Error('Unexpected package identity');
    if (actual.dependencies || actual.peerDependencies) throw new Error('Runtime dependencies are not allowed');
    for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) if (actual.scripts?.[script]) throw new Error(`Install script present: ${script}`);
  } else if (!body.equals(expected)) throw new Error(`Archive differs from source: ${relative}`);
}
const missing = [...required, ...userDocs].filter(name => !seen.has(name));
if (missing.length) throw new Error(`Missing distribution members: ${missing.join(', ')}`);
const extra = [...seen].filter(name => !required.has(name) && !userDocs.has(name));
if (extra.length) throw new Error(`Unexpected distribution members: ${extra.join(', ')}`);
const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive + '.sha256', `${digest}  ${path.basename(archive)}\n`);
console.log(`Verified ${seen.size} files; development files excluded; bytes and manifest match the workspace.`);
console.log(`SHA256 ${digest}`);
