import type {
  ContentCollection,
  CreateDocumentInput,
  CreateDocumentResult,
  DocumentRef,
  DocumentSource,
  DocumentSummary,
  PromoteDocumentInput,
  PromoteDocumentResult,
  WriteDocumentInput,
  WriteDocumentResult,
} from '../domain/documents.js';
import type { ManifestEntry } from '../domain/releases.js';
import type { AdapterDescriptor, AdapterDiagnostic } from './common.js';

export interface GeneratorCapabilities {
  readonly preview: boolean;
  readonly drafts: boolean;
  readonly mdx: boolean;
}

export interface DetectionResult {
  readonly detected: boolean;
  readonly confidence: number;
  readonly diagnostics: readonly AdapterDiagnostic[];
}

export interface SiteModel {
  readonly collections: readonly ContentCollection[];
  readonly siteUrl?: string;
  readonly outputDirectory: string;
  readonly diagnostics: readonly AdapterDiagnostic[];
}

export interface BuildInput {
  readonly workspaceRoot: string;
  readonly mode: 'preview' | 'production';
  /** Optional cooperative cancellation for bounded, disposable builds. */
  readonly signal?: AbortSignal;
}

export interface BuildResult {
  readonly outputDirectory: string;
  readonly manifest: readonly ManifestEntry[];
  readonly durationMs: number;
  readonly diagnostics: readonly AdapterDiagnostic[];
}

export interface GeneratorAdapter extends AdapterDescriptor {
  readonly capabilities: GeneratorCapabilities;
  detect(workspaceRoot: string): Promise<DetectionResult>;
  inspect(workspaceRoot: string): Promise<SiteModel>;
  listDocuments(
    workspaceRoot: string,
    collectionId: string,
  ): Promise<readonly DocumentSummary[]>;
  readDocument(
    workspaceRoot: string,
    ref: DocumentRef,
  ): Promise<DocumentSource>;
  writeDocument(
    workspaceRoot: string,
    input: WriteDocumentInput,
  ): Promise<WriteDocumentResult>;
  createDocument?(
    workspaceRoot: string,
    input: CreateDocumentInput,
  ): Promise<CreateDocumentResult>;
  promoteDocument?(
    workspaceRoot: string,
    input: PromoteDocumentInput,
  ): Promise<PromoteDocumentResult>;
  resolvePublicUrl(workspaceRoot: string, ref: DocumentRef): Promise<string>;
  /** Resolve a document-authored/root-relative asset to a workspace-relative source path. */
  resolveAssetSourcePath?(
    workspaceRoot: string,
    ref: DocumentRef,
    sourceUrl: string,
  ): Promise<string | undefined>;
  build(input: BuildInput): Promise<BuildResult>;
}
