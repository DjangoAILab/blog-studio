import {
  defineTool,
  type AgentToolResult,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { lstat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { Type } from 'typebox';

import type { SiteToolMutationRunner } from './mutation-runner.js';
import { assertSitePath } from './site-path.js';

export interface SiteAgentAttachmentSource {
  load(attachmentId: string): Promise<{
    readonly filename: string;
    readonly bytes: Uint8Array;
  }>;
}

/**
 * Copy one Session-owned chat attachment into the Site workspace. The source
 * callback owns Session/Site authorization; this tool owns destination safety.
 */
export function createAttachmentImportTool(
  siteRoot: string,
  source: SiteAgentAttachmentSource,
  runMutation: SiteToolMutationRunner,
): ToolDefinition {
  return defineTool({
    name: 'import_attachment',
    label: 'Import chat attachment',
    description:
      'Copy one uploaded chat attachment into a new file below the current Site root. Existing files are never overwritten.',
    parameters: Type.Object({
      attachmentId: Type.String({ minLength: 1, maxLength: 200 }),
      destination: Type.String({ minLength: 1, maxLength: 4096 }),
    }),
    execute: async (toolCallId, parameters) => {
      const root = await assertSitePath(siteRoot);
      const destination = await assertSitePath(root, parameters.destination);
      const path = relative(root, destination);
      if (!path || path.startsWith('..') || isAbsolute(path)) {
        throw new Error(
          'An attachment destination below the Site root is required',
        );
      }
      const exists = await lstat(destination)
        .then(() => true)
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        });
      if (exists) throw new Error('Attachment destination already exists');

      const attachment = await source.load(parameters.attachmentId);
      await runMutation({
        toolCallId,
        toolName: 'import_attachment',
        paths: [path],
        operation: async () => {
          const executionDestination = await assertSitePath(
            root,
            parameters.destination,
          );
          const executionExists = await lstat(executionDestination)
            .then(() => true)
            .catch((error: unknown) => {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                return false;
              throw error;
            });
          if (executionExists)
            throw new Error('Attachment destination already exists');
          await writeFile(executionDestination, attachment.bytes, {
            flag: 'wx',
          });
        },
      });
      const result: AgentToolResult<unknown> = {
        content: [
          {
            type: 'text',
            text: `Imported ${attachment.filename} to ${path}`,
          },
        ],
        details: {},
      };
      return result;
    },
  });
}
