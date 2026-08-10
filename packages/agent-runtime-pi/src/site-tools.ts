import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
  defineTool,
} from '@earendil-works/pi-coding-agent';
import { lstat, rename, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { Type } from 'typebox';

import { assertSitePath } from './site-path.js';
import type { SiteToolMutationRunner } from './mutation-runner.js';

export class SiteFileMutationInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SiteFileMutationInputError';
  }
}

async function mutablePath(siteRoot: string, input: string): Promise<string> {
  const path = await assertSitePath(siteRoot, input);
  const fromRoot = relative(await assertSitePath(siteRoot), path);
  if (!fromRoot) {
    throw new SiteFileMutationInputError(
      'The Site workspace root cannot be mutated',
    );
  }
  return path;
}

async function rejectSymlinkInput(
  siteRoot: string,
  input: string,
): Promise<void> {
  await assertSitePath(siteRoot, input);
  const lexicalPath = resolve(await assertSitePath(siteRoot), input);
  const metadata = await lstat(lexicalPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (metadata?.isSymbolicLink()) {
    throw new SiteFileMutationInputError(
      'Moving or deleting a symlink is not allowed',
    );
  }
}

/**
 * Pi-native file tools with a Blog Studio Site boundary added before execution.
 * Bash is deliberately absent. Structured Git tools will be separate tools.
 */
export function createSiteFileTools(
  siteRoot: string,
  runMutation?: SiteToolMutationRunner,
): ToolDefinition[] {
  const read = createReadToolDefinition(siteRoot);
  const write = createWriteToolDefinition(siteRoot);
  const edit = createEditToolDefinition(siteRoot);
  const grep = createGrepToolDefinition(siteRoot);
  const find = createFindToolDefinition(siteRoot);
  const ls = createLsToolDefinition(siteRoot);

  const tools = [
    {
      ...read,
      execute: async (...args: Parameters<typeof read.execute>) => {
        const path = await assertSitePath(siteRoot, args[1].path);
        return read.execute(
          args[0],
          { ...args[1], path },
          args[2],
          args[3],
          args[4],
        );
      },
    },
    {
      ...write,
      execute: async (...args: Parameters<typeof write.execute>) => {
        const path = await assertSitePath(siteRoot, args[1].path);
        if (!runMutation) {
          throw new SiteFileMutationInputError(
            'File mutations are unavailable',
          );
        }
        return await runMutation({
          toolCallId: args[0],
          toolName: 'write',
          paths: [relative(await assertSitePath(siteRoot), path)],
          operation: async () => {
            const executionPath = await assertSitePath(siteRoot, args[1].path);
            return write.execute(
              args[0],
              { ...args[1], path: executionPath },
              args[2],
              args[3],
              args[4],
            );
          },
        });
      },
    },
    {
      ...edit,
      execute: async (...args: Parameters<typeof edit.execute>) => {
        const path = await assertSitePath(siteRoot, args[1].path);
        if (!runMutation) {
          throw new SiteFileMutationInputError(
            'File mutations are unavailable',
          );
        }
        return await runMutation({
          toolCallId: args[0],
          toolName: 'edit',
          paths: [relative(await assertSitePath(siteRoot), path)],
          operation: async () => {
            const executionPath = await assertSitePath(siteRoot, args[1].path);
            return edit.execute(
              args[0],
              { ...args[1], path: executionPath },
              args[2],
              args[3],
              args[4],
            );
          },
        });
      },
    },
    {
      ...grep,
      execute: async (...args: Parameters<typeof grep.execute>) => {
        const path = await assertSitePath(siteRoot, args[1].path ?? '.');
        return grep.execute(
          args[0],
          { ...args[1], path },
          args[2],
          args[3],
          args[4],
        );
      },
    },
    {
      ...find,
      execute: async (...args: Parameters<typeof find.execute>) => {
        const path = await assertSitePath(siteRoot, args[1].path ?? '.');
        return find.execute(
          args[0],
          { ...args[1], path },
          args[2],
          args[3],
          args[4],
        );
      },
    },
    {
      ...ls,
      execute: async (...args: Parameters<typeof ls.execute>) => {
        const path = await assertSitePath(siteRoot, args[1].path ?? '.');
        return ls.execute(
          args[0],
          { ...args[1], path },
          args[2],
          args[3],
          args[4],
        );
      },
    },
  ] as ToolDefinition[];
  if (runMutation) {
    tools.push(
      defineTool({
        name: 'delete_path',
        label: 'Delete path',
        description:
          'Delete one file or directory below the Site root. Untracked files have no automatic recovery.',
        parameters: Type.Object({
          path: Type.String({ minLength: 1, maxLength: 4096 }),
        }),
        execute: async (toolCallId, parameters) => {
          await rejectSymlinkInput(siteRoot, parameters.path);
          const path = await mutablePath(siteRoot, parameters.path);
          await runMutation({
            toolCallId,
            toolName: 'delete_path',
            paths: [relative(await assertSitePath(siteRoot), path)],
            operation: async () => {
              await rejectSymlinkInput(siteRoot, parameters.path);
              const executionPath = await mutablePath(
                siteRoot,
                parameters.path,
              );
              await rm(executionPath, { recursive: true });
            },
          });
          return {
            content: [{ type: 'text', text: `Deleted: ${parameters.path}` }],
            details: {},
          };
        },
      }),
      defineTool({
        name: 'move_path',
        label: 'Move path',
        description:
          'Move or rename one Site path without overwriting a destination.',
        parameters: Type.Object({
          source: Type.String({ minLength: 1, maxLength: 4096 }),
          destination: Type.String({ minLength: 1, maxLength: 4096 }),
        }),
        execute: async (toolCallId, parameters) => {
          await rejectSymlinkInput(siteRoot, parameters.source);
          const source = await mutablePath(siteRoot, parameters.source);
          const destination = await mutablePath(
            siteRoot,
            parameters.destination,
          );
          const root = await assertSitePath(siteRoot);
          await runMutation({
            toolCallId,
            toolName: 'move_path',
            paths: [relative(root, source), relative(root, destination)],
            operation: async () => {
              await rejectSymlinkInput(siteRoot, parameters.source);
              const executionSource = await mutablePath(
                siteRoot,
                parameters.source,
              );
              const executionDestination = await mutablePath(
                siteRoot,
                parameters.destination,
              );
              const destinationExists = await lstat(executionDestination)
                .then(() => true)
                .catch((error: unknown) => {
                  if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return false;
                  throw error;
                });
              if (destinationExists) {
                throw new SiteFileMutationInputError(
                  'Move destination already exists',
                );
              }
              await rename(executionSource, executionDestination);
            },
          });
          return {
            content: [
              {
                type: 'text',
                text: `Moved ${parameters.source} to ${parameters.destination}`,
              },
            ],
            details: {},
          };
        },
      }),
    );
  }
  return tools;
}
