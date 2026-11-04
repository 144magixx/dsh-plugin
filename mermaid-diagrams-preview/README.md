# 会话图表 · 预览与组件验证

[mermaid-diagrams](../mermaid-diagrams/) 插件的开发辅助目录，不属于插件本身，也不会被安装。

| 文件 | 用途 |
|---|---|
| `index.html` + `entry.mjs` → `preview.js` | 改版前的样式预览：真实 Mermaid 引擎 + 插件配色、图标、卡片样式，浅色 / 深色对照 |
| `component.html` + `component.jsx` → `component.js` | 组件验证：用 React 18 直接渲染 `../mermaid-diagrams/src/diagram.jsx`，使用与插件相同的构建期 Mermaid 适配 |
| `preview.png` / `final.png` / `final-dialog.png` | 预览、最终卡片和放大窗口截图 |

`preview.js`、`component.js` 是构建产物，提交是为了无需构建即可打开页面。

## 重新构建

```sh
pnpm install --ignore-scripts                 # 本目录：React 18
(cd ../mermaid-diagrams && pnpm install --ignore-scripts)   # Mermaid、DOMPurify、esbuild
```

然后用 esbuild 打包 `component.jsx`（`format: 'iife'`，`loader: { '.css': 'text' }`，插件使用 `../mermaid-diagrams/scripts/mermaid-plugin.mjs` 导出的 `mermaidPlugin()`，`nodePaths` 指向本目录与插件目录的 `node_modules`）。

页面需要通过 HTTP 打开（例如 `python3 -m http.server`），不能直接用 `file://`。

这里的测试页不是 DSH 本身；会话内的最终显示仍以 DSH 中刷新后的实际页面为准。
