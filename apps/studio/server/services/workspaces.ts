import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

import { resolveWorkspacePath } from '@blog-studio/adapter-command';
import { HexoGeneratorAdapter } from '@blog-studio/adapter-hexo';
import {
  assertKnownAdapters,
  parseBlogStudioConfigYaml,
  type AdapterRegistry,
  type BlogStudioConfig,
} from '@blog-studio/config';
import type {
  DocumentRef,
  DocumentSummary,
  GeneratorAdapter,
} from '@blog-studio/core';

export interface WorkspaceHandle {
  readonly config: BlogStudioConfig;
  readonly generator: GeneratorAdapter;
}

const builtInRegistry: AdapterRegistry = {
  generator: new Set(['hexo', 'command']),
  repository: new Set(['local-git']),
  assets: new Set(['filesystem', 'tencent-cos']),
  publish: new Set(['filesystem', 'tencent-cos']),
  cache: new Set(['none', 'tencent-cdn']),
};

function createGenerator(config: BlogStudioConfig): GeneratorAdapter {
  if (config.generator.adapter === 'hexo') {
    return new HexoGeneratorAdapter({ workspaceId: config.workspace.id });
  }
  throw new Error(
    `Generator ${config.generator.adapter} requires an administrator-provided factory`,
  );
}

export class WorkspaceService {
  readonly #workspaces = new Map<string, WorkspaceHandle>();

  private constructor() {}

  public static async load(options: {
    readonly configurationPaths: readonly string[];
    readonly allowedWorkspaceRoot: string;
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
      service.#workspaces.set(config.workspace.id, {
        config,
        generator: createGenerator(config),
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
