import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WEBSITE_TITLE } from '../src/index.js';

describe('website app', () => {
  it('uses the product title', () => {
    expect(WEBSITE_TITLE).toBe('Blog Studio');
  });

  it('keeps landing claims within the verified product boundary', async () => {
    const landing = await readFile(
      join('src', 'content', 'landing.ts'),
      'utf8',
    );
    expect(landing).toContain('Files remain canonical');
    expect(landing).toContain('Hexo is the first proof');
    expect(landing).not.toMatch(/multi-user|scheduled publishing|AI writing/i);
  });

  it('generates reference pages from source contracts', async () => {
    const adapterReference = await readFile(
      join(
        'src',
        'content',
        'docs',
        'en',
        'docs',
        'reference',
        'adapter-api.md',
      ),
      'utf8',
    );
    const configurationReference = await readFile(
      join(
        'src',
        'content',
        'docs',
        'en',
        'docs',
        'reference',
        'configuration.md',
      ),
      'utf8',
    );
    expect(adapterReference).toContain('interface GeneratorAdapter');
    expect(adapterReference).toContain('interface Publisher');
    expect(configurationReference).toContain('`workspace`');
    expect(configurationReference).toContain('Unknown keys rejected');
  });
});
