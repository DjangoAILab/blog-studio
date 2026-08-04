import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

import {
  CommandGeneratorAdapter,
  resolveWorkspacePath,
  type CommandCollectionOptions,
} from '@blog-studio/adapter-command';
import { HexoGeneratorAdapter } from '@blog-studio/adapter-hexo';
import { AssetPipeline } from '@blog-studio/assets';
import {
  assertKnownAdapters,
  parseBlogStudioConfigYaml,
  type AdapterRegistry,
  type BlogStudioConfig,
} from '@blog-studio/config';
import type {
  AssetProvider,
  CreateDocumentInput,
  CreateDocumentResult,
  DocumentRef,
  DocumentSummary,
  GeneratorAdapter,
} from '@blog-studio/core';
import { FilesystemAssetProvider } from '@blog-studio/storage-filesystem';

export interface WorkspaceHandle {
  readonly configurationPath: string;
  readonly config: BlogStudioConfig;
  readonly generator: GeneratorAdapter;
  readonly assetProvider: AssetProvider;
  readonly assetRootPrefix: string;
  readonly assets: AssetPipeline;
}

export type AssetProviderFactory = (config: BlogStudioConfig) =>
  | {
      readonly provider: AssetProvider;
      readonly rootPrefix: string;
    }
  | Promise<{
      readonly provider: AssetProvider;
      readonly rootPrefix: string;
    }>;

const builtInRegistry: AdapterRegistry = {
  generator: new Set(['hexo', 'command']),
  repository: new Set(['local-git']),
  assets: new Set(['filesystem', 'tencent-cos']),
  publish: new Set(['none', 'filesystem', 'tencent-cos']),
  cache: new Set(['none', 'tencent-cdn', 'tencent-edgeone']),
};

function optionRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function rejectUnknownOptions(
  options: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  const unknown = Object.keys(options).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${path}.${unknown} is not supported`);
}

function requiredString(
  options: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): string {
  const value = options[key];
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${path}.${key} must be a non-empty string`);
  return value;
}

function optionalString(
  options: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): string | undefined {
  if (options[key] === undefined) return undefined;
  return requiredString(options, key, path);
}

function stringArray(
  options: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  fallback: readonly string[] = [],
): readonly string[] {
  const value = options[key];
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  )
    throw new Error(`${path}.${key} must be an array of non-empty strings`);
  return value as readonly string[];
}

function optionalPositiveInteger(
  options: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): number | undefined {
  const value = options[key];
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error(`${path}.${key} must be a positive integer`);
  return Number(value);
}

function commandCollections(
  config: BlogStudioConfig,
): readonly CommandCollectionOptions[] {
  const posts = config.content?.collections.posts;
  if (!posts)
    throw new Error(
      'content.collections.posts is required by the command generator',
    );
  return [
    {
      id: 'posts',
      label: 'Posts',
      path: posts.path,
      state: 'published',
    },
    ...(posts.draftPath
      ? [
          {
            id: 'drafts',
            label: 'Drafts',
            path: posts.draftPath,
            state: 'draft' as const,
          },
        ]
      : []),
  ];
}

