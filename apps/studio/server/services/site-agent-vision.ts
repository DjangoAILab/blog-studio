export interface SiteAgentVisionInput {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

export interface SiteAgentVisionResult {
  readonly model: string;
  readonly text: string;
}

export interface SiteAgentVisionAdapter {
  readonly configured: boolean;
  interpret(input: SiteAgentVisionInput): Promise<SiteAgentVisionResult>;
}

export class SiteAgentVisionError extends Error {
  public constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SiteAgentVisionError';
  }
}

export class DisabledSiteAgentVisionAdapter implements SiteAgentVisionAdapter {
  public readonly configured = false;

  public interpret(): Promise<SiteAgentVisionResult> {
    return Promise.reject(
      new SiteAgentVisionError(
        'No Site Agent vision model is configured',
        'AGENT_VISION_NOT_CONFIGURED',
      ),
    );
  }
}

export interface OpenAiCompatibleVisionAdapterOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

/** Replaceable adapter for CLIProxy and other OpenAI-compatible vision APIs. */
export class OpenAiCompatibleVisionAdapter implements SiteAgentVisionAdapter {
  public readonly configured = true;

  public constructor(
    private readonly options: OpenAiCompatibleVisionAdapterOptions,
  ) {}

  public async interpret(
    input: SiteAgentVisionInput,
  ): Promise<SiteAgentVisionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 60_000,
    );
    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Describe this image accurately for a writing Agent. Preserve visible text and call out uncertainty. Filename: ${input.filename}`,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${input.mimeType};base64,${input.bytes.toString('base64')}`,
                  },
                },
              ],
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new SiteAgentVisionError(
          `Vision provider returned HTTP ${response.status}`,
          'AGENT_VISION_PROVIDER_ERROR',
        );
      }
      const payload: unknown = await response.json();
      const text = this.#responseText(payload);
      return { model: this.options.model, text };
    } catch (error) {
      if (error instanceof SiteAgentVisionError) throw error;
      throw new SiteAgentVisionError(
        error instanceof Error && error.name === 'AbortError'
          ? 'Vision provider timed out'
          : 'Vision provider request failed',
        'AGENT_VISION_PROVIDER_ERROR',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  #responseText(payload: unknown): string {
    if (payload === null || typeof payload !== 'object') {
      throw new SiteAgentVisionError(
        'Vision provider returned an invalid response',
        'AGENT_VISION_RESPONSE_INVALID',
      );
    }
    const choices = (payload as { readonly choices?: unknown }).choices;
    if (!Array.isArray(choices)) {
      throw new SiteAgentVisionError(
        'Vision provider returned no choices',
        'AGENT_VISION_RESPONSE_INVALID',
      );
    }
    const first: unknown = choices[0];
    const message =
      first !== null && typeof first === 'object'
        ? (first as { readonly message?: unknown }).message
        : undefined;
    const content =
      message !== null && typeof message === 'object'
        ? (message as { readonly content?: unknown }).content
        : undefined;
    if (typeof content !== 'string' || !content.trim()) {
      throw new SiteAgentVisionError(
        'Vision provider returned no interpretation',
        'AGENT_VISION_RESPONSE_INVALID',
      );
    }
    return content.trim();
  }
}
