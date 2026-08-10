import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const normalizedBase = `/${(process.env.BLOG_STUDIO_DOCS_BASE ?? '').replace(/^\/+|\/+$/g, '')}`;
const base = normalizedBase === '/' ? '/' : `${normalizedBase}/`;

export default defineConfig({
  site: process.env.BLOG_STUDIO_DOCS_SITE ?? 'http://localhost:4321',
  base,
  integrations: [
    starlight({
      title: 'Blog Studio',
      description:
        'A self-hosted publishing workbench for file-based static sites.',
      disable404Route: true,
      favicon: '/favicon.png',
      customCss: ['./src/styles/docs.css'],
      editLink: {
        baseUrl:
          'https://github.com/DjangoAILab/blog-studio/edit/main/apps/website/',
      },
      lastUpdated: true,
      social: [
        {
          icon: 'github',
          label: 'Blog Studio on GitHub',
          href: 'https://github.com/DjangoAILab/blog-studio',
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { slug: 'docs' },
            { slug: 'docs/concepts/core-journey' },
            { slug: 'docs/guides/self-hosting' },
          ],
        },
        {
          label: 'Use Blog Studio',
          items: [
            { autogenerate: { directory: 'docs/use' } },
            { slug: 'docs/guides/hexo' },
          ],
        },
        {
          label: 'Operate',
          items: [
            { slug: 'docs/configuration/workspaces' },
            { slug: 'docs/providers/tencent' },
            { slug: 'docs/operations/security' },
            { slug: 'docs/operations/backup-restore' },
            { slug: 'docs/operations/upgrading' },
            { slug: 'docs/operations/troubleshooting' },
          ],
        },
        {
          label: 'Extend',
          items: [
            { slug: 'docs/adapters/overview' },
            { slug: 'docs/reference/configuration' },
            { slug: 'docs/reference/adapter-api' },
          ],
        },
      ],
    }),
  ],
  markdown: {
    shikiConfig: { theme: 'github-dark-default' },
  },
});
