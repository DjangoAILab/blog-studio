import type { SiteWriteLocks } from './site-write-lock.js';

export type SiteMutationApprovalMode = 'approval' | 'yolo';
export type SiteMutationApprovalDecision = 'approved' | 'rejected';

export interface SiteMutationRequest {
  readonly siteId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly paths: readonly string[];
  readonly mode: SiteMutationApprovalMode;
}

export class SiteMutationRejectedError extends Error {
  public constructor(readonly request: SiteMutationRequest) {
    super(`Agent mutation ${request.toolCallId} was rejected`);
    this.name = 'SiteMutationRejectedError';
  }
}

export type SiteMutationApprovalGate = (
  request: SiteMutationRequest,
) => Promise<SiteMutationApprovalDecision>;

/**
 * Applies the same hard serialization boundary to approval and YOLO turns.
 * Approval happens while holding the Site writer lock so the reviewed state
 * cannot be overtaken by another mutating Session before execution.
 */
export class SiteMutationPolicy {
  public constructor(
    private readonly locks: SiteWriteLocks,
    private readonly approvalGate: SiteMutationApprovalGate,
  ) {}

  public async run<T>(
    request: SiteMutationRequest,
    operation: () => Promise<T>,
  ): Promise<T> {
    return await this.locks.run(request.siteId, async () => {
      if (
        request.mode === 'approval' &&
        (await this.approvalGate(request)) !== 'approved'
      ) {
        throw new SiteMutationRejectedError(request);
      }
      return await operation();
    });
  }
}
