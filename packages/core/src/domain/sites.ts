import type { AdapterDiagnostic } from '../adapters/common.js';
import type { SiteId, WorkspaceId } from './identifiers.js';

export interface SiteCapabilities {
  readonly generator: string;
  readonly generatorPreview: boolean;
  readonly nativeDrafts: boolean;
  readonly createDocuments: boolean;
  readonly assetProvider: string;
  readonly publishProvider: string;
  readonly publishConfigured: boolean;
}

export interface Site {
  readonly id: SiteId;
  readonly displayName: string;
  readonly canonicalUrl?: string;
  readonly capabilities: SiteCapabilities;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SiteDiscoveryCandidate {
  readonly candidateId: WorkspaceId;
  readonly proposedDisplayName: string;
  readonly canonicalUrl?: string;
  readonly contentCounts: Readonly<Record<string, number>>;
  readonly capabilities: SiteCapabilities;
  readonly diagnostics: readonly AdapterDiagnostic[];
  readonly advanced: {
    readonly workspaceId: WorkspaceId;
    readonly workspaceRoot: string;
    readonly configurationPath: string;
  };
}
