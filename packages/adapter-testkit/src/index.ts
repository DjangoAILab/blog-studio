import {
  ADAPTER_API_VERSION,
  type AdapterDescriptor,
  type AssetProvider,
  type AssetPutInput,
  type AssetScope,
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
