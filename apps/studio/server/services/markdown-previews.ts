import { randomUUID } from 'node:crypto';

import { micromark } from 'micromark';

export interface MarkdownPreviewSession {
  readonly id: string;
  readonly html: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type MarkdownPreviewResourceContext =
  | {
      readonly kind: 'site';
      readonly siteId: string;
      readonly documentId: string;
      readonly collection: string;
    }
  | {
      readonly kind: 'workspace';
      readonly workspaceId: string;
      readonly documentId: string;
      readonly collection: string;
    };

interface StoredMarkdownPreviewSession {
  readonly preview: MarkdownPreviewSession;
  readonly resource: MarkdownPreviewResourceContext;
  readonly referencedSources: ReadonlySet<string>;
}

export class MarkdownPreviewNotFoundError extends Error {}
export class MarkdownPreviewResourceNotFoundError extends Error {}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rewriteResourceUrls(
  html: string,
  resourceBase: string,
): { readonly html: string; readonly referencedSources: ReadonlySet<string> } {
  const referencedSources = new Set<string>();
  const rewritten = html.replace(
    /\b(href|src)="([^"]*)"/gi,
    (_match, attribute: string, value: string) => {
      if (value.length === 0) return `${attribute}="#blocked-resource"`;
      if (
        value.startsWith('#') ||
        /^https?:\/\//i.test(value) ||
        (attribute.toLowerCase() === 'href' && /^mailto:/i.test(value))
      ) {
        return `${attribute}="${value}"`;
      }
      referencedSources.add(value);
      return `${attribute}="${resourceBase.replaceAll('&', '&amp;')}${encodeURIComponent(value)}"`;
    },
  );
  return { html: rewritten, referencedSources };
}

export class MarkdownPreviewService {
  readonly #sessions = new Map<string, StoredMarkdownPreviewSession>();

  public constructor(private readonly idleMs = 5 * 60_000) {}

  public start(input: {
    readonly title: string;
    readonly body: string;
    readonly resource: MarkdownPreviewResourceContext;
    readonly now?: number;
  }): MarkdownPreviewSession {
    const now = input.now ?? Date.now();
    const id = randomUUID();
    const rendered = rewriteResourceUrls(
      micromark(input.body, { allowDangerousHtml: false }),
      `/api/markdown-previews/${id}/resource?source=`,
    );
    const session: MarkdownPreviewSession = {
      id,
      html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-serif, Georgia, serif; }
    body { box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; line-height: 1.75; overflow-wrap: anywhere; }
    img, video { max-width: 100%; height: auto; }
    pre { overflow: auto; padding: 16px; border-radius: 12px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
    code { font-family: ui-monospace, SFMono-Regular, monospace; }
    blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid color-mix(in srgb, CanvasText 25%, Canvas); color: color-mix(in srgb, CanvasText 75%, Canvas); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .5rem; border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas); text-align: start; }
    a { color: LinkText; }
  </style>
</head>
<body><main>${rendered.html}</main></body>
</html>`,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.idleMs).toISOString(),
    };
    this.#sessions.set(session.id, {
      preview: session,
      resource: input.resource,
      referencedSources: rendered.referencedSources,
    });
    return session;
  }

  public get(id: string, now = Date.now()): MarkdownPreviewSession {
    const stored = this.#sessions.get(id);
    if (!stored || Date.parse(stored.preview.expiresAt) <= now) {
      throw new MarkdownPreviewNotFoundError(`Unknown Markdown preview: ${id}`);
    }
    return stored.preview;
  }

  public resource(
    id: string,
    source: string,
    now = Date.now(),
  ): MarkdownPreviewResourceContext {
    const stored = this.#sessions.get(id);
    if (!stored || Date.parse(stored.preview.expiresAt) <= now) {
      throw new MarkdownPreviewNotFoundError(`Unknown Markdown preview: ${id}`);
    }
    if (!stored.referencedSources.has(source)) {
      throw new MarkdownPreviewResourceNotFoundError(
        'Resource was not referenced by this Markdown preview',
      );
    }
    return stored.resource;
  }

  public reapExpired(now = Date.now()): number {
    let reaped = 0;
    for (const [id, stored] of this.#sessions) {
      if (Date.parse(stored.preview.expiresAt) <= now) {
        this.#sessions.delete(id);
        reaped++;
      }
    }
    return reaped;
  }

  public dispose(): void {
    this.#sessions.clear();
  }
}
