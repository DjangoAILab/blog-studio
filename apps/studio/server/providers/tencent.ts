import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

import { TencentCacheProvider } from '@blog-studio/cache-tencent';
import type { BlogStudioConfig } from '@blog-studio/config';
import type { CacheProvider, Publisher } from '@blog-studio/core';
import { TencentCosPublisher } from '@blog-studio/publisher-cos';
import type {
  CosPublisherClient,
  TencentCosPublisherOptions,
} from '@blog-studio/publisher-cos';
import { TencentCosAssetProvider } from '@blog-studio/storage-cos';
import type {
  CosClient,
  TencentCosAssetProviderOptions,
} from '@blog-studio/storage-cos';
import COS from 'cos-nodejs-sdk-v5';
import { cdn } from 'tencentcloud-sdk-nodejs-cdn';
import { teo } from 'tencentcloud-sdk-nodejs-teo';

import type { ReleaseServiceOptions } from '../services/releases.js';
import type {
  AssetProviderFactory,
  WorkspaceHandle,
} from '../services/workspaces.js';

type CosSdk = Pick<
  COS,
  'deleteObject' | 'getBucket' | 'getObject' | 'putObject' | 'putObjectCopy'
>;
type CdnSdk = Pick<
  InstanceType<typeof cdn.v20180606.Client>,
  'DescribePurgeTasks' | 'PurgePathCache' | 'PurgeUrlsCache'
>;
type TeoSdk = Pick<
  InstanceType<typeof teo.v20220901.Client>,
  'CreatePurgeTask' | 'DescribePurgeTasks'
>;

export interface TencentCredentials {
  readonly secretId: string;
  readonly secretKey: string;
  readonly sessionToken?: string;
}

export interface TencentSdkFactories {
  readonly cos: (credentials: TencentCredentials) => CosSdk;
  readonly cdn: (credentials: TencentCredentials) => CdnSdk;
  readonly teo: (credentials: TencentCredentials) => TeoSdk;
}

type AdapterConfig = NonNullable<
  BlogStudioConfig['assets' | 'cache' | 'publish']
>;

