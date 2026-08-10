import {
  createAgentSession,
  SessionManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
} from '@earendil-works/pi-coding-agent';

import { createSiteFileTools } from './site-tools.js';
import { createStructuredGitTools } from './git-tools.js';
import {
  createAttachmentImportTool,
  type SiteAgentAttachmentSource,
} from './attachment-tool.js';
import type { SiteToolMutationRunner } from './mutation-runner.js';
import {
  createAgentTurnReversalTool,
  type AgentTurnReversalSource,
} from './turn-reversal-tool.js';

export interface CreateSiteAgentSessionOptions {
  siteRoot: string;
  agentDir: string;
  sessionManager?: SessionManager;
  modelRuntime?: CreateAgentSessionOptions['modelRuntime'];
  model?: CreateAgentSessionOptions['model'];
  mutationRunner?: SiteToolMutationRunner;
  attachmentSource?: SiteAgentAttachmentSource;
  turnReversalSource?: AgentTurnReversalSource;
}

/** Create an offline-initializable Pi session with only Site-scoped file tools. */
export async function createSiteAgentSession(
  options: CreateSiteAgentSessionOptions,
): Promise<CreateAgentSessionResult> {
  const tools = createSiteFileTools(options.siteRoot, options.mutationRunner);
  const gitTools = createStructuredGitTools(
    options.siteRoot,
    options.mutationRunner,
  );
  const customTools = [...tools, ...gitTools];
  if (options.attachmentSource && options.mutationRunner) {
    customTools.push(
      createAttachmentImportTool(
        options.siteRoot,
        options.attachmentSource,
        options.mutationRunner,
      ),
    );
  }
  if (options.turnReversalSource && options.mutationRunner) {
    customTools.push(
      createAgentTurnReversalTool(
        options.siteRoot,
        options.turnReversalSource,
        options.mutationRunner,
      ),
    );
  }

  return createAgentSession({
    cwd: options.siteRoot,
    agentDir: options.agentDir,
    ...(options.modelRuntime ? { modelRuntime: options.modelRuntime } : {}),
    ...(options.model ? { model: options.model } : {}),
    tools: customTools.map((tool) => tool.name),
    customTools,
    sessionManager:
      options.sessionManager ?? SessionManager.inMemory(options.siteRoot),
  });
}
