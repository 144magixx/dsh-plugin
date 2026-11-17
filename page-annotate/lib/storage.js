import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_COUNT = 100;
export const MAX_MARKDOWN_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

export class AnnotationError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function checkAbort(signal) {
  if (signal?.aborted) throw new AnnotationError('aborted', 'Annotation saving was cancelled.', 499);
}
function text(value, name, max = 8192) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new AnnotationError('invalid-request', `Invalid ${name}.`);
  }
  return value;
}

/** Select the path dialect explicitly: tests exercise Windows paths on macOS too. */
export function containedSource(root, source, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  text(root, 'workspace root'); text(source, 'sourcePath');
  if (!p.isAbsolute(root)) throw new AnnotationError('invalid-workspace', 'The workspace root must be absolute.');
  if (platform === 'win32') {
    if (/^[a-z]:[^\\/]/i.test(source) || /^\\(?!\\)/.test(source) || /^\/(?!\/)/.test(source)) {
      throw new AnnotationError('outside-workspace', 'Drive-relative and root-relative source paths are not allowed.');
    }
    // Reject ADS/device spellings and malformed segments, while retaining normal drive/UNC roots.
    for (const value of [root, source]) {
      if (/^[\\/]{2}[?.][\\/]/.test(value)) throw new AnnotationError('invalid-path', 'Device paths are not allowed.');
      const tail = value.slice(p.parse(value).root.length);
      if (/[<>:"|?*]/.test(tail) || tail.split(/[\\/]/).some(part => part !== '.' && part !== '..' && /[ .]$/.test(part))) {
        throw new AnnotationError('invalid-path', 'Invalid Windows path.');
      }
    }
  }
  const absolute = p.resolve(root, source);
  const relative = p.relative(p.resolve(root), absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${p.sep}`) || p.isAbsolute(relative)) {
    throw new AnnotationError('outside-workspace', 'The annotated source must be inside this session’s workspace.', 403);
  }
  return { absolute, relative: relative.split(p.sep).join('/') };
}

/** Immutable request validation. No filename supplied by the client is ever used for output. */
export function validateSave(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AnnotationError('invalid-request', 'A JSON object is required.');
  const sessionId = text(value.sessionId, 'sessionId', 256);
  const sourcePath = text(value.sourcePath, 'sourcePath');
  if (!Number.isSafeInteger(value.count) || value.count < 1 || value.count > MAX_COUNT) throw new AnnotationError('invalid-count', 'count must be between 1 and 100.');
  if (typeof value.markdown !== 'string' || !value.markdown.trim() || Buffer.byteLength(value.markdown, 'utf8') > MAX_MARKDOWN_BYTES || value.markdown.includes('\0')) {
    throw new AnnotationError('invalid-markdown', 'Markdown must be nonempty and at most 256 KiB.');
  }
  if (!Array.isArray(value.images) || value.images.length > value.count) throw new AnnotationError('invalid-images', 'images must be an array with at most count entries.');
  let total = 0;
  const numbers = new Set();
  const images = value.images.map(image => {
    if (!image || !Number.isSafeInteger(image.number) || image.number < 1 || image.number > 1000000 || numbers.has(image.number)) {
      throw new AnnotationError('invalid-images', 'Image numbers must be distinct positive integers (up to 1000000).');
    }
    numbers.add(image.number);
    if (typeof image.data !== 'string' || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || image.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(image.data) || !/^[^=]*={0,2}$/.test(image.data)) {
      throw new AnnotationError('invalid-image', 'Expected base64 PNG, at most 8 MiB per image.');
    }
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR' || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) {
      throw new AnnotationError('invalid-image', 'Expected a PNG image with a valid IHDR.');
    }
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new AnnotationError('images-too-large', 'Images exceed the 24 MiB total limit.', 413);
    return { number: image.number, bytes };
  });
  return { sessionId, sourcePath, count: value.count, markdown: value.markdown, images };
}

/** Authoritative membership only: client cwd/root is intentionally ignored. */
export function workspaceForSession(registry, sessionId) {
  const matches = registry.list().filter(workspace => workspace.sessionIds.includes(sessionId));
  if (matches.length !== 1) throw new AnnotationError('workspace-unavailable', 'The session does not belong to one available workspace.', 409);
  return matches[0].path;
}
export function batchName(now = new Date(), random = randomUUID()) {
  return `${now.toISOString().replace(/[-:.]/g, '')}-${random}`;
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
async function directoryIdentity(target) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AnnotationError('unsafe-path', 'Annotation directories must be real directories, not links.', 409);
  return stat;
}

/**
 * Creates one private batch, with no overwrites. Ancestors are checked before
 * every mutation; open handles use O_EXCL/O_NOFOLLOW where available. Portable
 * Node has no openat directory-relative API: identity checks reject observable
 * swaps, but a hostile external process racing directory renames cannot be
 * made completely race-free with these cross-platform primitives.
 */
export async function saveAnnotations(registry, input, signal) {
  const data = validateSave(input);
  checkAbort(signal);
  const registeredRoot = workspaceForSession(registry, data.sessionId);
  const workspaceRoot = await fs.realpath(registeredRoot);
  checkAbort(signal);
  const rootStat = await directoryIdentity(workspaceRoot);
  const source = containedSource(registeredRoot, data.sourcePath);
  // Real-path containment also rejects a source symlink leaving the workspace.
  const realSource = await fs.realpath(source.absolute);
  containedSource(workspaceRoot, realSource);
  if (!(await fs.stat(realSource)).isFile()) throw new AnnotationError('invalid-source', 'The annotated source is not a file.');
  checkAbort(signal);
  const identities = [[workspaceRoot, rootStat]];
  const verify = async () => {
    checkAbort(signal);
    for (const [dir, identity] of identities) {
      const current = await directoryIdentity(dir);
      if (!sameFile(identity, current) || await fs.realpath(dir) !== dir) throw new AnnotationError('unsafe-path', 'An annotation directory changed while saving.', 409);
    }
    checkAbort(signal);
  };
  let parent = workspaceRoot;
  for (const segment of ['.dsh', 'annotations']) {
    await verify();
    parent = path.join(parent, segment);
    try { await fs.mkdir(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    identities.push([parent, await directoryIdentity(parent)]);
  }
  await verify();
  const ignore = path.join(parent, '.gitignore');
  // Never rewrite an existing user file; if it does not hide everything, fail
  // with an actionable error rather than silently exposing private notes.
  try { await fs.writeFile(ignore, '*\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await fs.lstat(ignore);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new AnnotationError('unsafe-ignore', 'Existing annotations/.gitignore must be a small regular file.', 409);
    const handle = await fs.open(ignore, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!sameFile(info, opened)) throw new AnnotationError('unsafe-ignore', '.gitignore changed while opening.', 409);
      const lines = (await handle.readFile('utf8')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      if (!lines.includes('*') || lines.some(line => line.startsWith('!'))) throw new AnnotationError('ignore-conflict', 'annotations/.gitignore already exists. Add a standalone * rule and remove negations before saving.', 409);
    } finally { await handle.close(); }
  }
  await verify();
  const batch = path.join(parent, batchName());
  // mkdir is exclusive (no recursive flag) so no pre-existing directory is owned.
  await fs.mkdir(batch, { mode: 0o700 });
  const batchStat = await directoryIdentity(batch);
  identities.push([batch, batchStat]);
  const created = [];
  try {
    const write = async (name, bytes) => {
      await verify();
      const target = path.join(batch, name);
      const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      const identity = await handle.stat();
      created.push([target, identity]);
      try { await handle.writeFile(bytes, { signal }); } finally { await handle.close(); }
      checkAbort(signal);
    };
    for (const image of data.images) await write(`annotation-${image.number}.png`, image.bytes);
    const filename = `${data.count}条批注.md`;
    await write(filename, data.markdown);
    await verify();
    const absolutePath = path.join(batch, filename);
    return { workspaceRoot, absolutePath, relativePath: path.relative(workspaceRoot, absolutePath).split(path.sep).join('/'), count: data.count };
  } catch (error) {
    // Delete only our exact new files, never recurse through a path that may
    // have been swapped. Ancestor identity validation ignores cancellation.
    try {
      for (const [dir, identity] of identities) if (!sameFile(identity, await directoryIdentity(dir))) throw new Error('changed');
      for (const [target, identity] of created.reverse()) {
        const current = await fs.lstat(target).catch(() => null);
        if (current && sameFile(identity, current) && current.isFile() && !current.isSymbolicLink()) await fs.unlink(target);
      }
      if (sameFile(batchStat, await directoryIdentity(batch))) await fs.rmdir(batch);
    } catch { /* Refuse cleanup when identity is no longer provable. */ }
    throw error;
  }
}
