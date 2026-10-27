import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverCapabilities, createDiscoveryService, resolveSessionCwd, validateConfig, runReadOnlyCommand, LIMITS, safeText, parseCodexMcp } from '../lib/discovery.js';
import { createFetchHandler, createCapabilityTool, profileMcpReader, runtimeSkillReader, errorResult } from '../lib/index.js';

const skillText = (name = 'example', extra = '') => `---\nname: ${name}\ndescription: A useful local skill\n---\nRead this instruction.\n${extra}`;
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-capability-test-')));
  t.after(async () => { assert.equal(path.dirname(root), await fs.realpath(os.tmpdir())); assert.match(path.basename(root), /^dsh-capability-test-/); await fs.rm(root, { recursive: true, force: true }); });
  const home = path.join(root, 'home'); const cwd = path.join(root, 'project');
  await fs.mkdir(home); await fs.mkdir(path.join(cwd, '.git'), { recursive: true });
  const write = async (relative, value) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); return file; };
  const scan = options => discoverCapabilities({ home, cwd, env: { PATH: '' }, config: { cliCommands: [] }, dshMcp: () => [], ...options });
  return { root, home, cwd, write, scan };
}

 test('whole-bundle dedup merges copies, retains same-name instruction/resource versions and real sources', async t => {
  const fx = await fixture(t);
  const a = await fx.write('home/.codex/skills/a/SKILL.md', skillText());
  await fx.write('home/.codex/skills/a/scripts/tool.js', 'version one');
  await fx.write('home/.claude/skills/a/SKILL.md', skillText());
  await fx.write('home/.claude/skills/a/scripts/tool.js', 'version one');
  await fx.write('project/.dsh/skills/a/SKILL.md', skillText());
  await fx.write('project/.dsh/skills/a/scripts/tool.js', 'version two');
  await fx.write('project/.agents/skills/a/SKILL.md', skillText('example', 'Different instructions.'));
  await fs.mkdir(path.join(fx.home, '.agents/skills'), { recursive: true });
  await fs.symlink(path.dirname(a), path.join(fx.home, '.agents/skills/alias'), 'dir');
  const result = await fx.scan(); const skills = result.items.filter(item => item.kind === 'skill');
  assert.equal(skills.length, 3);
  const merged = skills.find(item => item.sources.length === 3);
  assert.ok(merged); assert.equal(merged.status, 'installed'); assert.equal(merged.resourceCount, 1);
  assert.deepEqual(new Set(merged.sources.map(row => row.agent)), new Set(['Codex', 'Claude Code', '.agents']));
  assert.ok(merged.sources.every(row => path.isAbsolute(row.path)));
  assert.ok(merged.selectionText.includes(JSON.stringify(merged.sources[0].path)));
  assert.ok(!merged.selectionText.includes('Read this instruction'));
  assert.equal(result.complete, true);
});

test('flat markdown skills remain distinct within a shared resource directory', async t => {
  const fx = await fixture(t);
  await fx.write('home/.agents/skills/one.md', skillText('one'));
  await fx.write('home/.agents/skills/two.md', skillText('two'));
  await fx.write('home/.agents/skills/README.md', 'Not a skill');
  const result = await fx.scan(); assert.deepEqual(result.items.map(row => row.name), ['one', 'two']);
});

test('symbolic link cycles, excessive resources and external references stay unmerged', async t => {
  const fx = await fixture(t);
  const a = await fx.write('home/.codex/skills/one/SKILL.md', skillText());
  const b = await fx.write('home/.claude/skills/two/SKILL.md', skillText());
  await fs.symlink(path.dirname(a), path.join(path.dirname(a), 'loop'), 'dir');
  await fs.symlink(path.dirname(b), path.join(path.dirname(b), 'loop'), 'dir');
  await fx.write('home/.dsh/skills/deep/SKILL.md', skillText('deep'));
  await fx.write(`home/.dsh/skills/deep/${'sub/'.repeat(LIMITS.depth + 1)}data.txt`, 'resource');
  await fx.write('project/.agents/skills/one/SKILL.md', skillText('external', 'Load ../shared/tool.js'));
  await fx.write('home/.agents/skills/one/SKILL.md', skillText('external', 'Load ../shared/tool.js'));
  const result = await fx.scan();
  assert.equal(result.items.length, 5); assert.ok(result.items.every(item => item.status === 'limited'));
  assert.ok(result.warnings.some(row => row.code === 'SYMLINK_CYCLE')); assert.ok(result.warnings.some(row => row.code === 'RESOURCE_LIMIT')); assert.ok(result.warnings.some(row => row.code === 'EXTERNAL_RESOURCES'));
});

