import {
  createSiteFileTools,
  createSiteShellTool,
  createStructuredGitTools,
  type SiteToolMutationRunner,
} from '@blog-studio/agent-runtime-pi';

export interface CreateSiteAgentToolsOptions {
  readonly siteRoot: string;
  readonly runMutation?: SiteToolMutationRunner;
}

/**
 * Assemble the Site tool surface: files, structured Git, and a workspace
 * shell that runs with the Site root as cwd.
 */
export function createStudioSiteAgentTools(
  options: CreateSiteAgentToolsOptions,
) {
  return [
    ...createSiteFileTools(options.siteRoot, options.runMutation),
    ...createStructuredGitTools(options.siteRoot, options.runMutation),
    createSiteShellTool(options.siteRoot, options.runMutation),
  ];
}
