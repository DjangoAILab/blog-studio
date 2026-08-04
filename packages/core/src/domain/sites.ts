import type { AdapterDiagnostic } from '../adapters/common.js';
import type { ContentHash, SiteId, WorkspaceId } from './identifiers.js';

export interface SiteCapabilities {
  readonly generator: string;
  readonly generatorPreview: boolean;
  readonly nativeDrafts: boolean;
  readonly createDocuments: boolean;
  readonly assetProvider: string;
  readonly resourceMediaTypes: readonly string[];
  readonly inlinePreviewResourceMediaTypes: readonly string[];
  readonly maxResourceBytes: number;
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

export interface SiteSettingsSnapshot {
  readonly displayName: string;
  readonly canonicalUrl?: string;
}

export interface SiteAuditEvent {
  readonly sequence: number;
  readonly siteId: SiteId;
  readonly type: 'registered' | 'settings-updated';
  readonly actor: 'owner' | 'migration';
  readonly at: string;
  readonly before?: SiteSettingsSnapshot;
  readonly after: SiteSettingsSnapshot;
}

export interface SiteDiscoveryCandidate {
  readonly candidateId: WorkspaceId;
  readonly proposedDisplayName: string;
  readonly canonicalUrl?: string;
  readonly contentCounts: Readonly<Record<string, number>>;
  readonly capabilities: SiteCapabilities;
  readonly diagnostics: readonly AdapterDiagnostic[];
  readonly repository:
    | {
        readonly available: true;
        readonly branch: string;
        readonly head: ContentHash;
        readonly dirtyCount: number;
        readonly ahead: number;
        readonly behind: number;
      }
    | { readonly available: false; readonly diagnostic: string };
  readonly advanced: {
    readonly workspaceId: WorkspaceId;
    readonly workspaceRoot: string;
    readonly configurationPath: string;
  };
}
