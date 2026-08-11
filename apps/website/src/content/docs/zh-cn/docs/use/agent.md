---
title: 使用 Site Agent
description: 使用持久、限定于 Site 的 AI Session，同时明确文件、Git、预览和发布边界。
---

Site Agent 是既有 Blog Studio Web 应用中的 AI 辅助生产界面。它跟随选定的 **Site**，而不是某个页面或文章。打开内容、预览、ChangeSet、Site 管理或设置不会替换活动 Session；切换 Site 才会。

Agent 直接操作编辑器和配置生成器使用的同一磁盘工作区。预览 Provider 只会启动或指向预览 URL，不托管 Agent 运行时，也不复制工作区。

## 创建和管理 Session

可从任意应用页面打开 **Agent**。按 Site 需要创建多个独立 Session，并在面板中重命名、切换、归档或恢复。Session 列表由 URL 中的显式 `siteId` 所有。活动选择按浏览器标签页记忆，因此两个标签页可关注不同 Session，而不会把它们移到其他 Site。

Pi JSONL 是唯一聊天 transcript。SQLite 只保存 Site 关联、显示/归档状态、偏好、附件引用、turn、event 和审批/审计索引。重启 Studio 会恢复同一 Pi identity；缺失或损坏的 transcript 会产生可操作错误，绝不会静默替换。

## 附加只属于一条消息的上下文

文章页的 composer 会建议当前文章；未保存的编辑器 buffer 可以显式附加。在 Markdown 源码模式中，选择范围并点击“附加选区到 Agent”，加入带行号 chip。同一类型化机制也支持预览错误、diff、ChangeSet 和文件引用。

发送前检查或移除每个 chip。其实体内容只写入该用户消息一次并保留在 Session 历史中，不是隐藏状态，也不会注入下一条消息。这些引用帮助模型，但绝不会缩小其覆盖整个 Site 的文件系统权限。

## 选择审批或 YOLO

有效模式始终显示在 composer 上方：

- **每次审批**允许立即读和搜索，但每次文件或 Git 修改都要等待 owner 批准持久工具请求。
- **YOLO**只跳过该提示；认证、所有权、类型化工具、路径检查、Site writer lock、审计记录和 secret 脱敏仍然有效。

YOLO 可以永久删除未跟踪文件，Blog Studio 不为这种情况保留特殊垃圾箱。使用本地 Git 恢复已跟踪文件，并在发布前检查 status 和 diff。有边界的当前 turn 恢复工具只恢复 Agent 产生的状态，并拒绝覆盖后来的人类工作。

## 文件与 Git 权限

Agent 可在权威 Site 根目录下读、搜、创建、编辑、移动和删除。绝对路径、`..` 逃逸、符号链接逃逸和 `.git` 内部都会被拒绝。没有通用 shell。Git 只提供固定本地操作：status、diff、有边界的 log/show、单个 tracked path 恢复和可归因于当前 turn 的反转。任意参数、hook、alias、配置修改、remote、`git clean` 和全仓库 hard reset 都不是工具。

每个 Site 的一个 writer lock 会串行化所有 Session 修改；读取和其他 Site 保持独立。Agent 直接编辑可能让打开的编辑器 revision 过期；保存或准备 ChangeSet 前必须处理显示的冲突。

Agent 编辑只是工作树变更。ChangeSet 是独立审查制品，本地 Git commit 又是下一项显式操作，发布仍是单独触发、由人审查的 release 工作流。Agent 不能发布。

## 附加文件并使用视觉模型

Composer 上传存储在 Blog Studio 应用数据中、位于所有 Site 根目录之外。文件有大小限制，经过 MIME sniff、净化、哈希，并绑定到所属 Site Session。发送图片会保留原附件，并让单独配置的视觉适配器解读。视觉失败时，消息和原图仍保留，面板可重试且不会声称解读成功。

附件随 Session 保留，归档后亦然，并纳入运维备份。当前产品支持归档和恢复，但没有破坏性删除 Session，因此不会按时间或隐式清理附件。元数据写入失败会立即删除刚写入的孤立文件；其他情况下保留行为是确定的，且不与文章资源清理绑定。

只有 Agent 显式调用 `import_attachment` 修改工具并提供目标时，附件才会进入 Site；审批或 YOLO 以及同一 Site lock 都适用。文章资源上传是另一流程，参见[管理文章资源](../assets/)。

### 主语言模型

Blog Studio 直接使用 Pi 原生 Provider 和模型配置，而不再翻译为第二套应用专用 schema。运行时目录默认位于 Studio SQLite 旁的 `agent-runtime`，可用 `BLOG_STUDIO_AGENT_RUNTIME_DIRECTORY` 覆盖。在其中配置 Pi 的 `auth.json`、`models.json` 和 `settings.json`，使内置 Provider、兼容代理、模型选择、压缩和未来 Pi 升级沿用同一兼容路径。该目录位于 Site 外，Agent 文件工具无法访问。

主模型必须支持工具调用。生产 CLIProxy 在 `models.json` 中配置为 Anthropic Messages-compatible Provider，由 `settings.json` 选择 `glm-5.2`。凭据仅放在权限 `0600` 的 `auth.json`，绝不能放入 Site YAML、Compose 环境值或聊天上下文。运行时目录须由 Studio UID/GID 拥有且权限 `0700`；三个 JSON 文件由同一身份拥有且权限 `0600`。

OpenAI-compatible 视觉端点配置如下：

```sh
BLOG_STUDIO_VISION_ENDPOINT=http://cliproxy.internal/v1/chat/completions
BLOG_STUDIO_VISION_MODEL=minimax-m3
BLOG_STUDIO_VISION_API_KEY_FILE=/run/secrets/vision_api_key
```

也接受 `BLOG_STUDIO_VISION_API_KEY`，但随附 Compose 契约使用 owner-only、权限 `0600` 的主机文件，只读挂载到上述路径。将 `BLOG_STUDIO_VISION_API_KEY_PATH` 设为该主机文件，绝不要把内容放进 `.env`。未配置 endpoint 时，图片仍可上传，视觉状态会明确显示未配置。

## 取消、重连和恢复

Turn 会展示 queued、running、waiting-for-approval、completed、failed、canceled 和 restart-interrupted 状态。取消会保留已完成工具审计，停止剩余模型工作，释放 writer lock，且绝不报告成功。事件流从持久 cursor 重连或返回明确终态快照，因此消息和工具事件不会重复。

升级前，将 SQLite、`agent-sessions` 和 `agent-attachments` 作为同一有版本数据集备份；Pi 运行时配置按其他运维 secret 单独保护。参见[备份与恢复](../../operations/backup-restore/)和[故障排查](../../operations/troubleshooting/)。
