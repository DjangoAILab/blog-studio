import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

import { resolveWorkspacePath, runCommand } from '@blog-studio/adapter-command';
import {
  ADAPTER_API_VERSION,
  BlogStudioError,
  createDocumentId,
  createWorkspaceId,
  type AdapterDiagnostic,
  type BuildInput,
  type BuildResult,
  type CreateDocumentInput,
  type CreateDocumentResult,
  type DetectionResult,
  type DocumentRef,
  type DocumentSource,
  type DocumentSummary,
  type FrontMatterValue,
  type GeneratorAdapter,
  type PromoteDocumentInput,
  type PromoteDocumentResult,
  type SiteModel,
  type WriteDocumentInput,
  type WriteDocumentResult,
} from '@blog-studio/core';
import { parse } from 'yaml';

import { createManifest, hashContent, walkFiles } from './files.js';
import { parseMarkdown, serializeMarkdown } from './front-matter.js';

interface HexoConfiguration {
  readonly url?: string;
  readonly root?: string;
  readonly permalink?: string;
  readonly timezone?: string;
  readonly source_dir?: string;
  readonly public_dir?: string;
}

export interface HexoAdapterOptions {
  readonly workspaceId: string;
  readonly configPath?: string;
  readonly buildTimeoutMs?: number;
  readonly executable?: string;
  readonly executableArgs?: readonly string[];
}

function portablePath(path: string): string {
  return path.split(sep).join('/');
}

function safeId(path: string) {
  return createDocumentId(
    `doc-${hashContent(path).slice('sha256:'.length, 25)}`,
  );
}

function stringValue(value: FrontMatterValue | undefined): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

function hexoDateParts(
  value: string,
):
  | { readonly year: string; readonly month: string; readonly day: string }
  | undefined {
  // Hexo 6 uses Moment's permissive parser, which accepts legacy zero-padded
  // three-digit days such as 014. Preserve that established URL behavior while
  // still rejecting impossible calendar dates.
  const match = /^(\d{4})-(\d{1,2})-(\d{1,3})(?:[T\s]|$)/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return {
    year: String(year).padStart(4, '0'),
    month: String(month).padStart(2, '0'),
    day: String(day).padStart(2, '0'),
  };
}

async function workspacePathExists(
  workspaceRoot: string,
  candidate: string,
): Promise<boolean> {
  try {
    await resolveWorkspacePath(workspaceRoot, candidate);
    return true;
  } catch {
    return false;
  }
}

export class HexoGeneratorAdapter implements GeneratorAdapter {
  public readonly apiVersion = ADAPTER_API_VERSION;
  public readonly id = 'hexo';
  public readonly displayName = 'Hexo';
  public readonly capabilities = {
    preview: true,
    drafts: true,
    mdx: false,
  } as const;

  readonly #workspaceId;
  readonly #configPath: string;
  readonly #buildTimeoutMs: number;
  readonly #executable: string;
  readonly #executableArgs: readonly string[];

  public constructor(options: HexoAdapterOptions) {
    this.#workspaceId = createWorkspaceId(options.workspaceId);
    this.#configPath = options.configPath ?? '_config.yml';
    this.#buildTimeoutMs = options.buildTimeoutMs ?? 180_000;
    this.#executable = options.executable ?? 'node_modules/.bin/hexo';
    this.#executableArgs = options.executableArgs ?? [];
  }

  async #configuration(workspaceRoot: string): Promise<HexoConfiguration> {
    const path = await resolveWorkspacePath(workspaceRoot, this.#configPath);
    return parse(await readFile(path, 'utf8')) as HexoConfiguration;
  }

  public async detect(workspaceRoot: string): Promise<DetectionResult> {
    const diagnostics: AdapterDiagnostic[] = [];
    const configFound = await workspacePathExists(
      workspaceRoot,
      this.#configPath,
    );
    let packageFound: boolean;

    try {
      const packagePath = await resolveWorkspacePath(
        workspaceRoot,
        'package.json',
      );
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
        dependencies?: Readonly<Record<string, string>>;
        devDependencies?: Readonly<Record<string, string>>;
        hexo?: unknown;
      };
      packageFound = Boolean(
        packageJson.hexo ??
        packageJson.dependencies?.hexo ??
        packageJson.devDependencies?.hexo,
      );
    } catch {
      packageFound = false;
    }

    if (!configFound)
      diagnostics.push({
        severity: 'error',
        code: 'HEXO_CONFIG_MISSING',
        message: `${this.#configPath} was not found`,
      });
    if (!packageFound)
      diagnostics.push({
        severity: 'warning',
        code: 'HEXO_PACKAGE_MISSING',
        message: 'package.json does not declare Hexo',
      });

