/** Offline Chrome acceptance of the REAL summary/capability/GuardianAccessory clients.
 * Writes only this plugin's ignored tests/.integration-data/accessory-browser tree.
 * No Web server, live Harness session, model request or system startup mutation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openArchive } from '../../session-summary/scripts/extract-test-runtime.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(workspace);
const outputDir = path.join(workspace, 'tests/.integration-data/accessory-browser');
fs.mkdirSync(outputDir, { recursive: true });
function replaceOnce(source, marker, replacement) {
  assert.equal(source.split(marker).length, 2, 'fixture marker changed: ' + marker.slice(0, 100));
  return source.replace(marker, replacement);
}
function buildFixture() {
  const archive = openArchive();
  const base = 'dsh/node_modules/@deepseek-ai/';
  const read = name => archive.read(base + name).toString('utf8');
  try {
    const assets = 'dsh-web-frontend/dist/assets/';
    const html = read('dsh-web-frontend/dist/index.html');
    const entry = html.match(/<script\b[^>]*\bsrc="\.\/assets\/(index-[^"/]+\.js)"/)?.[1];
    assert.ok(entry, 'installed Web shell entry');
    let shell = read(assets + entry);
    const imports = shell.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
    assert.ok(imports, 'installed Web shell vendor binding');
    let vendor = read(assets + imports[2].slice(2));
    const exports = vendor.match(/export\{([^}]+)\};?/);
    assert.ok(exports, 'installed vendor exports');
    vendor = vendor.replace(exports[0], 'globalThis.__vendor={' + exports[1].split(',').map(binding => {
      const [from, to] = binding.split(' as '); return `${JSON.stringify(to ?? from)}:${from}`;
    }).join(',') + '};');
    shell = shell.replace(imports[0], imports[1].split(',').map(binding => {
      const [from, to] = binding.split(' as '); return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`;
    }).join(''));
    const boot = [...shell.matchAll(/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*globalThis\.dshDesktopBoot\b/g)];
    assert.equal(boot.length, 1, 'installed shell boot boundary');
    const shared = shell.match(/function (\w+)\(\)\{return\{react:/)?.[1];
    assert.ok(shared, 'installed module table');
    shell = shell.slice(0, boot[0].index).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(outputDir, entry)).href));
    fs.writeFileSync(path.join(outputDir, 'vendor.js'), '(function(){' + vendor + '\n})();');
    fs.writeFileSync(path.join(outputDir, 'shell.js'), '(function(){' + shell + `\nglobalThis.__shared=${shared}();\n})();`);
    let css = '';
    for (const name of Object.keys(archive.lookup(base + assets).files).filter(name => name.endsWith('.css')).sort()) css += read(assets + name) + '\n';
    for (const match of read('dsh-client-ui-theme/lib/client.js').matchAll(/(?:var \w+_css_default|const css(?:\$\d+)?) = ("(?:[^"\\]|\\.)*");/g)) css += JSON.parse(match[1]) + '\n';
    fs.writeFileSync(path.join(outputDir, 'shell.css'), css);
    const native = replaceOnce(read('dsh-client-ui-conversation/lib/client.js'), 'exports.apply = apply;', 'exports.__BrowserTestInputHub = InputHub; exports.apply = apply;');
    fs.writeFileSync(path.join(outputDir, 'native-conversation.js'), native);
    for (const [source, name] of [['session-summary/lib/client.js', 'summary.js'], ['capability-selector/lib/client.js', 'capability.js'], ['task-guardian/lib/client.js', 'guardian.js']]) fs.copyFileSync(path.join(repo, source), path.join(outputDir, name));
    let fixture = fs.readFileSync(path.join(repo, 'capability-selector/tests/browser-fixture.js'), 'utf8');
    fixture = replaceOnce(fixture, "const capability = window.__registrations['dsh-capability-selector'].factory(require)", "const capability = window.__registrations['dsh-capability-selector'].factory(require)\n  const guardian = window.__registrations['dsh-task-guardian'].factory(require)");
    fixture = replaceOnce(fixture, 'const registrations = new Map(), effects = []', 'const registrations = new Map(), effects = [], guardianEffects = [], guardianCalls = [], tabOpens = [], guardianRecords = new Map()\n  let currentEffects = effects');
    fixture = replaceOnce(fixture, 'uiSession, sessions, conversation: { input: nativeInput },', `uiSession, sessions, conversation: { input: nativeInput },
    sidebarRightTabs: { register(definition) { if(definition.guide) throw Error('Guardian must not add a guide entry'); return () => {} } },
    sidebarRight: { openTab(kind) { tabOpens.push({kind,sessionId:current.getSnapshot().key}) } },`);
    fixture = replaceOnce(fixture, "effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return dispose },", "effect(fn) { const dispose = fn(); if (typeof dispose !== 'function') return dispose; let live = true; const off = () => { if (!live) return; live=false; return dispose() }; currentEffects.push(off); return off },");
    fixture = replaceOnce(fixture,
      "inject(name, factory) { return factory() },\n      register(options, component) { registrations.set(options.name, { options, component }); publishRegistry(); return () => { registrations.delete(options.name); publishRegistry() } },",
      `inject(name, factory) { const dispose=factory(); return ctx.effect(()=>dispose) },
      register(options, component) { const entry={options,component}; const entries=registrations.get(options.name)||[]; registrations.set(options.name,[...entries,entry]); publishRegistry(); let live=true; return () => { if(!live)return;live=false; const next=(registrations.get(options.name)||[]).filter(value=>value!==entry); if(next.length)registrations.set(options.name,next);else registrations.delete(options.name);publishRegistry() } },`);
    fixture = replaceOnce(fixture, "const transport = async (url, init = {}) => {\n    const payload = JSON.parse(init.body ?? '{}')", `function guardianSnapshot(id) {
    if(!guardianRecords.has(id)) guardianRecords.set(id,{version:1,sessionId:id,revision:0,epoch:0,settings:{enabled:false,recoverAfterRestart:false,autoSelectFirst:false},run:{phase:'idle',lastSeq:-1},retry:{attempt:0,retryAt:null},recovery:{status:'disabled',reason:'not authorized'},audit:[]});
    return {ok:true,sessionId:id,record:structuredClone(guardianRecords.get(id)),questions:[],compatibility:{supported:true,version:'0.2.1-rc.3'},fault:null,startup:{enabled:false,supported:false},serverNow:Date.now()};
  }
  const transport = async (url, init = {}) => {
    if(init.signal?.aborted)throw new DOMException('aborted','AbortError');
    const payload = JSON.parse(init.body ?? '{}');
    if(String(url).startsWith('/api/task-guardian/')) {
      const action=String(url).split('/').at(-1);guardianCalls.push({action,payload:structuredClone(payload)});
      if(!['session-main','session-other'].includes(payload.sessionId))throw Error('Unknown fixture session');
      if(action==='configure') { const value=guardianSnapshot(payload.sessionId).record;if(payload.epoch!==value.epoch)return {ok:false,status:409,json:async()=>({ok:false,error:'settings_changed_reload'})};Object.assign(value.settings,payload.settings);value.epoch++;value.revision++;guardianRecords.set(payload.sessionId,value); }
      else if(action!=='snapshot')throw Error('Only local read/configure permitted');
      return {ok:true,status:200,json:async()=>guardianSnapshot(payload.sessionId)};
    }`);
    fixture = replaceOnce(fixture, "function install() { capability.apply(ctx); view.set({ installed: true }); return registrations.get('shell.overlay').options.inject().api }", "function installGuardian() { currentEffects=guardianEffects; guardian.apply(ctx); currentEffects=effects }\n  function install() { currentEffects=effects; capability.apply(ctx); installGuardian(); view.set({ installed: true }); return registrations.get('shell.overlay')[0].options.inject().api }");
    fixture = replaceOnce(fixture, `function Slot({ name, sessionId }) {
    React.useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
    const entry = registrations.get(name)
    return entry ? h(entry.component, { ...entry.options.inject(), sessionId, t: ct }) : null
  }`, `function Slot({ name, sessionId, ...owner }) {
    React.useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
    const entries=(registrations.get(name)||[]).slice().sort((a,b)=>(a.options.order||0)-(b.options.order||0));
    return h(React.Fragment,null,...entries.map((entry,index)=>h(entry.component,{...owner,...(entry.options.inject?.()||{}),sessionId,t:translate(dictionaries.get(entry.options.locale)?.zh||capability.ZH),renderSlot:(slot,props={})=>h(Slot,{name:slot,sessionId,...props}),key:entry.options.id||entry.options.key||index})))
  }`);
    fixture = replaceOnce(fixture, 'errors, native: true, api, summaryApi, appendCalls, copies, current, inputHub,', 'errors, native: true, api, summaryApi, appendCalls, copies, current, inputHub, guardianCalls, tabOpens, guardianSnapshot, timerState:()=>window.__accessoryTimers.state(),');
    fixture = replaceOnce(fixture,
      "async uninstall() { for (const off of effects.splice(0).reverse()) { const result = off(); if (result?.then) await result } view.set({ installed: false }); cleanupCalls.push('uninstall') },",
      "async uninstallGuardian() { for(const off of guardianEffects.splice(0).reverse()){const result=off();if(result?.then)await result} },\n    reinstallGuardian() { installGuardian() },\n    async uninstall() { await this.uninstallGuardian();for (const off of effects.splice(0).reverse()) { const result = off(); if (result?.then) await result } view.set({ installed: false }); cleanupCalls.push('uninstall') },");
    fs.writeFileSync(path.join(outputDir, 'fixture.js'), fixture);
    const instrumentation = `(()=>{const owner=()=>/\\/(guardian|capability|summary)\\.js(?::|\\?)/.test(new Error().stack||'');const timeouts=new Map(),intervals=new Map(),rafs=new Map(),observers=new Set();const st=window.setTimeout.bind(window),ct=window.clearTimeout.bind(window),si=window.setInterval.bind(window),ci=window.clearInterval.bind(window),raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);window.setTimeout=(fn,ms,...args)=>{const owned=owner();let id;id=st((...values)=>{timeouts.delete(id);fn(...values)},ms,...args);if(owned)timeouts.set(id,ms);return id};window.clearTimeout=id=>{timeouts.delete(id);return ct(id)};window.setInterval=(fn,ms,...args)=>{const id=si(fn,ms,...args);if(owner())intervals.set(id,ms);return id};window.clearInterval=id=>{intervals.delete(id);return ci(id)};window.requestAnimationFrame=fn=>{const owned=owner();let id;id=raf(time=>{rafs.delete(id);fn(time)});if(owned)rafs.set(id,true);return id};window.cancelAnimationFrame=id=>{rafs.delete(id);return caf(id)};for(const name of ['ResizeObserver','MutationObserver']){const Native=window[name];window[name]=class extends Native{constructor(cb){super(cb);this.__owned=owner()}observe(...args){if(this.__owned)observers.add(this);return super.observe(...args)}disconnect(){observers.delete(this);return super.disconnect()}}}window.__accessoryTimers={state:()=>({timeouts:[...timeouts.values()],intervals:[...intervals.values()],animationFrames:rafs.size,observers:observers.size})}})();`;
    fs.writeFileSync(path.join(outputDir, 'index.html'), `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Guardian accessory integration</title><link rel="stylesheet" href="shell.css"></head><body><div id="root"></div><script>window.__registrations={};window.__ModuleLoader__={load:r=>window.__registrations[r.id]=r};window.fetch=()=>{throw Error('Network forbidden in offline fixture')};${instrumentation}</script><script src="vendor.js"></script><script src="shell.js"></script><script src="native-conversation.js"></script><script src="summary.js"></script><script src="capability.js"></script><script src="guardian.js"></script><script src="fixture.js"></script></body></html>`);
    return pathToFileURL(path.join(outputDir, 'index.html')).href;
  } finally { archive.close(); }
}
const page = buildFixture();
if (process.argv.includes('--build-only')) { console.log(JSON.stringify({ page, outputDir })); process.exit(0); }
const at = process.argv.indexOf('--browser');
const browser = (at >= 0 ? process.argv[at + 1] : undefined) ?? process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(filename => fs.existsSync(filename));
assert.ok(browser, 'Set CHROME_PATH or pass --browser');
const profile = path.join(outputDir, 'chrome-profile-' + randomUUID());
fs.mkdirSync(profile);
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit');
let socket, seq = 0, passed = 0, evaluate, call, diagnostic = null;
const pending = new Map(), browserErrors = [], failures = [], checks = [], screenshots = [], measurements = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome debugger timed out')), 15000);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Chrome exited before debugger: ' + code)); });
  });
  socket = new WebSocket(endpoint); await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result); } }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  call = (method, params) => send(method, params, sessionId);
  await call('Runtime.enable');
  evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,140))');
  const waitFor = async expression => { for (let index = 0; index < 100; index++) { if (await evaluate(expression)) return; const errors = await evaluate('window.__capabilityBrowser?.errors'); if (errors?.length) throw Error(errors.join('\n')); await pause(40); } throw Error('Timed out: ' + expression + '\n' + JSON.stringify(browserErrors)); };
  const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?JSON.parse(JSON.stringify(e.getBoundingClientRect())):null})()`);
  const check = async (name, value, detail = '') => { const ok = typeof value === 'string' ? await evaluate(value) : value; checks.push({ name, passed: !!ok, ...(detail ? { detail } : {}) }); if (ok) { passed++; console.log('PASS ' + name); } else { failures.push(name); console.error('FAIL ' + name + (detail ? ' :: ' + detail : '')); } };
  const resize = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle(); };
  const click = async selector => { const rect = await box(selector); assert.ok(rect && rect.width > 0 && rect.height > 0, 'visible click target ' + selector); const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2; await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await settle(); };
  const shot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); const filename = path.join(outputDir, name); fs.writeFileSync(filename, Buffer.from(image.data, 'base64')); screenshots.push(filename); };
  const fixture = 'window.__capabilityBrowser';
  async function geometry(label) {
    const summary = await box('[data-dsh-session-summary]'), dock = await box('.dsc-dock'), controls = await box('.dsc-controls'), accessory = await box('.dtg-accessory');
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})');
    const value = { label, viewport, summary, dock, controls, accessory, reserve: await evaluate('document.documentElement.style.getPropertyValue("--dsh-summary-accessory-height")') };
    measurements.push(value);
    await check(label + ': summary / capability / guardian order and gap', !!summary && !!dock && !!controls && !!accessory && dock.top >= summary.bottom + 5 && accessory.top >= controls.bottom + 4 && Math.abs(controls.left - accessory.left) <= 1 && Math.abs(controls.width - accessory.width) <= 1, JSON.stringify(value));
    await check(label + ': complete accessory remains inside viewport', !!accessory && accessory.left >= 10 && accessory.right <= viewport.width - 10 && accessory.top >= 10 && accessory.bottom <= viewport.height - 10 && dock.bottom <= viewport.height - 10, JSON.stringify(value));
  }
  await resize(1440, 900); await call('Page.navigate', { url: page });
  await waitFor(`!!${fixture} && !!document.querySelector('[data-dsh-session-summary]') && !!document.querySelector('.dtg-accessory') && !document.querySelector('.dtg-switch').disabled`); await settle();
  await check('real installed React and actual product GuardianAccessory render', `window.__shared.react.version==='18.3.1' && !!document.querySelector('.dsc-accessories > .dtg-accessory') && document.querySelector('.dtg-entry').textContent.includes('任务守护') && document.querySelector('.dsc-trigger').textContent.includes('外部能力')`);
  await check('initial title, switch and state are all visible', `(()=>{const e=document.querySelector('.dtg-accessory');return e.textContent.includes('守护已关闭') && e.querySelector('[role=switch]').getAttribute('aria-checked')==='false' && e.querySelector('.dtg-entry').getClientRects().length>0})()`);
  await geometry('1440x900 initial'); await shot('guardian-accessory-wide.png');
  await click('.dtg-entry');
  await check('title opens only native task-guardian kind for current session', `${fixture}.tabOpens.length===1 && ${fixture}.tabOpens[0].kind==='task-guardian' && ${fixture}.tabOpens[0].sessionId==='session-main'`);
  await click('.dtg-switch');
  await check('main switch configures only current session and updates status', `${fixture}.guardianCalls.filter(x=>x.action==='configure').length===1 && ${fixture}.guardianCalls.find(x=>x.action==='configure').payload.sessionId==='session-main' && ${fixture}.guardianSnapshot('session-main').record.settings.enabled && document.querySelector('.dtg-switch').getAttribute('aria-checked')==='true' && document.querySelector('.dtg-status').textContent.includes('守护已开启')`);
  await evaluate(`${fixture}.switchSession('session-other')`); await settle();
  await waitFor(`document.querySelector('.dtg-accessory')?.dataset.taskGuardian==='session-other' && !document.querySelector('.dtg-switch').disabled`);
  await check('switching sessions retains independent off state', `document.querySelector('.dtg-switch').getAttribute('aria-checked')==='false' && !${fixture}.guardianSnapshot('session-other').record.settings.enabled && ${fixture}.guardianSnapshot('session-main').record.settings.enabled`);
  await click('.dtg-switch');
  await check('second session configure uses its own epoch and identity', `(()=>{const calls=${fixture}.guardianCalls.filter(x=>x.action==='configure');return calls.length===2&&calls[1].payload.sessionId==='session-other'&&calls[1].payload.epoch===0&&calls[1].payload.settings.enabled===true})()`);
  await evaluate(`${fixture}.switchSession('session-main')`); await settle(); await waitFor(`document.querySelector('.dtg-accessory')?.dataset.taskGuardian==='session-main' && !document.querySelector('.dtg-switch').disabled`);
  await click('.dtg-switch');
  await check('returning and disabling one session leaves the other enabled', `!${fixture}.guardianSnapshot('session-main').record.settings.enabled && ${fixture}.guardianSnapshot('session-other').record.settings.enabled`);
  const initial = await box('[data-dsh-session-summary]');
  await evaluate(`${fixture}.summaryLong()`); await settle();
  const grown = await box('[data-dsh-session-summary]');
  await check('long real summary grows and internally scrolls', grown.height > initial.height + 25 && await evaluate('(()=>{const e=document.querySelector(".dss-body");return e.scrollHeight>e.clientHeight})()'), JSON.stringify({ initial, grown }));
  await geometry('expanded summary');
  await evaluate(`${fixture}.resetSummary()`); await settle();
  const handle = await box('[data-dss-drag-handle]'); const x = handle.left + 35, y = handle.top + handle.height / 2;
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let index = 1; index <= 4; index++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 80 * index / 4, y: y + 100 * index / 4, buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 80, y: y + 100, button: 'left', clickCount: 1 }); await settle();
  await check('real pointer drag enters floating mode', `${fixture}.summaryApi.prefs.getSnapshot().floating`); await geometry('dragged summary');
  for (const [width, height] of [[760, 480], [320, 480], [320, 190]]) {
    await resize(width, height); await evaluate(`${fixture}.resetSummary()`); await settle();
    await geometry(`${width}x${height}`); await shot(`guardian-accessory-${width}x${height}.png`);
  }
  await resize(1440, 900); await evaluate(`${fixture}.resetSummary()`); await settle();
  const mountedTimers = await evaluate(`${fixture}.timerState()`);
  await evaluate(`${fixture}.uninstallGuardian()`); await settle();
  await check('unloading guardian removes only its accessory and clock timers', `!document.querySelector('.dtg-accessory') && !!document.querySelector('.dsc-trigger') && ${fixture}.timerState().intervals.length===0`, JSON.stringify({ mountedTimers, afterGuardianUnload: await evaluate(`${fixture}.timerState()`) }));
  await evaluate(`${fixture}.reinstallGuardian()`); await settle(); await waitFor(`!!document.querySelector('.dtg-accessory') && !document.querySelector('.dtg-switch').disabled`);
  await check('guardian reinstall creates exactly one card and one one-second clock', `document.querySelectorAll('.dtg-accessory').length===1 && ${fixture}.timerState().intervals.filter(ms=>ms===1000).length===1`);
  await evaluate(`${fixture}.uninstall()`); await settle();
  await check('capability unload restores root reserve and removes both controls', `!document.querySelector('.dsc-trigger')&&!document.querySelector('.dtg-accessory')&&!document.documentElement.style.getPropertyValue('--dsh-summary-accessory-height')&&!document.querySelector('style[data-plugin=dsh-capability-selector]')`);
  await evaluate(`${fixture}.reinstall()`); await settle(); await waitFor(`!!document.querySelector('.dtg-accessory') && !document.querySelector('.dtg-switch').disabled`);
  await check('whole reinstall creates one capability control and one guardian card', `document.querySelectorAll('.dsc-trigger').length===1&&document.querySelectorAll('.dtg-accessory').length===1&&document.querySelectorAll('style[data-plugin=dsh-capability-selector]').length===1`);
  await geometry('reinstalled');
  await check('fixture and browser report no errors', `${fixture}.errors.length===0 && !document.querySelector('.dtg-accessory [role=alert]')`, JSON.stringify(browserErrors));
  await evaluate(`${fixture}.uninstall();${fixture}.unmount()`); await settle();
  const afterUnmount = await evaluate(`${fixture}.timerState()`);
  await check('full unmount leaves no product timers or observers and clears reserve', !afterUnmount.timeouts.length && !afterUnmount.intervals.length && !afterUnmount.animationFrames && !afterUnmount.observers && await evaluate('!document.documentElement.style.getPropertyValue("--dsh-summary-accessory-height") && !document.querySelector(".dtg-accessory") && !document.querySelector(".dsc-trigger") && !document.querySelector("[data-dsh-session-summary]")'), JSON.stringify(afterUnmount));
} catch (error) {
  failures.push('runner: ' + error.message); console.error(error.stack || error);
  if(evaluate) { try { diagnostic = await evaluate(`(()=>{const f=window.__capabilityBrowser;return {current:f?.current.getSnapshot().key,calls:f?.guardianCalls,card:document.querySelector('.dtg-accessory')?.outerHTML,timers:f?.timerState(),records:['session-main','session-other'].map(id=>f?.guardianSnapshot(id))}})()`); } catch {} }
  if (call) { try { const image = await call('Page.captureScreenshot', { format: 'png' }); const filename = path.join(outputDir, 'failure.png'); fs.writeFileSync(filename, Buffer.from(image.data, 'base64')); screenshots.push(filename); } catch {} }
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close(); child.kill(); await exited;
  // Delete only this run's owned, verified ignored Chrome profile directory.
  const resolved = fs.realpathSync(profile), expectedParent = fs.realpathSync(outputDir);
  assert.equal(path.dirname(resolved), expectedParent); assert.ok(path.basename(resolved).startsWith('chrome-profile-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const report = { passed, failed: failures.length, failures, checks, measurements, browserErrors, screenshots, diagnostic, fixture: page, scope: 'Offline actual product components + installed React/theme; no live user session, model or startup requests' };
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed, failed: failures.length, failures, report: path.join(outputDir, 'report.json'), screenshots }, null, 2));
  if (failures.length || browserErrors.length) process.exitCode = 1;
}
