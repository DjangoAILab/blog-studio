import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PiTranscriptError, validatePiTranscript } from '../src/index.js';

describe('Pi transcript validation', () => {
  it('classifies missing, corrupt, and newer incompatible transcripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-transcript-'));
    const missing = join(root, 'missing.jsonl');
    await expect(validatePiTranscript(missing)).rejects.toMatchObject({
      problem: 'missing',
    });

    const corrupt = join(root, 'corrupt.jsonl');
    await writeFile(corrupt, '{not-json}\n');
    await expect(validatePiTranscript(corrupt)).rejects.toMatchObject({
      problem: 'corrupt',
    });

    const incompatible = join(root, 'future.jsonl');
    await writeFile(
      incompatible,
      `${JSON.stringify({
        type: 'session',
        version: 999,
        id: 'future-session',
        timestamp: '2026-08-10T00:00:00.000Z',
        cwd: '/workspace',
      })}\n`,
    );
    await expect(validatePiTranscript(incompatible)).rejects.toMatchObject({
      problem: 'incompatible',
    });
  });

  it('returns the durable identity from a supported header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-studio-transcript-'));
    const path = join(root, 'session.jsonl');
    await writeFile(
      path,
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-session-one',
        timestamp: '2026-08-10T00:00:00.000Z',
        cwd: '/workspace',
      })}\n`,
    );
    await expect(validatePiTranscript(path)).resolves.toEqual({
      sessionId: 'pi-session-one',
      version: 3,
    });
    expect(PiTranscriptError).toBeDefined();
  });
});
