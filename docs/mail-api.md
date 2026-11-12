# Cloud Mail 接入

助手使用 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 收取学校验证码。Cloud Mail 单独部署，提供邮箱网页、账号和收件 API；助手通过邮箱账号登录，读取该账号的来信。

## 准备邮箱

1. 按 [Cloud Mail 官方部署文档](https://docs.skymail.ink) 部署站点，配置域名、D1、KV 和数据库初始化。
2. 在 Cloudflare Email Routing 中，将收件域名的来信交给 Cloud Mail 对应的 Worker。
3. 创建一个专门用于学校访客系统的邮箱账号，例如 `visitor@inbox.example.com`，设置登录密码。使用这个邮箱完成学校访客资料登记。
4. 从其他邮箱发送一封测试邮件，确认能在 Cloud Mail 收件箱中看到。

已有学校访客账号时，沿用原邮箱地址。Cloud Mail 的邮箱账号和学校访客账号使用同一个地址。

## 配置助手

在项目的 `.env` 中填写站点地址和邮箱：

```dotenv
MAIL_API_URL=https://mail.example.com
MAILBOX_ADDRESS=visitor@inbox.example.com
```

`MAIL_API_URL` 填写站点的 HTTPS 根地址，末尾不带 `/api`。将这个邮箱账号的 **Cloud Mail 登录密码**写入 `.secrets/mailbox-password`。助手会自动登录并刷新到期令牌。

```sh
chmod 400 .secrets/mailbox-password
docker compose up -d --build
```

## 接口与邮件显示

适配代码位于 `agent/mail.mjs`，直接调用 Cloud Mail 的账号和邮件接口：

| Cloud Mail 接口 | 用途 |
| --- | --- |
| `POST /api/login` | 邮箱账号登录 |
| `GET /api/account/list` | 获取当前邮箱 ID |
| `GET /api/email/list` | 获取收件列表和邮件正文 |
| `PUT /api/email/read` | 标记已读 |
| `DELETE /api/email/delete` | 删除邮件 |

助手网页显示最近 50 封来信和文字正文，完整邮箱与附件使用 Cloud Mail 网页查看。邮件保留时间在 Cloud Mail 中设置。

学校登录时，助手等待本次请求之后到达的学校验证码邮件，从 `nottingham.edu.cn` 及其子域来信中提取唯一的六位验证码，最长使用 10 分钟。Cloud Mail 的 AI 验证码提取功能可保持关闭。
