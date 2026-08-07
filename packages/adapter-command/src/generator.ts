import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';

import {
  ADAPTER_API_VERSION,
  createContentHash,
  createDocumentId,
  createWorkspaceId,
  type AdapterDiagnostic,
  type BuildInput,
  type BuildResult,
  type ContentHash,
  type DocumentRef,
  type DocumentSource,
  type DocumentSummary,
  type FrontMatterValue,
  type GeneratorAdapter,
  type ManifestEntry,
  type SiteModel,
  type WriteDocumentInput,
  type WriteDocumentResult,
} from '@blog-studio/core';
import { parse, stringify } from 'yaml';

import { resolveWorkspacePath } from './path-policy.js';
import { runCommand } from './runner.js';

export interface CommandCollectionOptions {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly state?: 'draft' | 'published';
  readonly formats?: readonly ('markdown' | 'mdx')[];
}

export interface CommandGeneratorOptions {
  readonly workspaceId: string;
  readonly id?: string;
  readonly displayName?: string;
  readonly markers: readonly string[];
  readonly outputDirectory: string;
  readonly siteUrl?: string;
  readonly collections: readonly CommandCollectionOptions[];
  readonly command: {
    readonly executable: string;
    readonly buildArgs: readonly string[];
    readonly previewArgs?: readonly string[];
    readonly timeoutMs?: number;
    readonly environmentAllowlist?: readonly string[];
    readonly environment?: Readonly<Record<string, string>>;
  };
}

interface MarkdownParts {
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
}

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parseMarkdown(raw: string): MarkdownParts {
  const match = frontMatterPattern.exec(raw);
  if (!match) return { frontMatter: {}, body: raw };
  const value: unknown = parse(match[1] ?? '');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Markdown front matter must be a mapping');
  }
  return {
    frontMatter: value as Readonly<Record<string, FrontMatterValue>>,
    body: raw.slice(match[0].length),
  };
}

