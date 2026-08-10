import {
  defineTool,
  type AgentToolResult,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { StructuredSiteGit } from './structured-git.js';
import type { SiteToolMutationRunner } from './mutation-runner.js';

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} };
}

/** Pi custom tools backed by fixed-shape local Git operations. */
export function createStructuredGitTools(
  siteRoot: string,
  runMutation?: SiteToolMutationRunner,
): ToolDefinition[] {
  const git = new StructuredSiteGit(siteRoot);
  const tools: ToolDefinition[] = [
    defineTool({
      name: 'git_status',
      label: 'Git status',
      description: 'Inspect local working-tree status for the current Site.',
      parameters: Type.Object({}),
      execute: async () => textResult(await git.status()),
    }),
    defineTool({
      name: 'git_diff',
      label: 'Git diff',
      description:
        'Inspect local unstaged changes, optionally for one Site path.',
      parameters: Type.Object({
        path: Type.Optional(Type.String({ maxLength: 4096 })),
      }),
      execute: async (_toolCallId, parameters) =>
        textResult(await git.diff(parameters.path)),
    }),
    defineTool({
      name: 'git_log',
      label: 'Git log',
      description:
        'Inspect a bounded local commit history for the current Site.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      }),
      execute: async (_toolCallId, parameters) =>
        textResult(
          await git.log(
            parameters.limit === undefined ? {} : { limit: parameters.limit },
          ),
        ),
    }),
    defineTool({
      name: 'git_show',
      label: 'Git show',
      description: 'Inspect HEAD, a bounded HEAD ancestor, or a commit hash.',
      parameters: Type.Object({
        revision: Type.String({ maxLength: 64 }),
        path: Type.Optional(Type.String({ maxLength: 4096 })),
      }),
      execute: async (_toolCallId, parameters) =>
        textResult(await git.show(parameters)),
    }),
  ];
  if (runMutation) {
    tools.push(
      defineTool({
        name: 'git_restore_path',
        label: 'Restore tracked path',
        description:
          'Restore exactly one tracked working-tree path from HEAD. This is a mutation.',
        parameters: Type.Object({
          path: Type.String({ minLength: 1, maxLength: 4096 }),
        }),
        execute: async (toolCallId, parameters) => {
          await runMutation({
            toolCallId,
            toolName: 'git_restore_path',
            paths: [parameters.path],
            operation: () => git.restorePath(parameters),
          });
          return textResult(`Restored tracked path: ${parameters.path}`);
        },
      }),
    );
  }
  return tools;
}
