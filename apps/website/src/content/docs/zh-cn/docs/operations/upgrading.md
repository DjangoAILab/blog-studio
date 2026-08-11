---
title: 升级与回滚
description: 独立升级 Studio、保留 Traefik 路由，并在不触碰公开网站的情况下回滚。
---

Blog Studio 将权威内容保存在挂载工作区中，将运维状态保存在 SQLite。应固定不可变镜像 digest，并独立于生成的公开网站升级 Studio 容器。

## 升级前

1. 阅读发布说明并确认配置兼容性。
2. 提交或以其他方式备份全部权威工作区变更。
3. 运行 `scripts/backup.sh`，并把归档和 checksum 复制到异机。
4. 记录当前镜像 digest 和精确 Compose 文件集合。
5. 验证健康状态和一次已认证的编辑/预览旅程。

## 重建 Studio

把 `BLOG_STUDIO_IMAGE` 设为 release 的 `container-digest.txt` 中的不可变引用。Traefik 安装必须保留两个 Compose 文件：

```sh
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  pull studio
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  up -d --no-deps studio
```

确认容器健康、HTTPS 可访问、认证正常、浏览器重载后自动保存有效、真实预览有效。Studio 停止或重启期间，生成的公开网站必须继续可访问。

## 回滚

恢复此前不可变镜像引用，并用相同 Compose 文件重建 Studio。镜像回滚不会修改公开网站或权威工作区。如持久数据发生不兼容变化，先停止 Studio，再按 checksum 验证的[备份与恢复](../backup-restore/)流程操作，之后才能启动旧镜像。

Provider release 回滚是发布时间线中的另一项操作。应用升级过程中，绝不要手工替换已填充的 COS 前缀，也不要改变既有公开 URL 路径。
