export interface WorkspaceSummary {
  readonly id: string;
  readonly generator: string;
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

  public async login(token: string): Promise<void> {
    const result = await this.#request<{ csrfToken: string }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    this.setCsrfToken(result.csrfToken);
  }

  public workspaces() {
    return this.#request<{ workspaces: readonly WorkspaceSummary[] }>(
      '/api/workspaces',
    );
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

  public startPreview(
    workspaceId: string,
    documentId: string,
    collection = 'posts',
  ) {
    return this.#request<{ preview: { id: string; url: string } }>(
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
