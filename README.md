# DSH 插件项目集合

此仓库用于开发和存放多个独立的 DSH（DeepSeek Harness）插件。每个插件放在自己的子目录中，分别维护代码、清单、文档、测试和安装包。

插件是纯 JavaScript，零运行时依赖、无需构建，面向 **Windows 和 macOS** 的 DSH Desktop / Web GUI；各插件实际能力与平台验证范围以其 README 和验收记录为准。

## 插件列表

| 插件 | 目录 | 用途 | npm 包名 |
|---|---|---|---|
| **岔路 · Side Branch** | [side-branch](side-branch/README.md) | 从历史轮次继续，或修改历史提问，在侧栏使用完整原生会话 | `dsh-side-branch` |
| **会话摘要悬浮框 · Session Summary** | [session-summary](session-summary/README.md) | 在对话右上角弹出可固定的摘要卡片：改动、子智能体、来源、计划、生成文件、后台任务、关联会话 | `dsh-session-summary` |
| **会话搜索 · Session Search** | [session-search](session-search/README.md) | Cmd/Ctrl+F 搜索当前会话，Cmd/Ctrl+Shift+F 搜索会话标题与跨会话正文 | `dsh-session-search` |
| **外部能力 · Capability Selector** | [capability-selector](capability-selector/README.md) | 发现并去重本机 Skills、企业 CLI 与 MCP，选择本次任务的能力；入口位于摘要下方 | `dsh-capability-selector` |
| **任务守护 · Task Guardian** | [task-guardian](task-guardian/README.md) | 原生优先的临时故障守护、恢复审查和问题倒计时；自动恢复与作答保持人工确认 | `dsh-task-guardian` |
| **会话导航 · Session Navigator** | [session-navigator](session-navigator/README.md) | 稳定标题配合最近话题、后台 Luna 摘要、悬停详情与最近访问，快速找回会话 | `dsh-session-navigator` |

## 获取代码

```sh
git clone https://github.com/144magixx/dsh-plugin.git
```

macOS 与 Windows 通用；仓库通过 `.gitattributes` 统一使用 LF 换行，两个平台检出的文件逐字节一致。

## 安装

在 DSH 的 **插件 → 添加插件旁的下拉箭头 → 安装第三方插件** 中，填入**具体插件子目录**的绝对路径，例如：

| 系统 | 示例 |
|---|---|
| macOS | `/Users/<你的用户名>/dsh-plugin/side-branch` |
| Windows | `E:\dsh-plugin\side-branch` |

安装成功后启用对应插件。会话摘要和会话搜索同理，把目录换成 `session-summary` 或 `session-search`。

> macOS 获取绝对路径：在终端进入该目录执行 `pwd`，或把 Finder 中的文件夹拖进终端窗口。

**不要把仓库根目录作为插件安装**，根目录没有插件清单。

### 命令行安装（可选）

```sh
dsh plugin --profile desktop add <插件目录或 .tgz 的绝对路径>
dsh plugin --profile desktop remove <npm 包名>
```

`dsh` 不在 PATH 中时，使用 DSH 安装包自带的启动器：

| 系统 | 启动器 |
|---|---|
| macOS | `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"` |
| Windows | `"<安装目录>\resources\runtime\cli\bin\dsh.cmd"` |

### 打包为 .tgz（可选）

仓库不提交构建产物。需要安装包时，在插件目录中执行（两个平台相同）：

```sh
npm pack --pack-destination artifacts
```

## 开发

需要 Node.js 22 及以上。在各插件目录中：

```sh
npm test                    # 单元测试，不依赖 DSH 安装
npm run test:integration    # 集成测试，从本机 DSH 安装包只读提取依赖
```

集成测试会自动查找本机的 DSH `app.asar`：

| 系统 | 自动查找位置 |
|---|---|
| macOS | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`、`~/Applications/…` |
| Windows | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`、`%ProgramFiles%\…`、`D:\DeepSeek Harness\…` |

安装在其他位置时，设置环境变量 `DSH_TEST_ASAR` 指向 `app.asar`：

```sh
DSH_TEST_ASAR="/path/to/app.asar" npm run test:integration          # macOS / Linux
$env:DSH_TEST_ASAR="D:\path\to\app.asar"; npm run test:integration  # Windows PowerShell
```

## 目录约定

```text
dsh-plugin/
├── README.md
├── side-branch/             # 岔路 · Side Branch
│   ├── package.json
│   ├── cordis.patch.yml
│   ├── lib/
│   ├── locale/
│   ├── docs/
│   ├── tests/
│   ├── scripts/
│   └── artifacts/          # 此插件的安装包及验证产物（不提交）
├── session-summary/         # 会话摘要悬浮框 · Session Summary
├── session-search/          # 会话搜索 · Session Search
└── <下一个插件>/
```

新增插件时使用独立子目录、独立包名及插件 ID，避免相互覆盖配置和产物。无需为了共享这个总目录而合并各插件的依赖或构建流程。

## 文档

- 岔路：[使用指南](side-branch/docs/使用指南.md)、[README](side-branch/README.md)
- 会话摘要：[使用文档](session-summary/docs/使用文档.md)、[README](session-summary/README.md)
- 会话搜索：[README](session-search/README.md)、[验收记录](session-search/docs/验收记录.md)
- 会话导航：[README](session-navigator/README.md)、[使用指南](session-navigator/docs/使用指南.md)
