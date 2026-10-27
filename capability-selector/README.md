# 外部能力 · Capability Selector

在 DSH 会话摘要下方提供一个小按钮，统一查看本机已安装的 Skills、企业 CLI 和 MCP 配置，搜索、筛选、多选后将准确的使用说明追加到当前输入框。纯 JavaScript，无运行时依赖，无需构建，Node.js 22+。

## 使用

1. 打开一个会话，点击右侧摘要下方的“外部能力”。首次打开时扫描；之后使用短期缓存，点击“刷新”重新扫描。
2. 按 Skills / CLI / MCP、来源或关键词筛选。点击名称查看说明、安装位置和依赖线索；复选框用于多选。
3. 点击“添加到输入框”。插件使用 DSH 原生追加接口，保留已有草稿、引用与附件，不自动发送。
4. 确认输入框中的任务及能力说明后，由用户发送。选择表示当前任务的使用偏好，不等于全局启用、禁用或安装能力。

输入框正在提交、附件处理未完成或绑定已变化时，会保留选择并提示重试。切换主会话后清空面板选择，避免把能力说明加到另一个会话。原生接口缺失时可用“复制使用说明”。

## 自适应布局

- 按钮是独立固定定位元素，不放入摘要内容的滚动容器。
- 配合本仓库的 Session Summary 0.3.1+，为按钮在摘要下方预留 48px；摘要增长时压缩其最大高度，由摘要内部滚动。
- 摘要被拖动、折叠、展开或窗口缩放时，按钮随实际摘要边界重新定位。
- 宽屏优先向左展开选择面板；空间不足时居中；窄屏使用单列面板，列表和详情可来回切换。
- 面板高度限制在可视窗口内，列表、详情单独滚动，底部操作区始终可访问；使用 visualViewport 适配可视区域变化。
- 关闭摘要或未安装摘要时，入口回到主会话页头右侧下方。插件也可以单独安装。
- 支持浅色 / 深色主题、Escape 关闭、键盘选取；窄屏弹层包含焦点循环。

布局协作约定是根元素 CSS 变量 `--dsh-summary-accessory-height` 与 `dsh:summary-accessory-change` 事件。停用时释放预留空间、观察器、事件和样式，不修改摘要内容 DOM。

## 发现范围

扫描发生在 DSH Host 所在机器上。浏览器远程访问 DSH 时，清单对应 Host 的安装情况。

| 类型 | 默认范围 | 状态含义 |
|---|---|---|
| Skills | 当前工程至 Git 根或用户目录的 `.codex/skills`、`.claude/skills`、`.dsh/skills`、`.agents/skills`；相应用户级目录；DSH 当前运行时 Skill 注册表；自定义目录 | 已安装；完整性不能确认时标记待核对 |
| CLI | PATH 与用户 `.local/bin` 中的 `o2` / `oxygen-cli`、`digger`、`jd-login`，可配置扩展命令名 | 仅检查可执行文件，不验证登录 |
| o2 子能力 | `o2 list --installed --json` 返回的已安装目录 | 只读发现，失败或超时产生提示，保留 o2 本身的安装信息 |
| MCP | Codex 用户及工程配置、Claude 用户及工程配置、DSH 当前 profile 已合成的 MCP 条目 | 已配置或已禁用，不冒充已连接、已登录或当前会话已可调用 |

支持 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`DSH_HOME` 等显式目录覆盖。不会遍历整块硬盘。扫描限制目录深度、文件大小、总读取量与耗时；局部失败时保留其他结果并显示扫描提示。

MCP 配置中只提取名称、来源、传输类型与启停状态，不向客户端返回启动参数、环境变量、地址中的凭据、请求头或完整配置。展示 Skill 文本时也过滤明显凭据。不会因为发现某项能力而自动登录、连接 MCP、安装工具或执行业务。

## 去重规则

- 同一真实 Skill 路径通过符号链接出现在不同 Agent 下时，合并来源。
- 不同目录中完整 Skill 包一致时合并，包括正文、脚本、资源文件名、内容与可执行位。
- 同名不同内容保留独立条目；扫描不完整或依赖包外资源时不跨目录误合并。
- 不可读取文件的 DSH provider Skill 按 provider 身份保留，并指引调用原生 Skill 工具。
- `oxygen-cli` 作为 `o2` 的别名合并；o2 子能力单独显示。
- MCP 仅在名称和完整配置指纹一致时合并。指纹只留在 Host 内部，不返回敏感配置。

## 安装

在 DSH 的“插件 → 安装第三方插件”中填入本目录的绝对路径，启用后刷新现有 DSH 页面。需要与摘要联动时，同时使用本仓库更新后的 `session-summary`。

```sh
dsh plugin --profile desktop add /absolute/path/dsh-plugin/capability-selector
```

macOS 未配置 PATH 时可使用官方启动器：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/dsh-plugin/capability-selector
```

如插件管理器报告需要重启，等待当前任务结束后再重启。无需启动额外 Web 服务。

## 配置

插件条目的 `config` 可填写以下内容，未填写使用默认值：

```yaml
extraSkillRoots: []                 # 最多24个绝对路径，支持 ~/
cliCommands: [o2, oxygen-cli, digger, jd-login]  # 最多24个命令名，不接受参数或路径
cacheTtlMs: 60000                   # 1000..300000
enableO2Discovery: true             # 只读发现o2已安装子能力
enableAgentTool: true               # 注册只读 capability_list 工具
```

前端请求只接受会话 ID，工作目录由 Host 读取会话当前目录解析，不能由浏览器指定任意扫描目录。

## 截图与验收

![宽屏实际组件截图](docs/preview.png)

查看[验收记录](docs/验收记录.md)及[窄屏截图](docs/mobile.png)。截图使用真实组件和测试样例数据。

## 开发与验证

```sh
npm run check
npm test
npm run test:integration
npm run test:browser
npm pack --pack-destination artifacts
```

原生后端集成测试读取 `scripts/.runtime` 或同仓库 `side-branch/scripts/.runtime` 的已提取宿主依赖，也可用 `DSH_TEST_RUNTIME` 指定依赖根目录；没有依赖时该项会明确跳过。浏览器测试直接从本机安装包读取所需模块。

浏览器检查使用隔离 Chrome 和本机 DSH 安装包中的真实 React / 主题，加载实际选择器和摘要源码，不访问用户会话或认证信息。截图和测试数据位于 `tests/.integration-data`，不提交仓库。

插件依赖 DSH `0.2.1-rc.3` 的公开插槽、`uiSession.current` 和原生 `requestDraftInitialization(..., { whenDraftExists: 'append' })` 接口；升级宿主后需要重新验证。
