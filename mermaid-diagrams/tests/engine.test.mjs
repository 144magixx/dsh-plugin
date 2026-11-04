import test from 'node:test';
import assert from 'node:assert/strict';
import mermaid from 'mermaid';

// Match the plugin's non-HTML labels. This checks syntax, not SVG layout.
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false, flowchart: { htmlLabels: false } });
const fixtures = {
  flowchart: 'flowchart LR\n A[收到请求] --> B{有会话吗}\n B -->|有| C[进入页面]\n B -->|无| D[跳转身份中心]',
  sequence: 'sequenceDiagram\n participant B as 浏览器\n participant I as 统一身份中心\n participant R as Risk API\n participant M as MyDB\n B->>R: 访问页面，没有 Risk API 会话\n R-->>B: 跳转到身份中心，携带回调地址\n B->>I: 请求登录\n I-->>B: 要求扫码或输入账号密码\n B->>I: 完成身份验证\n I-->>B: 设置身份中心 Cookie，携带票据跳回 Risk API\n B->>R: 访问回调地址，携带票据\n R->>I: 验证或兑换票据\n I-->>R: 确认用户身份\n R-->>B: 设置 Risk API 会话 Cookie\n B->>M: 访问 MyDB，没有 MyDB 会话\n M-->>B: 跳转到身份中心\n B->>I: 自动携带身份中心 Cookie\n I-->>B: 已登录，携带新票据跳回 MyDB\n B->>M: 访问回调地址，携带新票据\n M->>I: 验证或兑换票据\n I-->>M: 确认用户身份\n M-->>B: 设置 MyDB 会话 Cookie',
  class: 'classDiagram\n Animal <|-- Duck\n Animal : +int age',
  state: 'stateDiagram-v2\n [*] --> Idle\n Idle --> Running\n Running --> [*]',
  er: 'erDiagram\n CUSTOMER ||--o{ ORDER : places',
  gantt: 'gantt\n title 项目计划\n dateFormat YYYY-MM-DD\n section 研发\n 实现 :a1, 2026-11-01, 3d',
  mindmap: 'mindmap\n root((登录))\n  身份中心\n  Risk API\n  MyDB'
};
for (const [name, source] of Object.entries(fixtures)) {
  test(`real Mermaid parser accepts ${name}`, { skip: !['sequence', 'er'].includes(name) ? 'Mermaid sanitizer requires a browser DOM; covered only in browser acceptance' : false }, async () => {
    const result = await mermaid.parse(source);
    assert.ok(result && result.diagramType);
  });
}
