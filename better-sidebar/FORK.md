# Better Sidebar 二开说明（fork）

本目录 fork 自 [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的 **v0.28.0** 标签（tag 对象 `6adf501c10ff898d90847f81de2bac5fa22c7941`，源码取自 GitHub codeload 压缩包，未带上游 Git 历史）。包名与版本号保持 `dsh-better-sidebar@0.28.0` 不变：这样已有的 profile 配置行 `better-sidebar`、插件偏好和其他插件对它的依赖都继续生效。二开改动都标了 `[fork]` 注释。

上游的 [README](README.md)、[AGENTS.md](AGENTS.md)、[接入指南](docs/external-plugin-guide.md) 原样保留，下面只记录二开部分。

## 二开功能

### 1. 文件编辑区右上角「打开 ▾」

打开任意文件后，编辑区标题栏最右侧出现分体按钮：

- **单击「打开」**：用默认方式在外部应用里打开当前文件。没有设置过时，使用系统默认应用（宿主 open-in-app 能力）。
- **点 ▾**：列出这个文件可用的所有打开方式，当前默认方式打勾：
  - 系统默认应用（括号里显示系统实际会用的应用）；
  - 宿主为这个文件检测到的其他应用（带图标，例如各浏览器、编辑器）；
  - 插件自带目标：VS Code、Cursor、Zed、「打开方式」设置里添加的自定义编辑器（与宿主列表同名的会去重）；
  - 在文件管理器中显示。

  选中一项只**切换默认**，不会立刻打开；之后单击「打开」即用新默认。
- **「仅对 .ext 文件生效」**（菜单底部）：勾选后，当前扩展名使用单独的默认方式（例如 `.html` 用浏览器、其余文件用 VS Code）；取消勾选即删除这条扩展名规则，回落到全局默认。
- 打开失败时按钮边框变红，悬停提示原因，3 秒后恢复。

规则存放在编辑器插件设置 `pluginSettings.editor.openWith.defaults`，和文件树右键菜单的固定项、自定义编辑器在同一份配置里：

```json
{ "openWith": { "defaults": {
  "*":     { "target": "plugin:vscode", "name": "VS Code" },
  ".html": { "target": "app:com.google.Chrome", "name": "Google Chrome" }
} } }
```

`target` 取值：`system`（系统默认）、`app:<宿主应用 id>`、`plugin:<vscode|cursor|zed|explorer|custom:<id>>`、`reveal`（在文件管理器中显示）。代码见 [open-with.ts](src/client/open-with.ts)（纯逻辑：`defaultKeyOf` / `resolveDefaultOpen` / `withDefaultOpen`）和 [OpenWithButton.tsx](src/client/OpenWithButton.tsx)。宿主应用列表按扩展名缓存（最多 64 条），每个扩展名每页只查询一次，不轮询。

### 2. `editorActions` 扩展点（供 [页面批注](../page-annotate/README.md) 使用）

`ctx.betterSidebar.registerEditorAction(descriptor)` 往编辑区标题栏注册一个动作（`features` 含 `'editorActions'`）：

```ts
interface EditorActionDescriptor {
  id: string                       // 唯一 id，如 'my-plugin:annotate'
  order?: number                   // 升序，默认 0
  match?: (path: string) => boolean // 只对匹配的文件显示，默认全部
  render: (props: EditorActionProps) => ReactNode
}
interface EditorActionProps {
  ctx: Context
  scope: SessionScope
  path: string                     // 当前文件绝对路径
  mode: 'preview' | 'edit' | undefined
  visible: boolean                 // 所在页签是否在屏幕上
  surface: () => HTMLElement | null // 编辑区主体元素（预览 iframe 在它里面）
}
```

动作渲染在内置按钮右侧、「打开 ▾」左侧，每个动作包在独立的错误边界里，抛错只会让这个动作消失。返回值是 disposer，照例包在 `ctx.effect` 里。

### 3. 超过 5 MB 的 HTML 也能渲染预览

上游对超过 5 MB（`MAX_EDITABLE_BYTES`）的文本文件只给只读的分页源码视图，HTML 也一样。二开后，超限的 HTML 默认显示渲染预览（预览走 `/sidebar/html` 流式路由，本来就没有大小限制）；切换按钮的另一侧是「原文」，即原来的只读分页源码，仍然不能编辑。其他类型的大文件不变。代码见 [TextEditor.tsx](src/client/TextEditor.tsx) 里的 `largeHtml`。

### 4. 「关闭沙箱」时预览真正同源

上游的 `/sidebar/html` 路由对每个响应都加了 CSP `sandbox`（不含 `allow-same-origin`）。即使在设置里关闭了 HTML 沙箱、iframe 没有 `sandbox` 属性，页面仍是不透明源，父页面访问不到它的 DOM，所以划词提问、页面批注这类工具实际上用不了。

二开后，沙箱关闭时，编辑器给预览地址加上 `?same-origin=1`，路由随即返回带 `allow-same-origin` 的 CSP（仍然不允许顶层导航）。以下两种情况例外，仍返回原来的不透明源 CSP：

- 请求带有 `Sec-Fetch-Dest` 且不是 `iframe`（顶层打开、弹窗）；
- 请求带有 `Sec-Fetch-Site` 且不是 `same-origin`。

这两个请求头**缺失时视为通过**：DSH Desktop 的 `dsh-app://` 代理在转发给 Host 之前会删掉 `sec-fetch-site`。最初要求必须带这个头，导致 Desktop 上关闭沙箱也无法同源（2026-11-14 实测，按钮提示「仍被服务端隔离」）。

这样放宽不会让沙箱页面逃逸：CSP 的 `sandbox` 只能在浏览上下文原有的沙箱标志上再加限制。沙箱化（不透明源）的预览创建的子 iframe 和弹窗都会继承它的沙箱标志，没有 `allow-same-origin`，也没有 `allow-popups-to-escape-sandbox`，所以即使路由回了同源 CSP，它们仍然是不透明源。测试页面上已经验证：强制返回同源 CSP 时，沙箱页面里的子 iframe 和弹窗的 `origin` 都是 `null`。只有同源代码不加沙箱创建的预览（即关闭沙箱后的编辑器预览）才会同源，这正是「关闭沙箱」这个设置本来的含义。

代码见 [html-route.ts](src/html-route.ts) 的 `htmlRouteCsp`，测试见 `tests/file-stream-route.spec.ts`（真实 HTTP）。沙箱开启时，地址不带这个参数，行为与上游完全一致。

### 5. 任务管理页兼容 DSH 0.2.2-rc.2+ 的 Agent Teams 投影

现象：DSH 0.2.2-rc.3 上打开任务管理页，整页只剩 `dsh-better-sidebar: Cannot read properties of undefined (reading 'map')`。

原因：0.2.2-rc.2 把 Agent Teams 从 `dsh-experimental-agent-team` 转正为 `dsh-agent-team`，`agentTeam` 投影从 `{ members, tasks, failure? }` 改成了 `{ enabled, tasks, failure? }`。Team 变成每个根会话的一种模式，所以普通会话也会带这个投影（`enabled: false`）；成员名单改由根会话的 `subagentCatalog` 提供；任务带 `ownerId`；改派任务时 `owner` 改传会话 id，旧版传的是成员名。上游插件按旧类型直接执行 `team.members.map`。

修法按“以后再变也不整页崩溃”来做：

- **边界校验**：`agentTeam` 在类型上标成 `unknown`，只能经 `teamProjectionOf` 读取。逐字段校验，丢掉坏行，不认识的形状一律当“没有团队”，不抛异常。
- **按形状判断，不按版本号**：有 `members` 数组就走旧名单；没有就从目录推导（根会话 + 所有 `continuable` 后代，排除侧边对话）；`enabled: false` 不显示团队条。
- **以会话 id 认人**：任务归属先比 `ownerId`，再退回名字；每个成员带 `assignKey`，旧宿主是名字，新宿主是会话 id。
- **服务端探测**：写接口按宿主实际提供的方法选 `tryMembership` 或 `isEnabled`，两个都没有就交给宿主在写操作里自己鉴权。
- **故障隔离**：团队条外面单独套了一层 `RenderBoundary`，以后再出渲染错误只影响这一条，不会连带整页。`subagentCatalog` 不是数组时按“未加载”处理。

代码见 [team-projection.ts](src/client/team-projection.ts)、[team-routes.ts](src/team-routes.ts)，测试见 `tests/team-projection.spec.ts`、`tests/tasks-page.spec.tsx`（“DSH 0.2.2-rc.2+ team projection”）、`tests/team-routes.spec.ts`。

## 构建与测试

```sh
pnpm install          # 安装依赖（含 devDependencies）
pnpm build            # 生成 lib/（lib/ 不入库，link 安装依赖它）
pnpm typecheck && pnpm lint
pnpm vitest run tests/open-with.spec.ts tests/open-with-defaults.spec.ts tests/open-with-button.spec.tsx tests/editor-actions.spec.ts
pnpm test             # 全量
```

全量测试基线（2026-11-14，macOS）：未改动的上游 v0.28.0 就有 5 个用例失败，原因是本目录嵌套在 dsh-plugin 这个 Git 仓库里，与本次改动无关：`tests/git.spec.ts` 1 个，`tests/smoke.spec.ts` 中「session cwd resolution」4 个。二开后仍是同样 5 个，其余 2706 个通过。2026-11-17 加入第 5 节后：仍是这 5 个失败，2719 个通过、17 个跳过。

## 安装方式

profile 依赖为 `"dsh-better-sidebar": "link:/Users/minyuwei.6666/dsh-plugin/better-sidebar"`。宿主按包的 `peerDependencies` 把 `@deepseek-ai/*` 路由到宿主自身的实现，所以本目录 `node_modules` 里的开发版宿主包不会在运行时被加载。

**改源码后**先执行 `pnpm build`，再刷新页面（只改客户端时）或重启 DSH（改了宿主侧 `src/*.ts` 时）。

## 与上游同步

1. 下载上游新标签与 v0.28.0 的源码压缩包（`https://codeload.github.com/omdsh-dev/DSH-better-sidebar/tar.gz/refs/tags/<tag>`），以 v0.28.0 为基准做三方合并，或按 `[fork]` 注释逐处迁移。
2. 二开涉及的文件：`src/client/open-with.ts`、`src/client/OpenWithButton.tsx`（新增）、`src/client/EditorHost.tsx`、`src/client/TextEditor.tsx`、`src/client/api.ts`（`htmlUrl`）、`src/html-route.ts`、`src/index.ts`（html 路由的 CSP）、`src/client/service.ts`、`src/client/sidebar.module.css`（文件末尾）、`src/client/locales*.ts`（`openDefault*` 7 个键）、`tests/open-with*.spec.ts*`、`tests/editor-actions.spec.ts`（新增）、`tests/editor-large-file.spec.tsx` 与 `tests/file-stream-route.spec.ts`（新增用例）；Agent Teams 兼容（第 5 节）：`src/context-types.ts`、`src/team-routes.ts`、`src/client/team-projection.ts`、`src/client/subagent-catalog.ts`、`src/client/SubagentView.tsx`、`src/client/TeamBoard.tsx`、`src/client/TaskWindow.tsx`、`src/client/tasks-model.ts`、`tests/team-projection.spec.ts`、`tests/tasks-page.spec.tsx`、`tests/team-routes.spec.ts`、`tests/tasks-model.spec.ts`。
3. 同步后重跑上面的测试，并与基线对比。
