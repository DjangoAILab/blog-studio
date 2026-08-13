---
title: 开发与发布
description: 未上线的改动合并到 dev，由 GitHub Actions 部署到 home-server 不稳定编辑器；稳定环境只走 main 打标签。
---

Blog Studio 有两条互不替代的部署通道。

| 通道   | Git                          | 给谁看                     |
| ------ | ---------------------------- | -------------------------- |
| 不稳定 | `dev`                        | home-server 上的内部编辑器 |
| 稳定   | `main` 上的附注标签 `vX.Y.Z` | 按文档安装的公开环境       |

home-server 编辑器始终是不稳定环境。先在那里看效果，再决定是否晋升。不要把
`dev` 镜像装到需要长期保持的公开主机上。

## 不稳定改动

1. 从 `dev` 拉分支，Pull Request **合入 `dev`**。
2. 合并后，GitHub Actions 在 home-server runner 上构建
   `blog-studio:dev-<sha>`，并只重建 Studio 容器。
3. 到 `https://blog-editor.internal.wj2015.com` 验证旅程。
4. 不对就再向 `dev` 提修复。上一张 `dev-<sha>` 镜像留在主机上，方便回滚。

常用命令是 `gh pr create --base dev`。手动重部署：

```sh
gh workflow run unstable-deploy.yml --ref dev
```

## 稳定发布

只在不稳定编辑器上把目标旅程跑过后才晋升。

1. 从 `dev` 向 `main` 开 Pull Request。
2. `quality` 和 `security` 通过后再合并。
3. 在该 `main` 提交上推送附注且已签名的 `vX.Y.Z` 标签。
4. Release workflow 发布 `ghcr.io/djangoailab/blog-studio` 和 GitHub Release
   产物。
5. 稳定环境按该次 release 的不可变 digest 升级。见[升级与回滚](../upgrading/)。

完整命令、runner 注册和回滚说明在仓库
`docs/guides/development-and-release.md`。
