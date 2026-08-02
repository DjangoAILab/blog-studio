import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
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
  DocumentRef,
  DocumentSummary,
  GeneratorAdapter,
} from '@blog-studio/core';
import { FilesystemAssetProvider } from '@blog-studio/storage-filesystem';

export interface WorkspaceHandle {
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
  publish: new Set(['filesystem', 'tencent-cos']),
  cache: new Set(['none', 'tencent-cdn', 'tencent-edgeone']),
};

function createGenerator(config: BlogStudioConfig): GeneratorAdapter {
  if (config.generator.adapter === 'hexo') {
    return new HexoGeneratorAdapter({ workspaceId: config.workspace.id });
  }
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
      const assets = await createAssets(config, options.assetFactories ?? {});
      service.#workspaces.set(config.workspace.id, {
        config,
        generator: createGenerator(config),
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
