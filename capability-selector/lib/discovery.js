import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hash, safeText, skillMetadata, parseCodexMcp, jsonMcpEntries, mcpSummary } from './parsing.js';

export { safeText, parseCodexMcp, jsonMcpEntries } from './parsing.js';
export const LIMITS = Object.freeze({ roots: 80, ancestors: 12, depth: 5, directories: 2000, skills: 400, bundleFiles: 256, fileBytes: 1024 * 1024, bundleBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, configBytes: 1024 * 1024, detailChars: 12000, commandMs: 3000, commandBytes: 512 * 1024, warnings: 100, cacheSessions: 32, scanMs: 20000 });
export const DEFAULT_CONFIG = Object.freeze({ extraSkillRoots: [], cliCommands: ['o2', 'oxygen-cli', 'digger', 'jd-login'], cacheTtlMs: 60000, enableAgentTool: true, enableO2Discovery: true });
export class DiscoveryError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'DiscoveryError'; this.code = code; this.status = status; }
}
function check(signal) { signal?.throwIfAborted(); }
async function providerCall(callback, args, signal) {
  const control = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]);
  check(control);
  let abort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => callback({ ...args, signal: control })),
      new Promise((_, reject) => { abort = () => reject(control.reason); control.addEventListener('abort', abort, { once: true }); }),
    ]);
  } finally { if (abort) control.removeEventListener('abort', abort); }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function fail(code, message, status) { throw new DiscoveryError(code, message, status); }
function expand(value, home) { return value === '~' ? home : /^~[\\/]/.test(value) ? path.join(home, value.slice(2)) : value; }
function within(parent, child) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function absence(error) { return ['ENOENT', 'ENOTDIR'].includes(error?.code); }
function source(agent, file) { return { agent: safeText(agent, 80), path: safeText(file, 2048) }; }
function addSource(item, incoming) { if (!item.sources.some(row => row.agent === incoming.agent && row.path === incoming.path) && item.sources.length < 24) item.sources.push(incoming); }
function id(kind, value) { return `${kind}-${hash(value).slice(0, 24)}`; }

export function validateConfig(input = {}, home = homedir()) {
  if (!object(input)) fail('INVALID_CONFIG', 'Capability selector configuration must be an object.');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_CONFIG, key)) fail('INVALID_CONFIG', `Unknown capability selector option: ${safeText(key, 80)}.`);
  const roots = input.extraSkillRoots ?? DEFAULT_CONFIG.extraSkillRoots;
  if (!Array.isArray(roots) || roots.length > 24 || roots.some(root => typeof root !== 'string' || !root.trim() || root.length > 2048 || /[\x00-\x1f]/.test(root) || !path.isAbsolute(expand(root, home)))) fail('INVALID_CONFIG', 'extraSkillRoots must contain at most 24 absolute paths (~/ is supported).');
  const commands = input.cliCommands ?? DEFAULT_CONFIG.cliCommands;
  if (!Array.isArray(commands) || commands.length > 24 || commands.some(command => typeof command !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(command))) fail('INVALID_CONFIG', 'cliCommands must contain at most 24 bare command names, without paths or arguments.');
  const cacheTtlMs = input.cacheTtlMs ?? DEFAULT_CONFIG.cacheTtlMs;
  if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 1000 || cacheTtlMs > 300000) fail('INVALID_CONFIG', 'cacheTtlMs must be an integer from 1000 to 300000.');
  const enableAgentTool = input.enableAgentTool ?? true;
  if (typeof enableAgentTool !== 'boolean') fail('INVALID_CONFIG', 'enableAgentTool must be a boolean.');
  const enableO2Discovery = input.enableO2Discovery ?? true;
  if (typeof enableO2Discovery !== 'boolean') fail('INVALID_CONFIG', 'enableO2Discovery must be a boolean.');
  return { extraSkillRoots: [...new Set(roots.map(root => path.resolve(expand(root, home))))], cliCommands: [...new Set(commands)], cacheTtlMs, enableAgentTool, enableO2Discovery };
}

