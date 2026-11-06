// Browser verification harness (not DSH): the real lib/service.js HTTP handler with
// in-memory storage, and the real lib/client.js mounted with React 18 UMD.
// Usage: node scripts/live-preview.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTodoService, createFetchHandler } from '../lib/service.js';
import { localDate, instantOf, addDays } from '../lib/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const react = path.join(here, '../../mermaid-diagrams-preview/node_modules');
const port = Number(process.argv[2] || 58732);
const storageDomain = { async open(spec) { let value = structuredClone(spec.global.initial); return { global: { get: () => value, async set(next) { value = spec.global.schema.parse(next); } }, async close() {} }; } };
const service = createTodoService({ storageDomain });
service.setTitleReader(async ids => new Map(ids.map(id => [id, id === 'session-search' ? '会话搜索插件' : '当前对话'])));
const handler = createFetchHandler(service);
const today = localDate();
const seed = async () => {
  const plugin = (await service.execute({ action: 'createList', name: 'dsh-plugin', color: 'orange' })).list.id;
  const me = (await service.execute({ action: 'createList', name: '个人', color: 'green' })).list.id;
  await service.execute({ action: 'updateList', listId: 'default', name: '工作' });
  const at = time => ({ dueDate: today, dueTime: time, alertAt: instantOf(today, time) });
  await service.execute({ action: 'create', title: '确认待办插件设计稿', notes: '与用户确认样式后开始实现', ...at('09:30'), flagged: true });
  await service.execute({ action: 'create', title: '修复会话搜索高亮错位', listId: plugin, ...at('16:30'), sessionId: 'session-search' });
  await service.execute({ action: 'create', title: '整理插件 README', ...at('21:00') });
  await service.execute({ action: 'create', title: '周报', dueDate: addDays(today, 1) });
  await service.execute({ action: 'create', title: '买咖啡豆', listId: me, flagged: true });
  // Due one minute after start, to exercise the banner.
  const soon = Date.now() + 15000, d = new Date(soon);
  await service.execute({ action: 'create', title: '到点提醒测试', dueDate: localDate(soon), dueTime: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, alertAt: soon });
};
const page = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>待办 live</title>
<style>body{margin:0;background:#f4f4f6;font-family:-apple-system,"PingFang SC",sans-serif}#page{height:640px;background:#fff;border-bottom:1px solid #ddd}#card{width:360px;margin:16px}</style>
<div id="page"></div><div id="card"></div><div id="overlay"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>window.__ModuleLoader__={load(m){window.__todo=m.factory(()=>React)}}</script><script src="/client.js"></script>
<script>
const T=__todo.__test, t=(k,p={})=>String(T.ZH[k]??k).replace(/\\{(\\w+)\\}/g,(_,n)=>p[n]);
const req=async(input,signal)=>T.requestJSON(fetch.bind(window),input,signal);
const store=T.createStore(req,{pollMs:1000,tickMs:1000}); store.start(); window.__store=store; window.__opened=[];
const props={store,t,openSession:id=>__opened.push(id),openPage:v=>store.setView(v),currentSession:()=>'current'};
ReactDOM.createRoot(document.getElementById('page')).render(React.createElement(T.TodoPage,props));
ReactDOM.createRoot(document.getElementById('card')).render(React.createElement(T.TodoCard,{...props,sessionId:'current'}));
ReactDOM.createRoot(document.getElementById('overlay')).render(React.createElement(T.AlertToasts,props));
</script></html>`;
const files = { '/react.js': path.join(react, 'react/umd/react.development.js'), '/react-dom.js': path.join(react, 'react-dom/umd/react-dom.development.js'), '/client.js': path.join(here, '../lib/client.js') };
await seed();
http.createServer(async (req, res) => {
  if (req.url === '/api/todo/action') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await handler(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
  }
  if (req.url === '/agent' ) { const value = await service.execute({ action: 'create', title: 'Agent 新建的提醒', dueDate: today }); res.end(JSON.stringify(value)); return; }
  if (files[req.url]) { res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(files[req.url]).pipe(res); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
