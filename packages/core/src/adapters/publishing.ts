import type {
  PublishPlan,
  ReleaseManifest,
  ReleaseRecord,
} from '../domain/releases.js';
import type { ContentHash } from '../domain/identifiers.js';
import type { AdapterDescriptor } from './common.js';

export interface PublishInput {
  readonly release: ReleaseRecord;
  readonly outputDirectory: string;
  readonly manifest: ReleaseManifest;
  readonly previousManifest?: ReleaseManifest;
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

export interface PublishBatchResult {
  readonly uploaded: number;
  readonly deleted: number;
}

export interface RollbackResult {
  readonly restoredReleaseId: string;
  readonly restoredFiles: number;
}

export interface BaselineAdoptionInput {
  readonly release: ReleaseRecord;
  readonly verificationToken: string;
}

export interface BaselineAdoptionResult {
  readonly manifest: ReleaseManifest;
  readonly verificationManifestHash: ContentHash;
  readonly plan: PublishPlan;
  readonly publishResult: PublishResult;
}

export interface Publisher extends AdapterDescriptor {
  plan(input: PublishInput): Promise<PublishPlan>;
  apply(
    plan: PublishPlan,
    phase: 'assets' | 'pages',
    events: PublishEventSink,
  ): Promise<PublishBatchResult>;
  finalize(plan: PublishPlan): Promise<PublishResult>;
  rollback(release: ReleaseRecord): Promise<RollbackResult>;
  adoptBaseline?(
    input: BaselineAdoptionInput,
    events: PublishEventSink,
  ): Promise<BaselineAdoptionResult>;
}
