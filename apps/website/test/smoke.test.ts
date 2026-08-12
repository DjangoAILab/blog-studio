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
    expect(landing).toContain('Self-hosted AI content workspace');
    expect(landing).toContain('Understand the whole Site');
    expect(landing).toContain('AI changes. You review and publish.');
    expect(landing).toContain('自托管 AI 内容工作台');
    expect(landing).toContain('理解整个网站');
    expect(landing).toContain('AI 修改，人来审查与发布');
    expect(landing).not.toContain('在你的网站原本所在之处');
    expect(landing).not.toMatch(
      /multi-user|scheduled publishing|autonomous publishing|AI article generator/i,
    );
  });

  it('publishes concise localized metadata and crawler guidance', async () => {
    const component = await readFile(
      join('src', 'components', 'LandingPage.astro'),
      'utf8',
    );
    const robots = await readFile(join('public', 'robots.txt'), 'utf8');

    expect(component).toContain('property="og:title"');
    expect(component).toContain('name="twitter:card"');
    expect(component).not.toContain('principle-band');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(
      'Sitemap: https://djangoailab.github.io/blog-studio/sitemap-index.xml',
    );
  });

  it('keeps the Chinese documentation home focused on user tasks', async () => {
    const home = await readFile(
      join('src', 'content', 'docs', 'zh-cn', 'docs', 'index.mdx'),
      'utf8',
    );

    expect(home).toContain('让 AI 理解整个网站');
    expect(home).toContain('按你的目标开始');
    expect(home).not.toContain('项目完成线');
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
