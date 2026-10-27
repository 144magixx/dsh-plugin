import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
const LABEL = 'io.dsh.task-guardian.login';
const MARKER = '<!-- Managed by dsh-task-guardian -->';
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function findApplication(platform = process.platform, executable = process.execPath) {
  if (platform === 'darwin') {
    const parts = executable.split(path.sep), index = parts.findIndex(part => part.endsWith('.app'));
    if (index >= 0) return parts.slice(0, index + 1).join(path.sep);
  }
  if (platform === 'win32' && /DeepSeek Harness\.exe$/i.test(executable)) return executable;
  return undefined;
}
export function buildStartupPlan({ platform = process.platform, home = os.homedir(), appPath = findApplication(platform), uid = process.getuid?.() } = {}) {
  if (!appPath || /[\x00-\x1f]/.test(appPath)) throw new Error('startup_application_unavailable');
  if (platform === 'darwin') {
    if (!path.isAbsolute(appPath) || !appPath.endsWith('.app') || !Number.isInteger(uid)) throw new Error('startup_application_invalid');
    const file = path.resolve(home, 'Library', 'LaunchAgents', LABEL + '.plist');
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n${MARKER}\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-a</string><string>${xml(appPath)}</string></array><key>RunAtLoad</key><true/></dict></plist>\n`;
    // load-on-next-login only: launchctl enable makes the domain eligible but does not launch
    // another DSH while a task is running. A login starts a fresh launchd user domain.
    return { platform, file, content, appPath, enable: { command: '/bin/launchctl', args: ['enable', `gui/${uid}/${LABEL}`] }, disable: { command: '/bin/launchctl', args: ['bootout', `gui/${uid}/${LABEL}`] } };
  }
  if (platform === 'win32') {
    if (!path.win32.isAbsolute(appPath) || !appPath.toLowerCase().endsWith('.exe') || appPath.includes('"')) throw new Error('startup_application_invalid');
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    return { platform, appPath, enable: { command: 'reg.exe', args: ['add', key, '/v', LABEL, '/t', 'REG_SZ', '/d', `"${appPath}"`, '/f'] }, disable: { command: 'reg.exe', args: ['delete', key, '/v', LABEL, '/f'] }, query: { command: 'reg.exe', args: ['query', key, '/v', LABEL] } };
  }
  throw new Error('startup_platform_unavailable');
}
async function run(command, args) { return execFile(command, args, { windowsHide: true, timeout: 10000, maxBuffer: 65536 }); }
export async function setStartup(enabled, { plan = buildStartupPlan(), execute = run, filesystem = fs } = {}) {
  if (typeof enabled !== 'boolean') throw new Error('startup_invalid_setting');
  if (plan.platform === 'darwin') {
    // Verify the resolved absolute owned target immediately before writing/removing.
    const target = path.resolve(plan.file);
    if (!path.isAbsolute(plan.file) || target !== plan.file || path.basename(target) !== LABEL + '.plist' || path.basename(path.dirname(target)) !== 'LaunchAgents' || !plan.content.includes(MARKER)) throw new Error('startup_target_mismatch');
    let previous;
    try { previous = await filesystem.readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous !== undefined && !previous.includes(MARKER)) throw new Error('startup_file_not_owned');
    if (enabled) {
      await filesystem.mkdir(path.dirname(target), { recursive: true });
      await filesystem.writeFile(target, plan.content, { mode: 0o600 });
      try { await execute(plan.enable.command, plan.enable.args); }
      catch (error) { if (previous === undefined) await filesystem.unlink(target); else await filesystem.writeFile(target, previous); throw error; }
      const verified = await filesystem.readFile(target, 'utf8');
      if (verified !== plan.content) throw new Error('startup_verification_failed');
    } else {
      try { await execute(plan.disable.command, plan.disable.args); }
      catch (error) { if (!/No such process|Could not find service|not found/i.test(String(error.stderr || error.message))) throw error; }
      if (previous !== undefined) { const current = await filesystem.readFile(target, 'utf8'); if (current !== previous || !current.includes(MARKER)) throw new Error('startup_file_changed'); await filesystem.unlink(target); }
    }
  } else if (plan.platform === 'win32') {
    // Only one constant named HKCU value belongs to this plugin. Never edit HKLM or arbitrary keys.
    const expected = buildStartupPlan({ platform: 'win32', appPath: plan.appPath });
    if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error('startup_target_mismatch');
    const expectedValue = `"${plan.appPath}"`;
    const queryValue = async () => {
      let result;
      try { result = await execute(plan.query.command, plan.query.args); }
      catch (error) { if (error.code === 1 && /unable to find|not found|找不到/i.test(String(error.stderr || error.stdout || error.message))) return null; throw error; }
      const row = String(result?.stdout || '').split(/\r?\n/).find(line => line.trimStart().startsWith(LABEL));
      const match = row?.match(/^\s*io\.dsh\.task-guardian\.login\s+REG_SZ\s+(.+?)\s*$/);
      if (!match || match[1] !== expectedValue) throw new Error('startup_value_not_owned');
      return match[1];
    };
    const previous = await queryValue();
    if (enabled) {
      await execute(plan.enable.command, plan.enable.args);
      if (await queryValue() !== expectedValue) throw new Error('startup_verification_failed');
    } else if (previous !== null) {
      // Recheck immediately before deletion; no arbitrary value/key is accepted.
      if (await queryValue() !== previous) throw new Error('startup_value_changed');
      await execute(plan.disable.command, plan.disable.args);
    }
  } else throw new Error('startup_platform_unavailable');
  return { enabled, platform: plan.platform, effective: 'next_login', appPath: plan.appPath };
}
