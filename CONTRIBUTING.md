# 参与开发

## 开始

Fork 或下载项目后，在根目录安装依赖并检查：

```sh
npm ci
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefix agent
npm run validate
```

Node.js 版本见 `.node-version`。浏览器和 Docker 检查见 [测试说明](docs/self-test.md)。

## 修改与 Pull Request

一个 Pull Request 聚焦一个问题，说明修改前后的行为和运行过的检查。修改续约日期、验证码、二维码或学校表单流程时，补充能复现该行为的测试；修改配置和 API 时同步更新示例与文档。

`web/` 是访客助手网页，`agent/` 是 HTTP 服务与学校自动化。邮箱接入和适配代码见 [Cloud Mail 接入](docs/mail-api.md)。

## 反馈问题

Issue 中提供使用场景、复现步骤、预期与实际结果，以及 Node.js / Docker 版本。运行问题可附错误码、北京时间和同步状态；截图和日志使用样例数据。

密钥与运行数据的存放位置见 [SECURITY.md](SECURITY.md)。
