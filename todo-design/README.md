# 待办插件设计稿

仿 iPhone「提醒事项」的 DSH 待办插件。设计稿已于 2026-11-06 确认，暂未开发。

## 设计稿

| 文件 | 内容 |
|---|---|
| [page-gpt-image-2.5-high-v1.png](page-gpt-image-2.5-high-v1.png) | 方案 A：左侧导航「待办」完整页面 |
| [sidebar-card-gpt-image-2.5-high-v1.png](sidebar-card-gpt-image-2.5-high-v1.png) | 方案 B：右侧栏「待办」速览卡片 |

模型 `gpt-image-2.5-sunburst`，`quality: high`。提示词见同名 `*-prompt.txt`，请求元数据见同名 `.json`，重新出图用 `generate.mjs`。

## 已确认

- 入口：完整页面和右侧栏卡片都做。
- 视觉：按现有设计稿。
- 首版功能：
  - 智能列表（今天、计划、全部、旗标、已完成）和自定义「我的列表」
  - 截止时间与旗标，逾期时间标红
  - 提醒事项关联 DSH 会话，点击标签跳转
  - 到期时在 GUI 内弹出提醒
  - Agent 可通过工具读写待办

## 实现时要统一的细节

- 「新提醒事项」的加号：页面用描边圆圈，卡片用实心圆圈，实现时统一成一种。
