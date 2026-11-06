/** Real pointer/keyboard browser checks against the shipped client and installed React.
 * Uses an isolated Chrome profile and a file:// fixture; never connects to live DSH.
 * Run: node scripts/test-browser.mjs [--browser /path/to/chrome]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { workspace } from './extract-test-runtime.mjs';

await import('./build-preview.mjs');
const flag = process.argv.indexOf('--browser');
const browser = (flag >= 0 ? process.argv[flag + 1] : undefined) ?? process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean).find(file => fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH or pass --browser to Chrome/Chromium/Edge.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dss-browser-test-'));
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit');
let socket;
const errors = [];
let passed = 0;
function check(name, ok) { assert.ok(ok, name); passed++; console.log(`PASS ${name}`); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debugging endpoint timed out')), 15000);
    let output = '';
    child.stderr.on('data', chunk => {
      output += chunk;
      const url = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output)?.[1];
      if (url) { clearTimeout(timer); resolve(url); }
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited: ${code}`)); });
  });
  socket = new WebSocket(endpoint);
  await once(socket, 'open');
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id); clearTimeout(task.timer);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Runtime.enable');
  const evaluate = async expression => {
    const reply = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  };
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 80))');
  const waitFor = async expression => {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(50); }
    const diagnostic = await evaluate('JSON.stringify({url:location.href,ready:document.readyState,visibility:document.visibilityState,report:document.getElementById("selftest")?.textContent})');
    throw new Error(`Condition timed out: ${expression} :: ${diagnostic}`);
  };
  const resize = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle(); };
  await resize(1200, 900);
  const page = pathToFileURL(path.join(workspace, 'tests/.integration-data/preview/index.html')).href;
  await call('Page.navigate', { url: `${page}?persist=yes&tip=no` });
  await waitFor('!!document.querySelector("[data-dsh-session-summary]")');
  await settle();
  const api = 'window.__summaryPreview.api';
  const card = 'document.querySelector("[data-dsh-session-summary]")';
  const box = async (selector = '[data-dsh-session-summary]') => evaluate(`JSON.parse(JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()))`);
  const prefs = () => evaluate(`${api}.prefs.getSnapshot()`);
  const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, ...extra });
  async function click(selector) {
    const rect = await box(selector); const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
    await settle();
  }
  const expandedSections = () => evaluate(`[...document.querySelectorAll('.dss-sec-head[aria-expanded=true]')].map(button => button.closest('[data-section]').dataset.section)`);
  const checkBackground = async theme => {
    const result = await evaluate(`(() => {
      const card = ${card};
      const actual = getComputedStyle(card).backgroundColor;
      card.style.background = 'var(--dsw-specific-menu)';
      const native = getComputedStyle(card).backgroundColor;
      card.style.removeProperty('background');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const alpha = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return ctx.getImageData(0, 0, 1, 1).data[3]; };
      return { actual: alpha(actual), native: alpha(native), opacity: getComputedStyle(card).opacity };
    })()`);
    check(`${theme} background is slightly translucent without fading contents`, Math.abs(result.actual - result.native * 0.88) < 2 && result.opacity === '1');
    const image = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(workspace, `tests/.integration-data/preview/card-default-${theme}.png`), Buffer.from(image.data, 'base64'));
  };
  const initial = await box();
  check('fresh card opens and pins without clicking', (await prefs()).pinned && initial.width > 0);
  check('only changes is expanded on startup', JSON.stringify(await expandedSections()) === '["changes"]');
  check('docked summary leaves transcript and composer unobstructed', (await box('[data-conversation-content]')).right <= initial.left - 10 && (await box('[data-conversation-region="composer"]')).right < initial.left);
  await checkBackground('light');
  await evaluate("document.body.setAttribute('data-ds-dark-theme', '')"); await settle();
  await checkBackground('dark');
  await evaluate("document.body.removeAttribute('data-ds-dark-theme')"); await settle();
  await resize(760, 900);
  check('narrow window uses a compact summary row above conversation', (await box()).height < 64 && (await box('[data-conversation-content]')).top >= (await box()).bottom + 10);
  await click('[data-dss-more]');
  check('compact summary menu is visible inside the card', (await box('.dss-menu')).bottom <= (await box()).bottom && (await box('[data-conversation-content]')).top >= (await box()).bottom + 10);
  await click('.dss-menu li:first-child button');
  await click('[data-dss-compact]');
  check('expanding narrow summary reserves vertical space', (await box()).height > 100 && (await box('[data-conversation-content]')).top >= (await box()).bottom + 10);
  const narrowShot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(workspace, 'tests/.integration-data/preview/card-narrow.png'), Buffer.from(narrowShot.data, 'base64'));
  await resize(1200, 900);
  check('free dragging is removed; the stack owns ordering', await evaluate(`!document.querySelector('[data-dss-drag-handle]') && !${api}.setPosition`) && Math.abs((await box()).left - initial.left) < 2);
  await evaluate('window.__summaryPreview.switchSession("sess-other")'); await settle();
  check('switching session keeps the anchor and replaces old content', Math.abs((await box()).left - initial.left) < 2 && await evaluate(`${card}.dataset.dshSessionSummary === 'sess-other' && !${card}.textContent.includes('Wikipedia')`));
  await evaluate('window.__summaryPreview.switchSession("sess-paper")'); await settle();
  await resize(280, 190);
  const small = await box();
  check('small viewport keeps entire card reachable', small.left >= 11 && small.top >= 11 && small.right <= 269 && small.bottom <= 179);
  await resize(1200, 900);
  await click('[data-dss-more]');
  check('menu no longer offers a position reset', await evaluate(`![...document.querySelectorAll('.dss-menu button')].some(button => button.textContent.includes('靠边显示'))`));
  await click('[data-dss-more]');
  await click('[data-dss-pin]');
  check('pin button unpins without dragging or closing', !(await prefs()).pinned && await evaluate(`!!${card}`));
  await evaluate(`${api}.toggleSection('sources'); ${api}.toggleSection('changes')`); await settle();
  await click('[data-dss-close]');
  check('closing frees reserved conversation space', await evaluate("!document.querySelector('.dss-conversation-layout')"));
  check('manual close works for the current window', !(await prefs()).pinned && await evaluate(`!${card}`));
  await call('Page.reload'); await waitFor('!!window.__summaryPreview && !!document.querySelector("[data-dsh-session-summary]")'); await settle();
  check('reload reopens pinned and resets section defaults', (await prefs()).pinned && JSON.stringify(await expandedSections()) === '["changes"]');
  await evaluate(`localStorage.setItem(window.__summaryPreview.client.STORAGE_KEY, JSON.stringify({pinned:false,collapsed:{changes:true},position:{left:100,top:70}}))`);
  await call('Page.reload'); await waitFor('!!window.__summaryPreview && !!document.querySelector("[data-dsh-session-summary]")'); await settle();
  check('legacy saved close and position cannot suppress startup', (await prefs()).pinned && (await prefs()).position === undefined && Math.abs((await box()).left - initial.left) < 2 && JSON.stringify(await expandedSections()) === '["changes"]');
  await click('[data-dss-close]');
  const second = await send('Target.createTarget', { url: `${page}?persist=yes&tip=no`, newWindow: true });
  const attached = await send('Target.attachToTarget', { targetId: second.targetId, flatten: true });
  const newWindow = await send('Runtime.evaluate', {
    expression: `new Promise(resolve => { let tries = 0; const timer = setInterval(() => { const card = document.querySelector('[data-dsh-session-summary]'); if (card || ++tries > 60) { clearInterval(timer); resolve(Boolean(card?.hasAttribute('data-pinned') && [...card.querySelectorAll('.dss-sec-head[aria-expanded=true]')].map(b => b.closest('[data-section]').dataset.section).join(',') === 'changes')); } }, 50); })`,
    awaitPromise: true, returnByValue: true
  }, attached.sessionId);
  check('a separate window opens pinned with only changes expanded', newWindow.result.value === true);
  await send('Target.closeTarget', { targetId: second.targetId });
  await call('Page.bringToFront');
  await call('Page.navigate', { url: `${page}?mode=selftest` });
  await waitFor('document.getElementById("selftest")?.textContent.includes("job stream released after close") || /FAIL|ERRORS/.test(document.getElementById("selftest")?.textContent ?? "")');
  const report = await evaluate('document.getElementById("selftest").textContent');
  fs.writeFileSync(path.join(workspace, 'tests/.integration-data/preview/selftest.txt'), report);
  assert.ok(!/^(FAIL|ERRORS)\b/m.test(report), report);
  check('existing summary interactions still pass', report.split('\n').filter(line => line.startsWith('PASS ')).length >= 26);
  check('no browser runtime errors', errors.length === 0);
  console.log(`${passed} browser checks passed.`);
} finally {
  socket?.close();
  child.kill();
  await exited;
  // Only the exact temporary directory created above is eligible for deletion.
  const resolved = fs.realpathSync(profile);
  if (resolved !== path.join(fs.realpathSync(os.tmpdir()), path.basename(profile)) || !path.basename(resolved).startsWith('dss-browser-test-')) throw new Error('Unexpected browser profile path');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
