---
title: 接入 Hexo 网站
description: 把 Hexo 作为第一个生成器适配器，同时保留自定义语法、永久链接和旧资源。
---

## 兼容性模型

Hexo 适配器通过包元数据和 `_config.yml` 检测工作区，发现 `_posts` 与 `_drafts`，保留未知 front matter，并使用 Hexo 自身的永久链接和构建行为。它不会把核心产品变成 Hexo 数据库结构。

合成测试和只读参考扫描覆盖中文文件名、原始 HTML、Hexo 标签、自定义 front matter 以及已有且可解析的永久链接。

## 挂载并准备仓库

1. 使用克隆副本，不要操作网站唯一副本。
2. 确认工作树干净且已有备份。
3. 按目标架构使用网站 lockfile 安装精确依赖。
4. 确保 Studio UID 拥有或可写工作区。
5. 在暂存提升成功前保留旧部署路径。

最小生成器配置：

```yaml
workspace:
  id: personal-blog
  root: /workspaces/blog

generator:
  adapter: hexo

repository:
  adapter: local-git
```

生成器命令来自受信任的适配器与工作区，不能在浏览器中编辑。

工作区不变时，Hexo 主题和插件必须生成可复现字节。避免在每个页面附加 `Date.now()` 或随机值的 helper，应改用由内容派生的资源版本。Studio 为沙箱写入和权威文档写入分配同一发布时间，因此使用 `updated_option: mtime` 的 Hexo 网站不会仅因已验证草稿在发布后提交而产生第二次变更。

## 资源迁移策略

不要仅为了符合新的文章范围约定而移动旧资源。保持 `/static/**` 等旧路径受保护且可访问。为新媒体配置 `media/posts/{documentId}/...` 之类的受管前缀，使资源自然按文章分组且不改变旧 URL。

## 进入生产前的验收

- 只读扫描不改变工作区哈希；
- 打开并保存代表性文档后未知 front matter 仍被保留；
- 真实预览使用已安装的主题和插件；
- 生成 URL 清单与此前构建一致；
- 暂存前缀发布能验证其标记；
- 构建、上传、缓存、网络、重启和回滚故障演练通过；
- 提升后旧的公开 URL 仍可访问。

第一次服务商测试不得直接针对生产前缀。
