import type {
  Site,
  SiteAuditEvent,
  SiteDiscoveryCandidate,
} from '@blog-studio/core';

export interface WorkspaceSummary {
  readonly id: string;
  readonly generator: string;
  readonly canCreateDocuments: boolean;
  readonly publishTarget: {
    readonly id: string;
    readonly adapter: string;
    readonly configured: boolean;
    readonly baselineAdoption: 'disabled' | 'required' | 'complete';
  };
}

export type ReleaseStatus =
  | 'queued'
  | 'preflight'
  | 'building'
  | 'planning'
  | 'uploading-assets'
  | 'uploading-pages'
  | 'invalidating-cache'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rollback-required'
  | 'rolling-back'
  | 'rolled-back'
  | 'canceled';

export type PreviewFallbackReason =
  | 'missing-output'
  | 'route-error'
  | 'build-error'
  | 'timeout'
  | 'unsupported-engine'
  | 'canceled'
  | 'restart';

interface ReadyPreview {
  readonly id: string;
  readonly mode: 'markdown' | 'enhanced';
  readonly status: 'ready';
  readonly url: string;
  readonly fallbackReason?: PreviewFallbackReason;
}

export interface ReleaseDetails {
  readonly release: {
    readonly id: string;
    readonly targetId: string;
    readonly status: ReleaseStatus;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly previousReleaseId?: string;
    readonly stages: readonly {
      readonly name: string;
      readonly status:
        'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
      readonly startedAt?: string;
      readonly completedAt?: string;
    }[];
  };
  readonly events: readonly {
    readonly at: string;
    readonly stage: string;
    readonly level: 'info' | 'warning' | 'error';
    readonly message: string;
    readonly completed?: number;
    readonly total?: number;
  }[];
}

export interface DocumentSummary {
  readonly ref: {
    readonly documentId: string;
    readonly collectionId: string;
  };
  readonly title: string;
  readonly state: 'draft' | 'published';
  readonly updatedAt?: string;
}

export interface DocumentPayload {
  readonly source: {
    readonly ref: {
      readonly documentId: string;
      readonly collectionId: string;
    };
    readonly revision: string;
    readonly frontMatter: Readonly<Record<string, unknown>>;
    readonly body: string;
  };
  readonly draft: null | {
    readonly version: number;
    readonly frontMatter: Readonly<Record<string, unknown>>;
    readonly body: string;
  };
}

export type ContentState = 'draft' | 'published' | 'modified';

export interface ContentSummary {
  readonly documentId: string;
  readonly collectionId: string;
  readonly path: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly state: ContentState;
  readonly sourceState: 'draft' | 'published';
  readonly updatedAt?: string;
  readonly workingCopy?: {
    readonly version: number;
    readonly savedAt: string;
    readonly sourceRevision: string;
    readonly stale: boolean;
  };
}

export interface ContentQueryResult {
  readonly items: readonly ContentSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly counts: Readonly<Record<'all' | ContentState, number>>;
}

export interface OrphanAssetPlan {
  readonly confirmation: string;
  readonly sourceRevision: string;
  readonly draftVersion: number;
  readonly assets: readonly {
    readonly id: string;
    readonly key: string;
    readonly publicUrl: string;
    readonly byteLength: number;
    readonly contentHash: string;
  }[];
}

export class StudioApi {
  public constructor(private csrfToken: string) {}

