import { describe, expect, it } from 'vitest';

import {
  TencentCacheProvider,
  type TencentCacheClient,
  type TencentPurgeRequest,
} from '../src/index.js';

class FakeClient implements TencentCacheClient {
  public readonly submissions: TencentPurgeRequest[] = [];
  public readonly statuses = new Map<
    string,
    'pending' | 'succeeded' | 'failed'
  >();

  public submit(request: TencentPurgeRequest) {
    this.submissions.push(request);
    const taskId = `task-${this.submissions.length}`;
    this.statuses.set(taskId, 'succeeded');
    return Promise.resolve({
      taskId,
      requestId: `request-${this.submissions.length}`,
    });
  }

  public status(input: { readonly taskId: string }) {
    return Promise.resolve(this.statuses.get(input.taskId) ?? 'failed');
  }
}

describe('TencentCacheProvider', () => {
  it('uses official CDN URL/directory batch limits and awaits completion', async () => {
    const client = new FakeClient();
    const provider = new TencentCacheProvider({
      client,
      mode: 'cdn',
      delay: async () => {},
    });
    const result = await provider.invalidate({
      urls: Array.from(
        { length: 1001 },
        (_, index) => `https://blog.example/${index}`,
      ),
      directories: Array.from(
        { length: 501 },
        (_, index) => `https://blog.example/category/${index}/`,
      ),
    });
    expect(client.submissions.map((item) => item.targets.length)).toEqual([
      1000, 1, 500, 1,
    ]);
    expect(client.submissions.map((item) => item.kind)).toEqual([
      'url',
      'url',
      'directory',
      'directory',
    ]);
    expect(result).toMatchObject({ accepted: 1502 });
    expect(result.requestIds).toHaveLength(4);
  });

  it('requires a zone for EdgeOne and uses plan-configurable batches', async () => {
    expect(
      () =>
        new TencentCacheProvider({ client: new FakeClient(), mode: 'edgeone' }),
    ).toThrow(/zoneId/);
    const client = new FakeClient();
    const provider = new TencentCacheProvider({
      client,
      mode: 'edgeone',
      zoneId: 'zone-example',
      edgeOneBatchSize: 2,
      delay: async () => {},
    });
    await provider.invalidate({
      urls: [
        'https://blog.example/a',
        'https://blog.example/b',
        'https://blog.example/c',
      ],
      directories: [],
    });
    expect(client.submissions).toMatchObject([
      { mode: 'edgeone', zoneId: 'zone-example', kind: 'url' },
      { mode: 'edgeone', zoneId: 'zone-example', kind: 'url' },
    ]);
  });

  it('fails explicitly when a purge task fails or never completes', async () => {
    const client = new FakeClient();
    const originalSubmit = client.submit.bind(client);
    client.submit = async (request) => {
      const result = await originalSubmit(request);
      client.statuses.set(result.taskId, 'failed');
      return result;
    };
    const provider = new TencentCacheProvider({
      client,
      mode: 'cdn',
      delay: async () => {},
      maxPollAttempts: 2,
    });
    await expect(
      provider.invalidate({ urls: ['https://blog.example/'], directories: [] }),
    ).rejects.toThrow(/failed/i);
  });
});
