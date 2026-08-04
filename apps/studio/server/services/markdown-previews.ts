import { randomUUID } from 'node:crypto';

import { micromark } from 'micromark';

export interface MarkdownPreviewSession {
  readonly id: string;
  readonly html: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rewriteResourceUrls(html: string, resourceBase: string): string {
  return html.replace(
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
      return `${attribute}="${resourceBase.replaceAll('&', '&amp;')}${encodeURIComponent(value)}"`;
    },
  );
}

export class MarkdownPreviewService {
  readonly #sessions = new Map<string, MarkdownPreviewSession>();

  public constructor(private readonly idleMs = 5 * 60_000) {}

  public start(input: {
    readonly title: string;
    readonly body: string;
    readonly resourceBase: string;
    readonly now?: number;
  }): MarkdownPreviewSession {
    const now = input.now ?? Date.now();
    const rendered = rewriteResourceUrls(
      micromark(input.body, { allowDangerousHtml: false }),
      input.resourceBase,
    );
    const session: MarkdownPreviewSession = {
      id: randomUUID(),
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
<body><main>${rendered}</main></body>
</html>`,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.idleMs).toISOString(),
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  public get(id: string, now = Date.now()): MarkdownPreviewSession {
    const session = this.#sessions.get(id);
    if (!session || Date.parse(session.expiresAt) <= now) {
      throw new Error(`Unknown Markdown preview: ${id}`);
    }
    return session;
  }

  public reapExpired(now = Date.now()): number {
    let reaped = 0;
    for (const [id, session] of this.#sessions) {
      if (Date.parse(session.expiresAt) <= now) {
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
