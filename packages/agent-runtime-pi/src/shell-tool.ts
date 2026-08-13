import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { SiteToolMutationRunner } from './mutation-runner.js';
import { assertSitePath } from './site-path.js';

const execute = promisify(execFile);
const maxOutput = 80_000;

function clip(value: string): string {
  return value.length <= maxOutput
    ? value
    : `${value.slice(0, maxOutput)}\n… truncated …`;
}

export function createSiteShellTool(
  siteRoot: string,
  runMutation?: SiteToolMutationRunner,
): ToolDefinition {
  return defineTool({
    name: 'bash',
    label: 'Shell',
    description:
      'Run a shell command with the Site workspace as the working directory. Use for builds, scripts, and inspections that file tools cannot do. Stay inside this Site.',
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 8000 }),
    }),
    execute: async (toolCallId, parameters) => {
      const root = await assertSitePath(siteRoot);
      const operation = async () => {
        try {
          const result = await execute('bash', ['-lc', parameters.command], {
            cwd: root,
            timeout: 60_000,
            maxBuffer: 2 * 1024 * 1024,
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              LANG: process.env.LANG,
              TERM: 'dumb',
            },
          });
          return clip(
            `${result.stdout}${result.stderr}`.trimEnd() || '(no output)',
          );
        } catch (error) {
          const failed = error as {
            readonly stdout?: string;
            readonly stderr?: string;
            readonly message?: string;
          };
          const text = clip(
            [failed.stdout, failed.stderr, failed.message]
              .filter(Boolean)
              .join('\n') || 'Command failed',
          );
          throw new Error(text);
        }
      };
      const text = runMutation
        ? await runMutation({
            toolCallId,
            toolName: 'bash',
            paths: ['.'],
            operation,
          })
        : await operation();
      return {
        content: [
          {
            type: 'text',
            text: typeof text === 'string' ? text : String(text),
          },
        ],
        details: {},
      };
    },
  });
}
