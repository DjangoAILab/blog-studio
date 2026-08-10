import { readFile } from 'node:fs/promises';

import {
  CURRENT_SESSION_VERSION,
  parseSessionEntries,
} from '@earendil-works/pi-coding-agent';

export type PiTranscriptProblem =
  'missing' | 'empty' | 'corrupt' | 'incompatible';

export class PiTranscriptError extends Error {
  public constructor(
    readonly problem: PiTranscriptProblem,
    readonly path: string,
  ) {
    super(`Pi transcript is ${problem}: ${path}`);
    this.name = 'PiTranscriptError';
  }
}

export interface PiTranscriptIdentity {
  readonly sessionId: string;
  readonly version: number;
}

/** Validate without opening or migrating the sole transcript source. */
export async function validatePiTranscript(
  path: string,
): Promise<PiTranscriptIdentity> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PiTranscriptError('missing', path);
    }
    throw error;
  }
  if (!content.trim()) throw new PiTranscriptError('empty', path);
  let entries;
  try {
    entries = parseSessionEntries(content);
  } catch {
    throw new PiTranscriptError('corrupt', path);
  }
  const header = entries[0];
  if (
    header?.type !== 'session' ||
    typeof header.id !== 'string' ||
    typeof header.version !== 'number'
  ) {
    throw new PiTranscriptError('corrupt', path);
  }
  if (header.version > CURRENT_SESSION_VERSION) {
    throw new PiTranscriptError('incompatible', path);
  }
  return { sessionId: header.id, version: header.version };
}
