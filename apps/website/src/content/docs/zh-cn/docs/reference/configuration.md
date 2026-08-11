---
title: 配置结构 v1
description: 严格 Blog Studio 工作区配置的顶层参考。
---

> 从 `schemas/blog-studio.v1.schema.json` 生成。不要手工修改对应英文生成页；此中文页需与 schema 同步。

## 顶层字段

| 字段                  | 必填 | 类型     | 约束            |
| --------------------- | ---- | -------- | --------------- |
| `version`             | 是   | 常量 `1` | 必须等于 `1`    |
| `site`                | 否   | object   | 拒绝未知键      |
| `resources`           | 否   | object   | 拒绝未知键      |
| `workspace`           | 是   | object   | 拒绝未知键      |
| `generator`           | 是   | object   | 拒绝未知键      |
| `repository`          | 是   | object   | 拒绝未知键      |
| `assets`              | 是   | object   | 拒绝未知键      |
| `publish`             | 是   | object   | 拒绝未知键      |
| `cache`               | 否   | object   | 拒绝未知键      |
| `content`             | 否   | object   | 拒绝未知键      |
| `developmentProfiles` | 否   | object   | 参见嵌套 schema |
| `development`         | 否   | object   | 拒绝未知键      |
| `verification`        | 否   | object   | 拒绝未知键      |

所有对象段都是严格的：未知键会导致配置加载失败。适配器 ID 使用小写 kebab-case。凭据值必须是 `{ env: "VARIABLE_NAME" }` 形式的环境引用，绝不能是字面 secret。

## 完整通用示例

```yaml
version: 1
workspace:
  id: example-blog
  root: /workspaces/blog
generator:
  adapter: command
  options:
    displayName: Example command site
    markers: [.blog-studio-example]
    outputDirectory: public
    siteUrl: https://blog.example.com/
    build:
      command: node
      args: [scripts/build.mjs]
      timeoutMs: 120000
repository:
  adapter: local-git
  options:
    remote: origin
assets:
  adapter: filesystem
  options:
    rootDirectory: static
    managedPrefix: media/posts
    protectedPrefixes: [legacy]
    publicBaseUrl: https://blog.example.com/static/
publish:
  adapter: none
cache:
  adapter: none
content:
  collections:
    posts:
      path: content/posts
      draftPath: content/drafts
      assetScope: media/posts/{documentId}
```

写作和真实预览无需部署目标即可工作。只有目标的验证 URL 和回滚边界准备妥当后，才能把 `publish.adapter: none` 替换为文件系统或远程发布器。

## 可选图片处理

缺少或禁用此段时，文章资源保留原始字节、格式、扩展名和元数据。启用后只影响未来上传。

```yaml
resources:
  imageProcessing:
    enabled: true
    format: webp # original | webp
    quality: 82 # 1..100
    maxWidth: 1920 # 64..16384
    stripMetadata: true
```

机器可读源码是仓库中的 [JSON Schema](https://github.com/DjangoAILab/blog-studio/blob/main/schemas/blog-studio.v1.schema.json)。
