/** Chrome/CDP check of collapsing the card stack to the right edge.
 * Installed DSH React/theme (read-only from app.asar), the real capability and summary clients,
 * and a host that enumerates the accessories slot. No server, profile or live session.
 * Run: node scripts/test-stack-collapse.mjs [--browser /path/to/chrome] [--keep]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { buildBrowserFixture, workspace } from './build-browser-fixture.mjs';

const { outputDir } = buildBrowserFixture();
/** Derive an enumerating host from the shared fixture; each anchor must exist exactly once. */
function patch(source, from, to) { assert.equal(source.split(from).length, 2, 'fixture anchor changed: ' + from.slice(0, 60)); return source.replace(from, to); }
let fixture = fs.readFileSync(path.join(workspace, 'tests/browser-fixture.js'), 'utf8');
fixture = patch(fixture, 'inject(name, factory) { return factory() },', "inject(name, factory) { return factory() },\n      entries: name => name === 'capability-selector.accessories' ? window.__stackAccessories.map(options => ({ options })) : undefined,\n      subscribe: () => () => {},");
fixture = patch(fixture, 'h(entry.component, { ...entry.options.inject(), sessionId, t: ct })', 'h(entry.component, { ...entry.options.inject(), sessionId, t: ct, renderSlot: window.__stackRenderSlot })');
fixture = patch(fixture, "  const summaryStyle = document.createElement('style');", `  const demo = (title, body) => h('section', { className: 'fixture-demo-card' }, h('b', null, title), h('span', null, body))
  window.__stackAccessories = [{ id: 'dsh-session-summary', order: -10, label: () => '会话摘要' }, { id: 'dsh-session-favorites', order: 50, label: () => '常用对话' }, { id: 'dsh-todo', order: 60, label: () => '待办' }]
  const cards = { 'dsh-session-summary': props => h(summary.SummaryAccessory, { api: summaryApi, t: st, sessionId: props.sessionId }), 'dsh-session-favorites': () => demo('常用对话', '会话搜索插件 · 本机外部能力选择插件'), 'dsh-todo': () => demo('待办', '确认设计稿 · 修复高亮错位 · 整理 README') }
  window.__stackRenderSlot = (name, props, options) => options?.only ? (cards[options.only] ? h(cards[options.only], props) : null) : window.__stackAccessories.map(row => h(cards[row.id], { key: row.id, ...props }))
  const demoStyle = document.createElement('style'); demoStyle.textContent = '.fixture-demo-card{display:block;padding:10px 12px 10px 16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}.fixture-demo-card b{display:block;font-size:13px;color:var(--dsw-alias-label-primary);margin-bottom:3px}'; document.head.appendChild(demoStyle)
  const summaryStyle = document.createElement('style');`);
