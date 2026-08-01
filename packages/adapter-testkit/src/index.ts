import {
  ADAPTER_API_VERSION,
  type AdapterDescriptor,
  type AssetProvider,
  type AssetPutInput,
  type AssetScope,
  type GeneratorAdapter,
} from '@blog-studio/core';

export interface AssetProviderFixture {
  readonly provider: AssetProvider;
  readonly scope: AssetScope;
  readonly input: AssetPutInput;
}

export type AssetProviderFixtureFactory = () =>
  AssetProviderFixture | Promise<AssetProviderFixture>;

export function assertAdapterDescriptor(
  adapter: AdapterDescriptor,
): asserts adapter is AdapterDescriptor {
  if (adapter.apiVersion !== ADAPTER_API_VERSION) {
    throw new Error(`Adapter ${adapter.id} uses an unsupported API version`);
  }
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(adapter.id)) {
    throw new Error(`Adapter ID ${adapter.id} is not lowercase kebab-case`);
  }
  if (adapter.displayName.trim().length === 0) {
    throw new Error(`Adapter ${adapter.id} has no display name`);
  }
}

export async function assertAssetProviderConformance(
  createFixture: AssetProviderFixtureFactory,
): Promise<void> {
  const { provider, scope, input } = await createFixture();
  assertAdapterDescriptor(provider);

  const before = await provider.list(scope);
  if (before.length !== 0) {
    throw new Error('Fresh asset provider fixture must be empty');
  }

  const stored = await provider.put(input);
  if (stored.contentHash !== input.contentHash) {
    throw new Error('Asset provider changed the content hash');
  }
  if (!stored.key.startsWith(scope.prefix)) {
    throw new Error('Asset provider stored data outside the requested scope');
  }

  const afterPut = await provider.list(scope);
  if (afterPut.length !== 1 || afterPut[0]?.id !== stored.id) {
    throw new Error('Asset provider cannot list the stored asset');
  }

  await provider.delete({
    scope,
    assetId: stored.id,
    expectedContentHash: stored.contentHash,
  });

  const afterDelete = await provider.list(scope);
  if (afterDelete.length !== 0) {
    throw new Error('Asset provider cannot delete the stored asset');
  }
}

export interface GeneratorAdapterFixture {
  readonly adapter: GeneratorAdapter;
  readonly workspaceRoot: string;
  readonly collectionId: string;
}

export type GeneratorAdapterFixtureFactory = () =>
  GeneratorAdapterFixture | Promise<GeneratorAdapterFixture>;

/** Shared observable contract required from every generator integration. */
export async function assertGeneratorAdapterConformance(
  createFixture: GeneratorAdapterFixtureFactory,
): Promise<void> {
  const { adapter, workspaceRoot, collectionId } = await createFixture();
  assertAdapterDescriptor(adapter);

  const detection = await adapter.detect(workspaceRoot);
  if (!detection.detected || detection.confidence <= 0) {
    throw new Error('Generator does not detect its own fixture');
  }

  const model = await adapter.inspect(workspaceRoot);
  if (!model.collections.some((collection) => collection.id === collectionId)) {
    throw new Error('Generator does not expose the fixture collection');
  }

  const documents = await adapter.listDocuments(workspaceRoot, collectionId);
  const first = documents[0];
  if (!first) throw new Error('Generator fixture must contain a document');
  const source = await adapter.readDocument(workspaceRoot, first.ref);
  if (!/^sha256:[a-f0-9]{64}$/.test(source.revision)) {
    throw new Error('Generator returned an invalid document revision');
  }

  const noOp = await adapter.writeDocument(workspaceRoot, {
    ref: first.ref,
    expectedRevision: source.revision,
    frontMatter: source.frontMatter,
    body: source.body,
  });
  if (noOp.changed || noOp.revision !== source.revision) {
    throw new Error('Generator changed an unmodified document');
  }

  const publicUrl = await adapter.resolvePublicUrl(workspaceRoot, first.ref);
  if (!['http:', 'https:'].includes(new URL(publicUrl).protocol)) {
    throw new Error('Generator returned a non-HTTP public URL');
  }

  const build = await adapter.build({ workspaceRoot, mode: 'production' });
  for (const entry of build.manifest) {
    if (entry.path.startsWith('/') || entry.path.includes('\\')) {
      throw new Error(`Generator returned a non-portable path: ${entry.path}`);
    }
  }
}
