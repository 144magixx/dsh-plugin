# 划词提问（Selection Ask）插件设计稿

面向 DeepSeek Harness Desktop / Web GUI 的 Codex 风格全区域划词提问插件设计稿。

## 设计稿清单

| 文件 | 展示场景 |
|---|---|
| [popover-gpt-image-2.5-high-v1.png](popover-gpt-image-2.5-high-v1.png) | **图 1：会话框划词胶囊 + 右侧栏文件预览原地浮窗快问**（含完整工具调用、不切走当前文件、左侧工作区零污染） |
| [sidebar-html-history-gpt-image-2.5-high-v1.png](sidebar-html-history-gpt-image-2.5-high-v1.png) | **图 2：右侧栏 HTML 预览划词 + 固定到侧栏分栏并排 & 插件内历史提问列表** |

生成配置：模型 `gpt-image-2.5-sunburst`，`quality: high`，尺寸 `1536x1024`。提示词见同名 `*-prompt.txt`，请求元数据见同名 `.json`，重新生成可执行 `generate.mjs`。

## 已对齐的核心规格

1. **全区域划词覆盖（场景 A + 场景 B 含 HTML）**：
   - **场景 A（会话框）**：
     - 对话正文气泡：扩展原生 `conversation.chat.text-interaction` 插槽，在 `引用文本` 旁并列展示 `划词提问`。
     - 代码块 / 工具输出 / 折叠过程：通过 `shell.overlay` 全局选区检测器弹出 `划词提问` 胶囊。
   - **场景 B（右侧 Sidebar 阅读文件）**：
     - 支持 **Code 代码视图**（提取精确行号 `Lstart-Lend`）、**Plain Text 纯文本视图**（提取行号）、**Markdown 渲染视图**、**PDF / Office 文本层**，以及 **HTML 预览视图（`[data-html-preview]`）**。
     - **HTML 预览划词实现机制**：通过包装 `sidebar.right.tab.document` 的 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html` 渲染器，在 HTML 预览 iframe 内注入轻量选区桥接脚本（监听 `selectionchange` / `pointerup` / `keyup` 并通过 `window.parent.postMessage` 上报选中文本、选区相对矩形坐标及所在标题/段落上下文），宿主层接收后将坐标换算至主视口并在 HTML 选区旁弹出同一套 `划词提问` 胶囊与浮窗。
2. **交互形态（浮窗快问 + 可固定到右侧栏 Tab）**：
   - 点击 `划词提问` 后在选区旁原地展开可拖拽浮窗，不切走、不打断正在阅读的右侧栏文件。
   - 浮窗右上角支持一键「固定到侧栏」，优先以分栏（`preferNewPane: true`）在右侧栏打开独立问答 Tab，与正在阅读的代码或 HTML 文档左右并排对照。
3. **后台能力（完整工具隐藏 Agent）**：
   - 使用 `ctx.agents.create({ meta: { origin: 'subagent' } })`（不传 `parentSession`）创建隐藏会话，继承主会话已完成轮次前缀、模型路由、工作目录与权限策略，可真实调用 `read` / `grep` / `edit` / `write` / `bash` 等完整工具链。
4. **工作区隔离与插件内历史留存**：
   - 绝不出现在左侧工作区会话列表（含归档列表），也不触发主会话顶栏子代理目录。
   - 插件通过独立 `storageDomain` 保存提问历史索引，在浮窗和侧栏 Tab 的「历史提问」下拉列表中可随时查看、冷恢复续问、单条删除或一键清空。
