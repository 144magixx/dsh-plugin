# PI_AI_ERROR 与 Sub2API 错误分类

`PI_AI_ERROR` 是当前 pi-ai 适配器的兜底码，不能把它整体加入重试白名单。同一个码可能包装并发限流、服务故障、认证失败、余额不足、模型配置错误，甚至不支持的异步响应状态。分类需要读取实际保留的错误码、状态与消息。

当前 Harness 0.2.1-rc.3 的 OpenAI Responses 路径可能把流内 `response.failed.response.error` 扁平成 `code: message`，流内 `error` 也可能显示为 `Error Code code: message`。Sub2API 在流已开始后通过 HTTP 200 的 SSE 返回这些错误，因此不能仅凭 HTTP 200 或 `PI_AI_ERROR` 判定成功或未知。

## 已核实的处理范围

| 类型 | 可见代码或可靠信号 | 守护处理 |
|---|---|---|
| 网关并发槽位不足 | `gateway_concurrency_limit`，例如 `Concurrency limit exceeded for user, please retry later` | 临时容量拒绝，可重试 |
| 网关等待队列已满 | `gateway_queue_full` 与 `Too many pending requests, please retry later` | 临时容量拒绝，可重试；这里的 pending 不表示模型请求已被受理 |
| 用户/分组短周期请求频率 | `rate_limit_exceeded` 配合明确的 `user/group requests-per-minute limit exceeded` 等短周期频率证据 | 可重试；保留下来的有效 Retry-After 是最低等待时间 |
| 上游过载/降载 | `server_is_overloaded`、`slow_down`、`overloaded_error` 或 `server_error` 配合明确过载说明 | 可重试；不要求只匹配某一句固定英文 |
| 基础设施临时不可用 | `API_KEY_AUTH_OVERLOADED` + `API key authentication is temporarily unavailable`；`billing_service_error` + `Billing service temporarily unavailable. Please retry later.` | 可重试；认证服务过载和用户认证失败、计费服务故障和用户余额不足分别处理 |
| 明确的流传输中断 | `upstream_http2_stream_error`、`upstream_stream_read_error`、`upstream_stream_truncated`；明确的 connection reset、broken pipe、socket hang up、临时 DNS 或流空闲超时 | 可重试 |
| 可核实的临时 HTTP/服务故障 | 有可信来源的 408、502、503、504，以及有服务端故障证据的 500 | 仍需排除永久和模糊上游错误；不把任意数字或全部 5xx 都当临时 |
| 无有效认证/权限 | 无效、过期、撤销的 key/token，`authentication_failed`、`permission_denied`；分组不允许指定能力等 | 不重试 |
| 余额、支出窗口、订阅/使用额度 | `INSUFFICIENT_BALANCE`、`API_KEY_EXPIRED`、`QUOTA_EXHAUSTED`、`USAGE_LIMIT_EXCEEDED`，明确日/周/月使用或支出限额等 | 不重试；Retry-After 不能覆盖这些否决证据 |
| 参数、模型、上下文、内容与配置限制 | `invalid_request`、模型不存在/不支持、上下文超限、内容政策拦截、地址/证书/长期 DNS 配置错误 | 不重试 |
| 用户取消、工具/业务错误、不确定已受理状态 | 499/context canceled、工具或业务错误、pi-ai 的 pending/deferred 终态 | 不自动重新发送 |
| 其他未知错误 | 无明确临时证据的泛化 `PI_AI_ERROR`、`server_error` 或 `upstream_error: Upstream request failed` | 保守停止，界面和审计记录未接管原因 |

以上是已核实的类型范围，不是兜底错误码可能内容的完整枚举。用户自建部署可以包含其他版本或自定义错误；无法可靠判断的消息不会仅因包含 `retry later` 就被无限重试。永久错误线索先于并发、过载或 HTTP 状态生效。

## 不能混同的情况

- **`rate_limit_exceeded` 不全是临时频率限制。** 官方代码也把 API Key 的 5 小时/1 天/7 天消费窗口、用户平台日/周/月额度映射为相同代码或 429。有的长期窗口也携带 Retry-After，仍须优先识别并停止。API Key 的精确消息为 `api key 5小时限额已用完`、`api key 日限额已用完`、`api key 7天限额已用完`；平台周期消息为 `Daily/Weekly/Monthly usage quota exhausted for this platform.`。对应账户总额 code 包括 `API_KEY_QUOTA_EXHAUSTED`，订阅窗口对外还可使用 `USAGE_LIMIT_EXCEEDED`。
- **`upstream_error` 不全是瞬时网络故障。** 官方传输错误处理可能把代理认证、持久路由/DNS 问题合并成同样的 502 和 `Upstream request failed`。缺少更具体证据时不盲目重试。
- **认证/计费基础设施过载不等于用户无权调用。** 只有已核实的暂不可用 code 与对应消息组合才允许重试；无效凭据、余额和长期使用限额始终优先停止。
- **流内错误的 HTTP 200 不能证明请求成功。** 分类同时支持 SDK 前缀和保留的结构化 JSON 错误。若 pi-ai 已丢失原始 headers/状态，插件不会伪造它们。

## 执行边界

先等待原生 `agent/request-error` 处理链。原生返回重试时，插件不叠加自己的等待；只有当前版本可核实的原生预算耗尽或明确委派后，守护才进行上述分类。默认退避为 30、60、120、240、300 秒，并有抖动；有效服务端等待下限可超过 300 秒。

重试停留在失败模型请求的同一步边界，不重新执行前一步已经得到结果的工具。真实请求循环回归覆盖：先执行一个内存计数器工具，再遇到并发拒绝，之后重试成功；请求 step 轨迹为 `[1, 2, 2]`，工具计数为 `[0, 1, 1]`，工具调用和结果均只一条。

## 来源与版本限制

核对来源为官方 [Wei-Shaw/Sub2API](https://github.com/Wei-Shaw/sub2api)，固定采样版本 `ba81c7fd758e425d67f856d601147ef0c5263d3f`。用户提供的 `/keys` 页面只验证为 Sub2API 的公开 SPA 壳，未读取认证后的 Key 数据；该实际部署的完整版本与自定义改动未能从公共页面确认。本表以公开源码和已见实际返回为证据，不声称已遍历该部署的全部日志。

- [并发与队列满的独立代码和消息](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/handler/concurrency_error_response.go#L12)
- [HTTP 200 流内 response.failed 与错误码映射](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/handler/stream_error_event.go#L45)
- [计费、短周期 RPM 和消费窗口错误映射](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/handler/gateway_handler.go#L2494)
- [API Key 认证服务暂不可用与余额、订阅等拒绝](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/server/middleware/api_key_auth.go#L100)
- [流读取与截断的明确传输错误](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/service/openai_stream_read_error.go#L10)
- [generic upstream_error 可能隐藏的持久故障](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/service/openai_upstream_transport_error.go#L43)
- [流内过载代码改写为 server_error 的路径](https://github.com/Wei-Shaw/sub2api/blob/ba81c7fd758e425d67f856d601147ef0c5263d3f/backend/internal/service/openai_gateway_passthrough.go#L1321)