/** Size is checked while reading, not just with a racy pre-read stat. Never opens pipes/devices. */
async function readBounded(file, max, signal, budget) {
  check(signal);
  const target = await fs.stat(file);
  if (!target.isFile()) throw new DiscoveryError('NOT_REGULAR_FILE', 'Only regular files can be discovered.');
  if (target.size > max) throw new DiscoveryError('RESOURCE_LIMIT', 'File exceeds discovery limits.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw new DiscoveryError('RESOURCE_LIMIT', 'File exceeds discovery limits.');
    const chunks = []; let bytes = 0;
    while (true) {
      check(signal);
      const chunk = Buffer.alloc(Math.min(65536, max + 1 - bytes));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (budget) { budget.bytes += bytesRead; if (budget.bytes > LIMITS.totalBytes) throw new DiscoveryError('RESOURCE_LIMIT', 'Scan byte budget reached.'); }
      if (bytes > max) throw new DiscoveryError('RESOURCE_LIMIT', 'File exceeds discovery limits.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new DiscoveryError('FILE_CHANGED', 'File changed during discovery.');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
async function directoryEntries(dir, signal, max = LIMITS.directories) {
  check(signal); const handle = await fs.opendir(dir); const rows = [];
  try {
    for await (const entry of handle) {
      check(signal); if (rows.length >= max) throw new DiscoveryError('RESOURCE_LIMIT', 'Directory entry limit reached.');
      rows.push(entry);
    }
  } finally { await handle.close().catch(() => {}); }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Hash the complete bundle, including resource names, bytes and executable bits. Incomplete hashes never merge copies. */
async function bundleFingerprint(skillFile, signal, budget) {
  const directory = path.dirname(skillFile); const parts = []; const ancestors = new Set(); let files = 0; let bytes = 0;
  async function visit(dir, rel, depth) {
    check(signal);
    if (depth > LIMITS.depth) throw new DiscoveryError('RESOURCE_LIMIT', 'Bundle depth limit reached.');
    const real = await fs.realpath(dir);
    if (ancestors.has(real)) throw new DiscoveryError('SYMLINK_CYCLE', 'Bundle contains a symbolic-link cycle.');
    ancestors.add(real);
    try {
      for (const entry of await directoryEntries(dir, signal, LIMITS.bundleFiles)) {
        const file = path.join(dir, entry.name); const name = rel ? `${rel}/${entry.name}` : entry.name;
        const info = await fs.stat(file);
        if (info.isDirectory()) { parts.push(['directory', name]); await visit(file, name, depth + 1); }
        else if (info.isFile()) {
          if (++files > LIMITS.bundleFiles) throw new DiscoveryError('RESOURCE_LIMIT', 'Bundle file count limit reached.');
          const contents = await readBounded(file, LIMITS.fileBytes, signal, budget);
          bytes += contents.length; if (bytes > LIMITS.bundleBytes) throw new DiscoveryError('RESOURCE_LIMIT', 'Bundle byte limit reached.');
          parts.push(['file', name, info.mode & 0o111, hash(contents)]);
        } else throw new DiscoveryError('NOT_REGULAR_FILE', 'Bundle contains an unsupported resource.');
      }
    } finally { ancestors.delete(real); }
  }
  await visit(directory, '', 0);
  return { fingerprint: hash(parts), resourceCount: Math.max(0, files - 1), resourceBytes: bytes };
}

async function projectDirectories(cwd, home, signal) {
  const result = []; let current = cwd;
  for (let n = 0; n < LIMITS.ancestors; n++) {
    check(signal); result.push(current);
    try { await fs.lstat(path.join(current, '.git')); break; } catch (error) { if (!absence(error)) break; }
    if (current === home || path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  return result;
}
function envRoot(env, key, fallback, home) { const value = env[key]; return typeof value === 'string' && value.trim() && path.isAbsolute(expand(value, home)) ? path.resolve(expand(value, home)) : fallback; }

/** Only one executable, with constant arguments, is ever launched: o2's installed read-only catalog. */
export function runReadOnlyCommand(command, args, { signal, timeoutMs = LIMITS.commandMs, maxBytes = LIMITS.commandBytes, env = process.env, cwd, spawnImpl = spawn } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve({ ok: false, code: 'CANCELLED' }); return; }
    let child; let timer; let fallback; let done = false; let bytes = 0; const stdout = []; let failure;
    const finish = code => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(fallback); signal?.removeEventListener('abort', abort);
      resolve({ ok: !failure && code === 0, code: failure ?? (code === 0 ? 'OK' : 'COMMAND_FAILED'), exitCode: Number.isInteger(code) ? code : null, ...(failure ? {} : { stdout: Buffer.concat(stdout).toString('utf8') }) });
    };
    const stop = code => { if (failure) return; failure = code; try { child?.kill('SIGTERM'); } catch {} fallback = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} finish(null); }, 150); fallback.unref?.(); };
    const abort = () => stop('CANCELLED');
    try { child = spawnImpl(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { finish(null); return; }
    child.on('error', () => { failure ??= 'COMMAND_FAILED'; finish(null); });
    child.on('close', finish);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) stop('OUTPUT_LIMIT'); else stdout.push(Buffer.from(chunk)); });
    // Drain stderr to avoid pipe deadlocks; never expose or retain its possibly credential-bearing contents.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) stop('OUTPUT_LIMIT'); });
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop('COMMAND_TIMEOUT'), timeoutMs); timer.unref?.();
    if (signal?.aborted) abort();
  });
}

