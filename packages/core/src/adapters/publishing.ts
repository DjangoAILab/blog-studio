import type { ReleaseRecord } from '../domain/releases.js';
import type { PublishPlan } from '../domain/releases.js';
import type { AdapterDescriptor } from './common.js';

export interface PublishInput {
  readonly release: ReleaseRecord;
  readonly outputDirectory: string;
  readonly previousManifestPath?: string;
}

export interface PublishEvent {
  readonly at: string;
  readonly stage: string;
  readonly level: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly completed?: number;
  readonly total?: number;
}

export type PublishEventSink = (event: PublishEvent) => void;

export interface PublishResult {
  readonly manifestPath: string;
  readonly uploaded: number;
  readonly deleted: number;
}

export interface RollbackResult {
  readonly restoredReleaseId: string;
  readonly restoredFiles: number;
}

export interface Publisher extends AdapterDescriptor {
  plan(input: PublishInput): Promise<PublishPlan>;
  apply(plan: PublishPlan, events: PublishEventSink): Promise<PublishResult>;
  rollback(release: ReleaseRecord): Promise<RollbackResult>;
}
