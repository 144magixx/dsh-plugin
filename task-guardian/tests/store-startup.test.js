import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLease, createGuardianStore, defaultRecord } from '../lib/store.js';
import { buildStartupPlan, setStartup, findApplication } from '../lib/startup.js';

function memoryDomain({ failAudit = false } = {}) {
  const data = new Map();
  return { data, open: async () => ({ table: name => { if (!data.has(name)) data.set(name, new Map()); const m = data.get(name); return { get: key => m.get(key), entries: () => m.entries(), put: async (key, value) => { if (name === 'audit' && failAudit) throw Error('audit disk failed'); m.set(key, structuredClone(value)); } }; }, close: async () => {} }) };
}

test('settings default off, isolate sessions, survive reload and serialize revocation before stale scheduling', async () => {
  const domain = memoryDomain(); const store = await createGuardianStore(domain);
  assert.deepEqual(store.get('a').settings, { enabled: false, recoverAfterRestart: false, autoSelectFirst: false });
  await store.update('a', 'grant', r => ({ ...r, settings: { ...r.settings, enabled: true, recoverAfterRestart: true }, epoch: r.epoch + 1 }));
  assert.equal(store.get('b').settings.enabled, false);
  const revoke = store.update('a', 'revoke', r => ({ ...r, settings: { ...r.settings, enabled: false }, epoch: r.epoch + 1 }));
  const stale = store.update('a', 'stale_retry', r => r.settings.enabled ? { ...r, retry: { attempt: 10, retryAt: 9000 } } : undefined);
  await Promise.all([revoke, stale]);
  assert.equal(store.get('a').settings.enabled, false); assert.equal(store.get('a').retry.attempt, 0);
  assert.equal(store.get('a').epoch, 2);
  await store.close();
  const reopened = await createGuardianStore(domain); assert.equal(reopened.get('a').settings.enabled, false);
  assert.deepEqual(reopened.list().map(r => r.sessionId), ['a']);
  await reopened.close();
});

test('input conflict does not poison storage; audit failure preserves primary state and fences automatic actions', async () => {
  const domain = memoryDomain(); const store = await createGuardianStore(domain);
  await assert.rejects(store.update('a', 'conflict', () => { throw Error('stale settings'); }));
  assert.equal(store.healthy(), true);
  await store.update('a', 'disable', r => r); await store.close();
  const bad = await createGuardianStore(memoryDomain({ failAudit: true }));
  await assert.rejects(bad.update('a', 'revoke', r => ({ ...r, epoch: 1 })));
  assert.equal(bad.get('a').epoch, 1); assert.equal(bad.get('a').audit[0].kind, 'revoke'); assert.equal(bad.healthy(), false);
  await assert.rejects(bad.update('a', 'retry', r => r)); await bad.close();
});

test('OS lease excludes duplicate Hosts and is reusable after release', async () => {
  const options = { identity: path.join(os.tmpdir(), 'guardian-' + randomUUID()) };
  const first = await acquireLease(options);
  try { await assert.rejects(acquireLease(options), /lease unavailable/); } finally { await first.close(); }
  const second = await acquireLease(options); await second.close();
});

test('startup plans use native per-user launch mechanisms and preserve spaces and Unicode paths', () => {
  const mac = buildStartupPlan({ platform: 'darwin', home: '/Users/test user', appPath: '/Applications/DeepSeek & Harness.app', uid: 501 });
  assert.match(mac.content, /DeepSeek &amp; Harness/); assert.match(mac.file, /Library\/LaunchAgents/);
  assert.deepEqual(mac.enable.args, ['enable', 'gui/501/io.dsh.task-guardian.login']);
  const win = buildStartupPlan({ platform: 'win32', appPath: 'C:\\Program Files\\测试\\DeepSeek Harness.exe' });
  assert.equal(win.enable.command, 'reg.exe'); assert.equal(win.enable.args[1], 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  assert.equal(win.enable.args.at(-2), '"C:\\Program Files\\测试\\DeepSeek Harness.exe"');
  assert.throws(() => buildStartupPlan({ platform: 'win32', appPath: 'C:\\bad"argument.exe' }));
  assert.equal(findApplication('darwin', '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'), '/Applications/DeepSeek Harness.app');
});

test('macOS login adapter creates, verifies and removes only its owned plist without launching DSH now', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-launch-'));
  const plan = buildStartupPlan({ platform: 'darwin', home, appPath: '/Applications/DeepSeek Harness.app', uid: 501 });
  const calls = [], execute = async (command, args) => { calls.push({ command, args }); };
  assert.equal((await setStartup(true, { plan, execute })).effective, 'next_login');
  assert.equal(await fs.readFile(plan.file, 'utf8'), plan.content);
  await setStartup(false, { plan, execute }); await assert.rejects(fs.stat(plan.file), { code: 'ENOENT' });
  assert.equal(calls[0].args[0], 'enable'); assert.equal(calls[1].args[0], 'bootout');
  await fs.writeFile(plan.file, 'user-owned');
  await assert.rejects(setStartup(false, { plan, execute }), /not_owned/);
  // Temporary fixture retained for inspection; no real login item was changed.
});

test('Windows startup adapter passes arguments directly and checks query before deleting its value', async () => {
  const plan = buildStartupPlan({ platform: 'win32', appPath: 'C:\\Program Files\\DeepSeek Harness.exe' });
  const calls = [], execute = async (command, args) => { calls.push({ command, args }); return { stdout: `\n    io.dsh.task-guardian.login    REG_SZ    "${plan.appPath}"\r\n` }; };
  await setStartup(true, { plan, execute }); await setStartup(false, { plan, execute });
  assert.deepEqual(calls.map(c => c.args[0]), ['query', 'add', 'query', 'query', 'query', 'delete']);
  for (const enabled of [true, false]) await assert.rejects(setStartup(enabled, { plan, execute: async () => ({ stdout: 'io.dsh.task-guardian.login    REG_SZ    "C:\\Other.exe"' }) }), /not_owned/);
  await assert.rejects(setStartup(false, { plan: { ...plan, disable: { command: 'reg.exe', args: ['delete', 'HKLM\\Anything', '/f'] } }, execute }), /target_mismatch/);
});
