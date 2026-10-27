# 会话摘要悬浮框 · Session Summary

DSH Desktop / Web GUI 插件。在对话页头右上角加一个按钮，每次打开窗口时默认打开并固定摘要卡片，靠边显示以避开正文，也支持手动拖动，交互方式参照 Codex 桌面版的 pinned summary。

**完整的使用说明（含截图和常见问题）见 [使用文档](docs/使用文档.md)。**

卡片顶部是项目名，下面分为七个板块：

| 板块 | 显示内容 | 点击后 |
|---|---|---|
| 变更 | 本会话各轮改动过的文件及累计增删行数，最近改动的排在前面 | 在右侧栏打开该文件最近一轮的原生对比（review）标签 |
| 子智能体 | 运行中 / 已完成 / 未运行状态、模式、活跃耗时和 token 用量 | 在右侧栏打开子会话 |
| 来源 | 已读取和搜索到的网页、MCP 服务器（含工具和调用次数）、用过的技能、@ 引用的文件和会话 | 网页在内置浏览器打开（Web 版没有内置浏览器时用新窗口打开）；技能打开 SKILL.md；文件打开预览；会话跳转过去 |
| 计划 | 计划模式状态、目标（goal）、待办进度、已提交的计划 | 已提交的计划在右侧栏打开 |
| 生成文件 | 通过 `present` 交付的文件 | 打开文件预览 |
| 后台任务 | 本会话的后台任务（bash / pwsh / subagent / workflow），以及状态和耗时 | 只显示，不提供操作 |
| 关联会话 | 父会话或 fork 来源、本会话派生出的分支、侧栏分支插件创建的分支及其来源 | 在主视图打开 |

“变更”“子智能体”“来源”三个板块始终显示，和 Codex 一样；其余四个板块只在有内容时出现。每次打开或刷新窗口默认仅展开“变更”，其余板块折叠；手动展开/折叠的选择在当前窗口内保留。条目较多时只显示前几项，点击“查看全部”或“再显示 N 项”展开。

## 交互

- **按钮**：位于页头右侧，在原生右侧栏展开按钮的左边。有子智能体在运行时，按钮上会出现一个小圆点。
- **打开和关闭**：每次打开或刷新窗口默认打开并固定；关闭或取消固定仅影响当前窗口，旧版保存的关闭状态不会阻止启动显示。点击按钮显示或隐藏卡片。宽窗口为摘要预留右侧独立空间，正文和输入框同步调整宽度；关闭后释放空间。窄窗口显示在正文上方，默认是一条可展开的摘要栏，展开时预留高度。
- **固定**：默认固定，点击卡片上的图钉切换固定状态。固定后，切换会话或刷新页面都会保持显示，在对话外点击或按 Escape 也不会关闭（焦点在卡片内时按 Escape 会关闭）。不固定时，点击外部、按 Escape 或切换会话都会关闭。
- **拖动**：拖动顶部项目名区域会进入自由悬浮模式，当前位置在当前窗口切换会话时保留。下次打开或刷新窗口默认回到不遮挡正文的靠边布局。窗口缩小时会自动限制在可见区域内。聚焦项目名后可用方向键移动（Shift 加速），Home 回到靠边布局。固定表示保持显示，并不锁定位置。
- **更多菜单（⋯）**：复制项目路径、在文件树中查看、刷新（重新读取失败的改动记录和子智能体用量）、靠边显示（避开正文）。
- **外部能力插件协同**：安装本仓库的 Capability Selector 后，摘要下方为能力按钮独立预留空间；摘要过长时由内容内部滚动。拖动、折叠和窗口缩放时仍保留按钮的位置，窄屏正文间距也包含按钮高度。
- **背景**：主题菜单底色混入 12% 透明色，保留背景模糊；文字和按钮不降低透明度。
- **历史未全部加载时**：卡片底部会提示“仅统计已加载的记录”，可以点击“加载更早的记录”。

空白会话（还没有开始对话）的页头不显示原生的工具按钮，这里的按钮也一样不显示。

## 数据从哪里来

插件只读取原生客户端已有的数据，并调用原生的导航接口：

- 会话列表与投影（`subagentCatalog`、`todos`、`plan`、`goal`、`workingDirectory`），以及原生子智能体目录的状态、耗时和 token 计算方式。
- 对话快照里的工具调用（`web_search`、`web_fetch`、`mcp__<server>__<tool>`、MCP 资源工具、`skill`、`present`、`exit_plan_mode`），以及用户消息中的 @ 引用、技能调用和会话引用。
- 原生改动文件卡片使用的 Host 路由 `api/changes.summary`。插件按轮次读取后合并显示。
- 后台任务服务 `ctx.jobs`（只订阅，不发送停止等操作）。
- 安装了侧栏分支插件时，读取它的 `/api/side-branch/branch` 来识别当前会话的分支来源。

插件**不发送模型请求**，不往会话日志写任何内容，不改 Session 配置，也不注册 Host 路由或工具。按 DSH 官方插件开发规范，客户端只引用 React，原生图标、状态点和提示框的样式是从宿主复制过来的，颜色和圆角只使用主题变量，所以浅色和深色主题都会自动适配。

