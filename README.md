# UNNC Visitor

适用于没有门卡、但需要经常进校的人用的宁波诺丁汉大学访客助手。

研零提前进组、公司工程师到校做项目、外包人员驻校，常常都靠访客预约进出校园。这个项目把反复登录、收验证码、续约和找门禁码这些事放到一起：服务在后台维护预约，进校时打开网页，或者点一下 iPhone 快捷指令，就能查看当天的官方门禁二维码。

## 适合谁

- **研零（研0） / 提前进组的同学**：还没拿到校园卡，已经需要每天进实验室。
- **公司工程师 / 合作项目人员**：经常到校联调、部署设备或开展项目。
- **外包 / 驻场人员**：需要持续进校工作，通过访客预约安排通行。
- **其他经常到校、暂时没有门卡的人**。

一套部署对应一个访客账号，预约使用自己的访客资料和学校接访人邮箱。

## 已实现的功能

- **自动登录**：保留学校登录态，到期后自动请求邮件验证码，从 Cloud Mail 收件箱取码并完成登录。
- **今日门禁码**：从学校通行页面读取当天已批准预约的官方二维码，网页直接展示；手机预览增加白边，原码像素保持不变。
- **自动续约**：默认提前 3 个中国法定工作日，在北京时间 09:00 发起续约，包含节假日和调休；支持最大跨度和到期后接续两种日期模式。
- **网页配置**：设置门岗、来访原因、接访人邮箱、驾车与车牌、续约时间和提前天数，门岗与原因选项从学校系统读取。
- **预约与邮件集中查看**：查看已批准、待审批等预约状态，阅读学校来信、复制验证码、标记已读和删除邮件。
- **iOS 快捷指令**：通过 API 获取二维码 PNG，一键快速查看。
- **Telegram 通知**：本次续约的全部可预约日期获批后，发送包含日期范围的消息。
- **Docker 部署**：支持 Linux，登录态、配置及续约记录随数据目录持久保存。

## 使用效果

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>iPhone 快捷指令</strong><br><br>
      <img src="https://github.com/user-attachments/assets/c6c09ee6-8ef1-4ade-b83a-c0feb2d218a4" alt="在 iPhone 控制中心运行 UNNC 门禁码快捷指令" width="280">
    </td>
    <td width="50%" valign="top">
      <strong>Telegram 续约通知</strong><br><br>
      <img src="https://github.com/user-attachments/assets/e2cdcbaf-26e7-43c8-9b0a-cebee7d1e352" alt="续约全部获批后，Telegram 通知本次预约日期范围" width="402">
    </td>
  </tr>
</table>

## 日常怎么用

1. 首次启动时，助手登录学校访客系统并同步预约；已有批准记录会自动带出门岗、来访原因和接访人。
2. 在网页的“可选配置”里确认预约信息和续约安排。
3. 后台默认每 5 分钟同步一次，到设定时间提交续约，跟踪接访人审批进度。
4. 进校时查看当天门禁码；启用 Telegram 后，续约全部获批会收到通知。

## 部署

需要一台能访问 [学校访客系统](https://visitor.nottingham.edu.cn/client/) 的 Docker 设备，以及一个自建 [Cloud Mail](https://github.com/maillab/cloud-mail) 邮箱。访客系统的境外连接似乎受限，建议部署在能直接访问学校系统的内网或国内设备上。

### 1. 准备配置

在项目根目录执行，需要 Docker Compose 和 OpenSSL：

```sh
sh scripts/setup.sh
```

脚本创建 `.env`、数据目录和助手访问密钥。按 [Cloud Mail 接入](docs/mail-api.md) 部署邮箱，将该邮箱账号的登录密码保存到 `.secrets/mailbox-password`。

### 2. 填写收件服务

编辑 `.env`，填写 Cloud Mail 的站点地址和学校访客账号对应的邮箱：

```dotenv
MAIL_API_URL=https://mail.example.com
MAILBOX_ADDRESS=visitor@inbox.example.com
```

在学校访客系统完成该邮箱对应的访客信息登记，并准备接访人的学校邮箱。

### 3. 启动助手

容器以 UID 1001 运行。以 root 准备目录权限并启动：

```sh
chown -R 1001:1001 data .secrets
chmod 700 data .secrets
chmod 400 .secrets/app-key .secrets/mailbox-password
chmod 600 .env
docker compose up -d --build
docker compose ps
```

打开 `http://设备内网地址:8789`，用 `.secrets/app-key` 的内容登录。首次同步通常需要 30–120 秒，完成后可查看预约和今日门禁码。

端口、Telegram、日期策略、更新与备份见 [部署与配置](docs/deployment.md)。

Telegram 直接在同一个 `.env` 中填写，两项留空时关闭通知：

```dotenv
TELEGRAM_BOT_TOKEN=你的BotToken
TELEGRAM_CHAT_ID=你的数字聊天ID
```

## iPhone 一键查看门禁码

在“快捷指令”中新建指令：

1. 添加“获取 URL 内容”，方法为 GET，地址为 `http://设备内网地址:8789/api/visitor/qr`。
2. 添加请求头键名为 `Authorization`，值为 `Bearer 你的助手访问密钥`。（如Bearer abcd1234）
3. 添加“显示”，展示上一步返回的图片。

默认返回带白边的二维码 PNG，原始图片使用 `/api/visitor/qr?original=1`。自动刷新和其他接入方式见 [API 文档](docs/api.md)。

## 开发

需要 Node.js 24+：

```sh
npm ci
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefix agent
npm run validate
```

`validate` 运行 TypeScript 检查、鉴权与日期测试、助手测试。GitHub Actions 还会构建 Docker 镜像，并在镜像内运行 Chromium 浏览器检查。

| 目录 | 内容 |
| --- | --- |
| `agent/` | 内网 HTTP 服务、Playwright 学校自动化、二维码和 Telegram |
| `web/` | 访客助手网页 |
| `src/renewal.ts`、`src/visitor-model.ts` | 日期策略、预约与通行状态 |
| `src/auth.ts` | 访问密钥与网页会话鉴权 |
| `calendar/` | 中国法定节假日与调休数据 |
| `test/`、`agent/test/` | 单元、接口与浏览器测试 |

测试方法见 [测试说明](docs/self-test.md)，参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)。节假日数据来自 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)，来源与许可证见 [第三方说明](THIRD_PARTY_NOTICES.md)。
