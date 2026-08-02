import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudioApi } from '../src/app/api.js';

describe('StudioApi', () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
