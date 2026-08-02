import type { ContentHash, ReleaseId } from '@blog-studio/core';

export interface VerifyReleaseInput {
  readonly baseUrl: string;
  readonly markerPath: string;
  readonly expectedReleaseId: ReleaseId;
  readonly expectedVerificationToken: string;
  readonly expectedManifestHash: ContentHash;
  readonly maxAttempts?: number;
}

export interface ReleaseVerifier {
  verify(input: VerifyReleaseInput): Promise<boolean>;
}

export interface HttpReleaseVerifierOptions {
  readonly fetch?: typeof fetch;
  readonly delay?: (attempt: number) => Promise<void>;
}

export class HttpReleaseVerifier implements ReleaseVerifier {
  readonly #fetch: typeof fetch;
  readonly #delay: (attempt: number) => Promise<void>;

  public constructor(options: HttpReleaseVerifierOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#delay =
      options.delay ??
      (async (attempt) => {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      });
  }

  public async verify(input: VerifyReleaseInput): Promise<boolean> {
    const attempts = input.maxAttempts ?? 5;
    if (attempts < 1 || attempts > 10)
      throw new Error('Verification attempts must be between 1 and 10');
    const url = new URL(input.markerPath, input.baseUrl);
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.#fetch(url, {
          headers: { 'cache-control': 'no-cache' },
          redirect: 'error',
        });
        if (response.ok) {
          const marker = (await response.json()) as Record<string, unknown>;
          if (
            marker.releaseId === input.expectedReleaseId &&
            marker.verificationToken === input.expectedVerificationToken &&
            marker.manifestHash === input.expectedManifestHash
          )
            return true;
        }
      } catch {
        // Network and propagation errors are retried within the bounded policy.
      }
      if (attempt < attempts - 1) await this.#delay(attempt);
    }
    return false;
  }
}
