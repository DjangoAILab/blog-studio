import {
  createSiteFileTools,
  createStructuredGitTools,
  type SiteToolMutationRunner,
} from '@blog-studio/agent-runtime-pi';

export interface CreateSiteAgentToolsOptions {
  readonly siteRoot: string;
  readonly runMutation?: SiteToolMutationRunner;
}

/**
 * Assemble the complete hard-allowed Site tool surface. General shell and
 * free-form Git are impossible because they have no definition here.
 */
export function createStudioSiteAgentTools(
  options: CreateSiteAgentToolsOptions,
) {
  return [
    ...createSiteFileTools(options.siteRoot, options.runMutation),
    ...createStructuredGitTools(options.siteRoot, options.runMutation),
  ];
}
