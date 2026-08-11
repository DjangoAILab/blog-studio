import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const normalizedBase = `/${(process.env.BLOG_STUDIO_DOCS_BASE ?? '').replace(/^\/+|\/+$/g, '')}`;
const base = normalizedBase === '/' ? '/' : `${normalizedBase}/`;

export default defineConfig({
  site: process.env.BLOG_STUDIO_DOCS_SITE ?? 'http://localhost:4321',
  base,
  integrations: [
    starlight({
      title: { en: 'Blog Studio', 'zh-CN': 'Blog Studio' },
      description:
        'A self-hosted publishing workbench for file-based static sites.',
      locales: {
        en: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      defaultLocale: 'en',
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
          translations: { 'zh-CN': '从这里开始' },
          items: [
            { slug: 'docs' },
            { slug: 'docs/concepts/core-journey' },
            { slug: 'docs/guides/self-hosting' },
          ],
        },
        {
          label: 'Use Blog Studio',
          translations: { 'zh-CN': '使用 Blog Studio' },
          items: [
            { autogenerate: { directory: 'docs/use' } },
            { slug: 'docs/guides/hexo' },
          ],
        },
        {
          label: 'Operate',
          translations: { 'zh-CN': '运维' },
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
          translations: { 'zh-CN': '扩展' },
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
