import { parse, parseDocument, stringify } from 'yaml';

import type { FrontMatterValue } from '@blog-studio/core';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface ParsedMarkdown {
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly body: string;
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const match = FRONT_MATTER.exec(raw);
  if (!match) return { frontMatter: {}, body: raw };

  const parsed: unknown = parse(match[1] ?? '');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Markdown front matter must be a mapping');
  }

  return {
    frontMatter: parsed as Readonly<Record<string, FrontMatterValue>>,
    body: raw.slice(match[0].length),
  };
}

export function serializeMarkdown(
  frontMatter: Readonly<Record<string, FrontMatterValue>>,
  body: string,
): string {
  return `---\n${stringify(frontMatter, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}

function sameValue(
  left: FrontMatterValue | undefined,
  right: FrontMatterValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Update only front-matter keys whose structured values changed. YAML's
 * document model retains comments, key order, scalar form, and untouched CST
 * nodes, unlike serializing the complete mapping again.
 */
export function patchMarkdown(
  raw: string,
  frontMatter: Readonly<Record<string, FrontMatterValue>>,
  body: string,
): string {
  const match = FRONT_MATTER.exec(raw);
  if (!match) return serializeMarkdown(frontMatter, body);
  const source = match[1] ?? '';
  const parsed: unknown = parse(source);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Markdown front matter must be a mapping');
  const current = parsed as Readonly<Record<string, FrontMatterValue>>;
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length > 0)
    throw new Error(
      `Markdown front matter is invalid: ${document.errors[0]?.message ?? 'unknown YAML error'}`,
    );

  for (const key of Object.keys(current)) {
    if (!(key in frontMatter)) document.delete(key);
    else if (!sameValue(current[key], frontMatter[key]))
      document.set(key, frontMatter[key]);
  }
  for (const [key, value] of Object.entries(frontMatter)) {
    if (!(key in current)) document.set(key, value);
  }
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}