  public setCsrfToken(value: string): void {
    this.csrfToken = value;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.method && init.method !== 'GET'
          ? { 'x-csrf-token': this.csrfToken }
          : {}),
        ...init.headers,
      },
    });
    const result = (await response.json()) as T & { title?: string };
    if (!response.ok)
      throw new Error(result.title ?? `Request failed: ${response.status}`);
    return result;
  }

  public authStatus() {
    return this.#request<{ initialized: boolean; generation?: number }>(
      '/api/auth/status',
    );
  }

  public async login(password: string): Promise<void> {
    const result = await this.#request<{ csrfToken: string }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    this.setCsrfToken(result.csrfToken);
  }

  public async changePassword(input: {
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<{ readonly credentialGeneration: number }> {
    const result = await this.#request<{
      credentialGeneration: number;
      csrfToken: string;
    }>('/api/auth/password', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    this.setCsrfToken(result.csrfToken);
    return { credentialGeneration: result.credentialGeneration };
  }

  public logout() {
    return this.#request<{ authenticated: false }>('/api/session', {
      method: 'DELETE',
    });
  }

  public workspaces() {
    return this.#request<{ workspaces: readonly WorkspaceSummary[] }>(
      '/api/workspaces',
    );
  }

  public sites() {
    return this.#request<{ sites: readonly Site[] }>('/api/sites');
  }

  public discoverSites() {
    return this.#request<{
      candidates: readonly SiteDiscoveryCandidate[];
    }>('/api/sites/discover');
  }

  public site(siteId: string) {
    return this.#request<{ site: Site }>(`/api/sites/${siteId}`);
  }

  public registerSite(input: {
    readonly candidateId: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
  }) {
    return this.#request<{ site: Site }>('/api/sites', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public updateSite(input: {
    readonly siteId: string;
    readonly expectedUpdatedAt: string;
    readonly displayName: string;
    readonly canonicalUrl?: string;
  }) {
    const { siteId, ...body } = input;
    return this.#request<{ site: Site }>(`/api/sites/${siteId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  public siteEvents(siteId: string) {
    return this.#request<{ events: readonly SiteAuditEvent[] }>(
      `/api/sites/${siteId}/events`,
    );
  }

  public content(
    siteId: string,
    query: {
      readonly search?: string;
      readonly collection?: string;
      readonly state?: ContentState;
      readonly tag?: string;
      readonly from?: string;
      readonly to?: string;
      readonly page?: number;
      readonly pageSize?: number;
    } = {},
  ) {
    const parameters = new URLSearchParams();
    if (query.search) parameters.set('search', query.search);
    if (query.collection) parameters.set('collection', query.collection);
    if (query.state) parameters.set('state', query.state);
    if (query.tag) parameters.set('tag', query.tag);
    if (query.from) parameters.set('from', query.from);
    if (query.to) parameters.set('to', query.to);
    if (query.page !== undefined) parameters.set('page', String(query.page));
    if (query.pageSize !== undefined)
      parameters.set('pageSize', String(query.pageSize));
    const suffix = parameters.size > 0 ? `?${parameters.toString()}` : '';
    return this.#request<{ content: ContentQueryResult }>(
      `/api/sites/${siteId}/content${suffix}`,
    );
  }

  public siteDocument(siteId: string, documentId: string, collection: string) {
    return this.#request<DocumentPayload & { readonly stale: boolean }>(
      `/api/sites/${siteId}/content/${documentId}?collection=${encodeURIComponent(collection)}`,
    );
  }

  public saveWorkingCopy(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly expectedVersion: number;
    readonly sourceRevision: string;
    readonly frontMatter: Readonly<Record<string, unknown>>;
    readonly body: string;
  }) {
    return this.#request<{ draft: { version: number } }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/working-copy?collection=${encodeURIComponent(input.collection)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedVersion: input.expectedVersion,
          sourceRevision: input.sourceRevision,
          frontMatter: input.frontMatter,
          body: input.body,
        }),
      },
    );
  }

  public discardWorkingCopy(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly expectedVersion: number;
  }) {
    return this.#request<{ discarded: true }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/working-copy?collection=${encodeURIComponent(input.collection)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: input.expectedVersion }),
      },
    );
  }

  public startContentPreview(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly mode?: 'markdown' | 'enhanced';
  }) {
    const parameters = new URLSearchParams({ collection: input.collection });
    if (input.mode) parameters.set('mode', input.mode);
    return this.#request<{
      preview: ReadyPreview;
    }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/preview?${parameters.toString()}`,
      { method: 'POST' },
    );
  }

  public stopContentPreview(siteId: string) {
    return this.#request<{ stopped: boolean }>(`/api/sites/${siteId}/preview`, {
      method: 'DELETE',
    });
  }

  public documents(workspaceId: string, collection = 'posts') {
    return this.#request<{ documents: readonly DocumentSummary[] }>(
      `/api/workspaces/${workspaceId}/documents?collection=${collection}`,
    );
  }

  public document(
    workspaceId: string,
    documentId: string,
    collection = 'posts',
  ) {
    return this.#request<DocumentPayload>(
      `/api/workspaces/${workspaceId}/documents/${documentId}?collection=${collection}`,
    );
  }

  public createDocument(
    workspaceId: string,
    input: { readonly title: string; readonly slug?: string },
  ) {
    return this.#request<DocumentPayload>(
      `/api/workspaces/${workspaceId}/documents`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  public saveDraft(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly expectedVersion: number;
    readonly sourceRevision: string;
    readonly frontMatter: Readonly<Record<string, unknown>>;
    readonly body: string;
  }) {
    return this.#request<{ draft: { version: number } }>(
      `/api/workspaces/${input.workspaceId}/documents/${input.documentId}/draft?collection=${input.collection}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedVersion: input.expectedVersion,
          sourceRevision: input.sourceRevision,
          frontMatter: input.frontMatter,
          body: input.body,
        }),
      },
    );
  }

  public discardDraft(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly expectedVersion: number;
  }) {
    return this.#request<{ discarded: true }>(
      `/api/workspaces/${input.workspaceId}/documents/${input.documentId}/draft?collection=${input.collection}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion: input.expectedVersion }),
      },
    );
  }

  public startPreview(
    workspaceId: string,
    documentId: string,
    collection = 'posts',
  ) {
    return this.#request<{ preview: ReadyPreview }>(
      `/api/workspaces/${workspaceId}/documents/${documentId}/preview?collection=${collection}`,
      { method: 'POST' },
    );
  }

  public releases(workspaceId: string) {
    return this.#request<{ releases: readonly ReleaseDetails[] }>(
      `/api/workspaces/${workspaceId}/releases`,
    );
  }

  public release(workspaceId: string, releaseId: string) {
    return this.#request<ReleaseDetails>(
      `/api/workspaces/${workspaceId}/releases/${releaseId}`,
    );
  }

  public startRelease(input: {
    readonly workspaceId: string;
    readonly targetId: string;
    readonly draft?: {
      readonly collectionId: string;
      readonly documentId: string;
      readonly version: number;
    };
  }) {
    return this.#request<ReleaseDetails>(
      `/api/workspaces/${input.workspaceId}/releases`,
      {
        method: 'POST',
        body: JSON.stringify({
          targetId: input.targetId,
          ...(input.draft ? { draft: input.draft } : {}),
        }),
      },
    );
  }

  public adoptBaseline(workspaceId: string, targetId: string) {
    return this.#request<ReleaseDetails>(
      `/api/workspaces/${workspaceId}/releases/adopt-baseline`,
      {
        method: 'POST',
        body: JSON.stringify({
          targetId,
          confirmation: 'ADOPT EXISTING DEPLOYMENT',
        }),
      },
    );
  }

  public cancelRelease(workspaceId: string, releaseId: string) {
    return this.#request<ReleaseDetails>(
      `/api/workspaces/${workspaceId}/releases/${releaseId}`,
      { method: 'DELETE' },
    );
  }

  public rollbackRelease(workspaceId: string, releaseId: string) {
    return this.#request<ReleaseDetails>(
      `/api/workspaces/${workspaceId}/releases/${releaseId}/rollback`,
      { method: 'POST', body: '{}' },
    );
  }

  public uploadAsset(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly file: File;
  }) {
    return this.#request<{
      asset: { readonly id: string; readonly publicUrl: string };
    }>(
      `/api/workspaces/${input.workspaceId}/documents/${input.documentId}/assets?collection=${input.collection}`,
      {
        method: 'POST',
        body: input.file,
        headers: {
          'content-type': input.file.type,
          'x-blog-studio-filename': encodeURIComponent(input.file.name),
        },
      },
    );
  }

  public uploadResource(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly file: File;
  }) {
    return this.#request<{
      resource: {
        readonly id: string;
        readonly kind: 'image' | 'attachment';
        readonly publicUrl: string;
        readonly mediaType: string;
        readonly insertion: string;
        readonly inlinePreview: boolean;
      };
    }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/resources?collection=${encodeURIComponent(input.collection)}`,
      {
        method: 'POST',
        body: input.file,
        headers: {
          'content-type': input.file.type || 'application/octet-stream',
          'x-blog-studio-filename': encodeURIComponent(input.file.name),
        },
      },
    );
  }

  public orphanAssets(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly collection: string;
  }) {
    return this.#request<{ plan: OrphanAssetPlan }>(
      `/api/workspaces/${input.workspaceId}/documents/${input.documentId}/assets/orphans?collection=${input.collection}`,
    );
  }

  public deleteOrphanAssets(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly confirmation: string;
  }) {
    return this.#request<{ deleted: readonly string[]; count: number }>(
      `/api/workspaces/${input.workspaceId}/documents/${input.documentId}/assets/orphans?collection=${input.collection}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: input.confirmation }),
      },
    );
  }
}

export function csrfFromCookie(): string {
  const pair = document.cookie
    .split('; ')
    .find((value) => value.startsWith('blog_studio_csrf='));
  return pair
    ? (decodeURIComponent(pair.slice(pair.indexOf('=') + 1)).split('.')[0] ??
        '')
    : '';
}
