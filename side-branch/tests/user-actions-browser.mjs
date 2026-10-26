/** Offline Chrome regression against the extracted installed React/renderer/chat.
 * Run: node tests/user-actions-browser.mjs [--browser /path/to/chrome]
 * No live DSH connection, profile, or authentication is used.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { runtimeDir, workspace, openArchive } from '../scripts/extract-test-runtime.mjs';

const screenshotFlag = process.argv.indexOf('--screenshot');
const screenshotPath = screenshotFlag >= 0 ? path.resolve(process.argv[screenshotFlag + 1] ?? path.join(workspace, 'artifacts/user-actions-preview.png')) : undefined;

const flag = process.argv.indexOf('--browser');
const browser = (flag >= 0 ? process.argv[flag + 1] : undefined) ?? process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH or pass --browser.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-user-actions-browser-'));
const assets = path.join(runtimeDir, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
const indexHtml = fs.readFileSync(path.join(assets, '../index.html'), 'utf8');
const entryName = indexHtml.match(/src="\.\/assets\/(index-[^"/]+\.js)"/)?.[1];
assert.ok(entryName, 'installed shell entry');
let shell = fs.readFileSync(path.join(assets, entryName), 'utf8');
const imports = shell.match(/import\{([^}]+)\}from"(\.\/vendor-[^"]+)";/);
assert.ok(imports, 'installed shell vendor imports');
let vendor = fs.readFileSync(path.join(assets, imports[2]), 'utf8');
const vendorExports = vendor.match(/export\{([^}]+)\};?/);
assert.ok(vendorExports, 'vendor export table');
vendor = vendor.replace(vendorExports[0], 'globalThis.__vendor={' + vendorExports[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `${JSON.stringify(to ?? from)}:${from}`; }).join(',') + '};');
shell = shell.replace(imports[0], imports[1].split(',').map(binding => { const [from, to] = binding.split(' as '); return `const ${to ?? from}=globalThis.__vendor[${JSON.stringify(from)}];`; }).join(''));
const markers = [...shell.matchAll(/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*globalThis\.dshDesktopBoot\b/g)];
assert.equal(markers.length, 1, 'offline boot boundary');
const sharedName = shell.match(/function (\w+)\(\)\{return\{react:/)?.[1];
assert.ok(sharedName, 'shared runtime module table');
shell = shell.slice(0, markers[0].index).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(assets, entryName)).href));
const scripts = ['(function(){' + vendor + '\n})();', '(function(){' + shell + `\nglobalThis.__shared=${sharedName}();\n})();`];
for (const name of ['dsh-client-ui-renderer', 'dsh-client-ui-chat']) {
  let source = fs.readFileSync(path.join(runtimeDir, `node_modules/@deepseek-ai/${name}/lib/client.js`), 'utf8');
  if (name === 'dsh-client-ui-chat') {
    const marker = 'exports.apply = apply;';
    assert.equal(source.split(marker).length, 2, 'native test export boundary');
    source = source.replace(marker, 'exports.__UserMessageNodeView = UserMessageNodeView; exports.__UserContent = UserContent; ' + marker);
  }
  scripts.push(source);
}
scripts.push(fs.readFileSync(path.join(workspace, 'lib/client.js'), 'utf8'));
scripts.push(fs.readFileSync(path.join(workspace, 'tests/user-actions-fixture.js'), 'utf8'));
const tags = scripts.map((script, i) => { const name = `script-${i}.js`; fs.writeFileSync(path.join(temp, name), script); return `<script src="${name}"></script>`; }).join('\n');
fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Offline native user actions regression</title><style>body{font:14px sans-serif;padding:30px}section{margin:20px}button{min-height:24px}</style><div id="root"></div><script>window.__registrations={};window.__ModuleLoader__={load:r=>window.__registrations[r.id]=r};window.fetch=()=>{throw Error("Offline fixture forbids fetch")};</script>' + tags);
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${path.join(temp, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const exited = once(child, 'exit');
let socket;
const errors = [];
let passed = 0;
const check = (name, ok) => { assert.ok(ok, name); passed++; console.log('PASS ' + name); };
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debug endpoint timed out')), 15000);
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output)?.[1]; if (endpoint) { clearTimeout(timer); resolve(endpoint); } });
    child.on('error', error => { clearTimeout(timer); reject(error); });
  });
  socket = new WebSocket(endpoint); await once(socket, 'open');
  let seq = 0; const pending = new Map();
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
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const settle = () => evaluate('new Promise(resolve=>setTimeout(resolve,80))');
  const waitFor = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; const error = await evaluate('window.__fixtureError'); if (error) throw new Error(error); await settle(); } throw new Error('Timed out: ' + expression + '\n' + JSON.stringify(errors)); };
  await call('Page.navigate', { url: pathToFileURL(path.join(temp, 'index.html')).href });
  await waitFor('!!window.__userActions && !!document.querySelector(".sb-user-actions button")');
  const row = '[data-fixture-node="prompt-1"]';
  const action = row + ' .sb-user-actions button';
  const edit = row + ' .sb-user-actions button:first-child';
  const fork = row + ' .sb-user-actions button:nth-child(2)';
  const copy = row + ' button[aria-label="Copy"]';
  check('separate Edit and Fork controls share native Copy row', await evaluate(`document.querySelectorAll(${JSON.stringify(action)}).length === 2 && [...document.querySelectorAll(${JSON.stringify(action)})].map(b=>b.textContent).join('|') === [window.__userActions.t('editPrompt'),window.__userActions.t('forkPrompt')].join('|') && [...document.querySelectorAll(${JSON.stringify(action)})].every(b=>b.closest('[data-clock="start"]') === document.querySelector(${JSON.stringify(copy)}).parentElement)`));
  check('native content remains intact', await evaluate(`document.querySelector(${JSON.stringify(row)}).textContent.includes('Native text prompt-1')`));
  check('branch session receives actions', await evaluate(`!!document.querySelector(${JSON.stringify(fork)})`));
  check('later human prompt has no branch action', await evaluate(`!document.querySelector('[data-fixture-node="later-prompt"] .sb-user-actions button')`));
  check('steering and context remain unmodified', await evaluate(`!document.querySelector('[data-fixture-node="steering-1"] .sb-user-actions') && !document.querySelector('[data-fixture-node="context-1"] .sb-user-actions')`));
  await evaluate(`document.querySelector(${JSON.stringify(copy)}).click()`); await settle();
  check('native Copy copies original text', await evaluate(`window.__userActions.clipboard[0] === 'Native text prompt-1'`));
  await evaluate(`document.querySelector(${JSON.stringify(edit)}).click()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(row + ' textarea')})`);
  check('Edit opens original prompt inline without creating a session', await evaluate(`document.querySelector(${JSON.stringify(row + ' textarea')}).value === 'Native text prompt-1' && window.__userActions.requests.length === 0 && window.__userActions.mainOpened.length === 0 && window.__userActions.opened.length === 0`));
  await evaluate(`[...document.querySelectorAll(${JSON.stringify(row + ' button')})].find(b=>b.textContent===window.__userActions.t('cancel')).click()`);
  await waitFor(`!document.querySelector(${JSON.stringify(row + ' textarea')})`);
  check('cancel does not create or send', await evaluate('window.__userActions.requests.length === 0 && window.__userActions.prompts.length === 0'));
  await evaluate(`document.querySelector(${JSON.stringify(edit)}).click()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(row + ' textarea')})`);
  await evaluate(`{const el=document.querySelector(${JSON.stringify(row + ' textarea')});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Revised historical question');el.dispatchEvent(new Event('input',{bubbles:true}));}`); await settle();
  await evaluate(`{const b=[...document.querySelectorAll(${JSON.stringify(row + ' button')})].find(b=>b.textContent===window.__userActions.t('saveEdit'));b.click();b.click();}`); await settle();
  check('saving creates one revision at the selected prompt', await evaluate(`window.__userActions.requests.length === 1 && window.__userActions.requests[0].mode === 'edit' && window.__userActions.requests[0].intent === 'revise' && window.__userActions.requests[0].turn === 1 && window.__userActions.requests[0].expectedPromptMessageId === 'prompt-1' && !('messageId' in window.__userActions.requests[0]) && window.__userActions.requests[0].sourceSessionId === 'branch-session'`));
  await evaluate('window.__userActions.resolve()');
  await waitFor('window.__userActions.mainOpened.length === 1');
  check('saving sends edited text once to child with a stable request id', await evaluate(`window.__userActions.prompts.length === 1 && window.__userActions.prompts[0].sessionId === 'edited-child' && window.__userActions.prompts[0].mode === 'queue' && window.__userActions.prompts[0].content.length === 1 && window.__userActions.prompts[0].content[0].text === 'Revised historical question' && typeof window.__userActions.prompts[0].requestId === 'string' && window.__userActions.prompts[0].requestId.length > 0 && window.__userActions.mainOpened[0] === 'edited-child' && window.__userActions.opened.length === 0`));
  await waitFor(`!!document.querySelector(${JSON.stringify(fork)})`);
  check('revision preserves original historical prompt', await evaluate(`document.querySelector(${JSON.stringify(row)}).textContent.includes('Native text prompt-1')`));
  await evaluate(`{const b=document.querySelector(${JSON.stringify(fork)}); b.click(); b.click();}`); await settle();
  check('double Fork activation sends one exact branch request', await evaluate(`window.__userActions.requests.length === 2 && window.__userActions.requests[1].mode === 'continue' && window.__userActions.requests[1].intent === 'fork' && window.__userActions.requests[1].turn === 1 && window.__userActions.requests[1].expectedPromptMessageId === 'prompt-1' && !('messageId' in window.__userActions.requests[1]) && window.__userActions.requests[1].sourceSessionId === 'branch-session'`));
  await evaluate('window.__userActions.reject()'); await waitFor(`!!document.querySelector(${JSON.stringify(row + ' [role="alert"]')})`);
  check('failure leaves native Copy available', await evaluate(`!!document.querySelector(${JSON.stringify(copy)})`));
  await evaluate(`document.querySelector(${JSON.stringify(row + ' [role="alert"] button')}).click()`); await settle();
  check('retry reuses the idempotency request id', await evaluate('window.__userActions.requests.length === 3 && window.__userActions.requests[1].requestId === window.__userActions.requests[2].requestId'));
  await evaluate('window.__userActions.resolve()'); await settle();
  check('successful Fork retry opens sidebar without another prompt', await evaluate(`window.__userActions.opened.length === 1 && window.__userActions.opened[0].sessionId === 'fork-child' && window.__userActions.prompts.length === 1 && window.__userActions.mainOpened.length === 1`));
  await evaluate('window.__userActions.replaceNative()'); await settle();
  await waitFor(`!!document.querySelector(${JSON.stringify(action)})`);
  check('native renderer replacement retains two separate controls', await evaluate(`document.querySelectorAll(${JSON.stringify(action)}).length === 2`));
  await evaluate('window.__userActions.uninstall()'); await settle();
  check('unload removes custom actions and preserves native Copy', await evaluate(`!document.querySelector('.sb-user-actions') && !!document.querySelector(${JSON.stringify(copy)})`));
  await evaluate('window.__userActions.install()'); await waitFor(`!!document.querySelector(${JSON.stringify(action)})`);
  check('reinstall adds exactly two separate controls', await evaluate(`document.querySelectorAll(${JSON.stringify(action)}).length === 2`));
  await evaluate(`window.__userActions.addAttachment();document.querySelector(${JSON.stringify(edit)}).click()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(row + ' textarea')})`);
  check('attachment edit shows a reattachment notice', await evaluate(`document.querySelector(${JSON.stringify(row)}).textContent.includes(window.__userActions.t('editAttachments'))`));
  await evaluate(`[...document.querySelectorAll(${JSON.stringify(row + ' button')})].find(b=>b.textContent===window.__userActions.t('prepareEdit')).click()`);
  await waitFor('window.__userActions.requests.length === 4');
  await evaluate('window.__userActions.resolve()');
  await waitFor('window.__userActions.mainOpened.length === 2');
  check('attachment edit opens a child draft without sending text alone', await evaluate(`window.__userActions.prompts.length === 1 && window.__userActions.draftInitializations.length === 1 && window.__userActions.draftInitializations[0].sessionId === 'edited-child' && window.__userActions.draftInitializations[0].prompt === 'Native text prompt-1' && window.__userActions.draftInitializations[0].whenDraftExists === 'keep' && window.__userActions.opened.length === 1`));
  await evaluate('window.__userActions.dispose()'); await settle();
  check('no browser runtime errors', errors.length === 0);
  console.log(`${passed} native user action browser checks passed.`);
  if (screenshotPath) {
    await call('Emulation.setDeviceMetricsOverride', { width: 900, height: 280, deviceScaleFactor: 2, mobile: false });
    await call('Page.navigate', { url: pathToFileURL(path.join(temp, 'index.html')).href + '?preview=zh' });
    await waitFor('!!document.querySelector(".sb-user-actions button")');
    const archive = openArchive();
    let theme;
    try { theme = archive.read('dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js').toString(); }
    finally { archive.close(); }
    const tokens = [...theme.matchAll(/(?:var \w+_css_default|const css(?:\$\d+)?) = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1])).join('\n');
    await evaluate(`{const style=document.createElement('style');style.textContent=${JSON.stringify(tokens + '\nbody{margin:0;padding:40px;background:var(--dsw-alias-bg-base);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:760px;margin:0 auto}section{margin:0}')};document.head.appendChild(style);}`);
    await settle();
    const image = await call('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, Buffer.from(image.data, 'base64'));
    console.log('Chinese native bubble preview: ' + screenshotPath);
    await evaluate('window.__userActions.dispose()');
  }
} finally {
  socket?.close(); child.kill(); await exited;
  const resolved = fs.realpathSync(temp);
  assert.equal(resolved, path.join(fs.realpathSync(os.tmpdir()), path.basename(temp)));
  assert.ok(path.basename(resolved).startsWith('dsh-user-actions-browser-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