fs.writeFileSync(path.join(outputDir, 'stack-fixture.js'), fixture);
fs.writeFileSync(path.join(outputDir, 'stack.html'), fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8').replace('src="fixture.js"', 'src="stack-fixture.js"'));
// Mixed-version check: STACK_SUMMARY_FILE swaps in another session-summary client.
if (process.env.STACK_SUMMARY_FILE) fs.copyFileSync(process.env.STACK_SUMMARY_FILE, path.join(outputDir, 'summary.js'));
const page = pathToFileURL(path.join(outputDir, 'stack.html')).href;
if (process.argv.includes('--build-only')) { console.log(page); process.exit(0); }

const at = process.argv.indexOf('--browser');
const browser = (at >= 0 ? process.argv[at + 1] : undefined) ?? process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!browser) throw new Error('Set CHROME_PATH or pass --browser.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-stack-collapse-'));
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit');
let socket, seq = 0, passed = 0;
const pending = new Map(), errors = [], failures = [], shots = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debug endpoint timed out')), 15000);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Chrome exited before debugging: ' + code)); });
  });
  socket = new WebSocket(endpoint); await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Runtime.enable');
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const settle = (ms = 120) => evaluate(`new Promise(resolve=>setTimeout(resolve,${ms}))`);
  const waitFor = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); } throw new Error('Timed out: ' + expression + '\n' + JSON.stringify(errors)); };
  const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?JSON.parse(JSON.stringify(e.getBoundingClientRect())):null})()`);
  const check = async (name, value, detail) => { const ok = typeof value === 'string' ? await evaluate(value) : value; if (ok) { passed++; console.log('PASS ' + name); } else { failures.push(name); console.error('FAIL ' + name + (detail ? ' :: ' + JSON.stringify(detail) : '')); } };
  const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : extra.buttons ?? 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
  /** Press, move in steps (stepMs apart), release. */
  async function drag(x, y, dx, dy, steps = 12, stepMs = 16) {
    await mouse('mousePressed', x, y, { buttons: 1 });
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x + dx * i / steps, y + dy * i / steps, { button: 'left', buttons: 1 }); await pause(stepMs); }
    await mouse('mouseReleased', x + dx, y + dy);
    await settle(320);
  }
  const shot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); const output = path.join(outputDir, name); fs.writeFileSync(output, Buffer.from(image.data, 'base64')); shots.push(output); };
  const state = () => evaluate(`(()=>{const d=document.querySelector('.dsc-dock'),c=document.querySelector('[data-conversation-content]');return {collapsed:d?.hasAttribute('data-collapsed'),visibility:d&&getComputedStyle(d).visibility,transform:d?.style.transform,marker:document.documentElement.hasAttribute('data-dsh-card-stack-collapsed'),stored:localStorage.getItem('dsh-capability-selector.stack.v1'),layout:localStorage.getItem('dsh-capability-selector.cards.v1'),side:c&&getComputedStyle(c).marginRight,reserve:document.documentElement.style.getPropertyValue('--dsh-summary-accessory-height'),tab:!!document.querySelector('.dsc-stack-tab'),tabShown:document.querySelector('.dsc-stack-tab')?.hasAttribute('data-shown'),panel:!!document.querySelector('.dsc-panel'),summaryDocked:!!document.querySelector('.dsc-dock [data-dsh-session-summary]')}})()`);

  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: page });
  await waitFor(`!!window.__capabilityBrowser && !!document.querySelector('.dsc-dock [data-dsh-session-summary]') && !!document.querySelector('.fixture-demo-card')`);
  await evaluate('localStorage.clear()'); await call('Page.reload'); await waitFor(`!!document.querySelector('.dsc-dock [data-dsh-session-summary]')`); await settle(300);
  let s = await state();
  await check('stack starts expanded with the summary seated in it and its column reserved', !s.collapsed && s.summaryDocked && s.side !== '0px' && !s.tab && !s.marker, s);
  await shot('stack-1-expanded.png');

  // A short drag on the title band springs back and does not click the card.
  let dock = await box('.dsc-dock'), title = await box('.dsc-trigger');
  await drag(title.left + 60, title.top + 14, dock.width * 0.3, 2);
  s = await state();
  await check('a drag under half the width springs back', !s.collapsed && !s.transform && !s.stored, s);
  await check('the release after a drag does not open the capability panel', !s.panel, s);
  // A plain click on the same title still works.
  await mouse('mousePressed', title.left + 60, title.top + 14, { buttons: 1 }); await mouse('mouseReleased', title.left + 60, title.top + 14); await settle();
  await check('a click on the title still opens the panel', (await state()).panel);
  await evaluate('window.__capabilityBrowser.api.close()'); await settle();

  // Vertical drags from the title band leave the stack alone.
  await drag(title.left + 60, title.top + 14, 4, 80, 8);
  s = await state();
  await check('a vertical drag from a title does not slide or collapse', !s.collapsed && !s.transform, s);

  // A long rightward drag from a card title collapses.
  const fav = await evaluate(`(()=>{const e=[...document.querySelectorAll('.fixture-demo-card')].find(x=>x.textContent.startsWith('常用对话'));const r=e.getBoundingClientRect();return {left:r.left,top:r.top}})()`);
  await mouse('mousePressed', fav.left + 70, fav.top + 12, { buttons: 1 });
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', fav.left + 70 + i * 20, fav.top + 12, { button: 'left', buttons: 1 }); await pause(16); }
  const mid = await evaluate(`(()=>{const d=document.querySelector('.dsc-dock');return {transform:d.style.transform,sliding:d.hasAttribute('data-sliding'),select:document.documentElement.style.userSelect}})()`);
  await check('the stack follows the pointer while sliding, with text selection suppressed', /translate3d\(1[0-2]\dpx/.test(mid.transform) && mid.sliding && mid.select === 'none', mid);
  await shot('stack-2-dragging.png');
  for (let i = 7; i <= 12; i++) { await mouse('mouseMoved', fav.left + 70 + i * 20, fav.top + 12, { button: 'left', buttons: 1 }); await pause(16); }
  await mouse('mouseReleased', fav.left + 310, fav.top + 12); await settle(400);
  s = await state();
  await check('past half the width the stack collapses off screen and hides', s.collapsed && s.visibility === 'hidden' && s.marker && s.stored === '{"collapsed":true}', s);
  await check('the summary releases its column and the reserve is cleared', s.side === '0px' && !s.reserve, s);
  await check('the card layout record is untouched', s.layout === null, s);
  await check('drag cleanup restores text selection', `document.documentElement.style.userSelect===''`);
  await check('collapsed cards are inert', `document.querySelector('.dsc-dock').inert===true`);
  const vw = await evaluate('innerWidth');
  await check('collapsed dock lies beyond the right edge', (await box('.dsc-dock')).left >= vw);
  await check('the tab exists but is invisible until the pointer reaches the edge', s.tab && !s.tabShown && await evaluate(`getComputedStyle(document.querySelector('.dsc-stack-tab')).opacity==='0'`), s);
  await shot('stack-3-collapsed.png');

  const tab = await box('.dsc-stack-tab');
  await mouse('mouseMoved', vw - 200, tab.top + 20); await settle();
  await check('pointer away from the edge keeps the tab hidden', !(await state()).tabShown);
  await mouse('mouseMoved', vw - 4, tab.top + 20); await settle(250);
  s = await state();
  await check('pointer at the right edge reveals a translucent tab', s.tabShown && await evaluate(`(()=>{const t=document.querySelector('.dsc-stack-tab'),c=getComputedStyle(t);return c.opacity==='1'&&/blur/.test(c.backdropFilter||c.webkitBackdropFilter)&&Math.round(t.getBoundingClientRect().right)===innerWidth})()`), s);
  await shot('stack-4-edge-hover.png');
  await mouse('mouseMoved', vw - 30, tab.top + 20); await settle();
  await check('moving onto the tab keeps it shown', (await state()).tabShown);
  await mouse('mouseMoved', vw - 300, tab.top + 20); await settle(250);
  await check('leaving the edge hides it again', !(await state()).tabShown);

  // Reload: state persists.
  await call('Page.reload'); await waitFor(`!!document.querySelector('.dsc-dock') && !!document.querySelector('.dsc-stack-tab')`); await settle(300);
  s = await state();
  await check('collapse survives a reload without flashing the column back', s.collapsed && s.visibility === 'hidden' && s.side === '0px' && s.marker, s);

  // Click the tab: slides back in.
  await mouse('mouseMoved', vw - 4, tab.top + 20); await settle(250);
  const t2 = await box('.dsc-stack-tab');
  await mouse('mousePressed', t2.left + t2.width / 2, t2.top + t2.height / 2, { buttons: 1 }); await mouse('mouseReleased', t2.left + t2.width / 2, t2.top + t2.height / 2);
  await settle(60);
  const sliding = await evaluate(`(()=>{const d=document.querySelector('.dsc-dock');return {left:d.getBoundingClientRect().left,transition:d.style.transition}})()`);
  await check('the stack animates in from the right', /transform 220ms/.test(sliding.transition) && sliding.left > dock.left + 5, sliding);
  await settle(400);
  s = await state();
  dock = await box('.dsc-dock');
  await check('clicking the tab restores the stack, column and storage', !s.collapsed && !s.tab && !s.marker && s.stored === null && s.side !== '0px' && s.visibility === 'visible' && !s.transform && !!s.reserve, s);
  await check('restored stack sits where it was', Math.abs(dock.left - (await box('[data-dsh-session-summary]')).left) <= 1 && dock.right <= vw - 10, dock);
  await check('restored stack is interactive again', `document.querySelector('.dsc-dock').inert===false`);
  await shot('stack-5-restored.png');

  // The left-edge strip collapses too; the grip's rightward pull hands over to the slide.
  const edge = await box('.dsc-stack-edge');
  await check('a grab strip runs along the stack edge', edge && edge.width === 10 && Math.abs(edge.right - dock.left) <= 1 && edge.height > 100, edge);
  await drag(edge.left + 5, edge.top + 60, 260, 0);
  await check('dragging the edge strip right collapses', (await state()).collapsed);
  await mouse('mouseMoved', vw - 4, tab.top + 20); await settle(250);
  const t3 = await box('.dsc-stack-tab'); await mouse('mousePressed', t3.left + 10, t3.top + 20, { buttons: 1 }); await mouse('mouseReleased', t3.left + 10, t3.top + 20); await settle(400);
  await check('expanded again', !(await state()).collapsed);
  const fav2 = await evaluate(`(()=>{const e=[...document.querySelectorAll('.dsc-card-item')].find(x=>x.textContent.includes('常用对话'));const r=e.getBoundingClientRect();return {left:r.left,top:r.top}})()`);
  await mouse('mouseMoved', fav2.left + 40, fav2.top + 20); await settle();
  const grip = await evaluate(`(()=>{const e=[...document.querySelectorAll('.dsc-card-item')].find(x=>x.textContent.includes('常用对话')).querySelector('.dsc-grip');const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await drag(grip.x, grip.y, 240, 3);
  s = await state();
  await check('pulling a grip to the right collapses instead of reordering', s.collapsed && s.layout === null, s);
  await evaluate(`document.querySelector('.dsc-stack-tab').click()`); await settle(400);
  await drag(grip.x, grip.y, 2, 150, 14);
  s = await state();
  await check('a vertical grip drag still reorders and does not collapse', !s.collapsed && s.layout !== null, s);

  // Keyboard: menu item collapses; tab is focusable.
  await evaluate(`localStorage.removeItem('dsh-capability-selector.cards.v1')`);
  await evaluate(`document.querySelector('.dsc-grip').focus()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await settle();
  await check('the grip menu offers collapsing', `[...document.querySelectorAll('.dsc-card-menu button')].some(b=>b.textContent==='收起卡片栏')`);
  await evaluate(`[...document.querySelectorAll('.dsc-card-menu button')].find(b=>b.textContent==='收起卡片栏').click()`); await settle(400);
  await check('the menu item collapses the stack', (await state()).collapsed);
  await evaluate(`document.querySelector('.dsc-stack-tab').focus()`); await settle(300);
  const focusInfo = await evaluate(`(()=>{const t=document.querySelector('.dsc-stack-tab');return {active:document.activeElement===t,visible:t.matches(':focus-visible'),opacity:getComputedStyle(t).opacity,label:t.getAttribute('aria-label')}})()`);
  await check('keyboard focus reveals the tab', focusInfo.active && focusInfo.label === '显示卡片栏' && (!focusInfo.visible || focusInfo.opacity === '1'), focusInfo);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await settle(400);
  await check('Enter on the tab restores the stack', !(await state()).collapsed);

  // Escape cancels a slide in progress.
  title = await box('.dsc-trigger');
  await mouse('mousePressed', title.left + 60, title.top + 14, { buttons: 1 });
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', title.left + 60 + i * 25, title.top + 14, { button: 'left', buttons: 1 }); await pause(16); }
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await mouse('mouseReleased', title.left + 310, title.top + 14); await settle(300);
  s = await state();
  await check('Escape cancels the slide and springs back', !s.collapsed && !s.transform && !s.panel, s);

  // Right sidebar open: stack and tab step aside, marker removed; closing restores collapse.
  await evaluate(`document.querySelector('.dsc-grip').focus()`);
  await evaluate(`window.__capabilityBrowser.setSidebar(false)`);
  await drag(title.left + 60, title.top + 14, 260, 0);
  await check('collapsed before opening the sidebar', (await state()).collapsed);
  await evaluate(`window.__capabilityBrowser.setSidebar(true)`); await settle(300);
  s = await state();
  await check('an expanded right sidebar hides the tab and drops the marker', !s.tab && !s.marker && s.stored === '{"collapsed":true}', s);
  await evaluate(`window.__capabilityBrowser.setSidebar(false)`); await settle(300);
  s = await state();
  await check('closing the sidebar returns to the collapsed state', s.collapsed && s.tab && s.marker && s.visibility === 'hidden', s);
  await check('the remounted dock is still beyond the right edge', (await box('.dsc-dock')).left >= await evaluate('innerWidth'), await box('.dsc-dock'));
  await evaluate(`document.querySelector('.dsc-stack-tab').click()`); await settle(400);
  dock = await box('.dsc-dock');
  await check('expanding after the sidebar cycle returns to the summary column', !(await state()).collapsed && Math.abs(dock.right - (await evaluate('innerWidth')) + 12) <= 1, dock);
  title = await box('.dsc-trigger'); await drag(title.left + 60, title.top + 14, 300, 0);

  // Narrow window: stack layout, still collapses and restores.
  await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 700, deviceScaleFactor: 1, mobile: false }); await settle(400);
  s = await state();
  await check('after a resize the collapsed stack is still just past the edge', await evaluate(`(()=>{const r=document.querySelector('.dsc-dock').getBoundingClientRect();return r.left>=innerWidth && r.left<=innerWidth+40})()`));
  await check('narrow windows keep the collapse and free the top space', s.collapsed && /^0px$|^$/.test(await evaluate(`getComputedStyle(document.querySelector('[data-conversation-content]')).marginTop`)), s);
  await evaluate(`document.querySelector('.dsc-stack-tab').click()`); await settle(400);
  dock = await box('.dsc-dock');
  await check('narrow expand puts the stack back inside the viewport', !(await state()).collapsed && dock.right <= 820 - 10 && dock.left >= 10, dock);
  await shot('stack-6-narrow.png');

  // Unmount releases everything.
  title = await box('.dsc-trigger'); await drag(title.left + 60, title.top + 14, 300, 0);
  await evaluate(`window.__capabilityBrowser.uninstall()`); await settle(300);
  await check('uninstalling while collapsed removes the marker and tab', `!document.documentElement.hasAttribute('data-dsh-card-stack-collapsed') && !document.querySelector('.dsc-stack-tab') && !document.querySelector('.dsc-dock')`);
  await check('no browser errors', errors.length === 0 && (await evaluate('window.__capabilityBrowser.errors.length')) === 0, errors);

  // Hosts without slot enumeration (fixed order, no grips) still collapse from the title and edge.
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: page.replace('stack.html', 'index.html') });
  await waitFor(`!!window.__capabilityBrowser && !!document.querySelector('.dsc-trigger')`); await evaluate('localStorage.clear()'); await settle(300);
  await check('fallback host renders the fixed order without grips', `!document.querySelector('.dsc-grip') && !!document.querySelector('.dsc-accessories')`);
  title = await box('.dsc-trigger');
  await drag(title.left + 60, title.top + 14, 300, 0);
  s = await state();
  await check('fallback host: title drag collapses and the floating summary keeps its own place', s.collapsed && s.visibility === 'hidden' && !s.summaryDocked && !!(await box('[data-dsh-session-summary]'))?.width, s);
  await evaluate(`document.querySelector('.dsc-stack-tab').click()`); await settle(400);
  await check('fallback host: the tab restores it', !(await state()).collapsed && !(await state()).panel);
  await check('fallback host: no browser errors', errors.length === 0 && (await evaluate('window.__capabilityBrowser.errors.length')) === 0, errors);
} catch (error) {
  failures.push('runner: ' + error.message); console.error(error.stack || error);
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close(); child.kill(); await exited;
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(JSON.stringify({ passed, failed: failures.length, failures, screenshots: shots }, null, 2));
  if (failures.length) process.exitCode = 1;
}
