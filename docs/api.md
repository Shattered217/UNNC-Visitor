# 访客助手 API

默认地址：`http://设备内网地址:8789`。除健康检查和建立会话外，接口使用助手访问密钥鉴权：

```http
Authorization: Bearer <.secrets/app-key 的内容>
```

网页通过 `POST /api/session` 建立 12 小时 Cookie 会话。使用 Cookie 的写操作需要同源 `Origin` 请求头；快捷指令等程序接入使用 Bearer 请求头。

## 接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | HTTP 进程健康检查 |
| `GET /api/visitor/status` | 今日状态、预约摘要、二维码可用性、同步任务和续约状态 |
| `POST /api/visitor/refresh` | 异步同步学校记录，到达续约条件时执行续约 |
| `GET /api/visitor/qr` | 带白边的官方二维码 PNG |
| `GET /api/visitor/qr?original=1` | 学校原始 PNG |
| `GET /api/config` | 当前配置、学校门岗与原因选项、日期限制 |
| `PATCH /api/config` | 保存预约与续约配置 |
| `POST /api/session` | 以 JSON `{"key":"访问密钥"}` 建立网页会话 |
| `DELETE /api/session` | 退出网页会话 |
| `GET /api/settings` | 收件邮箱、邮箱服务和验证码时效 |
| `GET /api/messages` | 邮件列表 |
| `GET /api/messages/:id` | 邮件正文 |
| `PATCH /api/messages/:id` | 标记已读 |
| `DELETE /api/messages/:id` | 删除邮件 |

写操作使用 `Content-Type: application/json`。刷新、标记已读和删除邮件可传入 `{}`。

## 二维码

成功返回 `image/png`，`X-Visit-Date` 为北京时间的通行日期，`X-QR-Source` 为 `official-page`。

默认图片以白底居中展示学校原码，二维码约占图片宽度的 60%。`original=1` 返回学校原图。二维码对应当天已批准预约，并以最近 10 分钟内的同步结果为准。

| HTTP 状态 | 含义 |
| --- | --- |
| `200` | 返回二维码 PNG |
| `401` | 需要有效助手访问密钥或网页会话 |
| `404` | 当前快照中没有当天已批准的可用预约 |
| `409` | 尚未同步、同步超过 10 分钟，或已跨过北京午夜，需要刷新 |

## 刷新后取图

1. `POST /api/visitor/refresh`，返回 `202` 及异步任务 `job`。
2. 每 3 秒查询 `GET /api/visitor/status`，根据 `job.status` 等待任务完成。
3. `qr_available` 为 `true` 时获取 `GET /api/visitor/qr`。
4. `job.status` 为 `failed` 时显示返回的 `error`；同步成功但 `qr_available` 为 `false` 时查看预约摘要。

`POST /api/visitor/refresh` 运行与后台定时任务相同的流程，包含符合条件的自动续约。

## 续约配置

`PATCH /api/config` 接受以下字段，也可只传需要修改的部分：

| 字段 | 类型 / 可选值 |
| --- | --- |
| `enabled` | 布尔值，自动续约开关 |
| `calendar` | `china` / `weekdays` |
| `leadWorkdays` | 整数，1–10 |
| `hour` | 整数，0–23，北京时间 |
| `dateMode` | `max_span` / `after_expiry` |
| `gate` | `GET /api/config` 返回的门岗 `code` |
| `purpose` | `GET /api/config` 返回的原因 `value` |
| `purposeExtra` | 字符串，最多 300 字符；原因要求补充时填写 |
| `hostEmail` | 接访人的 `@nottingham.edu.cn` 邮箱 |
| `driving` | 布尔值，是否驾车 |
| `plate` | 字符串，最多 20 字符；驾车时填写 |

保存时校验合并后的完整配置，成功返回更新后的 `config`，格式或内容不符返回 `400`。首次配置需先完成学校选项同步。

邮件 ID 使用 Cloud Mail 的数字 ID，列表返回最近 50 封来信。邮箱部署和接口适配说明见 [Cloud Mail 接入](mail-api.md)。