test('MCP parsers keep different transports/configs and never return secrets', async t => {
  const fx = await fixture(t); const secret = 'private-credential-test-987654321';
  await fx.write('home/.codex/config.toml', `[mcp_servers."logs.service"]\ncommand = "server"\nargs = ["--token", "${secret}"]\n[mcp_servers."logs.service".env]\nTOKEN = "${secret}"\n[mcp_servers.web]\nurl = "https://user:${secret}@example.invalid/mcp?token=${secret}"\nenabled = false\n`);
  await fx.write('home/.claude.json', JSON.stringify({ mcpServers: { logs: { command: 'server', env: { TOKEN: secret } } }, projects: { [fx.cwd]: { mcpServers: { project: { url: `https://example.invalid/${secret}`, headers: { Authorization: secret } } } } } }));
  await fx.write('project/.mcp.json', JSON.stringify({ mcpServers: { logs: { command: 'other-server', args: [secret] }, disabled: { command: 'server' } } }));
  await fx.write('project/.claude/settings.local.json', JSON.stringify({ disabledMcpServers: ['disabled'], env: { TOKEN: secret } }));
  const result = await fx.scan({ dshMcp: () => [{ name: 'dsh-logs', config: { serverName: 'dsh-logs', transport: 'streamable-http', url: `https://example.invalid/${secret}`, headers: { Authorization: secret } }, path: '/profile/cordis.patch.yml' }] });
  const items = result.items.filter(row => row.kind === 'mcp'); assert.equal(items.length, 7);
  assert.equal(items.filter(row => row.name === 'logs').length, 2);
  assert.equal(items.find(row => row.name === 'web').status, 'disabled');
  assert.equal(items.find(row => row.name === 'disabled').status, 'disabled');
  const publicJSON = JSON.stringify(result);
  assert.ok(!publicJSON.includes(secret)); assert.ok(!publicJSON.includes('Authorization')); assert.ok(!publicJSON.includes('TOKEN')); assert.ok(!publicJSON.includes('example.invalid'));
  assert.ok(items.every(item => !['connected', 'ready', 'logged-in'].includes(item.status)));
});

test('Codex TOML supports quoted names and literal strings and flags unsupported sections', () => {
  const result = parseCodexMcp("[mcp_servers.'alpha.beta']\ncommand='npx' # comment\nenabled=false\n[mcp_servers.'alpha.beta'.env]\nKEY='hidden'\n[mcp_servers]\nbroken = { command='other' }\n");
  assert.equal(result.servers.length, 1); assert.equal(result.servers[0].name, 'alpha.beta'); assert.equal(result.servers[0].config.enabled, false); assert.equal(result.unsupported, true);
});

test('malformed/oversized MCP files produce partial warnings without losing valid skills', async t => {
  const fx = await fixture(t);
  await fx.write('home/.codex/skills/ok/SKILL.md', skillText('ok'));
  await fx.write('project/.mcp.json', '{"token":"do-not-echo", broken');
  await fx.write('home/.codex/config.toml', ' '.repeat(LIMITS.configBytes + 1));
  const result = await fx.scan(); assert.equal(result.items[0].name, 'ok'); assert.equal(result.complete, false);
  assert.ok(result.warnings.some(row => row.code === 'MCP_PARSE_FAILED')); assert.ok(result.warnings.some(row => row.code === 'RESOURCE_LIMIT')); assert.ok(!JSON.stringify(result).includes('do-not-echo'));
});

