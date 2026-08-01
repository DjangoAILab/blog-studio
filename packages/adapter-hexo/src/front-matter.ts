import { parse, stringify } from 'yaml';

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