## 安装

安装后刷新页面以载入客户端代码；如果插件管理器提示需要重启，请等当前任务结束后再重启。

**方式一：插件页（推荐）**

1. 在 DSH 左侧栏打开“插件”，点击“添加插件”。
2. 在输入框中填写下面任一绝对路径，然后点击“安装”：
   - 开发目录：macOS 例如 `/Users/<你的用户名>/dsh-plugin/session-summary`，Windows 例如 `E:\dsh-plugin\session-summary`
   - 或打包文件：先在本目录执行 `npm pack --pack-destination artifacts`，再填写 `artifacts/dsh-session-summary-0.3.1.tgz` 的绝对路径
3. 安装完成后，打开一个已经有对话的会话，页头右上角会出现摘要按钮。

**方式二：命令行**

```sh
# macOS
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD"
```

```powershell
# Windows PowerShell（把安装目录换成你的 DSH 安装位置）
& "D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "$PWD"
```

以上命令在 `session-summary` 目录中执行；如果 `dsh` 已在 PATH 中，直接用 `dsh plugin --profile desktop add <路径>` 即可。如果安装结果提示需要重启，请等其他任务结束后再重启 DSH。

**卸载**：在插件页打开“会话摘要悬浮框”后卸载，或执行 `dsh plugin --profile desktop remove dsh-session-summary`（`dsh` 的位置同上）。

卸载后不会留下会话数据。浏览器的 localStorage 里会保留一条很小的偏好记录 `dsh.session-summary.v1`（拖动后的位置；开启/固定/折叠状态仅在当前窗口内使用，新窗口恢复默认）。

## 已知边界

- **改动记录只在 Host 进程运行期间保留**，这是 DSH 本身的限制，原生改动文件卡片也一样。DSH 重启后，之前轮次的改动会显示为“已不可用”。子智能体会话和 fork 继承来的轮次没有改动记录。
- **变更的行数是按轮次累加的**，同一个文件在多轮中被改动时，显示的是每轮增删行数之和，不是净差异。
- **只统计已加载的记录**：来源、计划、生成文件等来自当前已加载的对话窗口。较早的历史需要点击“加载更早的记录”才会计入。
- `web_fetch` 的结果没有页面标题。如果同一个网址在搜索结果里出现过，就用搜索结果的标题，否则显示域名。
- DSH 没有提供列出 MCP 服务器的客户端接口，所以“来源”里只显示本会话实际调用过的 MCP 服务器。
- 侧栏分支插件“编辑第 1 轮”创建的分支是一个全新会话，不是 fork。从源会话这边无法枚举这类分支，只能在分支会话里看到它的来源。
- 子智能体与 Codex 文档描述的一致，卡片里只显示状态，不提供停止或引导操作。需要停止时，在子会话里用原生的停止按钮。
- 插件依赖 DSH `0.2.1-rc.3` 公开的客户端插槽与数据接口。升级 DSH 后请重新验证。

## 开发与验证

源码不需要构建：Host 端是 ESM，客户端是经典脚本格式的 ModuleLoader 文件。

| 文件 | 作用 |
|---|---|
| [client.js](lib/client.js) | 数据推导、页头按钮、`shell.overlay` 中的卡片、提示框、原生导航 |
| [index.js](lib/index.js) | Host 端空的 `apply`，只为让插件包作为普通的 Loader 条目出现 |
| [需求文档](docs/需求文档.md) | 已确认的范围、交互和 Codex 资料出处 |
| [docs/research](docs/research) | 对 DSH 插槽、组件和数据接口的调研笔记 |

以下命令在 Windows 和 macOS 上相同（Node.js 22+）：

```sh
npm test                                             # 单元测试
npm run test:browser                                 # 隔离 Chrome 的真实鼠标、触屏、键盘与刷新验证
npm run test:integration                             # 用安装包里真实的 React / 插槽运行时做集成测试（2 项）
node scripts/preview.mjs                             # 离线预览：浅色/深色截图 + 交互自检（需要 Chrome / Chromium / Edge）
npm pack --pack-destination artifacts                # 打包
node scripts/verify-package.mjs                      # 逐字节核对打包产物并写出 sha256
```

预览会自动查找 Chrome、Chromium 或 Edge（macOS 在 `/Applications` 下查找），也可用 `--browser <路径>` 或环境变量 `CHROME_PATH` 指定。集成测试会自动查找本机 DSH 的 `app.asar`（macOS：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`），找不到时用环境变量 `DSH_TEST_ASAR` 指定。

集成测试和预览只会从本机安装包 `app.asar` 中只读提取依赖，放到 `scripts/.runtime`。它们不访问正在运行的 DSH，不读取会话或凭据，也不写入 DSH home。预览用的是项目内的临时浏览器 profile，结束后会删除。验证结果、截图和安装后的验收清单见 [验收记录](docs/验收记录.md)。

图标是本项目原创的；卡片内的界面图标复制自 DSH 宿主。License: MIT。
