---
title: 腾讯云 COS 与缓存服务商
description: Provider 契约、部署形态以及真实腾讯云发布前必须通过的暂存关卡。
---

:::caution[集成状态]
COS 发布/存储和腾讯云 CDN/EdgeOne 客户端已接入生产 Studio 注册表，并有单元测试和故障注入测试覆盖。参考账号已通过隔离暂存和只读生产基线采用。普通生产内容写入仍属于独立、明确设闸的权限阶段。
:::

## 运行时凭据

YAML 只包含环境变量引用。虽然支持直接环境值，但随附腾讯云 Compose 覆盖文件使用 Docker secret 文件，避免凭据出现在工作区配置中：

```sh
umask 077
printf '%s' "$TENCENT_SECRET_ID" > secrets/tencent_secret_id
printf '%s' "$TENCENT_SECRET_KEY" > secrets/tencent_secret_key

docker compose \
  -f docker-compose.yml \
  -f deploy/tencent/docker-compose.override.yml \
  up -d
```

对于 `env: TENCENT_SECRET_ID`，Studio 先读 `TENCENT_SECRET_ID`；若不存在，再读 `TENCENT_SECRET_ID_FILE` 指向的文件。浏览器不会收到值或文件路径。

使用专用可编程 CAM 子用户。不要复用主账号 key 或策略未经审计的 CI key。复制并编辑仓库的 [`cam-staging-policy.example.json`](https://github.com/DjangoAILab/blog-studio/blob/main/deploy/tencent/cam-staging-policy.example.json)，挂载前替换账号、bucket、region、host 和运行前缀。已有生产部署先使用独立的 [`cam-production-adoption-policy.example.json`](https://github.com/DjangoAILab/blog-studio/blob/main/deploy/tencent/cam-production-adoption-policy.example.json)：它能盘点生产并写入保留状态和精确发布标记，但不能覆盖或删除普通公开对象。采用后的差异获批后，用 [`tencent-production-writer-policy.mjs`](https://github.com/DjangoAILab/blog-studio/blob/main/scripts/tencent-production-writer-policy.mjs) 为独立 writer identity 生成新策略。仓库中的 [`cam-production-writer-policy.example.json`](https://github.com/DjangoAILab/blog-studio/blob/main/deploy/tencent/cam-production-writer-policy.example.json) 仅作示例；应从已部署配置生成，不要手工编辑其受保护资源。

COS resource ARN 中的 `/` 保持字面值，但 `cos:prefix` 条件值中的每个斜杠都要编码为 `%2F`。腾讯云用 URL 编码的 `prefix` 请求参数匹配该条件，因此看似正确的字面斜杠条件可能拒绝预期的 `GetBucket` 盘点。仓库策略 smoke test 固定了这一差异；参见腾讯云 [`cos:prefix` 条件示例](https://cloud.tencent.com/document/product/436/71307)。

暂存策略有意不授予 bucket 配置、创建、账号 bucket 列举或生产前缀对象权限。其 COS 操作与 Studio SDK 调用相符：

- 用受 `cos:prefix` 限制的 `GetBucket` 分页盘点；
- 用 `GetObject`、`PutObject`、`DeleteObject` 验证、提升、保留回滚状态和回滚；
- classic CDN 使用 `PurgeUrlsCache`、`PurgePathCache`、`DescribePurgeTasks`。

腾讯云当前 CAM 能力表把三个 CDN API 归为资源必须为 `*` 的操作级 action，策略无法再限制到某条 URL 路径，[`PurgeUrlsCache` CAM 条目](https://cloud.tencent.com/document/product/598/98110)确认了这一边界。因此必须采用补偿控制：

1. 子用户只拥有列出的 action；
2. `verification.baseUrl` 固定为预期 host 和暂存路径；
3. secret 仅通过只读 Docker secret 文件部署到 Studio 容器；
4. 授予生产前缀 COS 权限前轮换或删除暂存 key；
5. 只有服务器出口地址经验证稳定时，才可按源 IP 进一步限制 CAM 策略。

示例是策略模板，不证明腾讯云已经接受策略。启用生产前必须在 CAM 验证并运行暂存关卡。

## COS 发布模型

发布器基于最后保留的 release manifest 规划，不会为每个生成文件发送远程 HEAD。上传并发有界，只重试可重试失败，并等待每个对象操作。

先提升资源，再提升页面。标记和精确清单共同构成验证与回滚边界。Provider 删除仅限配置的受管目标，受保护旧前缀不归其所有。

## 采用已有部署

已有内容的 bucket 根绝不视为空 Blog Studio 目标。要在不改变旧 URL 的情况下管理它，需显式选择：

```yaml
publish:
  adapter: tencent-cos
  options:
    targetPrefix: /
    allowBucketRoot: true
    allowBaselineAdoption: true
    statePrefix: _blog-studio
    protectedPrefixes:
      - static
```

随后 Studio 禁用普通发布，直到管理员确认“adopt existing deployment”。采用会分页盘点受管 COS 目标，排除 Blog Studio 状态前缀，下载每个对象，并记录精确内容哈希、大小、媒体类型和缓存策略。只有完整盘点成功后才写 release marker 和保留基线状态；公开网站字节不会被改写。

目标已有 Blog Studio 标记时操作会拒绝。部分采用或此前受管的目标必须从保留状态恢复，不能静默重新采用。采用后，第一次普通发布针对已验证基线规划，因此未变旧路径保持不动，回滚也有精确边界。

采用与普通发布必须是不同权限阶段。生产采用策略可 `GetObject` 整个受管目标，但公开 `PutObject`/`DeleteObject` 只允许 `blog-studio-release.json`；保留清单和回滚元数据仅限配置的状态前缀。采用只让精确标记 URL 失效，因此只授予 URL refresh，不授予目录 refresh。检查第一次只读差异后，若提升获批，再用单独审查的生产策略替换；不要原地扩展采用身份。

## 生成生产 writer 策略

生成器从部署 YAML 派生 region、bucket、目标/状态前缀和全部 `publish.options.protectedPrefixes`，加入 COS 发布器所需的最小公开/状态对象权限，并对每个受保护对象及其后代明确拒绝写入/删除。CAM 会先执行匹配的显式 deny，为 release planner 与 publisher 之后提供第二道边界；参见[策略评估顺序](https://cloud.tencent.com/document/product/598/10605)和 [COS 对象资源语法](https://cloud.tencent.com/document/product/436/18023)。

```sh
policy_directory=$(mktemp -d)
chmod 700 "$policy_directory"
node scripts/tencent-production-writer-policy.mjs \
  --config /absolute/path/to/blog-studio.production.yml \
  --app-id 1250000000 \
  --output "$policy_directory/production-writer-policy.json"
corepack pnpm policy:smoke
```

生成策略有意做到：

- 仅允许列举/读写/删除配置的公开目标和保留状态前缀；
- 受保护内容可读，但拒绝覆盖和删除；
- 允许 URL purge 和 purge-task 观察，不允许目录 purge；
- 不授予 bucket 配置/创建、账号 bucket 列举、EdgeOne 或通配 COS action。

创建无控制台登录、无组的 API-only 子用户，只挂载该策略，并在安装 key 前回读活动策略 JSON。不要针对真实受保护对象做破坏性权限探测。用唯一临时键证明状态前缀 put/get/delete，受保护显式 deny 则依赖策略回读和仓库 evaluator。

完整授权、激活、发布、停止和回滚流程见[生产阶段 B 检查表](https://github.com/DjangoAILab/blog-studio/blob/main/docs/checklists/production-phase-b.md)。

## CDN 与 EdgeOne 缓存模型

缓存适配器接收精确 URL 和目录路径，选择配置的腾讯云产品，遵守批量限制，记录 request ID 并轮询任务状态。API 接受后仍须验证公网标记。

如果发布目标已有隔离 URL 根，大型网站不应为每个生成页面和可变资源消耗一个 URL purge 配额。请明确配置边界：

```yaml
cache:
  adapter: tencent-cdn
  options:
    directoryPurgeRoot: https://blog.example.com/__blog-studio-staging/v0.1/
```

提交一次目录 purge 前，Studio 会验证每个受影响目标都处在相同 origin 和路径边界内；越界目标失败关闭。共享或旧 URL 树需要精确目标失效时不要设置此项。

从 classic CDN 升级到 EdgeOne 可能改善边缘能力并整合配置，但也会改变 Provider API、缓存语义、诊断和运维回滚。因此 Blog Studio 把它视为可替换缓存适配器，而不是首次发布的必需迁移。

## 参考部署关卡

1. 盘点当前 COS 前缀、公开 URL、缓存产品和 header，证据中不保存凭据。
2. 备份部署配置并保留此前发布命令。
3. 使用克隆工作区和非生产前缀/域名。
4. 发布合成文章和文章范围图片。
5. 注入构建、上传、缓存、网络和重启故障。
6. 比较生成 URL 清单和旧资源。
7. 将已有部署采用为已验证基线且不改写公开对象。
8. 只有此前关卡全部通过后，才提升一项受控真实变更。

使用彼此分离的权限阶段：

1. **暂存：** 只读写/删除唯一隐藏暂存目标及其状态前缀，另加上述三个 CDN action；
2. **采用：** 读取生产目标，只写 Blog Studio 状态前缀，不覆盖或删除公开对象；
3. **生产：** 只有采用、暂存发布、CDN 标记验证和回滚证据全部通过后，才授予目标写入/删除。

绝不要为了缩短设置而把阶段合并进未经审计的宽权限 key。提升后，公开博客不得依赖内部 Studio 主机。

可从仓库的 [`examples/reference/hexo-cos.example.yml`](https://github.com/DjangoAILab/blog-studio/blob/main/examples/reference/hexo-cos.example.yml) 开始，并始终把暂存放在隔离前缀和 origin URL 下。