function contentTimestamp(
  value: FrontMatterValue | undefined,
): string | undefined {
  if (value instanceof Date) return value.toISOString();
  const text =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined;
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function serializeMarkdown(parts: MarkdownParts): string {
  return `---\n${stringify(parts.frontMatter, { lineWidth: 0 }).trimEnd()}\n---\n${parts.body}`;
}

function hash(content: string | Buffer): ContentHash {
  return createContentHash(
    `sha256:${createHash('sha256').update(content).digest('hex')}`,
  );
}

function stringList(value: FrontMatterValue | undefined): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function documentId(path: string) {
  return createDocumentId(`doc-${hash(path).slice('sha256:'.length, 25)}`);
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

async function walk(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await visit(directory);
  return files;
}

function mediaType(path: string): string {
  const known: Readonly<Record<string, string>> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
  };
  return known[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function manifest(output: string): Promise<readonly ManifestEntry[]> {
  return await Promise.all(
    (await walk(output)).map(async (path): Promise<ManifestEntry> => {
      const content = await readFile(path);
      const extension = extname(path).toLowerCase();
      return {
        path: portable(relative(output, path)),
        contentHash: hash(content),
        byteLength: content.byteLength,
        mediaType: mediaType(path),
        cacheClass:
          extension === '.html'
            ? 'page'
            : extension === '.json' || extension === '.xml'
              ? 'metadata'
              : 'immutable',
      };
    }),
  );
}

export class CommandGeneratorAdapter implements GeneratorAdapter {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id: string;
  public readonly displayName: string;
  public readonly capabilities;

  readonly #workspaceId;
  readonly #options: CommandGeneratorOptions;

  public constructor(options: CommandGeneratorOptions) {
    this.#options = options;
    this.#workspaceId = createWorkspaceId(options.workspaceId);
    this.id = options.id ?? 'command';
    this.displayName = options.displayName ?? 'Command';
    this.capabilities = {
      preview: options.command.previewArgs !== undefined,
      drafts: options.collections.some(
        (collection) => collection.state === 'draft',
      ),
      mdx: options.collections.some((collection) =>
        collection.formats?.includes('mdx'),
      ),
    };
  }

  public async detect(workspaceRoot: string) {
    const missing: string[] = [];
    for (const marker of this.#options.markers) {
      try {
        await resolveWorkspacePath(workspaceRoot, marker);
      } catch {
        missing.push(marker);
      }
    }
    return {
      detected: missing.length === 0,
      confidence:
        this.#options.markers.length === 0
          ? 0.5
          : 1 - missing.length / this.#options.markers.length,
      diagnostics: missing.map((path): AdapterDiagnostic => ({
        severity: 'error',
        code: 'COMMAND_MARKER_MISSING',
        message: `Required marker was not found: ${path}`,
        path,
      })),
    };
  }

  public inspect(workspaceRoot: string): Promise<SiteModel> {
    return Promise.resolve({
      collections: this.#options.collections.map((collection) => ({
        id: collection.id,
        label: collection.label,
        formats: collection.formats ?? ['markdown'],
        canCreate: false,
        canDelete: false,
      })),
      ...(this.#options.siteUrl === undefined
        ? {}
        : { siteUrl: this.#options.siteUrl }),
      outputDirectory: join(workspaceRoot, this.#options.outputDirectory),
      diagnostics: [],
    });
  }

  #collection(id: string): CommandCollectionOptions {
    const collection = this.#options.collections.find((item) => item.id === id);
    if (!collection) throw new Error(`Unknown collection: ${id}`);
    return collection;
  }

  public async listDocuments(
    workspaceRoot: string,
    collectionId: string,
  ): Promise<readonly DocumentSummary[]> {
    const root = await resolveWorkspacePath(workspaceRoot, '.');
    const collection = this.#collection(collectionId);
    const directory = await resolveWorkspacePath(root, collection.path);
    const formats = collection.formats ?? ['markdown'];
    const extensions = new Set([
      ...(formats.includes('markdown') ? ['.md', '.markdown'] : []),
      ...(formats.includes('mdx') ? ['.mdx'] : []),
    ]);
    return await Promise.all(
      (await walk(directory))
        .filter((path) => extensions.has(extname(path).toLowerCase()))
        .map(async (path): Promise<DocumentSummary> => {
          const raw = await readFile(path, 'utf8');
          const { frontMatter } = parseMarkdown(raw);
          const documentPath = portable(relative(root, path));
          const details = await stat(path);
          const publishedAt = contentTimestamp(frontMatter.date);
          const contentUpdatedAt =
            contentTimestamp(frontMatter.updated) ?? publishedAt;
          return {
            ref: {
              workspaceId: this.#workspaceId,
              collectionId,
              documentId: documentId(documentPath),
              path: documentPath,
            },
            revision: hash(raw),
            title:
              typeof frontMatter.title === 'string'
                ? frontMatter.title
                : basename(path, extname(path)),
            tags: stringList(frontMatter.tags),
            ...(publishedAt ? { publishedAt } : {}),
            ...(contentUpdatedAt ? { contentUpdatedAt } : {}),
            filesystemModifiedAt: details.mtime.toISOString(),
            ...(contentUpdatedAt ? { updatedAt: contentUpdatedAt } : {}),
            state: collection.state ?? 'published',
          };
        }),
    );
  }

  public async readDocument(
    workspaceRoot: string,
    ref: DocumentRef,
  ): Promise<DocumentSource> {
    const path = await resolveWorkspacePath(workspaceRoot, ref.path);
    const raw = await readFile(path, 'utf8');
    const parts = parseMarkdown(raw);
    return {
      ref,
      revision: hash(raw),
      frontMatter: parts.frontMatter,
      body: parts.body,
      raw,
      format: extname(path).toLowerCase() === '.mdx' ? 'mdx' : 'markdown',
    };
  }

  public async writeDocument(
    workspaceRoot: string,
    input: WriteDocumentInput,
  ): Promise<WriteDocumentResult> {
    const path = await resolveWorkspacePath(workspaceRoot, input.ref.path);
    const current = await readFile(path, 'utf8');
    if (hash(current) !== input.expectedRevision)
      throw new Error('Document revision conflict');
    const currentParts = parseMarkdown(current);
    if (
      currentParts.body === input.body &&
      JSON.stringify(currentParts.frontMatter) ===
        JSON.stringify(input.frontMatter)
    )
      return { revision: input.expectedRevision, changed: false };
    const next = serializeMarkdown({
      frontMatter: input.frontMatter,
      body: input.body,
    });
    await writeFile(path, next, 'utf8');
    return { revision: hash(next), changed: true };
  }

  public async resolvePublicUrl(
    workspaceRoot: string,
    ref: DocumentRef,
  ): Promise<string> {
    if (!this.#options.siteUrl) throw new Error('Site URL is not configured');
    const source = await this.readDocument(workspaceRoot, ref);
    const configured = source.frontMatter.permalink;
    const path =
      typeof configured === 'string'
        ? configured
        : `${basename(ref.path, extname(ref.path))}.html`;
    return new URL(
      path,
      `${this.#options.siteUrl.replace(/\/$/, '')}/`,
    ).toString();
  }

  public async build(input: BuildInput): Promise<BuildResult> {
    const isPreview = input.mode === 'preview';
    const args = isPreview
      ? (this.#options.command.previewArgs ?? this.#options.command.buildArgs)
      : this.#options.command.buildArgs;
    const result = await runCommand({
      executable: this.#options.command.executable,
      args,
      workspaceRoot: input.workspaceRoot,
      ...(this.#options.command.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.#options.command.timeoutMs }),
      ...(this.#options.command.environmentAllowlist === undefined
        ? {}
        : {
            environmentAllowlist: this.#options.command.environmentAllowlist,
          }),
      ...(this.#options.command.environment === undefined
        ? {}
        : { environment: this.#options.command.environment }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (result.exitCode !== 0)
      throw new Error(`Build failed (${result.exitCode}): ${result.stderr}`);
    const outputDirectory = await resolveWorkspacePath(
      input.workspaceRoot,
      this.#options.outputDirectory,
    );
    return {
      outputDirectory,
      manifest: await manifest(outputDirectory),
      durationMs: result.durationMs,
      diagnostics: [],
    };
  }
}