test('runtime-injected skills use exact resource directories and opaque providers remain separate', async t => {
  const fx = await fixture(t); const file = await fx.write('runtime/office/SKILL.md', skillText('office'));
  const result = await fx.scan({ runtimeSkills: () => ({ complete: true, skills: [{ name: 'office', description: 'Office', provider: 'dsh-office', resourceBase: { kind: 'directory', path: path.dirname(file) } }, { name: 'remote', description: 'Managed capability', provider: 'vendor-a' }, { name: 'remote', description: 'Managed capability', provider: 'vendor-b' }] }) });
  assert.equal(result.items.length, 3); const office = result.items.find(row => row.name === 'office'); assert.equal(office.sources[0].path, file); assert.ok(office.selectionText.includes(file));
  const managed = result.items.find(row => row.runtimeProvider === 'vendor-a'); assert.match(managed.selectionText, /skill 工具/); assert.ok(!managed.selectionText.includes('undefined'));
});

test('o2 aliases merge and catalog discovery only uses fixed read-only arguments', async t => {
  const fx = await fixture(t); const entry = await fx.write('home/.local/bin/o2', '#!/bin/sh\nexit 0\n'); await fs.chmod(entry, 0o755);
  await fs.symlink(entry, path.join(fx.home, '.local/bin/oxygen-cli'));
  let calls = 0;
  const result = await fx.scan({ config: { cliCommands: ['o2', 'oxygen-cli', 'digger', 'jd-login'] }, runCommand: async (command, args) => { calls++; assert.equal(command, entry); assert.deepEqual(args, ['list', '--installed', '--json']); return { ok: true, stdout: JSON.stringify({ data: { items: [{ name: 'webcli:xingyun', description: 'Internal tools', installed: true, token: 'never-return' }, { name: 'available-only', installed: false }] } }) }; } });
  assert.equal(calls, 1); assert.equal(result.items.filter(item => item.name === 'o2').length, 1);
  assert.equal(result.items.find(item => item.name === 'digger').status, 'missing');
  const child = result.items.find(item => item.name === 'o2 · webcli:xingyun'); assert.ok(child); assert.ok(child.selectionText.includes(entry)); assert.ok(!JSON.stringify(result).includes('never-return'));
});

test('enterprise directory timeout/exit errors are partial and discovery can be disabled', async t => {
  const fx = await fixture(t); const entry = await fx.write('home/.local/bin/o2', '#!/bin/sh\nexit 0\n'); await fs.chmod(entry, 0o755);
  const result = await fx.scan({ config: { cliCommands: ['o2'] }, runCommand: async () => ({ ok: false, code: 'COMMAND_TIMEOUT', exitCode: null, stderr: 'token=hidden' }) });
  assert.equal(result.items[0].status, 'installed'); assert.ok(result.warnings.some(row => row.code === 'COMMAND_TIMEOUT')); assert.ok(!JSON.stringify(result).includes('hidden'));
  const disabled = await fx.scan({ config: { cliCommands: ['o2'], enableO2Discovery: false }, runCommand: () => { assert.fail('must not launch'); } }); assert.equal(disabled.complete, true);
});

test('real subprocess wrapper handles timeout, exit codes, output bounds and cancellation', { timeout: 5000 }, async () => {
  const timeout = await runReadOnlyCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 }); assert.equal(timeout.code, 'COMMAND_TIMEOUT');
  const failure = await runReadOnlyCommand(process.execPath, ['-e', 'process.stderr.write("token=never-return");process.exit(7)']); assert.equal(failure.exitCode, 7); assert.equal(failure.ok, false); assert.ok(!JSON.stringify(failure).includes('never-return'));
  const overflow = await runReadOnlyCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'], { maxBytes: 100 }); assert.equal(overflow.code, 'OUTPUT_LIMIT'); assert.equal(overflow.stdout, undefined);
  const signal = AbortSignal.abort(); const aborted = await runReadOnlyCommand(process.execPath, ['-e', 'process.exit(0)'], { signal }); assert.equal(aborted.code, 'CANCELLED');
});

