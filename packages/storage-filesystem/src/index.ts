import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import {
  ADAPTER_API_VERSION,
  createAssetId,
  createContentHash,
  type AssetDeleteInput,
  type AssetProvider,
  type AssetPutInput,
  type AssetRecord,
  type AssetScope,
  type ContentHash,
} from '@blog-studio/core';

export interface FilesystemAssetProviderOptions {
  readonly rootDirectory: string;
  readonly publicBaseUrl: string;
  readonly managedPrefix: string;
  readonly protectedPrefixes?: readonly string[];
}

function portablePrefix(value: string): string {
  const prefix = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (
    !prefix ||
    prefix.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid asset prefix: ${value}`);
  return prefix;
}

function isWithinPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function mediaTypeFor(path: string): string {
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.png')) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  return 'application/octet-stream';
}

function hashBytes(bytes: Uint8Array): ContentHash {
  return createContentHash(
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  );
}

export class FilesystemAssetProvider implements AssetProvider {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'filesystem';
  public readonly displayName = 'Filesystem assets';
  readonly #rootDirectory: string;
  readonly #publicBaseUrl: URL;
  readonly #managedPrefix: string;
  readonly #protectedPrefixes: readonly string[];

  public constructor(options: FilesystemAssetProviderOptions) {
    this.#rootDirectory = resolve(options.rootDirectory);
    this.#publicBaseUrl = new URL(
      options.publicBaseUrl.endsWith('/')
        ? options.publicBaseUrl
        : `${options.publicBaseUrl}/`,
    );
    this.#managedPrefix = portablePrefix(options.managedPrefix);
    this.#protectedPrefixes = (options.protectedPrefixes ?? []).map(
      portablePrefix,
    );
    if (
      this.#protectedPrefixes.some(
        (prefix) =>
          isWithinPrefix(this.#managedPrefix, prefix) ||
          isWithinPrefix(prefix, this.#managedPrefix),
      )
    )
      throw new Error('Managed and protected asset prefixes must not overlap');
  }

  #assertManaged(scope: AssetScope): string {
    const prefix = portablePrefix(scope.prefix);
    if (!isWithinPrefix(prefix, this.#managedPrefix))
      throw new Error('Asset scope is outside the managed prefix');
    if (this.#protectedPrefixes.some((item) => isWithinPrefix(prefix, item)))
      throw new Error('Asset scope targets a protected legacy prefix');
    return prefix;
  }

  #path(key: string): string {
    const path = resolve(this.#rootDirectory, ...key.split('/'));
    const rel = relative(this.#rootDirectory, path);
    if (rel === '..' || rel.startsWith(`..${sep}`))
      throw new Error('Asset path escaped the storage root');
    return path;
  }

  #record(input: {
    readonly scope: AssetScope;
    readonly key: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly contentHash: ContentHash;
    readonly createdAt: string;
  }): AssetRecord {
    const idHash = createHash('sha256').update(input.key).digest('hex');
    return {
      id: createAssetId(`asset-${idHash.slice(0, 24)}`),
      workspaceId: input.scope.workspaceId,
      ...(input.scope.documentId ? { documentId: input.scope.documentId } : {}),
      key: input.key,
      publicUrl: new URL(
        input.key.split('/').map(encodeURIComponent).join('/'),
        this.#publicBaseUrl,
      ).toString(),
      mediaType: input.mediaType,
      byteLength: input.byteLength,
      contentHash: input.contentHash,
      createdAt: input.createdAt,
    };
  }

  public async put(input: AssetPutInput): Promise<AssetRecord> {
    const prefix = this.#assertManaged(input.scope);
    if (hashBytes(input.bytes) !== input.contentHash)
      throw new Error('Asset bytes do not match the declared content hash');
    if (!/^[a-f0-9]{64}-[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/.test(input.filename))
      throw new Error('Asset filename must be sanitized and content-addressed');
    if (!input.filename.startsWith(input.contentHash.slice(7)))
      throw new Error('Asset filename does not match its content hash');
    const key = `${prefix}/${input.filename}`;
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, input.bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(path);
      if (hashBytes(existing) !== input.contentHash)
        throw new Error('Existing asset differs; refusing to overwrite it', {
          cause: error,
        });
    }
    const details = await stat(path);
    return this.#record({
      scope: input.scope,
      key,
      mediaType: input.mediaType,
      byteLength: details.size,
      contentHash: input.contentHash,
      createdAt: details.birthtime.toISOString(),
    });
  }

  public async list(scope: AssetScope): Promise<readonly AssetRecord[]> {
    const prefix = this.#assertManaged(scope);
    const directory = this.#path(prefix);
    let names: readonly string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records = await Promise.all(
      names.map(async (name): Promise<AssetRecord | undefined> => {
        const digest = /^([a-f0-9]{64})-/.exec(name)?.[1];
        if (!digest) return undefined;
        const key = `${prefix}/${basename(name)}`;
        const details = await stat(this.#path(key));
        if (!details.isFile()) return undefined;
        return this.#record({
          scope,
          key,
          mediaType: mediaTypeFor(name),
          byteLength: details.size,
          contentHash: createContentHash(`sha256:${digest}`),
          createdAt: details.birthtime.toISOString(),
        });
      }),
    );
    return records.filter((record) => record !== undefined);
  }

  public async delete(input: AssetDeleteInput): Promise<void> {
    const asset = (await this.list(input.scope)).find(
      (record) => record.id === input.assetId,
    );
    if (!asset) throw new Error(`Unknown asset: ${input.assetId}`);
    if (asset.contentHash !== input.expectedContentHash)
      throw new Error('Asset content hash changed; refusing deletion');
    await unlink(this.#path(asset.key));
  }
}
