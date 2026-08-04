import { randomUUID } from 'node:crypto';

import {
  createSiteId,
  createWorkspaceId,
  type Site,
  type SiteAuditEvent,
  type SiteCapabilities,
  type SiteDiscoveryCandidate,
} from '@blog-studio/core';
import type {
  SiteRecord,
  SqliteSiteRepository,
} from '@blog-studio/persistence';

import type { WorkspaceHandle, WorkspaceService } from './workspaces.js';

export class SiteNotFoundError extends Error {
  public constructor(readonly siteId: string) {
    super(`Unknown Site: ${siteId}`);
    this.name = 'SiteNotFoundError';
  }
}

export class SiteCandidateNotFoundError extends Error {
  public constructor(readonly candidateId: string) {
    super(`Unknown Site candidate: ${candidateId}`);
    this.name = 'SiteCandidateNotFoundError';
  }
}

export class SiteValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SiteValidationError';
  }
}

function capabilities(workspace: WorkspaceHandle): SiteCapabilities {
  return {
    generator: workspace.generator.id,
    generatorPreview: workspace.generator.capabilities.preview,
    nativeDrafts: workspace.generator.capabilities.drafts,
    createDocuments: workspace.generator.createDocument !== undefined,
    assetProvider: workspace.config.assets.adapter,
    resourceMediaTypes: workspace.config.resources?.allowedMediaTypes ?? [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'application/zip',
      'text/plain',
    ],
    inlinePreviewResourceMediaTypes: workspace.config.resources
      ?.inlinePreviewMediaTypes ?? [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
    ],
    maxResourceBytes:
      workspace.config.resources?.maxInputBytes ?? 12 * 1024 * 1024,
    publishProvider: workspace.config.publish.adapter,
    publishConfigured: workspace.config.publish.adapter !== 'none',
  };
}

function capabilityRecord(
  value: SiteCapabilities,
): Readonly<Record<string, unknown>> {
  return { ...value };
}

function storedCapabilities(
  value: Readonly<Record<string, unknown>>,
): SiteCapabilities {
  const requiredBooleans = [
    'generatorPreview',
    'nativeDrafts',
    'createDocuments',
    'publishConfigured',
  ] as const;
  const requiredStrings = [
    'generator',
    'assetProvider',
    'publishProvider',
  ] as const;
  if (
    requiredBooleans.some((key) => typeof value[key] !== 'boolean') ||
    requiredStrings.some((key) => typeof value[key] !== 'string') ||
    typeof value.maxResourceBytes !== 'number' ||
    !Array.isArray(value.resourceMediaTypes) ||
    value.resourceMediaTypes.some((item) => typeof item !== 'string')
  ) {
    throw new Error('Stored Site capabilities are invalid');
  }
  const inlinePreviewResourceMediaTypes =
    value.inlinePreviewResourceMediaTypes === undefined
      ? []
      : value.inlinePreviewResourceMediaTypes;
  if (
    !Array.isArray(inlinePreviewResourceMediaTypes) ||
    inlinePreviewResourceMediaTypes.some((item) => typeof item !== 'string')
  ) {
    throw new Error('Stored Site capabilities are invalid');
  }
  return {
    ...value,
    inlinePreviewResourceMediaTypes,
  } as unknown as SiteCapabilities;
}

