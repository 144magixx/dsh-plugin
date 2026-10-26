/**
 * Offline layout preview of the summary card (NOT verification of a running DSH).
 *
 * Builds tests/.integration-data/preview from the installed shell bundle, then
 * renders it with headless Chrome/Chromium/Edge using a throw-away profile owned
 * by this project. Never touches the running DSH, its port, or any personal
 * profile. Works on Windows, macOS and Linux.
 *
 * Usage: node scripts/preview.mjs [--browser <path>]   (or set CHROME_PATH)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { workspace } from './extract-test-runtime.mjs';

function browserCandidates() {
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(root => [
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (process.platform === 'darwin') {
    return ['/Applications', path.join(os.homedir(), 'Applications')].flatMap(root => [
      path.join(root, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      path.join(root, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      path.join(root, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
    ]);
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
}

const flag = process.argv.indexOf('--browser');
const browser = (flag >= 0 ? process.argv[flag + 1] : undefined) ?? process.env.CHROME_PATH ?? browserCandidates().find(candidate => fs.existsSync(candidate));
if (!browser || !fs.existsSync(browser)) {
  console.error('No Chrome/Chromium/Edge found. Pass --browser <path> or set CHROME_PATH.');
  process.exit(1);
}

await import('./build-preview.mjs');
const out = path.join(workspace, 'tests', '.integration-data', 'preview');
const page = pathToFileURL(path.join(out, 'index.html')).href;
const profileDir = path.join(workspace, 'tests', '.integration-data', `chrome-${randomUUID().replaceAll('-', '')}`);
fs.mkdirSync(profileDir, { recursive: true });
const common = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--user-data-dir=${profileDir}`, '--window-size=1440,900'];

// Chrome reports progress on stderr; that is not a failure.
function run(args, stdout = 'ignore') {
  const result = spawnSync(browser, [...common, ...args], { stdio: ['ignore', stdout, 'ignore'], timeout: 60_000 });
  if (result.error) throw result.error;
}

try {
  const shots = [
    ['card-light.png', '?mode=light'],
    ['card-dark.png', '?mode=dark'],
    ['card-light-bottom.png', '?mode=light&tip=no&scroll=bottom'],
    ['toggle-closed.png', '?mode=light&open=no'],
  ];
  for (const [name, query] of shots) {
    const shot = path.join(out, name);
    run(['--virtual-time-budget=4000', `--screenshot=${shot}`, page + query]);
    console.log(`screenshot: ${shot}`);
  }
  // Write --dump-dom straight to a file descriptor rather than a pipe; this is
  // the most reliable capture on every platform.
  const domFile = path.join(out, 'selftest-dom.html');
  const fd = fs.openSync(domFile, 'w');
  try { run(['--virtual-time-budget=8000', '--dump-dom', `${page}?mode=selftest`], fd); }
  finally { fs.closeSync(fd); }
  const dom = fs.readFileSync(domFile, 'utf8');
  const raw = /<pre id="selftest"[^>]*>([\s\S]*?)<\/pre>/.exec(dom)?.[1] ?? '';
  const report = raw
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
  fs.writeFileSync(path.join(out, 'selftest.txt'), report);
  console.log(report);
  if (!report.trim() || /^(FAIL|ERRORS)\b/m.test(report)) process.exitCode = 1;
} finally {
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
