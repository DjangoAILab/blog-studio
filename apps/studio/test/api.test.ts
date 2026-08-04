import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudioApi } from '../src/app/api.js';

describe('StudioApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends owner passwords without the legacy token field', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ csrfToken: 'rotated-csrf' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new StudioApi('').login('owner browser passphrase');

    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/session');
    if (typeof request?.body !== 'string')
      throw new Error('Expected a JSON string request body');
    expect(JSON.parse(request.body)).toEqual({
      password: 'owner browser passphrase',
    });
    expect(request.body).not.toContain('token');
  });

  it('sends only the versioned draft contract to the server', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ draft: { version: 4 } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new StudioApi('csrf-token');
    await api.saveDraft({
      workspaceId: 'personal-blog',
      documentId: 'hello-world',
      collection: 'posts',
      expectedVersion: 3,
      sourceRevision: 'sha256:source',
      frontMatter: { title: 'Hello', custom: 'preserved' },
      body: '# Hello',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      '/api/workspaces/personal-blog/documents/hello-world/draft?collection=posts',
    );
    if (typeof request?.body !== 'string')
      throw new Error('Expected a JSON string request body');
    expect(JSON.parse(request.body)).toEqual({
      expectedVersion: 3,
      sourceRevision: 'sha256:source',
      frontMatter: { title: 'Hello', custom: 'preserved' },
      body: '# Hello',
    });
    expect(request?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-token',
    });
  });

  it('queries and saves content through the Site-first working-copy contract', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ content: { items: [] } }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = new StudioApi('csrf-token');

    await api.content('site-one', {
      search: 'hello world',
      state: 'modified',
      tag: 'release',
      page: 2,
      pageSize: 10,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/sites/site-one/content?search=hello+world&state=modified&tag=release&page=2&pageSize=10',
    );

    await api.saveWorkingCopy({
      siteId: 'site-one',
      documentId: 'hello-world',
      collection: 'published posts',
      expectedVersion: 3,
      sourceRevision: 'sha256:source',
      frontMatter: { title: 'Edited' },
      body: '# Edited',
    });
    const [url, request] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe(
      '/api/sites/site-one/content/hello-world/working-copy?collection=published%20posts',
    );
    expect(request?.method).toBe('PUT');
    expect(request?.headers).toMatchObject({ 'x-csrf-token': 'csrf-token' });
    if (typeof request?.body !== 'string')
      throw new Error('Expected a JSON string request body');
    expect(JSON.parse(request.body)).toEqual({
      expectedVersion: 3,
      sourceRevision: 'sha256:source',
      frontMatter: { title: 'Edited' },
      body: '# Edited',
    });

    await api.startContentPreview({
      siteId: 'site-one',
      documentId: 'hello-world',
      collection: 'published posts',
      mode: 'enhanced',
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      '/api/sites/site-one/content/hello-world/preview?collection=published+posts&mode=enhanced',
    );
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST');

    await api.stopContentPreview('site-one');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/sites/site-one/preview');
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('DELETE');

    await api.uploadResource({
      siteId: 'site-one',
      documentId: 'hello-world',
      collection: 'posts',
      file: new File(['%PDF-1.7'], 'Guide 终稿.pdf', {
        type: 'application/pdf',
      }),
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      '/api/sites/site-one/content/hello-world/resources?collection=posts',
    );
    expect(fetchMock.mock.calls[4]?.[1]?.headers).toMatchObject({
      'content-type': 'application/pdf',
      'x-blog-studio-filename': 'Guide%20%E7%BB%88%E7%A8%BF.pdf',
    });
  });

  it('uses the Site-first onboarding, settings, and audit contracts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ sites: [], candidates: [], events: [] }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = new StudioApi('csrf-token');

    await api.setupStatus();
    await api.sites();
    await api.discoverSites();
    await api.site('site-one');
    await api.registerSite({
      candidateId: 'workspace-one',
      displayName: 'My Site',
      canonicalUrl: 'https://example.test',
    });
    await api.updateSite({
      siteId: 'site-one',
      expectedUpdatedAt: '2026-08-04T00:00:00.000Z',
      displayName: 'Renamed Site',
    });
    await api.siteEvents('site-one');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/setup/status',
      '/api/sites',
      '/api/sites/discover',
      '/api/sites/site-one',
      '/api/sites',
      '/api/sites/site-one',
      '/api/sites/site-one/events',
    ]);
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        candidateId: 'workspace-one',
        displayName: 'My Site',
        canonicalUrl: 'https://example.test',
      }),
    });
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({
        expectedUpdatedAt: '2026-08-04T00:00:00.000Z',
        displayName: 'Renamed Site',
      }),
    });
  });

  it('starts a release with the exact saved draft version', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          release: { id: 'release-one', status: 'queued', stages: [] },
          events: [],
        }),
        { headers: { 'content-type': 'application/json' }, status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new StudioApi('csrf-token').startRelease({
      workspaceId: 'personal-blog',
      targetId: 'production',
      draft: {
        collectionId: 'posts',
        documentId: 'hello-world',
        version: 4,
      },
    });

    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/workspaces/personal-blog/releases');
    expect(request?.method).toBe('POST');
    if (typeof request?.body !== 'string')
      throw new Error('Expected a JSON string request body');
    expect(JSON.parse(request.body)).toEqual({
      targetId: 'production',
      draft: {
        collectionId: 'posts',
        documentId: 'hello-world',
        version: 4,
      },
    });
  });
});
