# 上行瘦身 · Upload Slim

上行带宽慢时，DSH 每轮都会把对话里所有图片重新上传一遍。DSH 默认按每张最多 2048×2048 像素、约 1 MB 发图，一次请求可以带到 20 MB 图片；在 80 KB/s 的上行下，单轮光上传就要几分钟。

本插件一键调低 DSH 自带的每张图片请求参数，并提供：

- **开关**：开启时写入所选模型路由的图片参数；关闭时按记录逐项恢复（原来没设的字段会 unset 回继承值）。
- **策略**：保真 / 均衡（推荐）/ 省流 / 极省，四档预设。
- **真实前后对比**：从当前和最近会话里取真实图片，用 DSH 自己的请求图片流水线（`attachments.readImageRequest`）生成每档版本，显示尺寸、字节、请求内体积和按你的上行速度估算的每轮上传时间；左右并排、同步滚动、可放大。
- **告诉 Agent**：开启时，只在已瘦身路由的系统提示词里说明图片是有损预览，看不清时去 `Normalized copy` 原图裁剪局部查看。
- **会话头部状态标**：开启时显示“瘦身·均衡”，点开进入设置页。

## 它改了什么

只改 `@deepseek-ai/dsh-llm-pi-ai` 每条路由的两个字段，均为 volatile 配置，热生效、不重启：

| 策略 | `requestImagePixelBudget` | `requestImageMaxBytes` |
|---|---|---|
| DSH 默认（关闭时） | 4,194,304（2048×2048） | 1 MiB |
| 保真 | 2,359,296（≈2048×1152） | 400 KiB |
| 均衡 | 1,440,000（≈1600×900） | 200 KiB |
| 省流 | 921,600（≈1280×720） | 120 KiB |
| 极省 | 518,400（≈960×540） | 60 KiB |

DSH 按像素预算缩小，再用 JPEG 85→75→60（有透明通道时用 WebP）编码到字节目标以内；字节目标是软目标，压不下去时取最小的一档，不会再缩尺寸。

**刻意不改** `maxRequestImageBytes` / `maxRequestImages` / `imageOffloadCountQuantum`：调低它们会让 DSH 把旧图永久替换成占位文字（`image/offload` 事件写入会话日志），关闭插件也找不回来。

## 注意

- 切换开关或策略后，所有图片的请求版本都会变，进行中会话下一轮的提示词缓存会失效一次，之后恢复命中。
- 写入的是 profile 的 `cordis.patch.yml`（经 `ctx.settings`，带 revision 校验）。插件只在用户点击时写配置，不在启停插件时自动写；**卸载前请先关掉开关**，否则路由会保留瘦身参数（不影响使用，只是图片仍按瘦身档上传）。
- 如果别处改了这些字段，页面会提示“被别处改过”，可一键重新应用。
- 本插件不做 gzip 等传输层压缩：DSH 没有修改请求体的扩展点。

## 安装

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /Users/<你>/dsh-plugin/upload-slim
```

或在 DSH 插件页“安装第三方插件”填入本目录（Windows 同样用插件页安装，或运行安装目录下 `resources` 里的 `dsh` CLI；Windows 路径未在真机上验证）。安装后在左侧导航打开“上行瘦身”。

兼容性：不声明 `engines.dsh`，在 DSH 0.2.1 与 0.2.2 上都已用对应版本的真实 cordis / storage / system-prompt 跑过集成测试。0.2.1 的提示词装配上下文不带 `modelSelection`，插件改从装配结果的 `variables.provider` 读取当前路由，所以“图片是压缩预览”的说明在两个版本上都会写入已瘦身路由的系统提示词。

## 开发

```sh
npm run check   # 语法检查
npm test        # 单元测试（core / service / client），不依赖 DSH
npm run test:integration   # 用本机 DSH 的真实 cordis / storage / system-prompt 挂载插件：开关、提示段、排空/503/恢复、反复启停
PREVIEW_IMAGES=/path/to/pngs node tests/browser/build-preview.mjs   # 浏览器预览：真实 client.js + DSH 自带 sharp 按同一算法编码的各档图片
# Windows PowerShell：$env:PREVIEW_IMAGES = 'C:\path\to\pngs'; node tests/browser/build-preview.mjs
# 集成测试默认读本机已安装的 DSH app.asar；用 DSH_TEST_ASAR 指向别的版本（macOS：DSH_TEST_ASAR=/path/app.asar npm run test:integration；PowerShell：$env:DSH_TEST_ASAR = 'C:\path\app.asar'; npm run test:integration）
```

预览产物在 `tests/.test-data/preview/`（不提交），用任意静态服务器打开 `index.html`。

服务端依赖的宿主服务：`connection`、`storageDomain`（必需）；`settings`、`attachments`、`sessionQuery`、`systemPrompt`（可选，缺失时对应功能降级并在页面提示）。所有 HTTP 交互都是有限的 JSON 或图片响应，不持有长连接，不阻塞宿主更新排空。
