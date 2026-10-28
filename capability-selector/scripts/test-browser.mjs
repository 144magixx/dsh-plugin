/** Chrome/CDP integration with real summary + capabilities + native draft engine.
 * No server, profile installation, live session or model request is involved.
 * Run: node scripts/test-browser.mjs [--browser /path/to/chrome]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { buildBrowserFixture, workspace } from './build-browser-fixture.mjs';

const { page, outputDir } = buildBrowserFixture();
const at = process.argv.indexOf('--browser');
const browser = (at >= 0 ? process.argv[at + 1] : undefined) ?? process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!browser) throw new Error('Set CHROME_PATH or pass --browser.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-capability-browser-'));
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit');
let socket, seq = 0, passed = 0;
const pending = new Map(), errors = [], failures = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debug endpoint timed out')), 15000);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
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
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  const waitFor = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; const e = await evaluate('window.__capabilityBrowser?.errors'); if (e?.length) throw new Error(e.join('\n')); await pause(50); } throw new Error('Timed out: ' + expression + '\n' + JSON.stringify(errors)); };
  const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?JSON.parse(JSON.stringify(e.getBoundingClientRect())):null})()`);
  const resize = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle(); };
  const check = async (name, value, detail = '') => { const ok = typeof value === 'string' ? await evaluate(value) : value; if (ok) { passed++; console.log('PASS ' + name); } else { failures.push(name + (detail ? ' :: ' + detail : '')); console.error('FAIL ' + name + (detail ? ' :: ' + detail : '')); } };
  const click = async selector => { const r = await box(selector); assert.ok(r && r.width && r.height, 'visible click target ' + selector); const x = r.left + r.width / 2, y = r.top + r.height / 2; await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await settle(); };
  const shot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); const output = path.join(outputDir, name); fs.writeFileSync(output, Buffer.from(image.data, 'base64')); return output; };
  const fixture = 'window.__capabilityBrowser';
  const open = async () => { if (!await evaluate('!!document.querySelector(".dsc-panel")')) await click('.dsc-trigger'); await waitFor(`${fixture}.api.getSnapshot().status==='ready' && !!document.querySelector('.dsc-panel')`); };
  const gapCheck = async label => {
    const s = await box('[data-dsh-session-summary]'), dock = await box('.dsc-dock'), card = await box('.dsc-trigger');
    const reserve = await evaluate('parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dsh-summary-accessory-height"))');
    await check(label, !!s && !!dock && !!card && dock.top >= s.bottom + 6 && dock.bottom <= await evaluate('innerHeight') - 10 && dock.left >= 10 && dock.right <= await evaluate('innerWidth') - 10 && Math.abs(card.left - s.left) <= 1 && Math.abs(card.width - s.width) <= 1 && Math.abs(reserve - Math.ceil(dock.height) - 12) <= 1, JSON.stringify({ summary: s, dock, card, reserve }));
  };
  const panelCheck = async label => {
    const p = await box('.dsc-panel'), footer = await box('.dsc-footer'), add = await box('.dsc-add');
    const v = await evaluate('({w:innerWidth,h:innerHeight})');
    await check(label, !!p && !!footer && !!add && p.left >= 10 && p.top >= 10 && p.right <= v.w - 10 && p.bottom <= v.h - 10 && footer.top >= p.top && footer.bottom <= p.bottom + 1 && add.bottom <= p.bottom + 1 && add.left >= p.left && add.right <= p.right, JSON.stringify({ p, footer, add, viewport: v }));
  };
  const textBoundsCheck = async label => {
    const result = await evaluate(`(() => {
      const list = document.querySelector('.dsc-list');
      const failures = [];
      for (const row of list.querySelectorAll('.dsc-row')) {
        const text = row.querySelector('.dsc-entry-text'), entry = row.querySelector('.dsc-entry'), meta = row.querySelector('.dsc-row-meta');
        const textRect = text.getBoundingClientRect(), entryRect = entry.getBoundingClientRect(), metaRect = meta.getBoundingClientRect();
        for (const field of row.querySelectorAll('.dsc-entry-name,.dsc-entry-description')) {
          if (!field.getClientRects().length) continue;
          const rect = field.getBoundingClientRect();
          if (rect.left < textRect.left - 1 || rect.right > textRect.right + 1 || rect.right > metaRect.left - 2) failures.push({ field: field.className, right: rect.right, textRight: textRect.right, sourceLeft: metaRect.left });
        }
        if (entryRect.right > metaRect.left - 2) failures.push({ field: 'entry', right: entryRect.right, sourceLeft: metaRect.left });
      }
      return { failures, horizontalOverflow: list.scrollWidth > list.clientWidth + 1 };
    })()`);
    await check(label, result.failures.length === 0 && !result.horizontalOverflow, JSON.stringify(result));
  };
  await resize(1440, 900);
  await call('Page.navigate', { url: `${page}?scan=hold` });
  await waitFor(`!!${fixture} && !!document.querySelector('[data-dsh-session-summary]') && !!document.querySelector('.dsc-trigger') && ${fixture}.scanRequests.length===1`);
  await settle();
  await check('real installed React and native input engine mounted', `${fixture}.native && window.__shared.react.version==='18.3.1'`);
  await check('Chinese and English dictionaries have the same keys', `(()=>{const c=window.__registrations['dsh-capability-selector'].factory(id=>window.__shared[id]);return JSON.stringify(Object.keys(c.ZH).sort())===JSON.stringify(Object.keys(c.EN).sort())})()`);
  await check('first read-only scan starts before opening and reports loading without a fake total', `${fixture}.api.getSnapshot().status==='loading' && !${fixture}.api.getSnapshot().open && document.querySelector('.dsc-trigger').getAttribute('aria-busy')==='true' && !document.querySelector('.dsc-card-count') && document.querySelector('.dsc-card-hint').textContent.length>0`);
  await evaluate(`${fixture}.releaseScan()`); await waitFor(`${fixture}.api.getSnapshot().status==='ready'`); await settle();
  await check('card displays discovered totals and all three capability counts before clicking', `${fixture}.scanRequests.length===1 && document.querySelector('.dsc-card-count').textContent.includes('52') && document.querySelector('.dsc-card-stats').textContent.includes('Skills 47') && document.querySelector('.dsc-card-stats').textContent.includes('CLI 3') && document.querySelector('.dsc-card-stats').textContent.includes('MCP 2') && document.querySelector('.dsc-card-hint').textContent.includes('去重')`);
  await gapCheck('full-width native card aligns below summary and reserves its actual height');
  await check('card is one accessible button with title, icon, total and opening chevron', `(()=>{const e=document.querySelector('.dsc-trigger');return e.tagName==='BUTTON' && e.getAttribute('aria-label')==='外部能力' && e.querySelector('.dsc-card-title')?.textContent==='外部能力' && e.querySelectorAll('.dsc-card-head svg').length===2 && !e.querySelector('button') && e.getBoundingClientRect().height>60})()`);
  const restingStyle = await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.dsc-trigger'));return {background:s.backgroundColor,border:s.borderTopColor}})()");
  const cardHover = await box('.dsc-trigger'); await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardHover.left + 40, y: cardHover.top + 15 }); await settle();
  const hoveredStyle = await evaluate("(()=>{const e=document.querySelector('.dsc-trigger'),s=getComputedStyle(e);return {background:s.backgroundColor,border:s.borderTopColor,cursor:s.cursor,hover:e.matches(':hover')}})()");
  await check('native card has pointer feedback on hover', hoveredStyle.cursor === 'pointer' && hoveredStyle.hover && (hoveredStyle.background !== restingStyle.background || hoveredStyle.border !== restingStyle.border), JSON.stringify({ restingStyle, hoveredStyle }));
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await evaluate("document.querySelector('.dsc-trigger').focus()");
  await check('keyboard focus has a visible native outline', `(()=>{const e=document.querySelector('.dsc-trigger'),s=getComputedStyle(e);return document.activeElement===e && s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>=1})()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await settle();
  await check('Enter opens the selector without another discovery request', `!!document.querySelector('.dsc-panel') && ${fixture}.scanRequests.length===1`);
  await evaluate(`${fixture}.api.close();document.querySelector('.dsc-trigger').focus()`); await settle();
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await settle();
  await check('Space opens the selector as a native button', `!!document.querySelector('.dsc-panel')`);
  await evaluate(`${fixture}.api.close()`); await settle();
  await shot('capability-card-wide.png');
  const initial = await box('[data-dsh-session-summary]');
  await evaluate(`${fixture}.summaryLong()`); await settle();
  const grown = await box('[data-dsh-session-summary]');
  await check('expanding long summary grows its real card', grown.height > initial.height + 30, JSON.stringify({ initial, grown }));
  await gapCheck('button follows growing summary without overlap');
  await evaluate(`document.querySelector('.dss-body').scrollTop=10000`); await settle();
  await check('long summary scrolls internally', 'document.querySelector(".dss-body").scrollTop>0');
  await gapCheck('summary scroll does not move button into the scroller');
  await evaluate(`document.querySelector('[data-fixture-scroll]').scrollTop=250`); await settle();
  await gapCheck('transcript scrolling keeps button anchored');
  await open(); await panelCheck('wide panel and footer remain inside the viewport');
  await check('panel background is fully opaque in the real host theme', `(()=>{const e=document.querySelector('.dsc-panel');const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=getComputedStyle(e).backgroundColor;x.fillRect(0,0,1,1);return x.getImageData(0,0,1,1).data[3]===255})()`);
  await check('scan renders all fixture capabilities', 'document.querySelectorAll(".dsc-row").length===52');
  await textBoundsCheck('long Chinese and unbroken English descriptions do not overlap source labels');
  await evaluate(`document.querySelector('.dsc-list').scrollTop=10000`); await settle();
  await check('capability list scrolls independently', 'document.querySelector(".dsc-list").scrollTop>0');
  await panelCheck('list scroll preserves footer and add button');
  // Exercise actual React input events using native input setter and CDP typing.
  await click('.dsc-search'); await call('Input.insertText', { text: 'digger' }); await settle();
  await check('typing search filters rendered rows', 'document.querySelectorAll(".dsc-row").length===2');
  await evaluate(`{const e=document.querySelector('.dsc-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));}`); await settle();
  await click('.dsc-tab:nth-child(3)');
  await check('CLI tab filters actual rows', 'document.querySelectorAll(".dsc-row").length===3 && [...document.querySelectorAll(".dsc-kind-icon")].every(e=>e.dataset.kind==="cli")');
  await click('.dsc-ready input');
  await check('ready filter omits limited and missing CLI', 'document.querySelectorAll(".dsc-row").length===1 && document.querySelector(".dsc-entry-name").textContent.includes("digger")');
  await click('.dsc-ready input'); await click('.dsc-tab:first-child');
  await evaluate(`{const e=document.querySelector('.dsc-source-select');e.value='Codex';e.dispatchEvent(new Event('change',{bubbles:true}));}`); await settle();
  await check('source dropdown filters by real source metadata', 'document.querySelectorAll(".dsc-row").length===23');
  await evaluate(`{const e=document.querySelector('.dsc-source-select');e.value='';e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.dsc-list').scrollTop=0;}`); await settle();
  await click('.dsc-row:first-child input'); await click('.dsc-row:nth-child(3) input');
  await check('selection displays two chips and selected count', 'document.querySelectorAll(".dsc-chip").length===2 && document.querySelector(".dsc-selection-head").textContent.includes("2")');
  await check('selected information stays inside the full-width card hint', `document.querySelector('.dsc-trigger .dsc-card-hint .dsc-selected-count')?.textContent.includes('已选 2 项')`);
  await click('.dsc-row:first-child .dsc-entry');
  await waitFor(`${fixture}.api.getSnapshot().detailStatus==='ready'`);
  await check('details renders full document and merged sources', 'document.querySelectorAll(".dsc-source-item").length===3 && document.querySelector(".dsc-content").textContent.includes("使用说明")');
  await shot('capability-light.png');
  await evaluate(`${fixture}.dark(true)`); await settle();
  await check('dark theme changes panel surface and preserves text contrast', `(()=>{const s=getComputedStyle(document.querySelector('.dsc-panel'));return s.backgroundColor!=='rgb(255, 255, 255)'&&s.color!==s.backgroundColor})()`);
  await shot('capability-dark.png'); await evaluate(`${fixture}.dark(false)`); await settle();
  await evaluate(`${fixture}.seedReferenceDraft()`); await settle();
  await click('.dsc-add');
  await check('add calls exact native append API with current binding', `${fixture}.appendCalls.length===1 && ${fixture}.appendCalls[0].sameBinding && ${fixture}.appendCalls[0].sessionId==='session-main' && ${fixture}.appendCalls[0].options.whenDraftExists==='append'`);
  await check('real native engine preserves draft and attachments', `${fixture}.snapshot().draft.startsWith('保留这段未发送的草稿') && ${fixture}.snapshot().draft.includes('[本次任务选择的外部能力]') && ${fixture}.snapshot().attachmentIds.join('|')==='attachment-existing'`);
  await check('real native engine preserves semantic file references', `${fixture}.snapshot().occurrences.length===1 && ${fixture}.snapshot().occurrences[0].clipboardText==='@existing.txt' && ${fixture}.snapshot().occurrences[0].ref==='file:///fixture/existing.txt'`);
  await check('success closes panel without sending', '!document.querySelector(".dsc-panel")');
  await open(); await evaluate(`${fixture}.busy(true)`); await click('.dsc-add');
  await check('native blocked admission preserves selection and panel', `${fixture}.api.getSnapshot().open && ${fixture}.api.getSnapshot().selectedIds.length===2 && ${fixture}.api.getSnapshot().notice.includes('输入框正忙')`);
  await evaluate(`${fixture}.busy(false)`);
  const beforeSwitch = await evaluate(`${fixture}.appendCalls.length`);
  await evaluate(`${fixture}.activeWithoutRender('session-other');${fixture}.api.add()`); await settle();
  await check('session change during click refuses wrong-session append', `${fixture}.appendCalls.length===${beforeSwitch} && (${fixture}.api.getSnapshot().notice.includes('当前会话已变化') || (${fixture}.api.getSnapshot().sessionId==='session-other' && !${fixture}.api.getSnapshot().open))`);
  await evaluate(`${fixture}.switchSession('session-other')`); await settle();
  await check('normal session switch closes panel and clears selection', `${fixture}.api.getSnapshot().sessionId==='session-other'&&!${fixture}.api.getSnapshot().open&&${fixture}.api.getSnapshot().selectedIds.length===0`);
  await check('other session native draft remains untouched', `${fixture}.snapshot('session-other').draft===''&&${fixture}.snapshot('session-other').attachmentIds.length===0`);
  await evaluate(`${fixture}.switchSession('session-main')`); await settle();
  await open(); await click('.dsc-row:first-child input');
  const beforeGeneration = await evaluate(`${fixture}.appendCalls.length`);
  await evaluate(`${fixture}.replaceBinding();${fixture}.api.add()`); await settle();
  await check('same session with replaced scope generation refuses append', `${fixture}.appendCalls.length===${beforeGeneration}&&${fixture}.api.getSnapshot().notice.includes('当前会话已变化')`);
  await evaluate(`${fixture}.switchSession('session-other')`); await settle(); await evaluate(`${fixture}.switchSession('session-main')`); await settle();
  await open();
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); await settle();
  await check('Escape closes panel and restores trigger focus', '!document.querySelector(".dsc-panel") && document.activeElement.classList.contains("dsc-trigger")');
  await check('Escape preserves pinned summary', '!!document.querySelector("[data-dsh-session-summary]")');
  await open(); await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 330, y: 60, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 330, y: 60, button: 'left', clickCount: 1 }); await settle();
  await check('outside pointer closes panel and keeps summary', '!document.querySelector(".dsc-panel") && !!document.querySelector("[data-dsh-session-summary]")');
  // Real pointer drag of the summary, including low viewport clamping.
  await evaluate(`${fixture}.resetSummary()`); await settle();
  const dragHandle = await box('[data-dss-drag-handle]'); const dx = dragHandle.left + 35, dy = dragHandle.top + dragHandle.height / 2;
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: dx, y: dy, button: 'left', buttons: 1, clickCount: 1 });
  for (let n = 1; n <= 4; n++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dx - 100 * n / 4, y: dy + 45 * n / 4, buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dx - 100, y: dy + 45, button: 'left', clickCount: 1 }); await settle();
  await check('real summary drag enters floating mode', `${fixture}.summaryApi.prefs.getSnapshot().floating`);
  await gapCheck('accessory follows dragged summary');
  await evaluate(`${fixture}.api.set({selectedIds:['skill:digger-main','cli:digger'],notice:''})`);
  for (const [width, height] of [[1440,480],[1000,900],[760,900],[760,480],[320,480],[320,190],[760,190]]) {
    await resize(width, height); await evaluate(`${fixture}.resetSummary()`); await settle();
    await gapCheck(`${width}x${height} summary leaves accessory space`);
    if (height <= 280) await check(`${width}x${height} hides auxiliary card rows while keeping title and total`, `getComputedStyle(document.querySelector('.dsc-card-stats')).display==='none' && getComputedStyle(document.querySelector('.dsc-card-hint')).display==='none' && document.querySelector('.dsc-card-title').getClientRects().length>0 && document.querySelector('.dsc-card-count').getClientRects().length>0`);
    await open(); await panelCheck(`${width}x${height} panel footer reachable`);
    await textBoundsCheck(`${width}x${height} long names, descriptions and sources stay in separate areas`);
    const listBox = await box('.dsc-list');
    await check(`${width}x${height} list leaves a usable row area`, listBox.height >= 32, JSON.stringify(listBox));
    if (width < 760) {
      await check(`${width}x${height} uses modal sheet`, 'document.querySelector(".dsc-panel").dataset.mode==="sheet" && document.querySelector(".dsc-panel").getAttribute("aria-modal")==="true"');
      if (height > 190) {
        await click('.dsc-row:first-child .dsc-entry'); await waitFor(`${fixture}.api.getSnapshot().detailStatus==='ready'`);
        await check(`${width}x${height} details replace list`, 'getComputedStyle(document.querySelector(".dsc-list")).display==="none"&&getComputedStyle(document.querySelector(".dsc-detail")).display!=="none"');
        await click('.dsc-mobile-back');
      }
    }
    await shot(`capability-${width}x${height}.png`);
    await evaluate(`${fixture}.api.close()`); await settle();
  }
  await resize(760, 900); await evaluate(`${fixture}.resetSummary()`); await settle();
  await click('[data-dss-compact]');
  await gapCheck('expanded narrow summary still leaves button below');
  await check('narrow expanded summary reserves content plus accessory', `(()=>{const c=document.querySelector('[data-conversation-content]').getBoundingClientRect();const b=document.querySelector('.dsc-dock').getBoundingClientRect();return c.top+parseFloat(getComputedStyle(document.querySelector('[data-conversation-content]')).paddingTop)>=b.bottom-1})()`);
  await resize(1440, 900); await evaluate(`${fixture}.resetSummary();${fixture}.summaryApi.close()`); await settle();
  await check('closing summary preserves capability button', '!document.querySelector("[data-dsh-session-summary]")&&!!document.querySelector(".dsc-trigger")');
  await check('closed-summary fallback anchors below main header', `Math.abs(document.querySelector('.dsc-dock').getBoundingClientRect().top-document.querySelector('.fixture-header').getBoundingClientRect().bottom-8)<2`);
  await evaluate(`${fixture}.summaryPresent(false)`); await settle();
  await check('uninstalled summary keeps standalone capability button', '!document.querySelector("[data-dsh-session-summary-toggle]")&&!!document.querySelector(".dsc-trigger")');
  await open(); await panelCheck('standalone panel has visible footer'); await shot('capability-without-summary.png');
  await evaluate(`${fixture}.uninstall()`); await settle();
  await check('unload removes overlay, anchor, styles and reserved space', '!document.querySelector("[data-dsh-capability-selector]")&&!document.querySelector("[data-dsh-capability-anchor]")&&!document.querySelector("style[data-plugin=dsh-capability-selector]")&&!document.documentElement.style.getPropertyValue("--dsh-summary-accessory-height")');
  await evaluate(`window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('dsh:summary-accessory-change'));document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));`); await settle();
  await check('unloaded geometry listeners do not recreate UI', '!document.querySelector(".dsc-trigger")');
  await evaluate(`${fixture}.summaryPresent(true);${fixture}.resetSummary();${fixture}.reinstall()`); await settle();
  await check('reinstall restores exactly one accessory and style', 'document.querySelectorAll(".dsc-trigger").length===1 && document.querySelectorAll("style[data-plugin=dsh-capability-selector]").length===1');
  await open(); await evaluate(`${fixture}.api.toggle('skill:digger-main');${fixture}.api.toggle('cli:digger')`); await settle();
  await shot('preview.png');
  await check('browser and React report no uncaught errors', `${fixture}.errors.length===0`, JSON.stringify(errors));
  await evaluate(`${fixture}.uninstall();${fixture}.unmount()`); await settle();
  await check('full fixture unmount removes both overlays', '!document.querySelector(".dsc-trigger")&&!document.querySelector("[data-dsh-session-summary]")');
  await call('Page.navigate', { url: `${page}?scan=fail` });
  await waitFor(`!!${fixture} && ${fixture}.api.getSnapshot().status==='error' && !!document.querySelector('.dsc-trigger')`); await settle();
  await check('failed first scan leaves an actionable error hint without a false total', `!${fixture}.api.getSnapshot().open && document.querySelector('.dsc-card-hint').getAttribute('role')==='status' && document.querySelector('.dsc-card-hint').textContent.length>0 && !document.querySelector('.dsc-card-count') && ${fixture}.scanRequests.length===1`);
  await evaluate(`${fixture}.api.set({notice:'fixture render'});window.dispatchEvent(new Event('resize'));document.querySelector('.dsc-trigger').focus()`);
  await evaluate('new Promise(resolve=>setTimeout(resolve,350))');
  await check('first scan error does not create a render or resize retry loop', `${fixture}.scanRequests.length===1 && ${fixture}.api.getSnapshot().status==='error'`);
  await evaluate(`${fixture}.setScanMode('ready')`); await click('.dsc-trigger'); await waitFor(`${fixture}.api.getSnapshot().status==='ready'`);
  await check('explicit card activation may retry a failed discovery once', `${fixture}.scanRequests.length===2 && !!document.querySelector('.dsc-panel') && document.querySelector('.dsc-card-count').textContent.includes('52')`);
  await evaluate(`${fixture}.uninstall();${fixture}.unmount()`); await settle();
  await call('Page.navigate', { url: `${page}?lang=en` });
  await waitFor(`!!${fixture} && ${fixture}.api.getSnapshot().status==='ready' && !!document.querySelector('.dsc-card-count')`); await settle();
  await check('English card uses localized title, total and helper copy', `document.querySelector('.dsc-trigger').getAttribute('aria-label')==='External capabilities' && document.querySelector('.dsc-card-title').textContent==='External capabilities' && document.querySelector('.dsc-card-count').textContent.includes('52') && !/[\\u4e00-\\u9fff]/.test(document.querySelector('.dsc-card-hint').textContent)`);
  await gapCheck('English card stays full width with measured reserve'); await shot('capability-card-english.png');
  await click('.dsc-trigger');
  await check('English card opens the localized selector', `document.querySelector('.dsc-heading h2').textContent==='External capabilities' && ${fixture}.scanRequests.length===1`);
  await check('loading, failure and English fixtures report no browser errors', `${fixture}.errors.length===0 && ${JSON.stringify(errors.length)}===0`, JSON.stringify(errors));
  await evaluate(`${fixture}.uninstall();${fixture}.unmount()`); await settle();
  const report = { passed, failed: failures.length, failures, browserErrors: errors, nativeDraftEngine: true, fixture: page, screenshotDirectory: outputDir };
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length || errors.length) process.exitCode = 1;
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close(); child.kill(); await exited;
  const resolved = fs.realpathSync(profile);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('dsh-capability-browser-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