function createCommandGenerator(config: BlogStudioConfig): GeneratorAdapter {
  const options = config.generator.options;
  const path = 'generator.options';
  rejectUnknownOptions(
    options,
    new Set(['build', 'displayName', 'markers', 'outputDirectory', 'siteUrl']),
    path,
  );
  const build = optionRecord(options.build, `${path}.build`);
  rejectUnknownOptions(
    build,
    new Set([
      'args',
      'command',
      'environmentAllowlist',
      'previewArgs',
      'timeoutMs',
    ]),
    `${path}.build`,
  );
  const buildArgs = stringArray(build, 'args', `${path}.build`);
  const siteUrl = optionalString(options, 'siteUrl', path);
  if (siteUrl) {
    let parsed: URL;
    try {
      parsed = new URL(siteUrl);
    } catch {
      throw new Error(`${path}.siteUrl must be a valid HTTP(S) URL`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error(`${path}.siteUrl must be a valid HTTP(S) URL`);
  }
  const displayName = optionalString(options, 'displayName', path);
  const timeoutMs = optionalPositiveInteger(
    build,
    'timeoutMs',
    `${path}.build`,
  );
  return new CommandGeneratorAdapter({
    workspaceId: config.workspace.id,
    ...(displayName ? { displayName } : {}),
    markers: stringArray(options, 'markers', path),
    outputDirectory: requiredString(options, 'outputDirectory', path),
    ...(siteUrl ? { siteUrl } : {}),
    collections: commandCollections(config),
    command: {
      executable: requiredString(build, 'command', `${path}.build`),
      buildArgs,
      previewArgs: stringArray(
        build,
        'previewArgs',
        `${path}.build`,
        buildArgs,
      ),
      ...(timeoutMs ? { timeoutMs } : {}),
      environmentAllowlist: stringArray(
        build,
        'environmentAllowlist',
        `${path}.build`,
      ),
    },
  });
}

function createGenerator(config: BlogStudioConfig): GeneratorAdapter {
  if (config.generator.adapter === 'hexo') {
    const options = config.generator.options;
    rejectUnknownOptions(
      options,
      new Set(['buildTimeoutMs', 'config']),
      'generator.options',
    );
    const configPath = optionalString(options, 'config', 'generator.options');
    const buildTimeoutMs = optionalPositiveInteger(
      options,
      'buildTimeoutMs',
      'generator.options',
    );
    return new HexoGeneratorAdapter({
      workspaceId: config.workspace.id,
      ...(configPath ? { configPath } : {}),
      ...(buildTimeoutMs ? { buildTimeoutMs } : {}),
    });
  }
  if (config.generator.adapter === 'command')
    return createCommandGenerator(config);
  throw new Error(
    `Generator ${config.generator.adapter} requires an administrator-provided factory`,
  );
}

function stringOption(
  config: BlogStudioConfig,
  key: string,
  fallback: string,
): string {
  const value = config.assets.options[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`assets.options.${key} must be a non-empty string`);
  return value;
}

function stringArrayOption(
  config: BlogStudioConfig,
  key: string,
): readonly string[] {
  const value = config.assets.options[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`assets.options.${key} must be an array of strings`);
  return value as readonly string[];
}

async function createAssets(
  config: BlogStudioConfig,
  factories: Readonly<Record<string, AssetProviderFactory>>,
): Promise<{
  readonly provider: AssetProvider;
  readonly rootPrefix: string;
  readonly pipeline: AssetPipeline;
}> {
  if (config.assets.adapter !== 'filesystem') {
    const factory = factories[config.assets.adapter];
    if (!factory)
      throw new Error(`Unsupported asset adapter: ${config.assets.adapter}`);
    const created = await factory(config);
    return {
      ...created,
      pipeline: new AssetPipeline(created.provider),
    };
  }
  const rootDirectory = await resolveWorkspacePath(
    config.workspace.root,
    stringOption(config, 'rootDirectory', 'source'),
  );
  const rootPrefix = stringOption(config, 'managedPrefix', 'media/posts');
  const provider = new FilesystemAssetProvider({
    rootDirectory,
    publicBaseUrl: stringOption(
      config,
      'publicBaseUrl',
      config.verification?.baseUrl ?? 'http://localhost/',
    ),
    managedPrefix: rootPrefix,
    protectedPrefixes: stringArrayOption(config, 'protectedPrefixes'),
  });
  return {
    provider,
    rootPrefix,
    pipeline: new AssetPipeline(provider),
  };
}

export class WorkspaceService {
  readonly #workspaces = new Map<string, WorkspaceHandle>();

  private constructor() {}

  public static async load(options: {
    readonly configurationPaths: readonly string[];
    readonly allowedWorkspaceRoot: string;
    readonly assetFactories?: Readonly<Record<string, AssetProviderFactory>>;
  }): Promise<WorkspaceService> {
    const service = new WorkspaceService();
    const allowedRoot = await resolveWorkspacePath(
      options.allowedWorkspaceRoot,
      '.',
    );

    for (const configurationPath of options.configurationPaths) {
      const config = parseBlogStudioConfigYaml(
        await readFile(configurationPath, 'utf8'),
      );
      assertKnownAdapters(config, builtInRegistry);
      const canonicalWorkspaceRoot = await resolveWorkspacePath(
        config.workspace.root,
        '.',
      );
      await resolveWorkspacePath(
        allowedRoot,
        relative(allowedRoot, canonicalWorkspaceRoot),
      );
      if (service.#workspaces.has(config.workspace.id)) {
        throw new Error(`Duplicate workspace ID: ${config.workspace.id}`);
      }
      const generator = createGenerator(config);
      const assets = await createAssets(config, options.assetFactories ?? {});
      service.#workspaces.set(config.workspace.id, {
        configurationPath,
        config,
        generator,
        assetProvider: assets.provider,
        assetRootPrefix: assets.rootPrefix,
        assets: assets.pipeline,
      });
    }
    return service;
  }

  public list(): readonly WorkspaceHandle[] {
    return [...this.#workspaces.values()];
  }

  public get(workspaceId: string): WorkspaceHandle {
    const workspace = this.#workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
    return workspace;
  }

  public async createDocument(
    workspaceId: string,
    input: CreateDocumentInput,
  ): Promise<CreateDocumentResult> {
    const workspace = this.get(workspaceId);
    if (!workspace.generator.createDocument)
      throw new Error(
        `Generator ${workspace.generator.id} does not support document creation`,
      );
    return await workspace.generator.createDocument(
      workspace.config.workspace.root,
      input,
    );
  }

  public async findDocument(
    workspaceId: string,
    collectionId: string,
    documentId: string,
  ): Promise<{ readonly summary: DocumentSummary; readonly ref: DocumentRef }> {
    const workspace = this.get(workspaceId);
    const documents = await workspace.generator.listDocuments(
      workspace.config.workspace.root,
      collectionId,
    );
    const summary = documents.find(
      (document) => document.ref.documentId === documentId,
    );
    if (!summary) throw new Error(`Unknown document: ${documentId}`);
    return { summary, ref: summary.ref };
  }
}
