// Static design-comparison preview: renders the real client components with sample data.
// Not DSH itself; output goes to artifacts/preview.html.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireReact = createRequire(path.join(here, '../../mermaid-diagrams-preview/package.json'));
const React = requireReact('react');
const { renderToStaticMarkup } = requireReact('react-dom/server');
let registration;
vm.runInNewContext(fs.readFileSync(path.join(here, '../lib/client.js'), 'utf8'), { window: { __ModuleLoader__: { load: value => { registration = value; } } }, Intl, console, setTimeout, clearTimeout, AbortController });
const T = registration.factory(() => React).__test;
const t = (key, params = {}) => String(T.ZH[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => params[name]);
const now = Date.now(), today = T.localDate(now), at = time => T.instantOf(today, time);
const lists = [{ id: 'work', name: '工作', color: 'blue', createdAt: 0 }, { id: 'plugin', name: 'dsh-plugin', color: 'orange', createdAt: 1 }, { id: 'me', name: '个人', color: 'green', createdAt: 2 }];
const base = { notes: '', dueTime: null, alertAt: null, alerted: false, flagged: false, completed: false, completedAt: null, createdAt: 1, updatedAt: 1, sessionId: null, sessionTitle: '' };
const items = [
  { ...base, id: '1', listId: 'work', title: '确认待办插件设计稿', notes: '与用户确认样式后开始实现', dueDate: today, dueTime: '09:30', alertAt: at('09:30'), flagged: true },
  { ...base, id: '2', listId: 'plugin', title: '修复会话搜索高亮错位', dueDate: today, dueTime: '16:30', alertAt: at('16:30'), sessionId: 's', sessionTitle: '会话搜索插件' },
  { ...base, id: '3', listId: 'plugin', title: '提交 task-guardian 重构', dueDate: today, dueTime: '15:00', completed: true, completedAt: now },
  { ...base, id: '4', listId: 'work', title: '整理插件 README', dueDate: today, dueTime: '21:00', alertAt: at('21:00') },
  ...['周报', '评审', '回归测试'].map((title, i) => ({ ...base, id: `w${i}`, listId: 'work', title, dueDate: T.addDays(today, i + 1) })),
  { ...base, id: 'm1', listId: 'me', title: '买咖啡豆', flagged: true, dueDate: null },
  { ...base, id: 'm2', listId: 'me', title: '健身', dueDate: null },
  { ...base, id: 'p1', listId: 'plugin', title: '发布 0.1.0', dueDate: null },
];
let state = { status: 'ready', error: '', offline: false, lists, items, revision: 1, token: '1.0', view: { kind: 'smart', id: 'today' }, query: '', showCompleted: false, recentDone: { 3: true }, alerts: [{ id: '1', title: '确认待办插件设计稿', dueDate: today, dueTime: '09:30', sessionId: 's' }], minute: Math.floor(now / 60000) };
const store = { getSnapshot: () => state, subscribe: () => () => {} };
const props = { store, t, openSession() {}, openPage() {}, currentSession: () => 's' };
const page = renderToStaticMarkup(React.createElement(T.TodoPage, props));
const card = renderToStaticMarkup(React.createElement(T.TodoCard, { ...props, sessionId: 's' }));
const toast = renderToStaticMarkup(React.createElement(T.AlertToasts, props)).replace('dtd-toasts', 'dtd-toasts dtd-static');
const neighbor = (title, body) => `<section class="nb"><div class="nb-head"><b>${title}</b></div>${body}</section>`;
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>待办 preview</title><style>
body{margin:0;background:#f4f4f6;font-family:-apple-system,"PingFang SC",sans-serif}.frame{display:flex;height:760px;border-bottom:1px solid #ddd}
.side{width:200px;background:#f4f4f6;border-right:1px solid #e5e5ea;padding:16px 10px;font-size:14px;color:#333}.side div{padding:7px 10px;border-radius:8px}.side .on{background:#e6e6ea}
.pagewrap{flex:1;background:#fff;min-width:0}.cards{width:360px;padding:18px;display:flex;flex-direction:column;gap:10px}
.nb{background:#fff;border:.5px solid #d8d8dc;border-radius:16px;padding:12px;font-size:13px;color:#666}.nb-head{color:#111;font-size:14px;margin-bottom:4px}
.row{display:flex;gap:24px;padding:24px;align-items:flex-start}.dtd-static{position:static!important;transform:none!important}
</style><div class="frame"><div class="side"><div>新会话</div><div>插件</div><div>自动化任务</div><div>会话导航</div><div class="on">待办</div><div>更多</div></div><div class="pagewrap">${page}</div></div>
<div class="row"><div class="cards">${neighbor('dsh-plugin', '')}${card}${neighbor('任务守护', '守护已开启 · 0 次')}</div><div style="width:380px">${toast}</div></div></html>`;
const out = path.join(here, '../artifacts/preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out);
