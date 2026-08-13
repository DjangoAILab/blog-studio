import type {
  ChangeSetReview,
  Site,
  SiteAuditEvent,
  SiteDiscoveryCandidate,
  StudioSetupStatus,
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
    readonly sourceChangeSetId?: string;
    readonly sourceCommitId?: string;
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

export interface DevelopmentDetails {
  readonly workspaceId: string;
  readonly status: 'stopped' | 'starting' | 'ready' | 'failed';
  readonly baseUrl?: string;
  readonly previewUrl?: string;
  readonly startedAt?: string;
  readonly message?: string;
  readonly logs: readonly string[];
}

export interface SiteConfigurationDetails {
  readonly siteId: string;
  readonly revision: number;
  readonly yaml: string;
  readonly source: 'legacy' | 'owner' | 'revert';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SiteConfigurationRevision {
  readonly siteId: string;
  readonly revision: number;
  readonly yaml: string;
  readonly source: 'legacy' | 'owner' | 'revert';
  readonly createdAt: string;
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
  readonly stale?: boolean;
  readonly source: {
    readonly ref: {
      readonly documentId: string;
      readonly collectionId: string;
    };
    readonly revision: string;
    readonly frontMatter: Readonly<Record<string, unknown>>;
    readonly frontMatterSource?: string;
    readonly frontMatterParseError?: string;
    readonly body: string;
  };
  readonly draft: null | {
    readonly version: number;
    readonly frontMatter: Readonly<Record<string, unknown>>;
    readonly frontMatterSource?: string;
    readonly body: string;
  };
}

export type ContentState = 'draft' | 'published' | 'modified';
export type ContentSortField =
  | 'activityAt'
  | 'publishedAt'
  | 'contentUpdatedAt'
  | 'filesystemModifiedAt'
  | 'title'
  | 'state'
  | 'path';
export type ContentSortDirection = 'asc' | 'desc';

export interface ContentSummary {
  readonly documentId: string;
  readonly collectionId: string;
  readonly path: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly categories: readonly string[];
  readonly state: ContentState;
  readonly sourceState: 'draft' | 'published' | 'unavailable';
  readonly publishedAt?: string;
  readonly contentUpdatedAt?: string;
  readonly filesystemModifiedAt?: string;
  readonly workingCopySavedAt?: string;
  readonly activityAt?: string;
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
  readonly facets: {
    readonly collections: readonly {
      readonly id: string;
      readonly count: number;
    }[];
    readonly tags: readonly { readonly name: string; readonly count: number }[];
    readonly dateRange: { readonly from?: string; readonly to?: string };
  };
  readonly issues: readonly {
    readonly collectionId: string;
    readonly kind: 'collection-unavailable';
    readonly message: string;
  }[];
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
  readonly storage?: 'local' | 'remote';
}

export type AgentApprovalMode = 'approval' | 'yolo';

export interface AgentPreferenceDefaults {
  readonly global: AgentApprovalMode | null;
  readonly site: AgentApprovalMode | null;
}

export interface AgentSessionSummary {
  readonly id: string;
  readonly siteId: string;
  readonly displayName: string;
  readonly documentId?: string;
  readonly collectionId?: string;
  readonly state: 'active' | 'archived';
  readonly approvalMode?: AgentApprovalMode;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentHistoryEntry {
  readonly id: string;
  readonly kind: 'message' | 'context';
  readonly role: string;
  readonly text?: string;
  readonly imageCount?: number;
  readonly timestamp?: number;
}

export interface AgentTurnSummary {
  readonly id: string;
  readonly status:
    | 'queued'
    | 'running'
    | 'waiting-approval'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'interrupted';
  readonly cancelRequestedAt?: string;
  readonly errorCode?: string;
}

export interface AgentApprovalSummary {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly approvalDecision:
    'not-required' | 'pending' | 'approved' | 'rejected' | 'auto-approved';
  readonly status:
    'requested' | 'running' | 'succeeded' | 'failed' | 'canceled';
  readonly paths: readonly string[];
}

export interface AgentAttachmentSummary {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly status: 'uploaded' | 'processing' | 'ready' | 'failed';
  readonly visionModel?: string;
  readonly messageEntryId?: string;
}

export interface AgentSessionDetails {
  readonly session: AgentSessionSummary;
  readonly effectiveApproval: {
    readonly mode: AgentApprovalMode;
    readonly source: 'session' | 'site' | 'global' | 'default';
  };
  readonly history: readonly AgentHistoryEntry[];
  readonly turns: readonly AgentTurnSummary[];
  readonly approvals: readonly AgentApprovalSummary[];
  readonly attachments: readonly AgentAttachmentSummary[];
}

export type AgentMessageContext =
  | {
      readonly type: 'article';
      readonly documentId: string;
      readonly collectionId: string;
      readonly title?: string;
      readonly path?: string;
    }
  | {
      readonly type: 'editor-buffer';
      readonly documentId: string;
      readonly collectionId: string;
      readonly sourceRevision: string;
      readonly body: string;
    }
  | {
      readonly type: 'markdown-selection';
      readonly documentId: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly text: string;
    }
  | { readonly type: 'preview-error'; readonly message: string }
  | { readonly type: 'diff'; readonly content: string }
  | {
      readonly type: 'change-set';
      readonly changeSetId: string;
      readonly summary?: string;
    }
  | { readonly type: 'file'; readonly path: string }
  | { readonly type: 'attachment'; readonly attachmentId: string }
  | { readonly type: 'image'; readonly attachmentId: string };

export class StudioApiError extends Error {
  public constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'StudioApiError';
  }
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
    const result = (await response.json()) as T & {
      title?: string;
      code?: string;
      details?: Readonly<Record<string, unknown>>;
    };
    if (!response.ok)
      throw new StudioApiError(
        result.title ?? `Request failed: ${response.status}`,
        response.status,
        result.code,
        result.details,
      );
    return result;
  }

  public authStatus() {
    return this.#request<{ initialized: boolean; generation?: number }>(
      '/api/auth/status',
    );
  }

  public setupStatus() {
    return this.#request<StudioSetupStatus>('/api/setup/status');
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

  public changeSets(siteId: string) {
    return this.#request<{ changeSets: readonly ChangeSetReview[] }>(
      `/api/sites/${siteId}/change-sets`,
    );
  }

  public prepareChangeSet(siteId: string) {
    return this.#request<{ changeSet: ChangeSetReview }>(
      `/api/sites/${siteId}/change-sets/prepare`,
      { method: 'POST', body: '{}' },
    );
  }

  public applyChangeSet(siteId: string, changeSetId: string) {
    return this.#request<{ changeSet: ChangeSetReview }>(
      `/api/sites/${siteId}/change-sets/${changeSetId}/apply`,
      { method: 'POST', body: '{}' },
    );
  }

  public commitChangeSet(input: {
    readonly siteId: string;
    readonly changeSetId: string;
    readonly message: string;
    readonly paths: readonly string[];
  }) {
    return this.#request<{ changeSet: ChangeSetReview }>(
      `/api/sites/${input.siteId}/change-sets/${input.changeSetId}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ message: input.message, paths: input.paths }),
      },
    );
  }

  public releaseChangeSet(input: {
    readonly siteId: string;
    readonly changeSetId: string;
    readonly confirmation: string;
    readonly targetId?: string;
  }) {
    return this.#request<{ release: ReleaseDetails }>(
      `/api/sites/${input.siteId}/change-sets/${input.changeSetId}/release`,
      {
        method: 'POST',
        body: JSON.stringify({
          confirmation: input.confirmation,
          ...(input.targetId ? { targetId: input.targetId } : {}),
        }),
      },
    );
  }

  public siteReleases(siteId: string) {
    return this.#request<{ releases: readonly ReleaseDetails[] }>(
      `/api/sites/${siteId}/releases`,
    );
  }

  public siteRelease(siteId: string, releaseId: string) {
    return this.#request<ReleaseDetails>(
      `/api/sites/${siteId}/releases/${releaseId}`,
    );
  }

  public cancelSiteRelease(siteId: string, releaseId: string) {
    return this.#request<ReleaseDetails>(
      `/api/sites/${siteId}/releases/${releaseId}`,
      { method: 'DELETE' },
    );
  }

  public rollbackSiteRelease(siteId: string, releaseId: string) {
    return this.#request<ReleaseDetails>(
      `/api/sites/${siteId}/releases/${releaseId}/rollback`,
      { method: 'POST', body: '{}' },
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
      readonly sort?: ContentSortField;
      readonly direction?: ContentSortDirection;
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
    if (query.sort) parameters.set('sort', query.sort);
    if (query.direction) parameters.set('direction', query.direction);
    if (query.page !== undefined) parameters.set('page', String(query.page));
    if (query.pageSize !== undefined)
      parameters.set('pageSize', String(query.pageSize));
    const suffix = parameters.size > 0 ? `?${parameters.toString()}` : '';
    return this.#request<{ content: ContentQueryResult }>(
      `/api/sites/${siteId}/content${suffix}`,
    );
  }

  public development(siteId: string) {
    return this.#request<{ development: DevelopmentDetails }>(
      `/api/sites/${siteId}/development`,
    );
  }

  public siteConfiguration(siteId: string) {
    return this.#request<{ configuration: SiteConfigurationDetails }>(
      `/api/sites/${siteId}/configuration`,
    );
  }

  public validateSiteConfiguration(siteId: string, yaml: string) {
    return this.#request<{ valid: true }>(
      `/api/sites/${siteId}/configuration/validate`,
      { method: 'POST', body: JSON.stringify({ yaml }) },
    );
  }

  public siteConfigurationHistory(siteId: string) {
    return this.#request<{
      revisions: readonly SiteConfigurationRevision[];
    }>(`/api/sites/${siteId}/configuration/history`);
  }

  public activateSiteConfiguration(input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly yaml: string;
  }) {
    return this.#request<{ configuration: SiteConfigurationDetails }>(
      `/api/sites/${input.siteId}/configuration`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: input.expectedRevision,
          yaml: input.yaml,
        }),
      },
    );
  }

  public updateSiteLifecycle(input: {
    readonly siteId: string;
    readonly expectedUpdatedAt: string;
    readonly lifecycleState: 'active' | 'paused' | 'unregistered';
  }) {
    return this.#request<{ site: Site }>(
      `/api/sites/${input.siteId}/lifecycle`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  public revertSiteConfiguration(input: {
    readonly siteId: string;
    readonly expectedRevision: number;
    readonly revision: number;
  }) {
    return this.#request<{ configuration: SiteConfigurationDetails }>(
      `/api/sites/${input.siteId}/configuration/revert`,
      {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: input.expectedRevision,
          revision: input.revision,
        }),
      },
    );
  }

  public controlDevelopment(
    siteId: string,
    action: 'start' | 'restart' | 'stop',
  ) {
    if (action === 'stop')
      return this.#request<{ development: DevelopmentDetails }>(
        `/api/sites/${siteId}/development`,
        { method: 'DELETE' },
      );
    return this.#request<{ development: DevelopmentDetails }>(
      `/api/sites/${siteId}/development`,
      { method: 'POST', body: JSON.stringify({ action }) },
    );
  }

  public siteDocument(siteId: string, documentId: string, collection: string) {
    return this.#request<DocumentPayload & { readonly stale: boolean }>(
      `/api/sites/${siteId}/content/${documentId}?collection=${encodeURIComponent(collection)}`,
    );
  }

  public createContent(
    siteId: string,
    input: { readonly title: string; readonly slug?: string },
  ) {
    return this.#request<DocumentPayload>(`/api/sites/${siteId}/content`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
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
    return this.#request<{
      draft: { version: number };
      source: DocumentPayload['source'];
    }>(
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

  public repairFrontMatter(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly sourceRevision: string;
    readonly frontMatterSource: string;
  }) {
    return this.#request<{ source: DocumentPayload['source'] }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/repair-front-matter?collection=${encodeURIComponent(input.collection)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceRevision: input.sourceRevision,
          frontMatterSource: input.frontMatterSource,
        }),
      },
    );
  }

  public publishDraft(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly expectedRevision: string;
  }) {
    return this.#request<DocumentPayload>(
      `/api/sites/${input.siteId}/content/${input.documentId}/publish?collection=${encodeURIComponent(input.collection)}`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: input.expectedRevision }),
      },
    );
  }

  public deleteContent(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
  }) {
    return this.#request<{ deleted: true }>(
      `/api/sites/${input.siteId}/content/${input.documentId}?collection=${encodeURIComponent(input.collection)}`,
      { method: 'DELETE' },
    );
  }

  public agentAttachmentUrl(
    siteId: string,
    sessionId: string,
    attachmentId: string,
    download = false,
  ): string {
    const parameters = download ? '?download=1' : '';
    return `/api/sites/${siteId}/agent/sessions/${sessionId}/attachments/${attachmentId}${parameters}`;
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

  public discardUnavailableWorkingCopy(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly expectedVersion: number;
  }) {
    return this.#request<{ discarded: true }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/unavailable-working-copy`,
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
        readonly storage: 'local' | 'remote';
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

  public agentSessions(siteId: string, includeArchived = false) {
    return this.#request<{ sessions: readonly AgentSessionSummary[] }>(
      `/api/sites/${siteId}/agent/sessions?includeArchived=${includeArchived}`,
    );
  }

  public agentPreferenceDefaults(siteId: string) {
    return this.#request<AgentPreferenceDefaults>(
      `/api/sites/${siteId}/agent/preferences`,
    );
  }

  public updateAgentPreferenceDefaults(input: {
    readonly siteId: string;
    readonly scope: 'global' | 'site';
    readonly mode: AgentApprovalMode | null;
  }) {
    return this.#request<AgentPreferenceDefaults>(
      `/api/sites/${input.siteId}/agent/preferences`,
      {
        method: 'PUT',
        body: JSON.stringify({ scope: input.scope, mode: input.mode }),
      },
    );
  }

  public createAgentSession(input: {
    readonly siteId: string;
    readonly displayName: string;
    readonly approvalMode?: AgentApprovalMode;
    readonly documentId?: string;
    readonly collectionId?: string;
  }) {
    return this.#request<AgentSessionSummary>(
      `/api/sites/${input.siteId}/agent/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          displayName: input.displayName,
          ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
          ...(input.documentId && input.collectionId
            ? {
                documentId: input.documentId,
                collectionId: input.collectionId,
              }
            : {}),
        }),
      },
    );
  }

  public agentSession(siteId: string, sessionId: string) {
    return this.#request<AgentSessionDetails>(
      `/api/sites/${siteId}/agent/sessions/${sessionId}`,
    );
  }

  public updateAgentSession(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly displayName?: string;
    readonly approvalMode?: AgentApprovalMode | null;
  }) {
    return this.#request<AgentSessionSummary>(
      `/api/sites/${input.siteId}/agent/sessions/${input.sessionId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.approvalMode !== undefined
            ? { approvalMode: input.approvalMode }
            : {}),
        }),
      },
    );
  }

  public archiveAgentSession(siteId: string, sessionId: string) {
    return this.#request<AgentSessionSummary>(
      `/api/sites/${siteId}/agent/sessions/${sessionId}/archive`,
      { method: 'POST', body: '{}' },
    );
  }

  public restoreAgentSession(siteId: string, sessionId: string) {
    return this.#request<AgentSessionSummary>(
      `/api/sites/${siteId}/agent/sessions/${sessionId}/restore`,
      { method: 'POST', body: '{}' },
    );
  }

  public submitAgentMessage(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly text: string;
    readonly contexts?: readonly AgentMessageContext[];
    readonly attachmentIds?: readonly string[];
  }) {
    return this.#request<AgentTurnSummary>(
      `/api/sites/${input.siteId}/agent/sessions/${input.sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: input.text,
          ...(input.contexts ? { contexts: input.contexts } : {}),
          ...(input.attachmentIds
            ? { attachmentIds: input.attachmentIds }
            : {}),
        }),
      },
    );
  }

  public cancelAgentTurn(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly turnId: string;
  }) {
    return this.#request<AgentTurnSummary>(
      `/api/sites/${input.siteId}/agent/sessions/${input.sessionId}/turns/${input.turnId}/cancel`,
      { method: 'POST', body: '{}' },
    );
  }

  public decideAgentApproval(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly toolCallId: string;
    readonly decision: 'approved' | 'rejected';
  }) {
    return this.#request<AgentApprovalSummary>(
      `/api/sites/${input.siteId}/agent/sessions/${input.sessionId}/turns/${input.turnId}/approvals/${input.toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: input.decision }),
      },
    );
  }

  public uploadAgentAttachment(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly file: File;
  }) {
    return this.#request<{ attachment: AgentAttachmentSummary }>(
      `/api/sites/${input.siteId}/agent/sessions/${input.sessionId}/attachments`,
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

  public retryAgentVision(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly attachmentId: string;
  }) {
    return this.#request<{ attachment: AgentAttachmentSummary }>(
      `/api/sites/${input.siteId}/agent/sessions/${input.sessionId}/attachments/${input.attachmentId}/vision/retry`,
      { method: 'POST', body: '{}' },
    );
  }

  public agentEventsUrl(siteId: string, sessionId: string, after = 0): string {
    return `/api/sites/${siteId}/agent/sessions/${sessionId}/events?after=${after}`;
  }

  public orphanResources(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
  }) {
    return this.#request<{ plan: OrphanAssetPlan }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/resources/orphans?collection=${encodeURIComponent(input.collection)}`,
    );
  }

  public deleteOrphanResources(input: {
    readonly siteId: string;
    readonly documentId: string;
    readonly collection: string;
    readonly confirmation: string;
  }) {
    return this.#request<{ deleted: readonly string[]; count: number }>(
      `/api/sites/${input.siteId}/content/${input.documentId}/resources/orphans?collection=${encodeURIComponent(input.collection)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: input.confirmation }),
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
