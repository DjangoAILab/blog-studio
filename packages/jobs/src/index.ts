import type { JobId, JobRecord } from '@blog-studio/core';
import type { SqliteJobRepository } from '@blog-studio/persistence';

export type JobHandler = (job: JobRecord) => Promise<void>;
export type JobHandlers = Readonly<Record<string, JobHandler>>;

export type WorkResult =
  | { readonly jobId: JobId; readonly status: 'succeeded' }
  | { readonly jobId: JobId; readonly status: 'failed'; readonly error: string }
  | null;

export class JobCoordinator {
  public constructor(
    private readonly repository: SqliteJobRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async workOnce(
    owner: string,
    leaseDurationMs: number,
    handlers: JobHandlers,
  ): Promise<WorkResult> {
    const startedAt = this.now();
    const leaseExpiresAt = new Date(
      startedAt.getTime() + leaseDurationMs,
    ).toISOString();
    const job = this.repository.acquire(
      owner,
      startedAt.toISOString(),
      leaseExpiresAt,
    );
    if (job === null) {
      return null;
    }

    const handler = handlers[job.type];
    if (handler === undefined) {
      const message = `No handler registered for job type ${job.type}`;
      this.repository.complete(
        job.id,
        owner,
        'failed',
        this.now().toISOString(),
      );
      return { jobId: job.id, status: 'failed', error: message };
    }

    try {
      await handler(job);
      this.repository.complete(
        job.id,
        owner,
        'succeeded',
        this.now().toISOString(),
      );
      return { jobId: job.id, status: 'succeeded' };
    } catch (error) {
      this.repository.complete(
        job.id,
        owner,
        'failed',
        this.now().toISOString(),
      );
      return {
        jobId: job.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown job failure',
      };
    }
  }
}

export function redactLogMessage(
  message: string,
  secrets: readonly string[],
): string {
  let redacted = message.replace(
    /authorization\s*:\s*(?:bearer|basic)\s+[^;\s]+/giu,
    'Authorization: [REDACTED]',
  );
  for (const secret of secrets) {
    if (secret.length >= 4) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
  }
  return redacted;
}
