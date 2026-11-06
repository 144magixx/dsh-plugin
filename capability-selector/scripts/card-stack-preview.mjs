// Browser verification harness for the generic card stack (not DSH itself).
// Loads the real lib/client.js with React 18 UMD; the Todo card is the real todo client with sample data.
// Usage: node scripts/card-stack-preview.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, '../../mermaid-diagrams-preview/node_modules');
const port = Number(process.argv[2] || 58733);
const files = {
  '/react.js': path.join(modules, 'react/umd/react.development.js'),
  '/react-dom.js': path.join(modules, 'react-dom/umd/react-dom.development.js'),
  '/selector.js': path.join(here, '../lib/client.js'),
  '/todo.js': path.join(here, '../../todo/lib/client.js'),
  '/summary.js': path.join(here, '../../session-summary/lib/client.js'),
};
const page = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>card stack</title>
<style>body{--dsw-alias-bg-layer-1:#fff;--dsw-alias-border-l3:#d8d8dc;--dsw-alias-border-l1:#e5e5ea;--dsw-alias-label-primary:#111;--dsw-alias-label-secondary:#7d899b;--dsw-specific-menu:#fff;margin:0;background:#f2f2f5;font-family:-apple-system,"PingFang SC",sans-serif}
#dock{position:relative;width:340px;height:760px;margin:24px}
.demo{padding:10px 12px;background:#fff;border:.5px solid #d8d8dc;border-radius:16px;font-size:13px;color:#7d899b}.demo b{display:block;color:#111;font-size:14px;margin-bottom:4px}
.summary{width:340px;margin:24px 24px -16px;padding:12px;background:#fff;border:.5px solid #d8d8dc;border-radius:16px;font-weight:600}</style>
<div class="dsc-root"><div class="dsc-dock" id="dock"></div></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>const loaded={};window.__ModuleLoader__={load(m){loaded[m.id]=m.factory(()=>React)}}</script>
<script src="/selector.js"></script><script src="/todo.js"></script><script src="/summary.js"></script>
<script>
const c=loaded['dsh-capability-selector'], T=loaded['dsh-todo'].__test, h=React.createElement;
const style=document.createElement('style'); style.textContent=c.CSS; document.head.appendChild(style);
const S=loaded['dsh-session-summary']; const sstyle=document.createElement('style'); sstyle.textContent=S.CSS; document.head.appendChild(sstyle);
const st=(k,p={})=>String(S.ZH[k]??k).replace(/\{(\w+)\}/g,(_,n)=>p[n]??'');
const sapi=S.createApi({get:()=>undefined},{storage:undefined,fetchImpl:async()=>({status:404,ok:false}),transportFetch:async()=>({json:async()=>({ok:false})}),openWindow(){}});
window.__sapi=sapi;
sapi.publish('s',{model:{project:{name:'dsh-plugin',cwd:'/Users/me/dsh-plugin'},changes:{...S.aggregateChanges([]),turns:2,files:[{path:'todo/lib/client.js',display:'todo/lib/client.js',added:42,deleted:7,latest:{seq:1,turn:1,index:0}}],added:42,deleted:7},subagents:S.deriveSubagents(undefined,undefined,{},Date.now()),sources:{web:[],mcp:[],skills:[],files:[],sessions:[]},plan:{mode:false,goal:null,todos:{total:0,done:0,items:[]},submitted:[]},files:[],jobs:{items:[],running:0},related:[],partial:false,loadingOlder:false},context:{cwd:'/Users/me/dsh-plugin',catalog:[]}});
sapi.publishAnchor('s',{right:400,top:60,width:320,maxHeight:600,layout:'side'});
const t=key=>c.ZH[key]??key, tt=(k,p={})=>String(T.ZH[k]??k).replace(/\\{(\\w+)\\}/g,(_,n)=>p[n]);
const today=T.localDate(), base={notes:'',dueTime:null,alertAt:null,alerted:false,flagged:false,completed:false,completedAt:null,createdAt:1,updatedAt:1,sessionId:null,sessionTitle:''};
const todoState={status:'ready',lists:[{id:'w',name:'工作',color:'blue',createdAt:0}],items:[
 {...base,id:'1',listId:'w',title:'确认待办插件设计稿',dueDate:today,dueTime:'09:30',alertAt:T.instantOf(today,'09:30'),flagged:true},
 {...base,id:'2',listId:'w',title:'修复会话搜索高亮错位',dueDate:today,dueTime:'16:30'},
 {...base,id:'3',listId:'w',title:'整理插件 README',dueDate:today,dueTime:'21:00'}],recentDone:{},alerts:[],view:{kind:'smart',id:'today'},minute:Math.floor(Date.now()/60000)};
const todoStore={getSnapshot:()=>todoState,subscribe:()=>()=>{}};
const demo=(title,body)=>h('section',{className:'demo'},h('b',null,title),body);
const cards={
 'dsh-session-summary':()=>h(S.SummaryAccessory,{api:sapi,t:st,sessionId:'s'}),
 'dsh-capability-selector':()=>demo('外部能力','Skills 22 · CLI 7 · MCP 4'),
 'dsh-session-favorites':()=>demo('常用对话','会话搜索插件 · 本机外部能力选择插件'),
 'dsh-todo':()=>h(T.TodoCard,{sessionId:'s',store:todoStore,t:tt,openPage(){},openSession(){},currentSession:()=>'s'}),
 'dsh-task-guardian':()=>demo('任务异常提醒','暂无未读异常提醒'),
};
const rows=[{id:'dsh-session-summary',order:-10,label:()=>'会话摘要'},{id:'dsh-capability-selector',order:0,label:'外部能力'},{id:'dsh-session-favorites',order:50,label:()=>'常用对话'},{id:'dsh-todo',order:60,label:()=>'待办'},{id:'dsh-task-guardian',order:100,label:()=>'任务异常提醒'}];
const layout=c.createCardLayout(localStorage); window.__layout=layout;
const dockRef={current:document.getElementById('dock')};
ReactDOM.createRoot(dockRef.current).render(h(c.CardStack,{rows,layout,t,dockRef,renderCard:id=>cards[id]()}));
</script></html>`;
http.createServer((req, res) => {
  if (files[req.url]) { res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(files[req.url]).pipe(res); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