function requiredValue(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function stringOption(
  config: AdapterConfig,
  section: string,
  key: string,
): string {
  const value = config.options[key];
  return requiredValue(
    typeof value === 'string' ? value : undefined,
    `${section}.options.${key}`,
  );
}

function optionalStringOption(
  config: AdapterConfig,
  section: string,
  key: string,
): string | undefined {
  const value = config.options[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${section}.options.${key} must be a non-empty string`);
  return value.trim();
}

function optionalIntegerOption(
  config: AdapterConfig,
  section: string,
  key: string,
): number | undefined {
  const value = config.options[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value))
    throw new Error(`${section}.options.${key} must be an integer`);
  return value as number;
}

function optionalBooleanOption(
  config: AdapterConfig,
  section: string,
  key: string,
): boolean | undefined {
  const value = config.options[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean')
    throw new Error(`${section}.options.${key} must be a boolean`);
  return value;
}

function stringArrayOption(
  config: AdapterConfig,
  section: string,
  key: string,
): readonly string[] {
  const value = config.options[key];
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  )
    throw new Error(
      `${section}.options.${key} must be an array of non-empty strings`,
    );
  return value as readonly string[];
}

function credentials(
  config: AdapterConfig,
  section: string,
  environment: Readonly<Record<string, string | undefined>>,
): TencentCredentials {
  const resolveCredential = (
    key: 'secretId' | 'secretKey' | 'sessionToken',
    required: boolean,
  ): string | undefined => {
    const reference = config.credentials?.[key];
    if (!reference) {
      if (required)
        throw new Error(`${section}.credentials.${key} is required`);
      return undefined;
    }
    const directValue = environment[reference.env];
    if (directValue?.trim()) return directValue.trim();
    const fileVariable = `${reference.env}_FILE`;
    const filePath = environment[fileVariable];
    if (filePath?.trim()) {
      try {
        return requiredValue(
          readFileSync(filePath.trim(), 'utf8'),
          `Secret file referenced by ${fileVariable}`,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('is required'))
          throw error;
        throw new Error(
          `Unable to read secret file referenced by ${fileVariable}`,
          { cause: error },
        );
      }
    }
    if (!required) return undefined;
    throw new Error(
      `Environment variable ${reference.env} or ${fileVariable} is required`,
    );
  };
  const sessionToken = resolveCredential('sessionToken', false);
  return {
    secretId: resolveCredential('secretId', true)!,
    secretKey: resolveCredential('secretKey', true)!,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

function metadataHeaders(
  metadata: Readonly<Record<string, string>>,
): Record<`x-cos-meta-${string}`, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      `x-cos-meta-${key}`,
      value,
    ]),
  );
}

function encodedObjectKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function objectSize(value: string, key: string): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error(`COS returned an invalid size for object ${key}`);
  return size;
}

export class TencentCosSdkClient implements CosClient, CosPublisherClient {
  public constructor(private readonly sdk: CosSdk) {}

  public async putObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
    readonly body: Uint8Array;
    readonly contentType: string;
    readonly cacheControl: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<void> {
    await this.sdk.putObject({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.key,
      Body: Buffer.from(input.body),
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      ...metadataHeaders(input.metadata),
    });
  }

  public async getObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
  }): Promise<Uint8Array> {
    const result = await this.sdk.getObject({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.key,
    });
    return result.Body;
  }

  public async copyObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly sourceKey: string;
    readonly destinationKey: string;
  }): Promise<void> {
    await this.sdk.putObjectCopy({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.destinationKey,
      CopySource: `${input.bucket}.cos.${input.region}.myqcloud.com/${encodedObjectKey(input.sourceKey)}`,
    });
  }

  public async listObjects(input: {
    readonly bucket: string;
    readonly region: string;
    readonly prefix: string;
    readonly continuationToken?: string;
  }) {
    const result = await this.sdk.getBucket({
      Bucket: input.bucket,
      Region: input.region,
      Prefix: input.prefix,
      MaxKeys: 1000,
      ...(input.continuationToken ? { Marker: input.continuationToken } : {}),
    });
    if (result.IsTruncated === 'true' && !result.NextMarker)
      throw new Error('COS list response was truncated without a next marker');
    return {
      objects: result.Contents.map((object) => ({
        key: object.Key,
        size: objectSize(object.Size, object.Key),
        lastModified: object.LastModified,
      })),
      ...(result.IsTruncated === 'true'
        ? { nextContinuationToken: result.NextMarker! }
        : {}),
    };
  }

  public async deleteObject(input: {
    readonly bucket: string;
    readonly region: string;
    readonly key: string;
  }): Promise<void> {
    await this.sdk.deleteObject({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.key,
    });
  }
}

function responseValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Tencent API response omitted ${label}`);
  return value;
}

export class TencentCdnSdkClient {
  public constructor(private readonly sdk: CdnSdk) {}

  public async submit(request: {
    readonly mode: 'cdn' | 'edgeone';
    readonly kind: 'url' | 'directory';
    readonly targets: readonly string[];
    readonly method: 'delete' | 'invalidate';
    readonly zoneId?: string;
  }) {
    if (request.mode !== 'cdn')
      throw new Error('CDN client cannot submit an EdgeOne request');
    const result =
      request.kind === 'url'
        ? await this.sdk.PurgeUrlsCache({
            Urls: [...request.targets],
            UrlEncode: true,
          })
        : await this.sdk.PurgePathCache({
            Paths: [...request.targets],
            FlushType: request.method === 'delete' ? 'delete' : 'flush',
            UrlEncode: true,
          });
    return {
      taskId: responseValue(result.TaskId, 'TaskId'),
      requestId: responseValue(result.RequestId, 'RequestId'),
    };
  }

  public async status(input: {
    readonly mode: 'cdn' | 'edgeone';
    readonly taskId: string;
    readonly zoneId?: string;
  }): Promise<'pending' | 'succeeded' | 'failed'> {
    if (input.mode !== 'cdn')
      throw new Error('CDN client cannot query an EdgeOne request');
    const result = await this.sdk.DescribePurgeTasks({
      TaskId: input.taskId,
      Limit: 100,
    });
    const logs = (result.PurgeLogs ?? []).filter(
      (entry) => entry.TaskId === input.taskId,
    );
    if (logs.some((entry) => entry.Status === 'fail')) return 'failed';
    if (logs.length > 0 && logs.every((entry) => entry.Status === 'done'))
      return 'succeeded';
    return 'pending';
  }
}

export class TencentEdgeOneSdkClient {
  public constructor(private readonly sdk: TeoSdk) {}

  public async submit(request: {
    readonly mode: 'cdn' | 'edgeone';
    readonly kind: 'url' | 'directory';
    readonly targets: readonly string[];
    readonly method: 'delete' | 'invalidate';
    readonly zoneId?: string;
  }) {
    if (request.mode !== 'edgeone' || !request.zoneId)
      throw new Error('EdgeOne request requires a zone ID');
    const result = await this.sdk.CreatePurgeTask({
      ZoneId: request.zoneId,
      Type: request.kind === 'url' ? 'purge_url' : 'purge_prefix',
      ...(request.kind === 'directory' ? { Method: request.method } : {}),
      Targets: [...request.targets],
    });
    if ((result.FailedList?.length ?? 0) > 0)
      throw new Error(
        `EdgeOne rejected ${result.FailedList!.length} purge target(s)`,
      );
    return {
      taskId: responseValue(result.JobId, 'JobId'),
      requestId: responseValue(result.RequestId, 'RequestId'),
    };
  }

  public async status(input: {
    readonly mode: 'cdn' | 'edgeone';
    readonly taskId: string;
    readonly zoneId?: string;
  }): Promise<'pending' | 'succeeded' | 'failed'> {
    if (input.mode !== 'edgeone' || !input.zoneId)
      throw new Error('EdgeOne status request requires a zone ID');
    const result = await this.sdk.DescribePurgeTasks({
      ZoneId: input.zoneId,
      Filters: [{ Name: 'job-id', Values: [input.taskId] }],
      Limit: 100,
    });
    const tasks = (result.Tasks ?? []).filter(
      (entry) => entry.JobId === input.taskId,
    );
    if (
      tasks.some((entry) =>
        ['failed', 'timeout', 'canceled'].includes(entry.Status ?? ''),
      )
    )
      return 'failed';
    if (tasks.length > 0 && tasks.every((entry) => entry.Status === 'success'))
      return 'succeeded';
    return 'pending';
  }
}

function defaultSdkFactories(): TencentSdkFactories {
  const cloudCredential = (value: TencentCredentials) => ({
    secretId: value.secretId,
    secretKey: value.secretKey,
    ...(value.sessionToken ? { token: value.sessionToken } : {}),
  });
  return {
    cos: (value) =>
      new COS({
        SecretId: value.secretId,
        SecretKey: value.secretKey,
        ...(value.sessionToken ? { SecurityToken: value.sessionToken } : {}),
        Protocol: 'https:',
        StrictSsl: true,
        Timeout: 30_000,
      }),
    cdn: (value) =>
      new cdn.v20180606.Client({
        credential: cloudCredential(value),
        profile: {
          httpProfile: {
            endpoint: 'cdn.tencentcloudapi.com',
            protocol: 'https://',
            reqTimeout: 30,
          },
        },
      }),
    teo: (value) =>
      new teo.v20220901.Client({
        credential: cloudCredential(value),
        profile: {
          httpProfile: {
            endpoint: 'teo.tencentcloudapi.com',
            protocol: 'https://',
            reqTimeout: 30,
          },
        },
      }),
  };
}

function cosAssetOptions(
  config: BlogStudioConfig,
  environment: Readonly<Record<string, string | undefined>>,
  sdkFactories: TencentSdkFactories,
): TencentCosAssetProviderOptions & { readonly managedPrefix: string } {
  const adapter = config.assets;
  const managedPrefix = stringOption(adapter, 'assets', 'managedPrefix');
  const maxAttempts = optionalIntegerOption(adapter, 'assets', 'maxAttempts');
  return {
    client: new TencentCosSdkClient(
      sdkFactories.cos(credentials(adapter, 'assets', environment)),
    ),
    bucket: stringOption(adapter, 'assets', 'bucket'),
    region: stringOption(adapter, 'assets', 'region'),
    publicBaseUrl: stringOption(adapter, 'assets', 'publicBaseUrl'),
    managedPrefix,
    protectedPrefixes: stringArrayOption(
      adapter,
      'assets',
      'protectedPrefixes',
    ),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  };
}

function cosPublisherOptions(
  workspace: WorkspaceHandle,
  environment: Readonly<Record<string, string | undefined>>,
  sdkFactories: TencentSdkFactories,
): TencentCosPublisherOptions {
  const adapter = workspace.config.publish;
  const concurrency = optionalIntegerOption(adapter, 'publish', 'concurrency');
  const maxAttempts = optionalIntegerOption(adapter, 'publish', 'maxAttempts');
  const allowBucketRoot = optionalBooleanOption(
    adapter,
    'publish',
    'allowBucketRoot',
  );
  return {
    client: new TencentCosSdkClient(
      sdkFactories.cos(credentials(adapter, 'publish', environment)),
    ),
    bucket: stringOption(adapter, 'publish', 'bucket'),
    region: stringOption(adapter, 'publish', 'region'),
    targetPrefix: stringOption(adapter, 'publish', 'targetPrefix'),
    statePrefix: stringOption(adapter, 'publish', 'statePrefix'),
    protectedPrefixes: stringArrayOption(
      adapter,
      'publish',
      'protectedPrefixes',
    ),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(allowBucketRoot === undefined ? {} : { allowBucketRoot }),
  };
}

function cacheProvider(
  workspace: WorkspaceHandle,
  mode: 'cdn' | 'edgeone',
  environment: Readonly<Record<string, string | undefined>>,
  sdkFactories: TencentSdkFactories,
): CacheProvider {
  const adapter = workspace.config.cache;
  if (!adapter) throw new Error('Tencent cache configuration is missing');
  const resolvedCredentials = credentials(adapter, 'cache', environment);
  const maxPollAttempts = optionalIntegerOption(
    adapter,
    'cache',
    'maxPollAttempts',
  );
  const edgeOneBatchSize = optionalIntegerOption(
    adapter,
    'cache',
    'edgeOneBatchSize',
  );
  const directoryPurgeRoot = optionalStringOption(
    adapter,
    'cache',
    'directoryPurgeRoot',
  );
  const zoneId = optionalStringOption(adapter, 'cache', 'zoneId');
  return new TencentCacheProvider({
    client:
      mode === 'cdn'
        ? new TencentCdnSdkClient(sdkFactories.cdn(resolvedCredentials))
        : new TencentEdgeOneSdkClient(sdkFactories.teo(resolvedCredentials)),
    mode,
    ...(zoneId ? { zoneId } : {}),
    ...(maxPollAttempts === undefined ? {} : { maxPollAttempts }),
    ...(edgeOneBatchSize === undefined ? {} : { edgeOneBatchSize }),
    ...(directoryPurgeRoot ? { directoryPurgeRoot } : {}),
  });
}

export function createTencentProviderFactories(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  sdkFactories: TencentSdkFactories = defaultSdkFactories(),
): {
  readonly assetFactories: Readonly<Record<string, AssetProviderFactory>>;
  readonly publisherFactories: NonNullable<
    ReleaseServiceOptions['publisherFactories']
  >;
  readonly cacheFactories: NonNullable<ReleaseServiceOptions['cacheFactories']>;
} {
  return {
    assetFactories: {
      'tencent-cos': (config) => {
        const options = cosAssetOptions(config, environment, sdkFactories);
        return {
          provider: new TencentCosAssetProvider(options),
          rootPrefix: options.managedPrefix,
        };
      },
    },
    publisherFactories: {
      'tencent-cos': (workspace): Publisher =>
        new TencentCosPublisher(
          cosPublisherOptions(workspace, environment, sdkFactories),
        ),
    },
    cacheFactories: {
      'tencent-cdn': (workspace) =>
        cacheProvider(workspace, 'cdn', environment, sdkFactories),
      'tencent-edgeone': (workspace) =>
        cacheProvider(workspace, 'edgeone', environment, sdkFactories),
    },
  };
}
