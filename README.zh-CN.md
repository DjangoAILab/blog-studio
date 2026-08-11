# Blog Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Blog Studio 是一款面向文件式网站的自托管发布工作台。它保留 Markdown、Git、现有静态网站生成器和托管技术栈，同时让从写作到生产的完整旅程都能在一个浏览器标签页中完成。

[官方网站](https://djangoailab.github.io/blog-studio/) ·
[English documentation](https://djangoailab.github.io/blog-studio/en/docs/) ·
[简体中文文档](https://djangoailab.github.io/blog-studio/zh-cn/docs/)

![Blog Studio Site Agent — 持久 Session、审批模式和显式 Markdown 上下文](docs/media/site-agent-demo.gif)

> 状态：v0.1.0 已发布。当前分支完成了有证据支撑的 Site-first 和 Site Agent 能力关卡；在正常审查与发布流程完成之前，不会把它称为新的公开 release。

## 产品承诺

- 写作无需等待 Git 或部署。
- 将策略允许的资源附加到文章范围资源库。
- 先即时预览已净化的 Markdown，再按需使用真实网站生成器和主题。
- 在本地提交或远程发布前，准备并审查持久 ChangeSet。
- 可从任意位置打开限定于 Site 的 Agent，保留多个持久 Session，并在有边界的文件与本地 Git 工具内选择逐项审批或 YOLO。
- 保留已有文件、URL 和基础设施。

首个生产集成面向 Hexo、腾讯云 COS、腾讯云 CDN 和 GitHub。核心契约不依赖特定生成器、存储、仓库或部署方案。

## 快速开始

要求：Docker Engine 27+ 和 Docker Compose v2。仓库中的示例工作区没有外部依赖，可在接入真实网站前证明完整写作和预览路径。

```sh
git clone https://github.com/DjangoAILab/blog-studio.git
cd blog-studio
mkdir -p config data/agent-runtime secrets workspace backups
cp deploy/traefik/.env.example .env
cp examples/config/blog-studio.yml config/blog-studio.yml
cp -R examples/workspace/. workspace/
umask 077
openssl rand -base64 48 > secrets/cookie_secret
chmod 700 data/agent-runtime secrets
chmod 600 secrets/cookie_secret
git -C workspace init
git -C workspace config user.name "Blog Studio Quick Start"
git -C workspace config user.email "quick-start@localhost"
git -C workspace add .
git -C workspace commit -m "Initialize example workspace"
```

确保配置的容器 UID/GID 可写 `data/` 和 `workspace/`。随附配置已指向 `/workspaces/blog`，使用通用 command adapter，并在配置真实目标前保持发布禁用。

```sh
docker compose config --quiet
docker compose build
docker compose run --rm studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite
docker compose up -d
curl --fail http://127.0.0.1:4310/api/health
```

初始化命令会读取并确认新的 owner 密码，且不会回显。打开配置的 HTTPS 路由，用该密码登录，编辑发现的 `Example Blog` Site 并选择预览。注册只会在 SQLite 中创建 Site identity 和审计记录。要接入自己的网站，请把示例工作区替换为干净可信的 checkout，在主机安装锁定依赖，配置生成器/发布器适配器，并在注册前审查发现的候选项。

4310 端口只绑定 localhost。浏览器访问请使用随附 Traefik 覆盖文件、其他 TLS 反向代理或私有隧道；不要把明文 HTTP 端口暴露到 LAN 或公网。配置远程发布器前请阅读[完整自行托管指南](apps/website/src/content/docs/zh-cn/docs/guides/self-hosting.md)。

本地生成器预览与 Studio UI 相互独立：Studio 启动配置的开发命令，主机可把预览域名直接路由到其容器端口（约定为 4000--4100）。启用可选入口前，请阅读自行托管指南中的 direct preview 部分。

## 一段话理解架构

Studio 负责浏览器 session、持久草稿快照、任务和发布证据。配置的生成器负责 Markdown 语义和最终网站形态。有版本的适配器负责仓库访问、文章范围资源、发布和缓存失效。release 在隔离工作区中构建，先上传不可变资源，再上传页面，验证公网标记，最后才提交原生草稿提升。公开静态网站永远不依赖 Studio 进程在线。

## 开发与验证

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @blog-studio/studio e2e
corepack pnpm container:smoke
```

支持的开发工具链是 Node.js 22 和 pnpm 11.18.0。CI 还会审计生产依赖，并扫描仓库和最终容器镜像中未接受的 critical 级问题。

## 文档

- [产品定义](docs/product/product-definition.md)
- [架构](docs/architecture/overview.md)
- [路线图](docs/roadmap.md)
- [Site Agent 指南](apps/website/src/content/docs/zh-cn/docs/use/agent.md)
- [AI 辅助生产检查表](docs/checklists/site-agent-ai-assisted-production.md)
- [Site Agent 验证证据](docs/verification/site-agent-runtime-api.md)
- [v0.1 release 检查表](docs/checklists/v0.1.md)
- [v0.2 release 检查表](docs/checklists/v0.2.md)
- [v0.2 实施计划](docs/plans/2026-08-04-blog-studio-v0.2.md)
- [v0.1 实施计划](docs/plans/2026-08-02-blog-studio-v0.1.md)
- [自行托管](docs/guides/self-hosting.md)
- [Sites 与首次运行](docs/guides/sites-and-first-run.md)
- [准备、提交和发布](docs/guides/prepare-commit-release.md)
- [备份与恢复](docs/guides/backup-restore.md)
- [升级与回滚](docs/guides/upgrading.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)
- [v0.2.0 release-candidate notes](docs/releases/v0.2.0.md)
- [v0.2 release-candidate 证据索引](docs/verification/v0.2-release-candidate.md)
- [v0.2 运维证据](docs/verification/v0.2-operations.md)
- [v0.2 真实参考 Site 证据](docs/verification/v0.2-reference-site.md)
- [验证证据](artifacts/verification/release-readiness.md)

## 许可证

Apache-2.0。参见 [LICENSE](LICENSE)。