test('configuration rejects shell fragments, relative roots and wrong types', () => {
  for (const config of [{ cliCommands: ['o2 --help'] }, { cliCommands: ['../o2'] }, { cliCommands: ['$(echo secret)'] }, { extraSkillRoots: ['relative'] }, { extraSkillRoots: [42] }, { cacheTtlMs: 0 }, { enableO2Discovery: 'true' }, { unknown: true }]) assert.throws(() => validateConfig(config), { code: 'INVALID_CONFIG' });
  assert.equal(validateConfig({ extraSkillRoots: ['~/skills'] }, '/example').extraSkillRoots[0], '/example/skills');
});

test('current session cwd follows durable changes; observation always disposes', async t => {
  const fx = await fixture(t); const moved = path.join(fx.root, 'moved'); await fs.mkdir(moved); let disposed = 0;
  const query = { observeSession: async () => ({ header: { cwd: fx.cwd }, events: [{ type: 'working-directory/change', data: { cwd: moved } }], [Symbol.dispose]: () => disposed++ }) };
  assert.equal(await resolveSessionCwd({ sessionQuery: query }, 'session'), moved); assert.equal(disposed, 1);
  const fallback = { observeSession: async () => ({ header: {}, events: [], [Symbol.dispose]: () => disposed++ }) };
  assert.equal(await resolveSessionCwd({ sessionQuery: fallback, workspaceRegistry: { list: () => [{ sessionIds: ['session'], path: fx.cwd }] } }, 'session'), fx.cwd);
});

test('cache and detail isolate sessions, expire and invalidate on cwd changes', async t => {
  const fx = await fixture(t); await fx.write('project/.agents/skills/one/SKILL.md', skillText('one', 'token=secret-hidden'));
  const other = path.join(fx.root, 'other'); await fs.mkdir(other); let clock = 0; let cwd = fx.cwd; let calls = 0;
  const service = createDiscoveryService({ home: fx.home, env: { PATH: '' }, config: { cliCommands: [], cacheTtlMs: 1000 }, dshMcp: () => [], now: () => clock, sessionQuery: { observeSession: async name => ({ header: { cwd: name === 'two' ? other : cwd }, events: [], [Symbol.dispose]() {} }) }, discover: async options => { calls++; return discoverCapabilities(options); } });
  t.after(() => service.dispose());
  const first = await service.scan({ sessionId: 'one' }); assert.equal(first.cached, false); assert.equal(first.items[0].detail, undefined);
  assert.equal((await service.scan({ sessionId: 'one' })).cached, true); assert.equal(calls, 1);
  const details = await service.detail({ sessionId: 'one', id: first.items[0].id }); assert.ok(!details.content.includes('secret-hidden')); assert.equal(details.body, details.content);
  await assert.rejects(service.detail({ sessionId: 'two', id: first.items[0].id }), { code: 'SCAN_REQUIRED' });
  await service.scan({ sessionId: 'two' }); await assert.rejects(service.detail({ sessionId: 'two', id: first.items[0].id }), { code: 'ITEM_NOT_FOUND' });
  clock = 1001; await assert.rejects(service.detail({ sessionId: 'one', id: first.items[0].id }), { code: 'SCAN_REQUIRED' });
  await service.scan({ sessionId: 'one' }); cwd = other; assert.equal((await service.scan({ sessionId: 'one' })).items.length, 0);
  await assert.rejects(service.scan({ sessionId: 'one', cwd: fx.home }), { code: 'INVALID_REQUEST' });
});

