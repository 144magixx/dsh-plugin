import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { batchName, containedSource, saveAnnotations, validateSave, workspaceForSession, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from '../lib/storage.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=';
const request = (root, patch = {}) => ({ sessionId: 's1', sourcePath: path.join(root, 'source.html'), markdown: '# 页面批注\n\n提问：什么意思？\n截图：annotation-4.png\n', count: 1, images: [{ number: 4, data: png }], ...patch });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'page-annotations-'));
  await fs.writeFile(path.join(root, 'source.html'), '<h1>Source</h1>');
  t.after(async () => { const actual = await fs.realpath(root); assert.equal(actual, path.resolve(actual)); await fs.rm(actual, { recursive: true, force: true }); });
  return { root, registry: { list: () => [{ path: root, sessionIds: ['s1'] }] } };
}
test('Windows-safe batch names and platform-specific containment', () => {
  assert.match(batchName(new Date('2026-11-15T03:30:00.123Z'), 'abc'), /^20261115T033000123Z-abc$/);
  assert.deepEqual(containedSource('C:\\Project', 'C:\\Project\\docs\\中文.html', 'win32'), { absolute: 'C:\\Project\\docs\\中文.html', relative: 'docs/中文.html' });
  assert.equal(containedSource('C:\\Project', 'c:\\project\\x.html', 'win32').relative, 'x.html');
  assert.equal(containedSource('\\\\server\\share\\work', 'docs\\x.html', 'win32').relative, 'docs/x.html');
  for (const bad of ['..\\escape.html', 'D:\\x.html', 'C:relative.html', '\\rooted.html', 'x.html:stream', '\\\\?\\C:\\Project\\x.html']) assert.throws(() => containedSource('C:\\Project', bad, 'win32'));
  assert.throws(() => containedSource('/a', '/ab/x.html', 'linux'));
  assert.equal(containedSource('/a', 'nested/x.html', 'linux').relative, 'nested/x.html');
});
test('membership uses registry sessionIds; missing and ambiguous sessions fail', () => {
  assert.equal(workspaceForSession({ list: () => [{ path: '/root', sessionIds: ['s'] }] }, 's'), '/root');
  assert.throws(() => workspaceForSession({ list: () => [] }, 's'));
  assert.throws(() => workspaceForSession({ list: () => [{ path: '/a', sessionIds: ['s'] }, { path: '/b', sessionIds: ['s'] }] }, 's'));
});
test('validates Markdown/count/image sizes and unique PNG numbers before writing', () => {
  const input = request('/a');
  assert.equal(validateSave(input).images[0].bytes.length, Buffer.from(png, 'base64').length);
  for (const patch of [{ count: 0 }, { count: 101 }, { markdown: '' }, { markdown: 'x'.repeat(256 * 1024 + 1) }, { images: [{ number: -1, data: png }] }, { images: [{ number: 1, data: 'AAAA' }] }, { count: 2, images: [{ number: 1, data: png }, { number: 1, data: png }] }]) assert.throws(() => validateSave({ ...input, ...patch }));
  const large = Buffer.alloc(MAX_IMAGE_BYTES + 1); Buffer.from(png, 'base64').copy(large);
  assert.throws(() => validateSave({ ...input, images: [{ number: 1, data: large.toString('base64') }] }));
  const padded = Buffer.alloc(MAX_TOTAL_IMAGE_BYTES / 4 + 1); Buffer.from(png, 'base64').copy(padded);
  assert.throws(() => validateSave({ ...input, count: 4, images: Array.from({ length: 4 }, (_, i) => ({ number: i + 1, data: padded.toString('base64') })) }), error => error.code === 'images-too-large');
  assert.equal(validateSave({ ...input, images: [{ number: 1, data: padded.toString('base64') }] }).images[0].bytes.length, padded.length);
});
test('saves private batch under canonical workspace, preserves source, unique batches', async t => {
  const { root, registry } = await fixture(t);
  const result = await saveAnnotations(registry, request(root), new AbortController().signal);
  assert.equal(result.workspaceRoot, await fs.realpath(root));
  assert.match(result.relativePath, /^\.dsh\/annotations\/[^:]+\/1条批注\.md$/);
  assert.equal(await fs.readFile(result.absolutePath, 'utf8'), request(root).markdown);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(result.absolutePath), 'annotation-4.png')), Buffer.from(png, 'base64'));
  assert.equal(await fs.readFile(path.join(root, '.dsh', 'annotations', '.gitignore'), 'utf8'), '*\n');
  assert.equal(await fs.readFile(path.join(root, 'source.html'), 'utf8'), '<h1>Source</h1>');
  const second = await saveAnnotations(registry, request(root, { images: [] }), new AbortController().signal);
  assert.notEqual(second.absolutePath, result.absolutePath);
});
test('ignores attacker cwd and refuses outside/source symlink escapes', async t => {
  const { root, registry } = await fixture(t);
  const result = await saveAnnotations(registry, request(root, { cwd: '/wrong', workspaceRoot: '/wrong', images: [] }), new AbortController().signal);
  assert.equal(result.workspaceRoot, await fs.realpath(root));
  await assert.rejects(saveAnnotations(registry, request(root, { sourcePath: path.join(root, '..', 'outside') })), /inside/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'annotations-outside-'));
  await fs.writeFile(path.join(outside, 'x.html'), 'outside');
  t.after(async () => { assert.ok(outside.startsWith(os.tmpdir())); await fs.rm(outside, { recursive: true, force: true }); });
  await fs.symlink(path.join(outside, 'x.html'), path.join(root, 'linked.html'));
  await assert.rejects(saveAnnotations(registry, request(root, { sourcePath: path.join(root, 'linked.html') })), /inside/);
});
test('refuses symlink/junction output directories without touching target', async t => {
  const { root, registry } = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'annotations-link-'));
  t.after(async () => { assert.ok(outside.startsWith(os.tmpdir())); await fs.rm(outside, { recursive: true, force: true }); });
  await fs.symlink(outside, path.join(root, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(saveAnnotations(registry, request(root)), /real directories/);
  assert.deepEqual(await fs.readdir(outside), []);
});
test('preserves pre-existing gitignore and refuses negation rules', async t => {
  const { root, registry } = await fixture(t);
  const dir = path.join(root, '.dsh', 'annotations'); await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, '.gitignore'); await fs.writeFile(file, '# User notes\n*\n!public.md\n');
  await assert.rejects(saveAnnotations(registry, request(root)), /standalone/);
  assert.equal(await fs.readFile(file, 'utf8'), '# User notes\n*\n!public.md\n');
  await fs.writeFile(file, '# User notes\n*\n');
  await saveAnnotations(registry, request(root));
  assert.equal(await fs.readFile(file, 'utf8'), '# User notes\n*\n');
});
test('cancellation after batch creation removes only the new batch', async t => {
  const { root, registry } = await fixture(t);
  const dir = path.join(root, '.dsh', 'annotations'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '.gitignore'), '*\n');
  await fs.writeFile(path.join(dir, 'user-file.txt'), 'keep');
  const controller = new AbortController();
  let sawBatch = false;
  // Deterministic cancellation at the first checkpoint after mkdir; filesystem
  // watcher delivery may be coalesced until after a tiny successful write.
  Object.defineProperty(controller.signal, 'aborted', { get() {
    if (!sawBatch && readdirSync(dir).some(filename => /^\d{8}T/.test(filename))) {
      sawBatch = true; controller.abort();
    }
    return sawBatch;
  } });
  await assert.rejects(saveAnnotations(registry, request(root), controller.signal), error => error.code === 'aborted' || error.name === 'AbortError');
  assert.equal(sawBatch, true);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['.gitignore', 'user-file.txt']);
  assert.equal(await fs.readFile(path.join(dir, 'user-file.txt'), 'utf8'), 'keep');
});

test('already-aborted save writes nothing', async t => {
  const { root, registry } = await fixture(t);
  await assert.rejects(saveAnnotations(registry, request(root), AbortSignal.abort()), /cancelled/);
  assert.deepEqual(await fs.readdir(root), ['source.html']);
});