    return {
      detected: configFound && packageFound,
      confidence: configFound && packageFound ? 1 : configFound ? 0.6 : 0,
      diagnostics,
    };
  }

  public async inspect(workspaceRoot: string): Promise<SiteModel> {
    const config = await this.#configuration(workspaceRoot);
    const sourceDirectory = config.source_dir ?? 'source';
    const collections = [
      {
        id: 'posts',
        label: 'Posts',
        formats: ['markdown'] as const,
        canCreate: true,
        canDelete: true,
      },
      {
        id: 'drafts',
        label: 'Drafts',
        formats: ['markdown'] as const,
        canCreate: true,
        canDelete: true,
      },
    ];

    return {
      collections,
      ...(config.url === undefined ? {} : { siteUrl: config.url }),
      outputDirectory: join(workspaceRoot, config.public_dir ?? 'public'),
      diagnostics: (await workspacePathExists(workspaceRoot, sourceDirectory))
        ? []
        : [
            {
              severity: 'error',
              code: 'HEXO_SOURCE_MISSING',
              message: `Source directory does not exist: ${sourceDirectory}`,
            },
          ],
    };
  }

  async #collectionDirectory(
    workspaceRoot: string,
    collectionId: string,
  ): Promise<string> {
    const config = await this.#configuration(workspaceRoot);
    const source = config.source_dir ?? 'source';
    const relativeDirectory =
      collectionId === 'posts'
        ? join(source, '_posts')
        : collectionId === 'drafts'
          ? join(source, '_drafts')
          : undefined;
    if (!relativeDirectory)
      throw new Error(`Unknown collection: ${collectionId}`);
    return await resolveWorkspacePath(workspaceRoot, relativeDirectory);
  }

  public async listDocuments(
    workspaceRoot: string,
    collectionId: string,
  ): Promise<readonly DocumentSummary[]> {
    const resolvedRoot = await resolveWorkspacePath(workspaceRoot, '.');
    const directory = await this.#collectionDirectory(
      workspaceRoot,
      collectionId,
    );
    const files = (await walkFiles(directory)).filter((path) =>
      ['.md', '.markdown'].includes(extname(path).toLowerCase()),
    );

    return await Promise.all(
      files.map(async (path): Promise<DocumentSummary> => {
        const raw = await readFile(path, 'utf8');
        const { frontMatter } = parseMarkdown(raw);
        const relativePath = portablePath(relative(resolvedRoot, path));
        const details = await stat(path);
        return {
          ref: {
            workspaceId: this.#workspaceId,
            collectionId,
            documentId: safeId(relativePath),
            path: relativePath,
          },
          title:
            stringValue(frontMatter.title) ?? basename(path, extname(path)),
          updatedAt:
            stringValue(frontMatter.updated) ?? details.mtime.toISOString(),
          state: collectionId === 'drafts' ? 'draft' : 'published',
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
    const parsed = parseMarkdown(raw);
    return {
      ref,
      revision: hashContent(raw),
      frontMatter: parsed.frontMatter,
      body: parsed.body,
      raw,
      format: 'markdown',
    };
  }

  public async writeDocument(
    workspaceRoot: string,
    input: WriteDocumentInput,
  ): Promise<WriteDocumentResult> {
    const path = await resolveWorkspacePath(workspaceRoot, input.ref.path);
    const current = await readFile(path, 'utf8');
    if (hashContent(current) !== input.expectedRevision) {
      throw new Error('Document revision conflict');
    }
    const next = serializeMarkdown(input.frontMatter, input.body);
    const parsedCurrent = parseMarkdown(current);
    if (
      parsedCurrent.body === input.body &&
      JSON.stringify(parsedCurrent.frontMatter) ===
        JSON.stringify(input.frontMatter)
    )
      return { revision: input.expectedRevision, changed: false };

    await writeFile(path, next, 'utf8');
    return { revision: hashContent(next), changed: true };
  }

  public async createDocument(
    workspaceRoot: string,
    input: CreateDocumentInput,
  ): Promise<CreateDocumentResult> {
    if (input.collectionId !== 'drafts')
      throw new Error('Hexo creates new documents in the drafts collection');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
      throw new Error('Hexo draft slug must be portable lowercase kebab-case');
    if (!input.title.trim()) throw new Error('Hexo draft title is required');
    if (Number.isNaN(Date.parse(input.createdAt)))
      throw new Error('Hexo draft creation date is invalid');

    const directory = await this.#collectionDirectory(workspaceRoot, 'drafts');
    const path = join(directory, `${input.slug}.md`);
    const raw = serializeMarkdown(
      { title: input.title.trim(), date: input.createdAt },
      '',
    );
    try {
      await writeFile(path, raw, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new BlogStudioError(
          'DOCUMENT_CONFLICT',
          `Hexo draft slug already exists: ${input.slug}`,
        );
      throw error;
    }
    const root = await resolveWorkspacePath(workspaceRoot, '.');
    const ref: DocumentRef = {
      workspaceId: this.#workspaceId,
      collectionId: 'drafts',
      documentId: safeId(portablePath(relative(root, path))),
      path: portablePath(relative(root, path)),
    };
    return { source: await this.readDocument(workspaceRoot, ref) };
  }

  public async promoteDocument(
    workspaceRoot: string,
    input: PromoteDocumentInput,
  ): Promise<PromoteDocumentResult> {
    if (
      input.ref.collectionId !== 'drafts' ||
      input.targetCollectionId !== 'posts'
    )
      throw new Error('Hexo only promotes drafts into posts');
    const source = await this.readDocument(workspaceRoot, input.ref);
    if (source.revision !== input.expectedRevision)
      throw new Error('Document revision conflict');
    const destinationDirectory = await this.#collectionDirectory(
      workspaceRoot,
      'posts',
    );
    const destination = join(destinationDirectory, basename(input.ref.path));
    try {
      await stat(destination);
      throw new Error(`Hexo post already exists: ${basename(destination)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(
      await resolveWorkspacePath(workspaceRoot, input.ref.path),
      destination,
    );
    const root = await resolveWorkspacePath(workspaceRoot, '.');
    const path = portablePath(relative(root, destination));
    return {
      ref: {
        ...input.ref,
        collectionId: 'posts',
        documentId: safeId(path),
        path,
      },
      revision: source.revision,
    };
  }

  public async resolvePublicUrl(
    workspaceRoot: string,
    ref: DocumentRef,
  ): Promise<string> {
    const source = await this.readDocument(workspaceRoot, ref);
    const config = await this.#configuration(workspaceRoot);
    if (!config.url) throw new Error('Hexo site URL is not configured');
    const fileTitle = basename(ref.path, extname(ref.path));
    const title = stringValue(source.frontMatter.slug) ?? fileTitle;
    const dateText = stringValue(source.frontMatter.date) ?? '';
    const date = hexoDateParts(dateText);
    const pattern = config.permalink ?? ':year/:month/:day/:title/';
    if (!date && /:(?:year|month|day)\b/.test(pattern)) {
      throw new Error(`Invalid Hexo document date: ${dateText || '(missing)'}`);
    }
    const values: Readonly<Record<string, string>> = {
      year: date?.year ?? '',
      month: date?.month ?? '',
      day: date?.day ?? '',
      title,
      name: fileTitle,
      id: fileTitle,
    };
    const permalink = pattern.replace(/:([a-z_]+)/g, (_, token: string) =>
      encodeURIComponent(values[token] ?? ''),
    );
    const root = config.root ?? '/';
    return new URL(
      join(root, permalink).split(sep).join('/'),
      config.url,
    ).toString();
  }

  public async resolveAssetSourcePath(
    workspaceRoot: string,
    ref: DocumentRef,
    sourceUrl: string,
  ): Promise<string | undefined> {
    if (
      !sourceUrl ||
      sourceUrl.startsWith('#') ||
      /^(?:data|blob|https?):/i.test(sourceUrl) ||
      sourceUrl.includes('\\')
    )
      return undefined;
    let decoded: string;
    try {
      decoded = decodeURIComponent(sourceUrl.split(/[?#]/, 1)[0] ?? '');
    } catch {
      return undefined;
    }
    const config = await this.#configuration(workspaceRoot);
    const candidate = decoded.startsWith('/')
      ? join(config.source_dir ?? 'source', decoded.slice(1))
      : join(dirname(ref.path), decoded);
    try {
      const root = await resolveWorkspacePath(workspaceRoot, '.');
      const path = await resolveWorkspacePath(workspaceRoot, candidate);
      return portablePath(relative(root, path));
    } catch {
      return undefined;
    }
  }

  public async build(input: BuildInput): Promise<BuildResult> {
    const config = await this.#configuration(input.workspaceRoot);
    const result = await runCommand({
      executable: this.#executable,
      args: [
        ...this.#executableArgs,
        'generate',
        ...(this.#configPath === '_config.yml'
          ? []
          : ['--config', this.#configPath]),
      ],
      workspaceRoot: input.workspaceRoot,
      timeoutMs: this.#buildTimeoutMs,
      environmentAllowlist: [
        'CI',
        'NODE_ENV',
        ...(config.timezone ? ['TZ'] : []),
      ],
      environment: {
        CI: 'true',
        NODE_ENV: input.mode === 'production' ? 'production' : 'development',
        ...(config.timezone ? { TZ: config.timezone } : {}),
      },
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Hexo build failed (${result.exitCode}): ${result.stderr}`,
      );
    }
    const outputDirectory = await resolveWorkspacePath(
      input.workspaceRoot,
      config.public_dir ?? 'public',
    );
    return {
      outputDirectory,
      manifest: await createManifest(outputDirectory),
      durationMs: result.durationMs,
      diagnostics: result.stderr
        ? [
            {
              severity: 'warning',
              code: 'HEXO_BUILD_STDERR',
              message: result.stderr,
            },
          ]
        : [],
    };
  }
}
