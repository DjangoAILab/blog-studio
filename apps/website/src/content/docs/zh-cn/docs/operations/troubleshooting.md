---
title: 故障排查
description: 在不危及生产的前提下诊断健康、认证、工作区、预览、发布和恢复故障。
---

## Agent Session 无法恢复

`AGENT_TRANSCRIPT_UNAVAILABLE` 表示 Pi JSONL 缺失、损坏、不兼容或 Session identity 不同。停止 Studio，并从同一代备份恢复 SQLite、`agent-sessions`、`agent-runtime` 和 `agent-attachments`。不要在旧 Session 记录下创建替代 JSONL。

## 重启后 turn 显示 interrupted

这是预期行为。Studio 会终结 queued、running 和 waiting-for-approval 工作而不重放工具。检查持久工具审计和工作树差异；确需继续时再提交新消息。

## 视觉处理失败但上传成功

原图仍保留在附件中。检查 `BLOG_STUDIO_VISION_ENDPOINT`、`BLOG_STUDIO_VISION_MODEL` 和可选 API-key secret，然后在附件上重试。失败的解读绝不会冒充模型输出。

## Agent 编辑与编辑器冲突

编辑器会保护其保存的 source revision。重新加载并比较工作区直接变更，再决定是否重新应用草稿。Agent 编辑、草稿、ChangeSet、本地提交和发布本就是彼此独立的状态。

## 容器始终不健康

```sh
docker compose ps
docker compose logs --tail=200 studio
docker compose config
```

确认两个 secret 文件非空且配置 UID 可读，配置文件挂载到 `/config/blog-studio.yml`，`/data` 可写，并且所有工作区根目录都位于 `/workspaces` 下。

## 登录成功但 API 返回 401 或 403

- `BLOG_STUDIO_ALLOWED_ORIGINS` 必须精确匹配 scheme、host 和 port。
- HTTPS 部署要求 Secure cookie；本地 HTTP smoke test 会明确关闭它。
- cookie secret 变化会使旧 session 失效；清除站点 cookie 后重新登录。
- 不要把 Studio 放在会改写浏览器 Origin 的代理之后。

## 工作区扫描失败

确认挂载路径、UID/GID 权限、生成器配置、包元数据和锁定依赖。解析到允许根目录之外的符号链接会被有意拒绝。修改边界规则前先检查仓库。

## 预览失败或超时

在挂载工作区内使用相同 Node 主版本运行该网站的精确构建。原生依赖必须匹配服务器架构。修复生成器或依赖锁，不要以接受无界进程的方式绕过适配器超时。

## 上传前发布失败

这是最安全的失败类别：生产尚未改变。阅读预检和构建事件，修正源码或生成器，再创建新发布。

## 发布发生回滚

保留结构化事件日志和 Provider request ID，验证公网标记已恢复到上一个 release。Provider 认证、配额或缓存策略错误根因未明确前不要立即重试。

## 恢复脚本拒绝运行

服务必须停止，`.sha256` sidecar 必须与归档相邻，选定镜像必须包含 SQLite 验证工具。拒绝是安全关卡，不要直接把归档解压到活动路径上。

## 公开博客不可用

公开网站不应经由 Blog Studio。应独立诊断其静态主机、对象存储、CDN、DNS 和证书。停止 Studio 不应对公开请求产生任何可观察影响。