test('new scans supersede same-session work without cancelling a different session', async t => {
  const fx = await fixture(t); const starts = []; let resolveFirst;
  const firstStarted = new Promise(resolve => resolveFirst = resolve);
  let blocked = true;
  const service = createDiscoveryService({ home: fx.home, config: { cliCommands: [] }, sessionQuery: { observeSession: async () => ({ header: { cwd: fx.cwd }, events: [], [Symbol.dispose]() {} }) }, discover: async ({ signal }) => {
    starts.push(signal);
    if (blocked) { blocked = false; resolveFirst(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    return { items: [], scannedAt: 'now', warnings: [], stats: {}, coverage: [], complete: true };
  } });
  t.after(() => service.dispose());
  const first = service.scan({ sessionId: 'one' }); const rejected = assert.rejects(first, { name: 'AbortError' });
  await firstStarted; const second = await service.scan({ sessionId: 'one', refresh: true }); assert.equal(second.ok, true); await rejected; assert.equal(starts[0].aborted, true);
  const signal = new AbortController(); signal.abort(); await assert.rejects(service.scan({ sessionId: 'two' }, signal.signal), { name: 'AbortError' });
});

test('HTTP API caps bodies, rejects arbitrary cwd, and returns safe error envelopes', async () => {
  const service = { scan: async input => { if ('cwd' in input) throw Object.assign(new Error('Unknown request field.'), { name: 'DiscoveryError' }); return { ok: true, items: [] }; } };
  const handler = createFetchHandler(service, 'scan');
  const post = (body, headers = { 'content-type': 'application/json' }) => handler(new Request('http://localhost/api/capability-selector/scan', { method: 'POST', headers, body }));
  assert.equal((await post('{')).status, 400); assert.equal((await post('{}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('x'.repeat(9000))).status, 413);
  const success = await post('{}'); assert.equal(success.headers.get('cache-control'), 'no-store'); assert.equal((await success.json()).ok, true);
  const unsafe = errorResult(new Error('token=do-not-echo')); assert.ok(!JSON.stringify(unsafe).includes('do-not-echo'));
});

test('model tool cannot request another session and only uses calling agent identity', async () => {
  let received;
  const tool = createCapabilityTool({ scan: async input => { received = input; return { ok: true }; } });
  await tool.execute({ refresh: true }, { agent: { id: 'caller' }, signal: new AbortController().signal }); assert.deepEqual(received, { sessionId: 'caller', refresh: true });
  await assert.rejects(tool.execute({ sessionId: 'other' }, { agent: { id: 'caller' } }), { code: 'INVALID_REQUEST' });
  await assert.rejects(tool.execute({}, {}), { code: 'SESSION_REQUIRED' });
});

test('current profile reader uses composed Loader config, not YAML, and runtime registry gets agent scope', async () => {
  const agent = { id: 'current' }; let options;
  const services = { profileContext: { patchPath: '/profile/cordis.patch.yml' }, loader: { *entries() { yield { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'old' } }, fiber: { config: { serverName: 'active', transport: 'stdio', command: 'server', env: { SECRET: 'private' } } } }; yield { options: { name: 'other', config: { serverName: 'ignored' } } }; } }, agents: { get: () => agent }, skills: { snapshot: async value => { options = value; return { skills: [], complete: true }; } } };
  const ctx = { get: key => services[key] }; const rows = await profileMcpReader(ctx)({}); assert.equal(rows.length, 1); assert.equal(rows[0].name, 'active');
  await runtimeSkillReader(ctx)({ sessionId: 'current', cwd: '/project' }); assert.equal(options.scope, agent);
  await assert.rejects(runtimeSkillReader({ get() { throw new Error('not ready'); } })({}), { code: 'RUNTIME_SKILLS_UNAVAILABLE' });
});

test('redaction handles common credentials, private keys and authenticated URLs', () => {
  const value = safeText('token="secret-one" password=secret-two Authorization: Bearer secret-three https://user:pass@example.invalid/mcp?key=secret-four\n-----BEGIN PRIVATE KEY-----\nsecret-five\n-----END PRIVATE KEY-----');
  for (const secret of ['secret-one', 'secret-two', 'secret-three', 'secret-four', 'secret-five', 'user:pass']) assert.ok(!value.includes(secret));
});
