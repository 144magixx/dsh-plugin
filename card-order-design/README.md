# 右侧卡片拖动排序设计稿

[drag-gpt-image-2.5-high-v1.png](drag-gpt-image-2.5-high-v1.png)：拖动「待办」卡片时的效果。2026-11-06 确认，并追加了以下要求：

- 抽成通用能力，后续加入卡片插槽的新组件自动支持排序。
- 支持隐藏和显示卡片。
- 摘要卡片也参与排序，取消摘要原有的自由拖动。
- 只能从把手拖动。

实现在 [capability-selector](../capability-selector/README.md#卡片排序与显示030)。
