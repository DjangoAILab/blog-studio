---
title: Adapter API v1
description: Generated TypeScript interfaces for Blog Studio generator and provider adapters.
---

> Generated from `packages/core/src/adapters/*.ts`. Do not edit this page by hand.

`ADAPTER_API_VERSION` is currently `1`. Implementations also need the domain
types referenced by these contracts and should pass the reusable adapter testkit.

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
  /** Resolve a document-authored/root-relative asset to a workspace-relative source path. */
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

Read the [adapter architecture](/docs/adapters/overview/) before implementing a
provider. Source is authoritative when a generated page and a package version
differ.
