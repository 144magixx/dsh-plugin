import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { mermaidConfig, typeName } from '../mermaid-diagrams/src/palette.mjs';
import { iconSvg } from '../mermaid-diagrams/src/icons.mjs';
import css from '../mermaid-diagrams/src/style.css';

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
    R-->>B: 设置 Risk API 会话 Cookie
    B->>M: 访问 MyDB，没有 MyDB 会话
    M-->>B: 跳转到身份中心
    B->>I: 自动携带身份中心 Cookie
    I-->>B: 已登录，携带新票据跳回 MyDB
    M->>I: 验证或兑换票据
    I-->>M: 确认用户身份
    M-->>B: 设置 MyDB 会话 Cookie`;

window.__probe = { mermaid, mermaidConfig };
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

const button = (icon, tip) => `<button type="button" class="dshmd-icon dshmd-tip" data-tip="${tip}" aria-label="${tip}">${iconSvg(icon)}</button>`;
let sequence = 0;
const timings = [];
async function card(host, source, type, dark) {
  const tokens = getComputedStyle(host);
  const read = name => tokens.getPropertyValue(name).trim();
  mermaid.initialize(mermaidConfig({ dark, canvas: read('--dsw-alias-markdown-code-block'), text: read('--dsw-alias-label-primary'), muted: read('--dsw-alias-label-secondary') }));
  const started = performance.now();
  const { svg } = await mermaid.render(`preview-${++sequence}`, source);
  timings.push(Math.round(performance.now() - started));
  const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style'] });
  host.innerHTML = `<section class="dshmd-card"><div class="dshmd-head"><span class="dshmd-title">${typeName(type, 'zh')}</span><div class="dshmd-actions">${button('source', '查看源码')}${button('copy', '复制源码')}${button('expand', '放大查看')}${button('download', '下载 SVG / PNG')}</div></div><div class="dshmd-canvas">${clean}</div></section>`;
}
(async () => {
  for (const column of document.querySelectorAll('[data-scheme]')) {
    const dark = column.dataset.scheme === 'dark';
    await card(column.querySelector('[data-flow]'), FLOW, 'flowchart', dark);
    await card(column.querySelector('[data-seq]'), SEQ, 'sequenceDiagram', dark);
  }
  document.body.dataset.ready = timings.join(',');
})().catch(error => { document.body.dataset.ready = 'error'; document.body.dataset.error = String(error?.stack || error); });
