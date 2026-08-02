export type BlogStudioErrorCode =
  | 'INVALID_IDENTIFIER'
  | 'INVALID_CONTENT_HASH'
  | 'INVALID_RELEASE_TRANSITION'
  | 'ADAPTER_CAPABILITY_UNAVAILABLE'
  | 'DOCUMENT_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'PROVIDER_OPERATION_FAILED';

export class BlogStudioError extends Error {
  public constructor(
    public readonly code: BlogStudioErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'BlogStudioError';
  }

  public toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
