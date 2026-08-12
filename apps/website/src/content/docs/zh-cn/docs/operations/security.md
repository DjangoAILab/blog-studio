---
title: 安全模型
description: 单用户自托管 AI 内容工作台的信任边界和加固要求。
---

## Site Agent 边界

每个 Agent 端点都使用与 Studio 其余部分相同的 owner session、允许来源、CSRF、请求大小、速率和 Site 所有权控制。SSE 在连接建立前完成认证。公开 payload 不包含附件存储键、授权值、已配置 secret 或敏感工具材料。

Agent 运行时没有通用 shell。文件系统操作会规范化并限制在所选 Site 下，同时保护 `.git`；Git 仅提供固定的本地命令面。审批与 YOLO 的唯一区别是是否要求 owner 确认，两者都不允许路径逃逸、自由 Git 参数、hook、alias、远程修改、`git clean` 或全仓库 reset。

Blog Studio v0.1 面向一位可信作者兼管理员，应运行在私有网络或 TLS 反向代理之后，不构成多租户隔离边界。

## 浏览器边界

- 长随机访问 token 用于创建签名的 same-site session。
- 修改 API 要求精确匹配允许的 Origin、签名 CSRF cookie 和对应 CSRF header。
- Cookie 默认启用 Secure；仅本地 smoke test 可关闭。
- 持久存储或缓存凭据绝不会进入浏览器响应。
- 请求正文和资源上传都有显式限制。

## 工作区边界

- 配置由管理员管理且结构严格。
- 解析符号链接后，工作区、文档和资源路径仍必须位于配置根目录下。
- 浏览器输入不能定义任意 shell 命令。
- 生成器进程使用参数数组、超时和环境变量白名单。
- 仓库是可执行输入：挂载前必须检查并信任它。

## 容器边界

随附 Compose 服务以非 root UID/GID 运行，删除全部 capabilities，设置 `no-new-privileges`，采用只读根文件系统，并只挂载明确的可写数据/工作区路径。应用端口绑定 localhost；Traefik 通过外部 Docker 网络访问容器。

## Secret 处理

认证和 cookie secret 以文件挂载。Provider secret 应来自 secret manager 或环境变量引用。对单 owner 自托管安装，也可使用仓库外专用文件，但必须由运行时管理员拥有、权限为 `0600`、只读挂载，并受主机和备份访问控制保护。不要保留下载的凭据 CSV，也不要提交 `.env`、secret 文件、Provider 日志、支持包或备份归档。

如登录 token 泄露，替换其文件并重建容器。轮换 cookie secret 会使所有 session 失效。不要仅因固定日历周期而轮换健康的 Provider key；应在疑似暴露、身份或权限边界实质变化、Provider 要求或密码学弃用时轮换，并采用最小权限和重叠切换流程。普通安全审查应复核范围和用量，而不是签发新凭据。

## 公开网站独立性

Studio 停机只会阻止编辑和发布，不影响静态公开网站请求。绝不要让公开网站流量经过 Studio 容器。

v0.1 治理关卡落地后，安全问题应遵循仓库 `SECURITY.md` 流程；不要在公开 issue 中披露凭据或私有网站内容。