async function executable(command, home, env, platform, signal) {
  const directories = [...new Set([...(env.PATH ?? '').split(path.delimiter).filter(directory => directory && path.isAbsolute(directory)), path.join(home, '.local', 'bin')])].slice(0, 128);
  const extensions = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  for (const directory of directories) for (const extension of extensions) {
    check(signal); const candidate = path.join(directory, command + extension);
    try { const stat = await fs.stat(candidate); if (!stat.isFile()) continue; await fs.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return { path: candidate, realPath: await fs.realpath(candidate) }; } catch {}
  }
}
function catalogRows(value) {
  if (Array.isArray(value)) return value;
  if (!object(value)) return [];
  for (const key of ['items', 'tools', 'capabilities', 'installed', 'entries', 'results']) if (Array.isArray(value[key])) return value[key];
  return object(value.data) || Array.isArray(value.data) ? catalogRows(value.data) : [];
}

/** Server-controlled inputs only. Neither cwd, environment nor profile configuration is accepted from the HTTP client. */
export async function discoverCapabilities({ cwd, home = homedir(), env = process.env, platform = process.platform, config = {}, signal, runtimeSkills, dshMcp, runCommand = runReadOnlyCommand } = {}) {
  if (!path.isAbsolute(cwd ?? '')) fail('INVALID_CWD', 'A server-resolved absolute session directory is required.');
  config = validateConfig(config, home); check(signal);
  const items = new Map(); const realSkills = new Map(); const warnings = []; const coverage = []; const budget = { bytes: 0 }; let skillCount = 0; let dirs = 0;
  const warning = (code, agent, file) => { if (warnings.length < LIMITS.warnings) warnings.push({ code: safeText(code, 80), agent: safeText(agent, 80), ...(file ? { path: safeText(file, 2048) } : {}) }); };
  function add(item) { const previous = items.get(item.id); if (previous) { for (const row of item.sources) addSource(previous, row); return previous; } items.set(item.id, item); return item; }
  async function skill(file, agent, flat = false, runtime) {
    check(signal);
    let real;
    try { real = await fs.realpath(file); } catch (error) { if (!absence(error)) warning('SKILL_READ_FAILED', agent, file); return undefined; }
    const existing = realSkills.get(real);
    if (existing) { addSource(existing, source(agent, real)); if (runtime) { existing.runtimeProvider = safeText(runtime.provider, 80); existing.runtimeName = safeText(runtime.name, 160); } return existing; }
    if (skillCount >= LIMITS.skills) { warning('SKILL_LIMIT', agent, real); return; }
    skillCount++;
    let raw;
    try { raw = (await readBounded(real, LIMITS.fileBytes, signal, budget)).toString('utf8'); }
    catch (error) { check(signal); warning(error.code === 'RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'SKILL_READ_FAILED', agent, real); return; }
    if (flat && !/^\uFEFF?---\s*\r?\n/.test(raw)) return;
    const metadata = skillMetadata(raw, flat ? path.basename(real, path.extname(real)) : path.basename(path.dirname(real)));
    let bundle; let limited = false;
    try {
      if (/(?:^|[\s"'(`])\.\.[/\\]/m.test(raw)) throw new DiscoveryError('EXTERNAL_RESOURCES', 'Skill references resources outside its bundle.');
      bundle = await bundleFingerprint(real, signal, budget);
      if (flat) bundle.fingerprint = hash([bundle.fingerprint, path.basename(real)]);
    }
    catch (error) { check(signal); limited = true; warning(['RESOURCE_LIMIT', 'SYMLINK_CYCLE', 'EXTERNAL_RESOURCES'].includes(error.code) ? error.code : 'RESOURCE_READ_FAILED', agent, real); bundle = { fingerprint: hash(['incomplete', real, hash(raw)]), resourceCount: null }; }
    const item = add({ id: id('skill', bundle.fingerprint), kind: 'skill', name: metadata.name, description: metadata.description, sources: [source(agent, real)], status: limited ? 'limited' : 'installed', contentHash: bundle.fingerprint, resourceCount: bundle.resourceCount, fingerprintComplete: !limited, ...(runtime ? { runtimeProvider: safeText(runtime.provider, 80), runtimeName: safeText(runtime.name, 160) } : {}), detail: { content: metadata.body, truncated: metadata.truncated } });
    realSkills.set(real, item); return item;
  }
  const codexHome = envRoot(env, 'CODEX_HOME', path.join(home, '.codex'), home);
  const claudeHome = envRoot(env, 'CLAUDE_CONFIG_DIR', path.join(home, '.claude'), home);
  const dshHome = envRoot(env, 'DSH_HOME', path.join(home, '.dsh'), home);
  const agentsHome = envRoot(env, 'DSH_AGENTS_HOME', path.join(home, '.agents'), home);
  const projects = await projectDirectories(cwd, home, signal);
  const roots = [
    ...projects.flatMap(project => [['Codex', '.codex/skills'], ['Claude Code', '.claude/skills'], ['DSH', '.dsh/skills'], ['.agents', '.agents/skills']].map(([agent, dir]) => ({ agent, path: path.join(project, dir) }))),
    ...[['Codex', codexHome], ['Claude Code', claudeHome], ['DSH', dshHome], ['.agents', agentsHome]].map(([agent, dir]) => ({ agent, path: path.join(dir, 'skills') })),
    ...config.extraSkillRoots.map(file => ({ agent: 'Custom', path: file })),
    ...(typeof env.DSH_BUNDLED_SKILL_DIR === 'string' && path.isAbsolute(env.DSH_BUNDLED_SKILL_DIR) ? [{ agent: 'DSH bundled', path: env.DSH_BUNDLED_SKILL_DIR }] : []),
  ];
  const rootSeen = new Set();
  for (const root of roots.slice(0, LIMITS.roots)) {
    const key = `${root.agent}:${root.path}`; if (rootSeen.has(key)) continue; rootSeen.add(key);
    const record = { ...root, state: 'scanned' }; coverage.push(record); const seen = new Set();
    async function walk(dir, depth) {
      check(signal);
      if (depth > LIMITS.depth || ++dirs > LIMITS.directories || budget.bytes >= LIMITS.totalBytes) throw new DiscoveryError('RESOURCE_LIMIT', 'Skill root scan limit reached.');
      const real = await fs.realpath(dir); if (seen.has(real)) return; seen.add(real);
      const info = await fs.stat(real);
      if (info.isFile()) { await skill(real, root.agent, path.basename(real) !== 'SKILL.md'); return; }
      const entries = await directoryEntries(dir, signal);
      if (entries.some(entry => entry.name === 'SKILL.md')) { await skill(path.join(dir, 'SKILL.md'), root.agent); return; }
      for (const entry of entries) {
        if (['node_modules', '.git', '__pycache__'].includes(entry.name)) continue;
        const file = path.join(dir, entry.name);
        try {
          const stat = await fs.stat(file);
          if (stat.isDirectory()) await walk(file, depth + 1);
          else if (stat.isFile() && /\.md$/i.test(entry.name)) await skill(file, root.agent, true);
        } catch (error) { check(signal); if (!absence(error)) { record.state = 'limited'; warning(error.code === 'RESOURCE_LIMIT' ? error.code : 'SKILL_READ_FAILED', root.agent, file); } }
      }
    }
    try { await walk(root.path, 0); }
    catch (error) { check(signal); record.state = absence(error) ? 'missing' : 'limited'; if (!absence(error)) warning(error.code === 'RESOURCE_LIMIT' ? error.code : 'ROOT_READ_FAILED', root.agent, root.path); }
  }
  if (roots.length > LIMITS.roots) warning('ROOT_LIMIT', 'discovery');
  if (runtimeSkills) {
    try {
      const observation = await providerCall(runtimeSkills, { cwd }, signal); check(signal);
      const rows = Array.isArray(observation) ? observation : observation?.skills;
      if (observation?.complete === false) warning('RUNTIME_SKILLS_PARTIAL', 'DSH runtime');
      if (!Array.isArray(rows)) throw new Error();
      for (const row of rows.slice(0, LIMITS.skills)) {
        check(signal); if (!row || typeof row.name !== 'string') continue;
        const file = path.isAbsolute(row.path ?? '') ? row.path : row.resourceBase?.kind === 'directory' && path.isAbsolute(row.resourceBase.path ?? '') ? path.join(row.resourceBase.path, 'SKILL.md') : undefined;
        if (file && await skill(file, 'DSH runtime', false, row)) continue;
        add({ id: id('skill', ['provider', row.provider, row.name]), kind: 'skill', name: safeText(row.name, 160), description: safeText(row.description, 700), sources: [source('DSH runtime', `provider:${safeText(row.provider || 'runtime', 80)}/${safeText(row.name, 160)}`)], status: 'installed', runtimeProvider: safeText(row.provider || 'runtime', 80), runtimeName: safeText(row.name, 160), fingerprintComplete: false, detail: { content: safeText(row.description, 700), truncated: false } });
      }
      if (rows.length > LIMITS.skills) warning('SKILL_LIMIT', 'DSH runtime');
      coverage.push({ agent: 'DSH runtime', path: 'provider:skills', state: observation?.complete === false ? 'limited' : 'scanned' });
    } catch { check(signal); warning('RUNTIME_SKILLS_FAILED', 'DSH runtime'); }
  }

  function mcp(name, cfg, agent, file) {
    const summary = mcpSummary(name, cfg); if (!summary.name) return;
    add({ id: id('mcp', [name, summary.fingerprint]), kind: 'mcp', name: summary.name, description: `MCP 配置（${summary.transport}）；连接和登录状态未验证。`, sources: [source(agent, file)], status: summary.status, transport: summary.transport, detail: { content: '仅发现配置。未连接服务、未验证登录，未返回启动参数、地址、请求头或环境变量。', truncated: false } });
  }
  const mcpFiles = [
    { agent: 'Codex', path: path.join(codexHome, 'config.toml'), toml: true },
    { agent: 'Claude Code', path: path.join(home, '.claude.json') },
    ...[claudeHome, ...projects.map(project => path.join(project, '.claude'))].flatMap(dir => ['settings.json', 'settings.local.json'].map(file => ({ agent: 'Claude Code', path: path.join(dir, file) }))),
    ...projects.flatMap(project => [{ agent: 'Claude Code', path: path.join(project, '.mcp.json') }, { agent: 'Codex', path: path.join(project, '.codex', 'config.toml'), toml: true }]),
  ];
  const mcpSeen = new Set(); const pendingMcp = []; const claudeDisabled = new Set();
  for (const candidate of mcpFiles) {
    check(signal);
    try {
      const real = await fs.realpath(candidate.path); if (mcpSeen.has(real)) continue; mcpSeen.add(real);
      const raw = (await readBounded(real, LIMITS.configBytes, signal, budget)).toString('utf8');
      let entries;
      if (candidate.toml) { const parsed = parseCodexMcp(raw); entries = parsed.servers; if (parsed.unsupported) warning('MCP_TOML_PARTIAL', candidate.agent, real); }
      else {
        const parsed = JSON.parse(raw); entries = jsonMcpEntries(parsed, cwd);
        const disabled = [...(Array.isArray(parsed.disabledMcpServers) ? parsed.disabledMcpServers : []), ...(Array.isArray(parsed.projects?.[cwd]?.disabledMcpServers) ? parsed.projects[cwd].disabledMcpServers : [])];
        for (const name of disabled) if (typeof name === 'string') claudeDisabled.add(name);
      }
      for (const row of entries.slice(0, 200)) pendingMcp.push({ ...row, agent: candidate.agent, path: real });
      if (entries.length > 200) warning('MCP_LIMIT', candidate.agent, real);
      coverage.push({ agent: candidate.agent, path: real, state: 'scanned', kind: 'mcp' });
    } catch (error) { check(signal); if (!absence(error)) warning(error.code === 'RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'MCP_PARSE_FAILED', candidate.agent, candidate.path); }
  }
  for (const row of pendingMcp.slice(0, 400)) mcp(row.name, row.agent === 'Claude Code' && claudeDisabled.has(row.name) ? { ...row.config, disabled: true } : row.config, row.agent, row.path);
  if (pendingMcp.length > 400) warning('MCP_LIMIT', 'discovery');
  if (dshMcp) {
    try {
      const rows = await providerCall(dshMcp, { cwd }, signal); check(signal);
      for (const row of (Array.isArray(rows) ? rows : []).slice(0, 200)) if (typeof row.name === 'string' && object(row.config)) mcp(row.name, row.config, 'DSH', row.path || 'profile:active');
      coverage.push({ agent: 'DSH', path: 'profile:active', state: 'scanned', kind: 'mcp' });
    } catch { check(signal); warning('DSH_MCP_READ_FAILED', 'DSH'); }
  } else warning('DSH_MCP_UNAVAILABLE', 'DSH');

  const commandGroups = new Map();
  for (const command of config.cliCommands) { const canonical = command === 'oxygen-cli' ? 'o2' : command; const list = commandGroups.get(canonical) ?? []; list.push(command); commandGroups.set(canonical, list); }
  for (const [canonical, aliases] of commandGroups) {
    const found = [];
    for (const command of aliases) { const value = await executable(command, home, env, platform, signal); if (value) found.push({ command, ...value }); }
    const known = { o2: '企业能力目录与内部研发工具；安装和登录状态须按具体任务核验。', digger: '企业应用日志、关键词和 TraceId 检索；登录及浏览器依赖未验证。', 'jd-login': '企业 SSO 登录态工具；本次仅检查安装，未执行登录或读取凭据。' };
    const item = add({ id: id('cli', canonical), kind: 'cli', name: canonical, description: known[canonical] || '本机命令；仅检查可执行文件是否存在。', sources: found.map(row => source('CLI', row.realPath)), status: found.length ? 'installed' : 'missing', aliases, detail: { content: found.length ? '已找到可执行文件。未验证业务授权、连接或登录状态。' : '在 PATH 和 ~/.local/bin 中未找到可执行文件。', truncated: false } });
    if (canonical !== 'o2' || !found.length || !config.enableO2Discovery) continue;
    const executablePath = found.find(row => row.command === 'o2')?.path ?? found[0].path;
    // Node does not support shell:false .cmd/.bat launching. Do not use shell interpolation as a fallback.
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath)) { warning('O2_LAUNCH_UNSUPPORTED', 'CLI', executablePath); continue; }
    let result;
    try { result = await runCommand(executablePath, ['list', '--installed', '--json'], { signal, timeoutMs: LIMITS.commandMs, maxBytes: LIMITS.commandBytes, cwd, env }); }
    catch { check(signal); warning('O2_DISCOVERY_FAILED', 'CLI', executablePath); continue; }
    check(signal);
    if (!result.ok) { warning(result.code || 'O2_DISCOVERY_FAILED', 'CLI', executablePath); continue; }
    try {
      const json = JSON.parse(result.stdout);
      if (json?.ok === false || (typeof json?.status === 'string' && ['error', 'failed', 'failure'].includes(json.status))) throw new Error();
      const rows = catalogRows(json);
      if (!Array.isArray(json) && rows.length === 0 && !['items', 'tools', 'capabilities', 'installed', 'entries', 'results', 'data'].some(key => Object.hasOwn(json ?? {}, key))) throw new Error();
      for (const row of rows.slice(0, 200)) {
        if (!object(row) || row.installed === false || row.isInstalled === false) continue;
        const name = row.name ?? row.id ?? row.slug;
        if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(name)) continue;
        add({ id: id('cli', ['o2', name]), kind: 'cli', name: `o2 · ${name}`, capabilityName: name, parentId: item.id, description: safeText(row.description ?? row.summary ?? 'o2 目录中已安装的子能力；使用前读取对应说明。', 700), sources: found.map(value => source('o2', value.realPath)), status: 'installed', detail: { content: '由 o2 list --installed --json 只读发现。执行前先读取 o2 skill，再核对真实下游帮助。未验证登录。', truncated: false } });
      }
      if (rows.length > 200) warning('O2_CATALOG_LIMIT', 'CLI', executablePath);
    } catch { warning('O2_INVALID_JSON', 'CLI', executablePath); }
  }
  check(signal);
  const values = [...items.values()];
  for (const item of values) {
    if (item.kind === 'skill') {
      const paths = item.sources.filter(row => !row.path.startsWith('provider:')).map(row => row.path);
      item.selectionText = item.runtimeName ? `本次任务请使用 Skill ${JSON.stringify(item.runtimeName)}（provider ${JSON.stringify(item.runtimeProvider)}）。先调用 skill 工具加载此 Skill${paths.length ? `，核对其来源与准确路径 ${JSON.stringify(paths[0])} 对应的版本` : ''}，再按需读取引用资源。不要只凭同名替换成其他版本。` : `本次任务请使用 Skill ${JSON.stringify(item.name)}。先使用 read 工具读取准确路径 ${JSON.stringify(paths[0])}，按其中指令执行并按需读取同目录资源。不要只凭名称替换成其他版本。`;
    } else if (item.kind === 'cli') {
      const entry = item.sources[0]?.path;
      const invocation = entry ? `入口为 ${JSON.stringify(entry)}（路径含空格时正确引用）。` : '尚未发现可执行文件。';
      item.selectionText = item.capabilityName ? `本次任务优先考虑 o2 子能力 ${JSON.stringify(item.capabilityName)}。${invocation}先读取 o2 skill ${JSON.stringify(item.capabilityName)} 并核对下游帮助；安装状态不代表登录就绪。` : `本次任务优先考虑 CLI ${JSON.stringify(item.name)}。${invocation}先核对实际 --help 和任务所需依赖；安装状态不代表已登录或可执行业务。`;
    }
    else item.selectionText = `本次任务优先考虑 MCP ${JSON.stringify(item.name)}（配置来源 ${item.sources.map(row => `${row.agent} ${JSON.stringify(row.path)}`).join('；')}）。仅已发现配置；先确认当前会话确有可调用工具，再按任务需要使用。`;
    item.selectionText = safeText(item.selectionText, 5000);
  }
  const order = { skill: 0, cli: 1, mcp: 2 };
  values.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: values, warnings, coverage, complete: warnings.length === 0, stats: { items: values.length, skills: values.filter(item => item.kind === 'skill').length, cli: values.filter(item => item.kind === 'cli').length, mcp: values.filter(item => item.kind === 'mcp').length, skillPaths: realSkills.size, bytesRead: budget.bytes, roots: coverage.length }, scannedAt: new Date().toISOString() };
}

export async function resolveSessionCwd({ sessionQuery, workspaceRegistry, workingDirectory }, sessionId, signal) {
  let observation;
  try { observation = await sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' }); }
  catch (error) { check(signal); fail(error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND' ? 'SESSION_NOT_FOUND' : 'SESSION_READ_FAILED', 'Cannot read the selected session.', error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND' ? 404 : 500); }
  try {
    check(signal);
    let cwd = observation.header?.cwd;
    // Header cwd is immutable. The latest durable change is the current session directory.
    const latest = observation.events?.findLast(event => event.type === 'working-directory/change');
    if (latest && path.isAbsolute(latest.data?.cwd ?? '')) cwd = latest.data.cwd;
    if (!cwd) cwd = workspaceRegistry?.list().find(workspace => workspace.sessionIds.includes(sessionId))?.path ?? workingDirectory?.defaultDirectory;
    if (!path.isAbsolute(cwd ?? '')) fail('SESSION_CWD_UNAVAILABLE', 'The session has no valid working directory.', 409);
    const canonical = await fs.realpath(cwd); if (!(await fs.stat(canonical)).isDirectory()) throw new Error();
    return canonical;
  } catch (error) { check(signal); if (error instanceof DiscoveryError) throw error; fail('SESSION_CWD_UNAVAILABLE', 'The session directory is unavailable.', 409); }
  finally { observation[Symbol.dispose]?.(); }
}

function request(input, action) {
  if (!object(input)) fail('INVALID_REQUEST', 'Expected a JSON object.');
  const allowed = action === 'scan' ? ['sessionId', 'refresh'] : ['sessionId', 'id'];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('INVALID_REQUEST', 'Unknown request field.');
  if (typeof input.sessionId !== 'string' || !input.sessionId.trim() || input.sessionId.length > 256 || /[\x00-\x1f]/.test(input.sessionId)) fail('INVALID_REQUEST', 'sessionId is required.');
  if (action === 'scan' && input.refresh !== undefined && typeof input.refresh !== 'boolean') fail('INVALID_REQUEST', 'refresh must be a boolean.');
  if (action === 'detail' && (typeof input.id !== 'string' || !/^(skill|cli|mcp)-[a-f0-9]{24}$/.test(input.id))) fail('INVALID_REQUEST', 'A valid scanned item id is required.');
  return input;
}
export function createDiscoveryService({ sessionQuery, workspaceRegistry, workingDirectory, config = {}, home = homedir(), env = process.env, runtimeSkills, dshMcp, discover = discoverCapabilities, now = Date.now } = {}) {
  config = validateConfig(config, home);
  const cache = new Map(); const pending = new Map(); const lifetime = new AbortController();
  let active = 0; const queue = [];
  async function slot(signal) {
    check(signal);
    if (active < 2) { active++; return; }
    await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal.removeEventListener('abort', abort); active++; resolve(); } };
      const abort = () => { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true }); queue.push(entry);
    });
  }
  function release() { active--; queue.shift()?.resolve(); }
  async function scan(input, signal) {
    request(input, 'scan');
    const control = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]); check(control);
    const cwd = await resolveSessionCwd({ sessionQuery, workspaceRegistry, workingDirectory }, input.sessionId, control);
    const previous = cache.get(input.sessionId);
    if (!input.refresh && previous?.cwd === cwd && now() - previous.time < config.cacheTtlMs) return publicResult(previous.result, input.sessionId, true);
    // Each request owns cancellation. A replacement scan invalidates the old request for the same session only.
    pending.get(input.sessionId)?.abort(new DOMException('Superseded by a newer scan.', 'AbortError'));
    const owner = new AbortController(); pending.set(input.sessionId, owner);
    const bounded = AbortSignal.any([control, owner.signal, AbortSignal.timeout(LIMITS.scanMs)]);
    let acquired = false;
    try {
      await slot(bounded); acquired = true;
      const result = await discover({ cwd, home, env, config, signal: bounded, ...(runtimeSkills ? { runtimeSkills: args => runtimeSkills({ ...args, sessionId: input.sessionId }) } : {}), dshMcp });
      check(bounded);
      cache.delete(input.sessionId); cache.set(input.sessionId, { cwd, time: now(), result });
      while (cache.size > LIMITS.cacheSessions) cache.delete(cache.keys().next().value);
      return publicResult(result, input.sessionId, false);
    } finally { if (acquired) release(); if (pending.get(input.sessionId) === owner) pending.delete(input.sessionId); }
  }
  async function detail(input, signal) {
    request(input, 'detail'); const control = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]); check(control);
    const cwd = await resolveSessionCwd({ sessionQuery, workspaceRegistry, workingDirectory }, input.sessionId, control);
    const entry = cache.get(input.sessionId);
    if (!entry || entry.cwd !== cwd || now() - entry.time >= config.cacheTtlMs) fail('SCAN_REQUIRED', 'Scan this session before requesting details.', 409);
    const item = entry.result.items.find(row => row.id === input.id); if (!item) fail('ITEM_NOT_FOUND', 'The item is not in this session scan.', 404);
    const content = safeText(item.detail?.content ?? item.description, LIMITS.detailChars);
    return { ok: true, item: publicItem(item), content, body: content, truncated: item.detail?.truncated ?? false };
  }
  return { scan, detail, dispose() { lifetime.abort(new DOMException('Plugin disposed.', 'AbortError')); for (const owner of pending.values()) owner.abort(); pending.clear(); cache.clear(); } };
}
function publicItem(item) { const { detail, ...metadata } = item; return metadata; }
function publicResult(result, sessionId, cached) { return structuredClone({ ok: true, sessionId, ...result, items: result.items.map(publicItem), cached }); }
