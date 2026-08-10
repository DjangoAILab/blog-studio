import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PiSiteAgentRuntimeFactory,
  type SiteToolMutationRunner,
  validatePiTranscript,
} from '../src/index.js';

describe('Pi Site Agent runtime adapter', () => {
  it('materializes an empty transcript and resumes the same Pi identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-runtime-adapter-'));
    const siteRoot = join(root, 'site');
    const sessionDirectory = join(root, 'sessions');
    await mkdir(siteRoot);
    const factory = new PiSiteAgentRuntimeFactory({
      agentDir: join(root, 'agent'),
    });
    const mutationRunner: SiteToolMutationRunner = async (input) =>
      await input.operation();
    const created = await factory.create({
      siteRoot,
      sessionDirectory,
      mutationRunner,
    });
    const identity = await validatePiTranscript(created.transcriptPath);
    expect(identity.sessionId).toBe(created.piSessionId);
    expect(created.history()).toEqual([]);
    const contextId = created.appendContext('Vision retry result');
    expect(created.history()).toContainEqual(
      expect.objectContaining({
        id: contextId,
        kind: 'context',
        text: 'Vision retry result',
      }),
    );
    created.dispose();

    const resumed = await factory.resume({
      siteRoot,
      sessionDirectory,
      transcriptPath: created.transcriptPath,
      expectedPiSessionId: created.piSessionId,
      mutationRunner,
    });
    expect(resumed.piSessionId).toBe(created.piSessionId);
    expect(resumed.running).toBe(false);
    expect(resumed.history()).toContainEqual(
      expect.objectContaining({ id: contextId, text: 'Vision retry result' }),
    );
    resumed.dispose();
  });
});
