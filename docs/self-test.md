# 测试说明

## 本地检查

在项目根目录使用 Node.js 24+：

```sh
npm ci
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefix agent
npm run validate
```

也可单独执行：

| 命令 | 内容 |
| --- | --- |
| `npm run check` | TypeScript 类型检查 |
| `npm test` | 鉴权、预约状态和续约日期测试 |
| `npm run test:agent` | 助手 HTTP、Cloud Mail 接入、二维码、学校响应解析及 Telegram 测试 |
| `npm run test:browser` | 两项 Chromium 浏览器回归检查 |

普通助手测试跳过浏览器检查；运行 `test:browser` 前安装匹配的 Chromium：

```sh
cd agent
npx playwright install --with-deps chromium
cd ..
npm run test:browser
```

## Docker 与 CI

GitHub Actions 在推送和 Pull Request 时执行类型与测试检查、Docker 镜像构建，并在镜像自带的 Chromium 中运行全部助手测试。

本地复现：

```sh
docker build -t unnc-visitor-agent:test .
docker run --rm --init \
  -e RUN_BROWSER_TESTS=1 \
  -v "$PWD/agent/test:/app/agent/test:ro" \
  unnc-visitor-agent:test npm test
```

## 覆盖的功能

| 功能 | 检查内容 |
| --- | --- |
| 访问鉴权 | Bearer、签名会话、同源写操作 |
| 日期调度 | 北京时间、法定节假日与调休、提前天数、续约时刻 |
| 预约范围 | 最大跨度、到期接续、学校禁约日期、待审批和重复申请判断 |
| 官方二维码 | 原图解码匹配、加白边后原码像素一致、跨日和过期状态 |
| 学校登录 | 英文邮箱标签与验证码按钮、登录后跳转 |
| Cloud Mail | 邮箱登录、令牌刷新、收件时间、邮件操作和本次验证码筛选 |
| 学校表单 | 含签名查询参数的提交地址识别和网络拦截 |
| Telegram | 可选配置、全部日期获批的触发条件、通知记录、发送失败重试 |

测试中的邮箱、身份及二维码均为固定样例。

## 学校表单联调

在已登录并保存预约配置的 Docker 环境中，等待当前同步结束后执行：

```sh
docker compose exec visitor-agent node dry-run.mjs
```

该命令读取真实学校表单、填入当前配置并校验提交内容，在网络提交边界中止请求。成功输出包含 `validated: true` 和 `submission: "aborted"`。正式自动续约和接访人审批的进度通过网页或 [状态 API](api.md) 查看。
