import { spawn } from 'node:child_process';

import { resolveWorkspacePath } from './path-policy.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface CommandRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workspaceRoot: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly environmentAllowlist?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export class CommandTimeoutError extends Error {
  public constructor(public readonly timeoutMs: number) {
    super(`Command exceeded its ${timeoutMs}ms timeout`);
    this.name = 'CommandTimeoutError';
  }
}

export class CommandOutputLimitError extends Error {
  public constructor(public readonly maxOutputBytes: number) {
    super(`Command output exceeded ${maxOutputBytes} bytes`);
    this.name = 'CommandOutputLimitError';
  }
}

export class CommandAbortedError extends Error {
  public constructor() {
    super('Command was canceled');
    this.name = 'CommandAbortedError';
  }
}

export async function runCommand(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.signal?.aborted) throw new CommandAbortedError();
  const cwd = await resolveWorkspacePath(
    request.workspaceRoot,
    request.cwd ?? '.',
  );
  if (request.signal?.aborted) throw new CommandAbortedError();
  const timeoutMs = request.timeoutMs ?? 120_000;
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  // PATH is the only inherited default: package-manager shims and /usr/bin/env
  // shebangs require it. Every credential and tool-specific variable is opt-in.
  const allowed = new Set(['PATH', ...(request.environmentAllowlist ?? [])]);
  const environment: NodeJS.ProcessEnv = {};

  for (const name of allowed) {
    const value = request.environment?.[name] ?? process.env[name];
    if (value !== undefined) environment[name] = value;
  }

  const startedAt = performance.now();

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(request.executable, [...request.args], {
      cwd,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminalError: Error | undefined;

    const cleanup = (): void => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    };

    const terminateWithError = (error: Error): void => {
      if (settled || terminalError) return;
      terminalError = error;
      cleanup();
      child.kill('SIGKILL');
    };

    const abort = (): void => terminateWithError(new CommandAbortedError());

    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminateWithError(new CommandOutputLimitError(maxOutputBytes));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(terminalError ?? error);
    });

    const timer = setTimeout(() => {
      terminateWithError(new CommandTimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref();
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminalError) {
        reject(terminalError);
        return;
      }
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  });
}