function publicSite(record: SiteRecord): Site {
  return {
    id: createSiteId(record.id),
    displayName: record.displayName,
    ...(record.canonicalUrl ? { canonicalUrl: record.canonicalUrl } : {}),
    capabilities: storedCapabilities(record.capabilities),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SiteValidationError('Site canonical URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SiteValidationError('Site canonical URL must use HTTP or HTTPS');
  }
  return parsed.toString();
}

export class SiteService {
  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly repository: SqliteSiteRepository,
  ) {}

  public list(): readonly Site[] {
    return this.repository.list().map(publicSite);
  }

  public get(siteId: string): Site {
    const site = this.repository.get(siteId);
    if (!site) throw new SiteNotFoundError(siteId);
    return publicSite(site);
  }

  public workspaceId(siteId: string): string {
    const site = this.repository.get(siteId);
    if (!site) throw new SiteNotFoundError(siteId);
    return site.workspaceId;
  }

  public events(siteId: string): readonly SiteAuditEvent[] {
    this.get(siteId);
    return this.repository.events(siteId).map((event) => ({
      ...event,
      siteId: createSiteId(event.siteId),
    }));
  }

  public async discover(): Promise<readonly SiteDiscoveryCandidate[]> {
    const registered = new Set(
      this.repository.list().map((site) => site.workspaceId),
    );
    return await Promise.all(
      this.workspaces
        .list()
        .filter((workspace) => !registered.has(workspace.config.workspace.id))
        .map(async (workspace) => {
          const root = workspace.config.workspace.root;
          const [detection, model] = await Promise.all([
            workspace.generator.detect(root),
            workspace.generator.inspect(root),
          ]);
          const repository = await workspace.repository
            .status(createWorkspaceId(workspace.config.workspace.id), root)
            .then((status) => ({
              available: true as const,
              branch: status.branch,
              head: status.head,
              dirtyCount: status.dirtyPaths.length,
              ahead: status.ahead,
              behind: status.behind,
            }))
            .catch((error: unknown) => ({
              available: false as const,
              diagnostic:
                error instanceof Error
                  ? error.message
                  : 'Repository status is unavailable',
            }));
          const counts: Record<string, number> = {};
          await Promise.all(
            model.collections.map(async (collection) => {
              counts[collection.id] = (
                await workspace.generator.listDocuments(root, collection.id)
              ).length;
            }),
          );
          const configuredUrl =
            workspace.config.site?.canonicalUrl ??
            model.siteUrl ??
            workspace.config.verification?.baseUrl;
          const normalizedUrl = canonicalUrl(configuredUrl);
          return {
            candidateId: createWorkspaceId(workspace.config.workspace.id),
            proposedDisplayName:
              workspace.config.site?.displayName ??
              workspace.config.workspace.id,
            ...(normalizedUrl ? { canonicalUrl: normalizedUrl } : {}),
            contentCounts: counts,
            capabilities: capabilities(workspace),
            repository,
            diagnostics: [...detection.diagnostics, ...model.diagnostics],
            advanced: {
              workspaceId: createWorkspaceId(workspace.config.workspace.id),
              workspaceRoot: workspace.config.workspace.root,
              configurationPath: workspace.configurationPath,
            },
          } satisfies SiteDiscoveryCandidate;
        }),
    );
  }

  public register(input: {
    readonly candidateId: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
    readonly at?: string;
  }): Site {
    let workspace: WorkspaceHandle;
    try {
      workspace = this.workspaces.get(input.candidateId);
    } catch {
      throw new SiteCandidateNotFoundError(input.candidateId);
    }
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) {
      throw new SiteValidationError(
        'Site display name must contain 1 to 120 characters',
      );
    }
    const at = input.at ?? new Date().toISOString();
    const nextUrl = canonicalUrl(input.canonicalUrl);
    return publicSite(
      this.repository.create({
        id: `site-${randomUUID()}`,
        workspaceId: workspace.config.workspace.id,
        displayName,
        ...(nextUrl ? { canonicalUrl: nextUrl } : {}),
        configurationPath: workspace.configurationPath,
        capabilities: capabilityRecord(capabilities(workspace)),
        createdAt: at,
        updatedAt: at,
      }),
    );
  }

  public update(input: {
    readonly siteId: string;
    readonly expectedUpdatedAt: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
    readonly at?: string;
  }): Site {
    const existing = this.repository.get(input.siteId);
    if (!existing) throw new SiteNotFoundError(input.siteId);
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) {
      throw new SiteValidationError(
        'Site display name must contain 1 to 120 characters',
      );
    }
    const nextUrl = canonicalUrl(input.canonicalUrl);
    const requestedAt = input.at ?? new Date().toISOString();
    const requestedTime = Date.parse(requestedAt);
    const existingTime = Date.parse(existing.updatedAt);
    if (!Number.isFinite(requestedTime) || !Number.isFinite(existingTime))
      throw new SiteValidationError('Site revision timestamp is invalid');
    const updatedAt = new Date(
      Math.max(requestedTime, existingTime + 1),
    ).toISOString();
    return publicSite(
      this.repository.update({
        id: input.siteId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        displayName,
        ...(nextUrl ? { canonicalUrl: nextUrl } : {}),
        capabilities: existing.capabilities,
        updatedAt,
      }),
    );
  }
}
