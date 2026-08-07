import { parse, parseDocument, stringify } from 'yaml';

import type { FrontMatterValue } from '@blog-studio/core';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface ParsedMarkdown {
  readonly frontMatter: Readonly<Record<string, FrontMatterValue>>;
  readonly frontMatterSource?: string;
  readonly frontMatterParseError?: string;
  readonly body: string;
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const match = FRONT_MATTER.exec(raw);
  if (!match) return { frontMatter: {}, body: raw };

  const source = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    return {
      frontMatter: {},
      frontMatterSource: source,
      frontMatterParseError:
        error instanceof Error ? error.message : 'Invalid YAML front matter',
      body: raw.slice(match[0].length),
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return {
      frontMatter: {},
      frontMatterSource: source,
      frontMatterParseError: 'Markdown front matter must be a mapping',
      body: raw.slice(match[0].length),
    };

  return {
    frontMatter: parsed as Readonly<Record<string, FrontMatterValue>>,
    frontMatterSource: source,
    body: raw.slice(match[0].length),
  };
}

export function serializeMarkdown(
  frontMatter: Readonly<Record<string, FrontMatterValue>>,
  body: string,
): string {
  return `---\n${stringify(frontMatter, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}

export function replaceFrontMatterSource(
  source: string,
  frontMatter: Readonly<Record<string, FrontMatterValue>>,
  body: string,
): string {
  const parsed = parseMarkdown(`---\n${source}\n---\n`);
  if (parsed.frontMatterParseError)
    throw new Error(
      `Markdown front matter is invalid: ${parsed.frontMatterParseError}`,
    );
  if (!sameValue(parsed.frontMatter, frontMatter))
    throw new Error('Markdown front matter source does not match its values');
  return `---\n${source.trimEnd()}\n---\n${body}`;
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
  const parsed = parseMarkdown(raw);
  if (parsed.frontMatterParseError)
    throw new Error(
      `Markdown front matter requires source repair: ${parsed.frontMatterParseError}`,
    );
  const current = parsed.frontMatter;
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
