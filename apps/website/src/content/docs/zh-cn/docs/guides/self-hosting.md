---
title: 使用 Docker 自行托管
description: 使用持久挂载、挂载 secret 和可选 Traefik TLS 安装单用户 Studio。
---

## 前置条件

- Linux 上的 Docker Engine 27+ 和 Docker Compose v2；
- 一份可信、已检出的静态网站工作区；
- 网站 lockfile 中锁定的生成器依赖；
- TLS 终止或私有网络。

随附容器以 UID/GID 1000 运行，采用只读根文件系统，删除 Linux capabilities，直接恢复端口只绑定 `127.0.0.1`。最终镜像有意不包含 npm 和 Git：挂载工作区前先安装网站锁定依赖，并在主机执行 Git 管理；工作区中已安装的生成器可执行文件仍可供 Studio 使用。

预览隔离使用 `noexec,nosuid` tmpfs，默认 1 GiB，可用 `BLOG_STUDIO_TMPFS_SIZE` 修改。空间需同时容纳源码树副本和一个生成网站，且不能超过容器内存上限。

## 1. 准备目录和 secret

```sh
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
chown -R 1000:1000 data workspace secrets
```

示例不依赖第三方包，使用内置 command generator，并保持发布禁用；写作、自动保存和预览仍可工作。接入真实网站时，用干净可信的 checkout 替换 `workspace/`，在主机安装其锁定依赖并更新适配器配置。容器路径仍为 `/workspaces/blog`。

Site Agent 需要在 `data/agent-runtime` 中配置 Pi 的 `auth.json`、`models.json` 和 `settings.json`：目录由 UID/GID 1000 拥有且权限 `0700`，三个文件由同一身份拥有且权限 `0600`，Pi 默认模型设为 `glm-5.2`。可选视觉功能使用同一 owner、权限 `0600` 的 `secrets/vision_api_key`；在 `.env` 中把 `BLOG_STUDIO_VISION_API_KEY_PATH` 指向主机文件，并设置 endpoint、`minimax-m3` 模型和容器内 key-file 路径。凭据值绝不能写入 `.env`、YAML 或镜像层。

## 2. 选择访问方式并启动

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:4310/api/health
```

Blog Studio 默认采用适合本机与可信局域网的无密码模式。打开配置的 origin 后，Studio 会自动建立签名浏览器 session；修改操作仍要求同源 CSRF 验证。能访问该 origin 的人都可以编辑。

对于不可信局域网、共享主机、隧道或更广泛的暴露范围，请在启动前于 `.env` 设置 `BLOG_STUDIO_AUTH_MODE=password`，再从可信主机初始化 Owner 密码：

```sh
docker compose run --rm studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite
```

状态和恢复使用同一可信容器入口：

```sh
docker compose run --rm studio \
  node dist/server/cli.js auth status \
  --database /data/blog-studio.sqlite
docker compose run --rm studio \
  node dist/server/cli.js auth reset \
  --database /data/blog-studio.sqlite
```

重置会撤销全部浏览器 session。旧 opaque token 只是可选 v0.1 迁移后备，不属于正常设置流程。

## 3. 加入已有 Traefik 网络

```sh
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  config --quiet
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  up -d
```

以后每次 `up`、`restart`、`pull` 和重建部署都必须使用两个 `-f` 参数。只使用基础文件会让替换容器失去 Traefik 网络和 label，造成本地 health 正常但 HTTPS 返回 `404`。

参考默认值使用 `blog-editor.internal.wj2015.com`、外部网络 `home-server_default` 和 `websecure` entrypoint。其他安装请在 `.env` 覆盖。Traefik 必须已拥有证书和 entrypoint。

`BLOG_STUDIO_ALLOWED_ORIGINS` 必须精确包含浏览器访问的 HTTPS origin。不要使用通配符，也不要把 4310 端口暴露到 LAN 或公网。

## 持久路径

| 主机                     | 容器                      | 内容                    |
| ------------------------ | ------------------------- | ----------------------- |
| `data/`                  | `/data`                   | SQLite 草稿、任务、发布 |
| `data/agent-runtime/`    | `/data/agent-runtime`     | Pi 配置与凭据           |
| `config/blog-studio.yml` | `/config/blog-studio.yml` | 管理员策略              |
| `workspace/`             | `/workspaces/blog`        | 文件、Git、生成器       |
| `secrets/*`              | `/run/secrets/*`          | cookie/Provider secret  |

静态公开网站在请求时不依赖这些挂载或 Studio 可用性。

## 证明容器契约

```sh
BLOG_STUDIO_SMOKE_IMAGE=blog-studio:local pnpm container:smoke
```

隔离 smoke test 检查非 root 身份、只读根文件系统、健康、认证、已确认草稿持久性、Agent 存储、缺少可选视觉配置时的显式状态、干净 SIGTERM 和容器重建。它不会挂载真实网站或调用 Provider。

继续阅读[工作区配置](../../configuration/workspaces/)并执行[备份演练](../../operations/backup-restore/)。
