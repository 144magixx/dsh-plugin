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
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error(`Condition timed out: ${expression}`);
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
  async function drag(dx, dy, end = true) {
    const rect = await box('[data-dss-drag-handle]');
    const x = rect.left + 35, y = rect.top + rect.height / 2;
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1 });
    for (let step = 1; step <= 5; step++) await mouse('mouseMoved', x + dx * step / 5, y + dy * step / 5, { buttons: 1 });
    if (end) await mouse('mouseReleased', x + dx, y + dy, { button: 'left' });
    await settle();
    return { x: x + dx, y: y + dy };
  }
  const initial = await box();
  check('fresh card opens and pins without clicking', (await prefs()).pinned && initial.width > 0);
  await drag(-220, 90);
  const moved = await box();
  check('real mouse drag follows pointer', Math.abs(moved.left - initial.left + 220) < 2 && Math.abs(moved.top - initial.top - 90) < 2);
  check('drag saves position and preserves pin', (await prefs()).pinned && Math.abs((await prefs()).position.left - moved.left) < 2);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(workspace, 'tests/.integration-data/preview/card-dragged.png'), Buffer.from(screenshot.data, 'base64'));
  const saved = (await prefs()).position;
  await call('Page.reload'); await waitFor('!!window.__summaryPreview && !!document.querySelector("[data-dsh-session-summary]")'); await settle();
  check('position and pin survive reload', (await prefs()).pinned && Math.abs((await box()).left - saved.left) < 2);
  await evaluate('window.__summaryPreview.switchSession("sess-other")'); await settle();
  check('switching session keeps position and replaces old content', Math.abs((await box()).left - saved.left) < 2 && await evaluate(`${card}.dataset.dshSessionSummary === 'sess-other' && !${card}.textContent.includes('Wikipedia')`));
  await evaluate('window.__summaryPreview.switchSession("sess-paper")'); await settle();
  await resize(280, 190);
  const small = await box();
  check('small viewport keeps entire card reachable', small.left >= 11 && small.top >= 11 && small.right <= 269 && small.bottom <= 179);
  await resize(1200, 900);
  await click('[data-dss-more]');
  await evaluate(`[...document.querySelectorAll('.dss-menu button')].find(button => button.textContent.includes('恢复默认位置')).click()`); await settle();
  check('reset menu returns to header anchor', (await prefs()).position === null && Math.abs((await box()).left - initial.left) < 2);
  await evaluate("document.querySelector('.pv-overlay').style.transform = 'translate(37px, 21px)'; window.dispatchEvent(new Event('resize'))");
  // Changing the anchor forces a layout pass under the shifted containing block.
  await resize(1190, 900); await resize(1200, 900);
  await drag(-150, 40);
  const shifted = await box();
  check('drag works inside transformed overlay', Math.abs(shifted.left - initial.left + 150) < 2 && Math.abs(shifted.top - initial.top - 40) < 2);
  await evaluate("document.querySelector('.pv-overlay').style.transform = 'translate(71px, 49px)'; window.dispatchEvent(new Event('resize'))"); await settle();
  check('saved position survives later overlay movement', Math.abs((await box()).left - shifted.left) < 2 && Math.abs((await box()).top - shifted.top) < 2);
  await click('[data-dss-drag-handle]');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft' }); await settle();
  check('keyboard moves focused title by 16px', Math.abs((await box()).left - shifted.left + 16) < 2);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' }); await settle();
  check('Home restores anchored position', (await prefs()).position === null);
  const beforeRight = await box('[data-dss-drag-handle]');
  await mouse('mousePressed', beforeRight.left + 30, beforeRight.top + 10, { button: 'right', buttons: 2 });
  await mouse('mouseMoved', beforeRight.left - 80, beforeRight.top + 50, { buttons: 2 });
  await mouse('mouseReleased', beforeRight.left - 80, beforeRight.top + 50, { button: 'right' }); await settle();
  check('right button does not drag', (await prefs()).position === null);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  // A native context menu may consume Escape, or the card may close. Restore explicitly.
  await evaluate(`${api}.prefs.set({pinned:true})`); await settle();
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touch = await box('[data-dss-drag-handle]');
  const point = { x: touch.left + 40, y: touch.top + 12, id: 1 };
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x - 100, y: point.y + 30 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settle();
  check('touch drag persists position', (await prefs()).position !== null);
  const beforeCancel = (await prefs()).position;
  const touch2 = await box('[data-dss-drag-handle]');
  const p2 = { x: touch2.left + 40, y: touch2.top + 12, id: 2 };
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p2] });
  await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p2, x: p2.x - 40, y: p2.y + 20 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await settle();
  check('touch cancellation restores saved position', JSON.stringify((await prefs()).position) === JSON.stringify(beforeCancel));
  await call('Emulation.setTouchEmulationEnabled', { enabled: false });
  const pointer = await drag(-80, 25, false);
  await evaluate('window.__summaryPreview.switchSession("sess-other")'); await settle();
  await mouse('mouseReleased', pointer.x, pointer.y, { button: 'left' }); await settle();
  check('switching during drag cleans up pointer listeners', JSON.stringify((await prefs()).position) === JSON.stringify(beforeCancel));
  await click('[data-dss-pin]');
  check('pin button unpins without dragging or closing', !(await prefs()).pinned && await evaluate(`!!${card}`));
  await click('[data-dss-close]');
  await call('Page.reload'); await waitFor('!!window.__summaryPreview'); await settle();
  check('manual close stays closed on reload', !(await prefs()).pinned && await evaluate(`!${card}`));
  await call('Page.navigate', { url: `${page}?mode=selftest` });
  await waitFor('document.getElementById("selftest")?.textContent.includes("job stream released after close") || document.getElementById("selftest")?.textContent.startsWith("FAIL selftest crashed")');
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
