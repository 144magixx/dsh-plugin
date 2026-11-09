import test from 'node:test';
// Loose deep equality: helper results come from the vm realm (different prototypes).
import assert from 'node:assert';
import { client, requested } from './client-core.mjs';

const t = (key, params = {}) => `${key}${Object.keys(params).length ? JSON.stringify(params) : ''}`;

test('the client module only requires shell-provided modules and declares its injections', () => {
  assert.deepEqual([...new Set(requested)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react-dom']);
  assert.equal(client.name, 'dsh-selection-ask');
  assert.deepEqual(client.inject, ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'uiConversation']);
  assert.deepEqual(Object.keys(client.ZH).sort(), Object.keys(client.EN).sort(), 'zh and en dictionaries match');
});

test('file addresses parse to session and path', () => {
  assert.deepEqual(client.parseFileAddress('dsh-resource://file/session/s%201/lib/a%20b.js?x=1'), { sessionId: 's 1', path: 'lib/a b.js' });
  assert.deepEqual(client.parseFileAddress('dsh-resource://file/absolute/Users/me/a.html'), { sessionId: null, path: '/Users/me/a.html' });
  assert.equal(client.parseFileAddress('dsh-resource://side-branch/x'), null);
  assert.equal(client.parseFileAddress('dsh-resource://file/session/%E0%A4%A/x'), null);
  assert.equal(client.baseName('/a/b/report.html'), 'report.html');
  assert.equal(client.baseName('C:\\a\\b.js'), 'b.js');
});

test('selection labels match the design chips', () => {
  assert.equal(client.selectionLabel({ kind: 'file', path: 'lib/service.js', startLine: 42, endLine: 46 }, t), 'service.js : 42-46');
  assert.equal(client.selectionLabel({ kind: 'file', path: 'lib/service.js', startLine: 7, endLine: 7 }, t), 'service.js : 7');
  assert.equal(client.selectionLabel({ kind: 'html', path: 'docs/report.html' }, t), 'sourceHtml{"name":"report.html"}');
  assert.equal(client.selectionLabel({ kind: 'chat', turn: 2, role: 'assistant' }, t), 'sourceTurn{"turn":2}');
  assert.equal(client.selectionLabel({ kind: 'chat', turn: 3, role: 'tool' }, t), 'sourceTool{"turn":3}');
  assert.equal(client.selectionLabel({ kind: 'chat' }, t), 'sourceChat');
  assert.equal(client.selectionLabel({ kind: 'document', path: 'a/README.md' }, t), 'README.md');
});

test('selection text and surrounding lines are bounded', () => {
  const long = 'x'.repeat(client.MAX_TEXT + 5);
  assert.deepEqual(client.clipSelection(long), { text: 'x'.repeat(client.MAX_TEXT), truncated: true });
  const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  const around = client.linesAround(lines, 42, 46, 3);
  assert.equal(around.before, 'line 39\nline 40\nline 41');
  assert.equal(around.after, 'line 47\nline 48\nline 49');
  assert.deepEqual(client.linesAround(lines, 1, 1, 0), {});
});

test('backoff is bounded and relative time is localized', () => {
  const delays = []; let delay = 0;
  for (let index = 0; index < 8; index++) delays.push(delay = client.backoffDelay(delay));
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  const now = Date.UTC(2026, 10, 9);
  assert.equal(client.relativeTime(now - 10_000, now, t), 'justNow');
  assert.equal(client.relativeTime(now - 5 * 60_000, now, t), 'minutesAgo{"n":5}');
  assert.equal(client.relativeTime(now - 3 * 3600_000, now, t), 'hoursAgo{"n":3}');
  assert.equal(client.relativeTime(now - 50 * 3600_000, now, t), 'daysAgo{"n":2}');
});

test('floating boxes stay inside the viewport', () => {
  const viewport = { width: 1000, height: 700 };
  assert.deepEqual(client.placeNear({ left: 400, top: 300, width: 100, height: 20 }, viewport, { width: 100, height: 30 }), { left: 400, top: 262 });
  assert.deepEqual(client.placeNear({ left: 400, top: 10, width: 100, height: 20 }, viewport, { width: 100, height: 30 }), { left: 400, top: 38 }, 'flips below near the top');
  assert.deepEqual(client.placeNear({ left: 980, top: 300, width: 10, height: 20 }, viewport, { width: 520, height: 300 }, 10, true), { left: 472, top: 330 });
  const clamped = client.placeNear({ left: 10, top: 690, width: 10, height: 10 }, viewport, { width: 520, height: 400 }, 10, true);
  assert.ok(clamped.left >= 8 && clamped.top >= 8 && clamped.top + 400 <= 700);
});

test('HTML bridge injection keeps standards mode and is idempotent', () => {
  const text = client.injectBridgeText('<!doctype html><html lang="zh"><head><title>x</title></head><body>a</body></html>');
  assert.match(text, /^<!doctype html><html lang="zh"><head><script data-dsh-selection-ask>/);
  assert.match(client.injectBridgeText('<p>fragment</p>'), /^<script data-dsh-selection-ask>/);
  assert.match(client.injectBridgeText('<!DOCTYPE html><p>x</p>'), /^<!DOCTYPE html><script/);
  assert.doesNotMatch(text.slice(text.indexOf('<script'), text.indexOf('</script>')), /<\/script/i);
  const bytes = new TextEncoder().encode('<html><body>a</body></html>');
  const once = client.injectBridge(bytes);
  assert.notEqual(once, bytes);
  assert.equal(client.injectBridge(once), once, 'already bridged documents are left alone');
  const invalid = new Uint8Array([0xff, 0xfe, 0x00]);
  assert.equal(client.injectBridge(invalid), invalid, 'undecodable bytes pass through to the native failure path');
  // The bridge must stay self-contained so it can run inside an opaque iframe.
  assert.doesNotThrow(() => new Function(`return (${client.selectionBridge.toString()})`)());
});

test('API errors carry status and codes; aborts stay aborts', async () => {
  const api = client.createApi(async (url, init) => {
    if (init.signal?.aborted) throw Object.assign(new Error('x'), { name: 'AbortError' });
    if (url.endsWith('/view')) return { ok: false, status: 503, json: async () => ({ ok: false, code: 'unloading', message: 'locked' }) };
    if (url.endsWith('/list')) return { ok: true, status: 200, json: async () => ({ ok: true, threads: [] }) };
    throw new TypeError('network down');
  });
  assert.deepEqual(await api('list', {}), { ok: true, threads: [] });
  await assert.rejects(api('view', {}), (error) => error.status === 503 && error.code === 'unloading');
  await assert.rejects(api('prompt', {}), (error) => error.status === 0 && error.code === 'network');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(api('list', {}, abort.signal), (error) => error.name === 'AbortError');
  await assert.rejects(api('drop-database', {}), /Unknown/);
});

test('feed long-polls, backs off on 503, recovers, and never reconnects after stop', async () => {
  const calls = []; const sleeps = []; const updates = [];
  let locked = 2; let revision = 0; let release;
  const api = async (operation, body, signal) => {
    calls.push(body);
    if (locked > 0) { locked--; throw Object.assign(new Error('locked'), { status: 503 }); }
    if (body.since) await new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    return { revision: `e:${++revision}` };
  };
  const feed = client.createFeed({ api, threadId: 't1', onUpdate: (patch) => updates.push(patch), sleep: async (ms) => { sleeps.push(ms); } });
  feed.start();
  for (let index = 0; index < 50 && !release; index++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(sleeps, [500, 1000], 'bounded exponential backoff while locked');
  assert.equal(calls[0].since, undefined);
  assert.equal(calls.at(-1).since, 'e:1');
  assert.equal(calls.at(-1).waitMs, 2000);
  assert.ok(updates.some((patch) => patch.error?.status === 503));
  assert.equal(updates.at(-1).view.revision, 'e:1');
  feed.stop();
  const count = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, count, 'no request after stop');
  assert.equal(feed.stopped, true);
});

test('feed stops on a deleted thread', async () => {
  const updates = []; let calls = 0;
  const feed = client.createFeed({ api: async () => { calls++; throw Object.assign(new Error('gone'), { status: 404 }); }, threadId: 't', onUpdate: (patch) => updates.push(patch), sleep: async () => {} });
  feed.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  assert.equal(updates[0].gone, true);
});

test('UI store transitions', () => {
  const store = client.createStore();
  let notified = 0; store.subscribe(() => notified++);
  store.showPill({ origin: 'frame', rect: {} });
  store.hidePill('dom');
  assert.ok(store.getSnapshot().pill, 'origin-specific hide leaves other pills');
  store.openCompose({ sourceSessionId: 's', rect: { left: 1 }, selection: { kind: 'chat', text: 'x' } });
  assert.equal(store.getSnapshot().pill, null);
  assert.equal(store.getSnapshot().popover.compose.text, 'x');
  store.setPopoverThread('t1', true);
  assert.equal(store.getSnapshot().popover.threadId, 't1');
  assert.equal(store.getSnapshot().popover.compose.text, 'x');
  store.setPopoverThread('t2');
  assert.equal(store.getSnapshot().popover.compose, null);
  store.closePopover();
  assert.equal(store.getSnapshot().popover, null);
  assert.equal(notified, 5, 'no-op hides do not notify');
});

test('memo components count as components, so Markdown is rendered with the native primitive', () => {
  assert.equal(client.isComponent(() => null), true);
  assert.equal(client.isComponent({ $$typeof: Symbol.for('react.memo'), type: () => null }), true);
  assert.equal(client.isComponent({}), false);
  assert.equal(client.isComponent(null), false);
});

test('model labels show name and effort', () => {
  assert.equal(client.modelLabel({ provider: 'p', model: 'm', name: 'Claude Opus 5.5', reasoningEffort: 'high', effortName: 'High' }, t), 'Claude Opus 5.5 · High');
  assert.equal(client.modelLabel({ provider: 'p', model: 'gpt-x' }, t), 'gpt-x');
  assert.equal(client.modelLabel(null, t), 'modelDefault');
});

test('thread links resolve against the hidden thread cwd and open in the source conversation', () => {
  assert.equal(client.sessionFileAddress('s 1', '/w/a b.png'), 'dsh-resource://file/session/s%201//w/a%20b.png');
  assert.equal(client.resolvePath('/repo', './out/x.png'), '/repo/out/x.png');
  assert.equal(client.resolvePath('/repo', '/abs/y.png'), '/abs/y.png');
  assert.equal(client.resolvePath('C:\\repo', 'x.png'), 'C:\\repo\\x.png');
  const opened = [];
  const links = client.createLinks({ openResource: (address, options) => opened.push([address, options]), openExternal() {} }, 'src', '/repo', t);
  const mention = links.mentions(['out/ledger.png']).resolve('ledger.png');
  assert.equal(mention.title, '/repo/out/ledger.png');
  mention.open();
  return new Promise(resolve => setTimeout(() => {
    assert.equal(opened[0][0], 'dsh-resource://file/session/src//repo/out/ledger.png');
    assert.equal(links.mentions([]), undefined);
    assert.equal(links.mentions(['a/x.png', 'b/x.png']).resolve('x.png'), undefined, 'ambiguous names stay plain');
    resolve();
  }, 0));
});

test('native MarkdownText receives the labels it dereferences for code blocks', () => {
  const labels = client.markdownLabels(t);
  assert.equal(typeof labels.code.copyLabel, 'string');
  assert.equal(typeof labels.code.toolbarLabels.wrapLabel, 'string');
  assert.equal(typeof labels.footnotes, 'string');
  const links = client.createLinks({ openResource() {}, openExternal() {}, fileDrag: () => undefined }, 's', '/w', t);
  assert.equal(typeof links.labels.code.copiedLabel, 'string');
  assert.equal(typeof links.fileImages.fileDrag.prepare, 'function', 'images always get a drag service');
});
