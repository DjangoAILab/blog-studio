import {
  defineTool,
  type AgentToolResult,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { isAbsolute, relative } from 'node:path';
import { Type } from 'typebox';

import type { SiteToolMutationRunner } from './mutation-runner.js';
import { assertSitePath } from './site-path.js';

export interface AgentTurnReversalSource {
  restore(path: string): Promise<void>;
}

export function createAgentTurnReversalTool(
  siteRoot: string,
  source: AgentTurnReversalSource,
  runMutation: SiteToolMutationRunner,
): ToolDefinition {
  return defineTool({
    name: 'git_revert_agent_path',
    label: 'Revert current Agent change',
    description:
      'Restore one tracked file to its exact state before this Agent turn changed it. Refuses if later work touched the file.',
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
    }),
    execute: async (toolCallId, parameters) => {
      const root = await assertSitePath(siteRoot);
      const absolute = await assertSitePath(root, parameters.path);
      const path = relative(root, absolute);
      if (!path || path.startsWith('..') || isAbsolute(path)) {
        throw new Error('A tracked file below the Site root is required');
      }
      await runMutation({
        toolCallId,
        toolName: 'git_revert_agent_path',
        paths: [path],
        operation: () => source.restore(path),
      });
      const result: AgentToolResult<unknown> = {
        content: [
          { type: 'text', text: `Reverted current Agent change: ${path}` },
        ],
        details: {},
      };
      return result;
    },
  });
}
