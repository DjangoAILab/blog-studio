---
title: 适配器 API v1
description: Blog Studio 生成器和服务商适配器的 TypeScript 接口。
---

> 从 `packages/core/src/adapters/*.ts` 生成。不要手工修改对应英文生成页；此中文页需与接口同步。

`ADAPTER_API_VERSION` 当前为 `1`。实现还需要这些契约引用的领域类型，并应通过可复用的适配器 testkit。

## AdapterDescriptor

```ts
export interface AdapterDescriptor {
  readonly apiVersion: typeof ADAPTER_API_VERSION;
  readonly id: string;
  readonly displayName: string;
}
```

## GeneratorAdapter

```ts
export interface GeneratorAdapter extends AdapterDescriptor {
  readonly capabilities: GeneratorCapabilities;
  detect(workspaceRoot: string): Promise<DetectionResult>;
  inspect(workspaceRoot: string): Promise<SiteModel>;
  listDocuments(
    workspaceRoot: string,
    collectionId: string,
  ): Promise<readonly DocumentSummary[]>;
  readDocument(
    workspaceRoot: string,
    ref: DocumentRef,
  ): Promise<DocumentSource>;
  writeDocument(
    workspaceRoot: string,
    input: WriteDocumentInput,
  ): Promise<WriteDocumentResult>;
  createDocument?(
    workspaceRoot: string,
    input: CreateDocumentInput,
  ): Promise<CreateDocumentResult>;
  promoteDocument?(
    workspaceRoot: string,
    input: PromoteDocumentInput,
  ): Promise<PromoteDocumentResult>;
  resolvePublicUrl(workspaceRoot: string, ref: DocumentRef): Promise<string>;
  /** 将文档中的根相对资源解析为工作区相对源码路径。 */
  resolveAssetSourcePath?(
    workspaceRoot: string,
    ref: DocumentRef,
    sourceUrl: string,
  ): Promise<string | undefined>;
  build(input: BuildInput): Promise<BuildResult>;
}
```

## RepositoryAdapter

```ts
export interface RepositoryAdapter extends AdapterDescriptor {
  status(
    workspaceId: WorkspaceId,
    workspaceRoot: string,
  ): Promise<RepositoryStatus>;
  checkpoint(
    workspaceId: WorkspaceId,
    workspaceRoot: string,
    message: string,
    paths: readonly string[],
  ): Promise<RepositoryCheckpoint>;
  push(workspaceId: WorkspaceId, workspaceRoot: string): Promise<void>;
}
```

## AssetProvider

```ts
export interface AssetProvider extends AdapterDescriptor {
  put(input: AssetPutInput): Promise<AssetRecord>;
  list(scope: AssetScope): Promise<readonly AssetRecord[]>;
  delete(input: AssetDeleteInput): Promise<void>;
}
```

## Publisher

```ts
export interface Publisher extends AdapterDescriptor {
  plan(input: PublishInput): Promise<PublishPlan>;
  apply(
    plan: PublishPlan,
    phase: 'assets' | 'pages',
    events: PublishEventSink,
  ): Promise<PublishBatchResult>;
  finalize(plan: PublishPlan): Promise<PublishResult>;
  rollback(release: ReleaseRecord): Promise<RollbackResult>;
  recoverInterrupted?(
    release: ReleaseRecord,
  ): Promise<InterruptedRecoveryResult>;
  adoptBaseline?(
    input: BaselineAdoptionInput,
    events: PublishEventSink,
  ): Promise<BaselineAdoptionResult>;
}
```

## CacheProvider

```ts
export interface CacheProvider extends AdapterDescriptor {
  invalidate(input: CacheInvalidation): Promise<CacheResult>;
}
```

实现 Provider 前请阅读[适配器架构](../../adapters/overview/)。当生成页与包版本不同时，以源码为准。
