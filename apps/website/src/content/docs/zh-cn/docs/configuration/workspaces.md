---
title: 工作区配置
description: 使用严格的 v1 YAML 和明确的适配器所有权注册受信任网站。
---

Studio 从 `BLOG_STUDIO_CONFIG_PATHS` 加载一个或多个由管理员拥有的 YAML 文件。未知键会被拒绝，防止拼错的安全或服务商选项悄然采用默认值。

## 最小文件系统工作区

```yaml
version: 1

workspace:
  id: personal-blog
  root: /workspaces/blog

generator:
  adapter: hexo

repository:
  adapter: local-git

assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    protectedPrefixes: [static]
    publicBaseUrl: https://blog.example.com/

publish:
  adapter: filesystem
  options:
    directory: /workspaces/blog/.published

cache:
  adapter: none

verification:
  baseUrl: https://blog.example.com
```

## 路径边界

`workspace.root` 解析后必须位于 `BLOG_STUDIO_WORKSPACE_ROOT` 下。资源和文档路径会先规范化，并在解析符号链接后再次检查。绝不要把 `/`、主目录或共享应用目录设为允许的工作区根目录。

## 凭据

配置只保存引用，不保存 secret 值：

```yaml
credentials:
  secretId:
    env: TENCENT_SECRET_ID
  secretKey:
    env: TENCENT_SECRET_KEY
```

由 secret manager 向服务端提供这些变量，它们绝不会返回浏览器。容器中可让配套的 `TENCENT_SECRET_ID_FILE` 和 `TENCENT_SECRET_KEY_FILE` 指向挂载的 Docker secrets；腾讯部署覆盖文件会自动配置它们。Studio 登录和 cookie secret 在所提供的 Compose 部署中使用同样的文件模式。

## 多个工作区

将 `BLOG_STUDIO_CONFIG_PATHS` 设为逗号分隔的配置路径列表。每个工作区 ID 必须稳定，每个根目录都必须处于允许范围内。即使配置多个 Site 工作区，v0.1 仍是单用户产品。

完整顶层要求见生成的[配置参考](../../reference/configuration/)。
