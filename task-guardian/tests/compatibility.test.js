import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectCompatibility } from '../lib/index.js';

async function packageContext(t, manifest) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-compatibility-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
  const baseUrl = 'file:///isolated-profile/';
  return { baseUrl, get: key => key === 'pluginPackages' ? { packageOf(name, parentURL) {
    assert.equal(name, '@deepseek-ai/dsh-llm-retry');
    assert.equal(parentURL, baseUrl);
    return { dir };
  } } : undefined };
}

for (const version of ['0.2.1-rc.3', '0.2.1-rc.5']) {
  test(`verified native ${version} passes the production compatibility gate`, async t => {
    const ctx = await packageContext(t, { name: '@deepseek-ai/dsh-llm-retry', version });
    assert.deepEqual(await detectCompatibility(ctx), { supported: true, version, reason: 'verified_contract' });
  });
}

for (const manifest of [
  { name: '@deepseek-ai/dsh-llm-retry', version: '0.2.1-rc.4' },
  { name: '@deepseek-ai/dsh-llm-retry', version: '0.2.1-rc.6' },
  { name: '@deepseek-ai/dsh-llm-retry', version: '0.2.1' },
  { name: 'unrelated-package', version: '0.2.1-rc.5' },
]) {
  test(`unverified package ${manifest.name}@${manifest.version} fails closed`, async t => {
    const ctx = await packageContext(t, manifest);
    assert.deepEqual(await detectCompatibility(ctx), { supported: false, version: manifest.version, reason: 'native_version_unsupported' });
  });
}

test('missing registry or absent package fails closed', async () => {
  for (const packages of [undefined, { packageOf: () => undefined }, { packageOf: () => { throw Error('unavailable'); } }]) {
    assert.deepEqual(await detectCompatibility({ get: () => packages }), { supported: false, reason: 'native_version_unavailable' });
  }
});
