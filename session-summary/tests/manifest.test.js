import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { client, requested, source } from './client-core.mjs';

const root = new URL('../', import.meta.url);

test('distribution declares a web client, bilingual metadata and no runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.name, 'dsh-session-summary');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.client.immediately, true);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  for (const name of ['@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-locale']) assert.ok(pkg.dsh.client.inject.includes(name), name);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  for (const script of ['preinstall', 'install', 'postinstall']) assert.equal(pkg.scripts?.[script], undefined);
  assert.equal(pkg.exports['./client'], './lib/client.js');
  for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(file), file);
    assert.ok((await stat(new URL(file, root))).isFile(), file);
  }
  for (const lang of ['zh', 'en']) {
    const locale = JSON.parse(await readFile(new URL(`locale/${lang}.json`, root), 'utf8'));
    assert.ok(locale.meta.title && locale.meta.description);
  }
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8');
  assert.match(patch, /- insert:\s+- id: dsh-session-summary\s+name: dsh-session-summary/);
  const icon = await readFile(new URL('icon.svg', root), 'utf8');
  assert.ok(icon.startsWith('<svg'));
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(icon));
  const host = await import(new URL('lib/index.js', root));
  assert.equal(typeof host.apply, 'function');
  assert.equal(host.apply(), undefined, 'the Host half registers nothing');
});

test('the browser file is a classic ModuleLoader script that requires only React', () => {
  assert.deepEqual(requested, ['react']);
  assert.ok(!source.includes("require('@deepseek-ai/"), 'no Harness Client package is required at runtime');
  assert.ok(!/document\.body\.append|appendChild\(\s*document\.createElement|createPortal/.test(source), 'no foreign DOM is appended to the page body');
  assert.equal(client.name, 'dsh-session-summary');
  assert.deepEqual(JSON.parse(JSON.stringify(client.inject)), ['slots', 'locale']);
  assert.equal(client.SLOT, 'conversation.session.header.utilities');
  assert.equal(client.OVERLAY_SLOT, 'shell.overlay');
});

test('both dictionaries carry the same keys and every literal key used in code exists', () => {
  const zh = Object.keys(client.ZH).sort();
  const en = Object.keys(client.EN).sort();
  assert.deepEqual(zh, en);
  const used = new Set([...source.matchAll(/\bt\('([a-z][\w.-]*)'/g)].map(match => match[1]));
  for (const key of used) assert.ok(key in client.ZH, `missing dictionary key ${key}`);
  for (const family of ['mode.one-shot', 'mode.continuable', 'mode.unknown', 'mode.external', 'activity.running', 'activity.completed', 'activity.inactive', 'related.parent', 'related.forkSource', 'related.branchSource', 'related.fork', 'related.sideBranch', 'jobs.running', 'jobs.stopping', 'jobs.completed', 'jobs.killed', 'jobs.failed', 'todo.pending', 'todo.in_progress', 'todo.completed', 'source.fetch', 'source.search']) assert.ok(family in client.ZH, family);
  for (const [key, value] of Object.entries(client.ZH)) {
    const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
    assert.equal(params(value), params(client.EN[key]), `placeholder mismatch in ${key}`);
  }
});

test('styles use theme tokens only and avoid tokens the theme does not define', () => {
  const css = client.CSS;
  assert.ok(!/--dsw-alias-fill-l\d|--dsw-font-mono/.test(css));
  const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map(match => match[0]);
  assert.deepEqual(literals, ['#fff'], 'only the tooltip text fallback is a literal color');
  for (const selector of css.match(/(^|\})\s*[^{}@]+\{/g) ?? []) {
    const names = selector.replace(/[{}]/g, '').split(',').map(part => part.trim()).filter(Boolean);
    for (const name of names) if (!/^(to|from|\d+%)$/.test(name)) assert.match(name, /\.dss-|^button\.dss-/, `unprefixed selector ${name}`);
  }
  assert.ok(Object.keys(client.HOST_ICONS).length >= 20);
});
