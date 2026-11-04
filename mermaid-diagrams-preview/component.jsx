import React from 'react';
import { createRoot } from 'react-dom/client';
import { Diagram } from '../mermaid-diagrams/src/diagram.jsx';
import zh from '../mermaid-diagrams/locale/zh.json';

const FLOW = `flowchart LR
    A[访问应用] --> B{已有登录会话？}
    B -->|是| C[进入页面]
    B -->|否| D[跳转身份中心]
    D --> E[完成登录]
    E --> C`;
const SEQ = `sequenceDiagram
    participant B as 浏览器
    participant I as 统一身份中心
    participant R as Risk API
    participant M as MyDB
    B->>R: 访问页面，没有 Risk API 会话
    R-->>B: 跳转到身份中心，携带回调地址
    B->>I: 请求登录
    I-->>B: 要求扫码或输入账号密码
    B->>I: 完成身份验证
    I-->>B: 设置身份中心 Cookie，携带票据跳回
    B->>R: 访问回调地址，携带票据
    R->>I: 验证或兑换票据
    I-->>R: 确认用户身份
    R-->>B: 设置 Risk API 会话 Cookie`;
const BROKEN = `flowchart LR
    A[开始] --> B{判断
    B --> C`;
const t = key => zh.ui[key] ?? key;
const marks = {};
window.__marks = marks;
const started = performance.now();
new MutationObserver(() => {
  document.querySelectorAll('[data-dsh-mermaid]').forEach((card, index) => {
    const state = card.dataset.state;
    if (state !== 'loading' && !(index in marks)) marks[index] = { state, ms: Math.round(performance.now() - started) };
  });
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'], childList: true });

function Column({ dark }) {
  const theme = React.useMemo(() => ({ revision: dark ? 2 : 1, active: { colorScheme: dark ? 'dark' : 'light' } }), [dark]);
  return React.createElement(React.Fragment, null,
    React.createElement('span', { className: 'badge' }, dark ? '深色主题' : '浅色主题'),
    React.createElement('p', null, '例如：'),
    React.createElement(Diagram, { source: FLOW, theme, localeId: 'zh-CN', t }),
    React.createElement('p', null, '以先登录 Risk API 为例，常见流程是：'),
    React.createElement(Diagram, { source: SEQ, theme, localeId: 'zh-CN', t }),
    React.createElement('p', null, '语法错误时：'),
    React.createElement(Diagram, { source: BROKEN, theme, localeId: 'zh-CN', t }));
}
const roots = [[createRoot(document.querySelector('main.light')), false], [createRoot(document.querySelector('main.dark')), true]];
let generation = 0;
const mount = () => roots.forEach(([root, dark]) => root.render(React.createElement(Column, { dark, key: generation })));
mount();
// Remount every card (as when a turn folds/unfolds or a session is reopened) and time it.
window.__remount = () => new Promise(resolve => {
  const begin = performance.now();
  generation += 1;
  mount();
  requestAnimationFrame(() => resolve({
    ms: Math.round(performance.now() - begin),
    states: [...document.querySelectorAll('[data-dsh-mermaid]')].map(card => card.dataset.state)
  }));
});
