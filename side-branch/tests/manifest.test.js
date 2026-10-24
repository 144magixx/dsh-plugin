import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
test('distribution declares the actual native client dependencies and bilingual metadata', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.name, 'dsh-side-branch'); assert.equal(pkg.dsh.client.platform, 'web');
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.scripts.postinstall, undefined);
  for (const file of ['lib/index.js','lib/service.js','lib/history.js','lib/client.js','cordis.patch.yml','icon.svg']) {
    assert.ok(pkg.files.includes(file)); assert.ok((await stat(new URL(file, root))).isFile());
  }
  for (const lang of ['zh', 'en']) {
    const locale = JSON.parse(await readFile(new URL(`locale/${lang}.json`, root), 'utf8'));
    assert.ok(locale.meta.title && locale.meta.description);
  }
  const icon = await readFile(new URL('icon.svg', root), 'utf8');
  assert.ok(icon.startsWith('<svg')); assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(icon));
});
test('the shipped browser file loads as a classic script with the exact package id', async () => {
  let registered;
  vm.runInNewContext(await readFile(new URL('lib/client.js', root), 'utf8'), { window: { __ModuleLoader__: { load: data => { registered = data; } } } });
  assert.equal(registered.id, 'dsh-side-branch'); assert.equal(typeof registered.factory, 'function');
});
