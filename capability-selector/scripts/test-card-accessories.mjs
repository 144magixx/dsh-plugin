/** Additional capability-card acceptance using the actual three product clients.
 * Builds through Guardian's existing read-only fixture builder, then copies that
 * fixture into this plugin's ignored output tree. No Guardian source is edited.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(workspace);
const built = spawnSync(process.execPath, [path.join(repo, 'task-guardian/scripts/test-accessory-browser.mjs'), '--build-only'], { cwd: repo, encoding: 'utf8' });
if (built.status !== 0) throw Error(`Existing accessory fixture builder failed: ${built.stderr || built.stdout}`);
const sourceDir = path.join(repo, 'task-guardian/tests/.integration-data/accessory-browser');
const outputDir = path.join(workspace, 'tests/.integration-data/card-accessories');
fs.mkdirSync(outputDir, { recursive: true });
for (const name of ['vendor.js', 'shell.js', 'shell.css', 'native-conversation.js', 'summary.js', 'capability.js', 'guardian.js', 'fixture.js', 'index.html']) fs.copyFileSync(path.join(sourceDir, name), path.join(outputDir, name));
const page = pathToFileURL(path.join(outputDir, 'index.html')).href;
const at = process.argv.indexOf('--browser');
const browser = (at >= 0 ? process.argv[at + 1] : undefined) ?? process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file));
assert.ok(browser, 'Set CHROME_PATH or pass --browser.');
const profile = path.join(outputDir, 'chrome-profile-' + randomUUID()); fs.mkdirSync(profile);
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit');
let socket, serial = 0, passed = 0, evaluate, call;
const pending = new Map(), failures = [], browserErrors = [], screenshots = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome debug endpoint timed out')), 15000); let output = '';
    child.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Chrome exited before debugging: ' + code)); });
  });
  socket = new WebSocket(endpoint); await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result); } }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  call = (method, params) => send(method, params, sessionId); await call('Runtime.enable');
  evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,140))');
  const waitFor = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; const errors = await evaluate('window.__capabilityBrowser?.errors'); if (errors?.length) throw Error(errors.join('\n')); await pause(40); } throw Error('Timed out: ' + expression); };
  const check = async (name, value, details) => { const ok = typeof value === 'string' ? await evaluate(value) : value; checks.push({ name, passed: !!ok, ...(details ? { details } : {}) }); if (ok) { passed++; console.log('PASS ' + name); } else { failures.push(name); console.error('FAIL ' + name + (details ? ' :: ' + JSON.stringify(details) : '')); } };
  const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?JSON.parse(JSON.stringify(e.getBoundingClientRect())):null})()`);
  const resize = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle(); };
  const click = async selector => { const r = await box(selector); assert.ok(r?.width && r?.height, 'visible click target ' + selector); const x = r.left + r.width / 2, y = r.top + r.height / 2; await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await settle(); };
  const shot = async (name, crop = false) => {
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})'); const summary = await box('[data-dsh-session-summary]'), dock = await box('.dsc-dock');
    let clip;
    if (crop && summary && dock) { const x = Math.max(0, summary.left - 12), y = Math.max(0, summary.top - 12); clip = { x, y, width: Math.min(viewport.width - x, Math.max(summary.right, dock.right) - x + 12), height: Math.min(viewport.height - y, Math.max(summary.bottom, dock.bottom) - y + 12), scale: 1 }; }
    const data = await call('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    const output = path.join(outputDir, name); fs.writeFileSync(output, Buffer.from(data.data, 'base64')); screenshots.push(output);
  };
  const fixture = 'window.__capabilityBrowser';
  async function geometry(label) {
    const summary = await box('[data-dsh-session-summary]'), dock = await box('.dsc-dock'), card = await box('.dsc-trigger'), guardian = await box('.dtg-accessory');
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})');
    const reserve = await evaluate('parseFloat(document.documentElement.style.getPropertyValue("--dsh-summary-accessory-height"))');
    const details = { summary, dock, card, guardian, viewport, reserve };
    await check(label + ': equal-width native cards stay aligned and ordered', !!summary && !!card && !!guardian && Math.abs(card.left - summary.left) <= 1 && Math.abs(card.width - summary.width) <= 1 && Math.abs(guardian.left - card.left) <= 1 && Math.abs(guardian.width - card.width) <= 1 && card.top >= summary.bottom + 5 && guardian.top >= card.bottom + 4, details);
    await check(label + ': cards and measured reserve fit the viewport', dock.bottom <= viewport.height - 10 && guardian.bottom <= viewport.height - 10 && card.left >= 10 && guardian.right <= viewport.width - 10 && Math.abs(reserve - Math.ceil(dock.height) - 12) <= 1, details);
  }
  await resize(899, 900); await call('Page.navigate', { url: page });
  await waitFor(`!!${fixture} && ${fixture}.api.getSnapshot().status==='ready' && !!document.querySelector('.dtg-accessory') && !document.querySelector('.dtg-switch').disabled`); await settle();
  await check('three actual products render while the selector is closed', `!!document.querySelector('[data-dsh-session-summary]') && !!document.querySelector('.dsc-trigger') && !!document.querySelector('.dsc-accessories > .dtg-accessory') && !document.querySelector('.dsc-panel')`);
  await check('compact summary is collapsed like the approved concept', `document.querySelector('[data-dsh-session-summary]').hasAttribute('data-compact-collapsed')`);
  await geometry('899x900 approved stack');
  await check('capability card shares guardian surface and radius tokens', `(()=>{const c=getComputedStyle(document.querySelector('.dsc-trigger')),g=getComputedStyle(document.querySelector('.dtg-accessory'));return c.borderTopLeftRadius===g.borderTopLeftRadius && c.backgroundColor===g.backgroundColor && c.borderTopColor===g.borderTopColor})()`);
  await shot('approved-card-stack-wide.png', true); await shot('approved-card-stack-context.png');
  await evaluate(`${fixture}.dark(true)`); await settle(); await geometry('899x900 dark'); await shot('approved-card-stack-dark.png', true); await evaluate(`${fixture}.dark(false)`); await settle();
  for (const [width, height] of [[760, 480], [320, 480], [320, 190]]) {
    await resize(width, height); await evaluate(`${fixture}.resetSummary()`); await settle();
    await geometry(`${width}x${height}`); await shot(`approved-card-stack-${width}x${height}.png`, true);
  }
  await resize(899, 900); await evaluate(`${fixture}.resetSummary()`); await settle();
  const baselineReserve = await evaluate('parseFloat(document.documentElement.style.getPropertyValue("--dsh-summary-accessory-height"))');
  await evaluate(`(()=>{const e=document.createElement('div');e.dataset.fixtureTallAccessory='';e.style.cssText='height:1100px;flex:none';document.querySelector('.dsc-accessories').appendChild(e)})()`);
  await waitFor(`document.querySelector('.dsc-dock').scrollHeight>document.querySelector('.dsc-dock').clientHeight+100`); await settle();
  await evaluate("document.querySelector('.dsc-dock').scrollTop=10000"); await settle();
  await check('tall companions can scroll without moving the sticky capability card out of reach', `(()=>{const d=document.querySelector('.dsc-dock'),c=document.querySelector('.dsc-trigger'),dr=d.getBoundingClientRect(),cr=c.getBoundingClientRect();return d.scrollTop>0 && cr.top>=dr.top-1 && cr.bottom<=dr.bottom+1 && document.elementFromPoint(cr.left+40,cr.top+12)?.closest('.dsc-trigger')===c})()`);
  await click('.dsc-trigger'); await check('sticky full-width card remains clickable after companion scroll', '!!document.querySelector(".dsc-panel")');
  await evaluate(`${fixture}.api.close();document.querySelector('[data-fixture-tall-accessory]').remove();document.querySelector('.dsc-dock').scrollTop=0`); await settle();
  await waitFor(`parseFloat(document.documentElement.style.getPropertyValue('--dsh-summary-accessory-height'))<=${baselineReserve + 1}`);
  await geometry('removed tall companion');
  await check('three-product fixture reports no errors or unexpected execution calls', `${fixture}.errors.length===0 && ${fixture}.guardianCalls.every(call=>call.action==='snapshot')`, browserErrors);
  await evaluate(`${fixture}.uninstall();${fixture}.unmount()`); await settle();
  await check('complete unmount releases all card layouts and reserve', `!document.querySelector('.dsc-trigger') && !document.querySelector('.dtg-accessory') && !document.documentElement.style.getPropertyValue('--dsh-summary-accessory-height')`);
} catch (error) {
  failures.push('runner: ' + error.message); console.error(error.stack || error);
  if (call) try { const data = await call('Page.captureScreenshot', { format: 'png' }); const output = path.join(outputDir, 'failure.png'); fs.writeFileSync(output, Buffer.from(data.data, 'base64')); screenshots.push(output); } catch {}
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close(); child.kill(); await exited;
  const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved), fs.realpathSync(outputDir)); assert.ok(path.basename(resolved).startsWith('chrome-profile-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const report = { passed, failed: failures.length, failures, checks, browserErrors, screenshots, fixture: page, scope: 'Actual summary, capability card and GuardianAccessory; installed React/theme; isolated fixture only' };
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed, failed: failures.length, failures, screenshots, report: path.join(outputDir, 'report.json') }, null, 2));
  if (failures.length || browserErrors.length) process.exitCode = 1;
}
