---
title: 备份与恢复
description: 在线备份已确认草稿，并在依赖自动化之前证明恢复有效。
---

## 包含内容

备份归档包含：

- 草稿、任务、发布和事件的在线 SQLite 快照；
- Pi Session JSONL 与原始聊天附件组成的一套有版本运维数据；
- 管理员工作区配置；
- 工作区文件和 Git 元数据，但排除生成的 `node_modules`、`public` 和 `.published` 目录。

Provider 对象和运行时 secret 文件有意分开保存。应在此归档之外配合使用远程 Git、Provider 版本控制和受保护的 secret 备份。`agent-runtime` 中的 Pi 服务商/模型配置和凭据属于运维配置与 secret，应按其他 Provider 凭据相同的访问控制单独备份。

不要只恢复 SQLite 或只恢复 Pi JSONL，否则会遗留孤立的 Session 元数据，或让 transcript identity 不可用。Agent 启动时会把进行中的 turn 标记为中断，绝不重放已完成或此前已批准的修改。

## 创建备份

保持 Studio 运行，以便脚本使用 SQLite 在线备份 API：

```sh
BLOG_STUDIO_BACKUP_PATH=/srv/backups/blog-studio scripts/backup.sh
```

结果是一份原子重命名的 `.tar.gz` 归档和权限为 `0600` 的 SHA-256 sidecar。两者都应异机保存并静态加密。

## 恢复

恢复具有破坏性，而且 Studio 运行时脚本会拒绝执行：

```sh
docker compose stop studio
BLOG_STUDIO_IMAGE=blog-studio:0.1.0 \
scripts/restore.sh --confirm \
  /srv/backups/blog-studio/blog-studio-backup-YYYYMMDDTHHMMSSZ.tar.gz
```

替换前，脚本会验证 checksum、拒绝路径穿越、检查归档格式，并用选定镜像执行 SQLite 完整性校验。此前路径会移到带时间戳的 `.blog-studio-pre-restore-*` 目录。

重新安装网站 lockfile 中的依赖，启动 Studio，然后验证：

1. HTTPS 认证；
2. 最新已确认草稿和发布时间线；
3. 工作区兼容性扫描；
4. 真实生成器预览；
5. 上传数为零的无差异发布计划；
6. 一个活动和一个已归档 Agent Session，包括历史、附件下载、终态以及不存在意外工作区变更。

验证通过前不要删除保留的恢复前目录。

## 复现恢复证明

```sh
BLOG_STUDIO_SMOKE_IMAGE=blog-studio:local pnpm operations:smoke
```

隔离演练会保存版本 1、备份、保存破坏性版本 2、停止服务、恢复版本 1、重建容器，并验证较早正文完全一致。只有目标主机上的演练成功后，才能安排定时备份。
