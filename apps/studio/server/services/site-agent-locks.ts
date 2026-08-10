import {
  SiteMutationPolicy,
  SiteWriteLocks,
  type SiteMutationApprovalGate,
  type SiteMutationApprovalMode,
  type SiteToolMutationRunner,
} from '@blog-studio/agent-runtime-pi';

/** One shared coordinator must be owned by the Studio server process. */
export class SiteAgentMutationCoordinator {
  readonly #locks = new SiteWriteLocks();

  public policy(approvalGate: SiteMutationApprovalGate): SiteMutationPolicy {
    return new SiteMutationPolicy(this.#locks, approvalGate);
  }

  public runner(input: {
    readonly siteId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly mode: SiteMutationApprovalMode;
    readonly approvalGate: SiteMutationApprovalGate;
  }): SiteToolMutationRunner {
    const policy = this.policy(input.approvalGate);
    return async (mutation) =>
      await policy.run(
        {
          siteId: input.siteId,
          sessionId: input.sessionId,
          turnId: input.turnId,
          toolCallId: mutation.toolCallId,
          toolName: mutation.toolName,
          paths: mutation.paths,
          mode: input.mode,
        },
        mutation.operation,
      );
  }
}
