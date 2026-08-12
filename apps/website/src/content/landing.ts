import type { Locale } from '../lib/locales';

export interface LandingCopy {
  description: string;
  title: string;
  skip: string;
  navLabel: string;
  homeLabel: string;
  nav: readonly [string, string, string];
  selfHost: string;
  heroKicker: string;
  heroTitle: readonly [string, string];
  heroLede: string;
  quickStart: string;
  source: string;
  proofLabel: string;
  proof: readonly [string, string, string];
  previewLabel: string;
  preview: {
    saved: string;
    publish: string;
    articles: string;
    search: string;
    articleTitles: readonly [string, string, string];
    articleMeta: readonly [string, string, string];
    essayMeta: string;
    essayTitle: readonly [string, string];
    essayIntro: string;
    essayBody: string;
    quote: string;
    releaseLabel: string;
    releaseTitle: string;
    stages: readonly [string, string, string, string];
    stageMeta: readonly [string, string, string, string];
    summary: readonly [string, string];
  };
  journeyKicker: string;
  journeyTitle: readonly [string, string];
  journeyStages: readonly (readonly [string, string, string])[];
  architectureKicker: string;
  architectureTitle: readonly [string, string];
  architectureBody: string;
  architectureLink: string;
  mapLabel: string;
  mapCore: string;
  mapState: string;
  adapters: readonly (readonly [string, string])[];
  finalLabel: string;
  finalTitle: readonly [string, string];
  finalAction: string;
  footer: string;
  builtOpen: string;
}

export const landingCopy: Record<Locale, LandingCopy> = {
  en: {
    description:
      'Blog Studio is a self-hosted publishing workbench for file-based static sites.',
    title: 'Blog Studio — Write where your site already lives',
    skip: 'Skip to content',
    navLabel: 'Primary navigation',
    homeLabel: 'Blog Studio home',
    nav: ['How it works', 'Docs', 'GitHub'],
    selfHost: 'Self-host it',
    heroKicker: 'SELF-HOSTED PUBLISHING WORKBENCH',
    heroTitle: ['Write where your site', 'already lives.'],
    heroLede:
      'Keep Markdown, Git, your generator, and your hosting. Replace the fragile chain of sync scripts and opaque deploys with one calm, verifiable browser journey.',
    quickStart: 'Read the quick start',
    source: 'Explore the source',
    proofLabel: 'Verified product properties',
    proof: [
      'Your content stays in Git',
      'Preview with your real theme',
      'Review every release',
    ],
    previewLabel: 'Blog Studio product preview',
    preview: {
      saved: 'Draft saved',
      publish: 'Publish →',
      articles: 'ARTICLES',
      search: '⌕ Search',
      articleTitles: [
        'Designing for durable calm',
        'A practical release manifest',
        'Why files remain canonical',
      ],
      articleMeta: [
        'Draft · just now',
        'Published · Aug 01',
        'Published · Jul 28',
      ],
      essayMeta: 'ESSAY · 7 MIN READ',
      essayTitle: ['Designing for', 'durable calm'],
      essayIntro: 'Publishing should preserve momentum, not interrupt it.',
      essayBody:
        'A draft can be immediate without making production casual. The editor saves first; the release pipeline explains every step.',
      quote: 'Files stay portable. Releases become observable.',
      releaseLabel: 'RELEASE / 0284',
      releaseTitle: 'Ready to publish',
      stages: ['Preflight', 'Build site', 'Plan diff', 'Upload & verify'],
      stageMeta: ['0.2s', '3.8s', '4 files', 'waiting'],
      summary: ['+3 changed', '0 deleted'],
    },
    journeyKicker: 'ONE CONTINUOUS JOURNEY',
    journeyTitle: ['From first sentence', 'to verified release.'],
    journeyStages: [
      [
        '01',
        'Write',
        'Markdown and unknown front matter stay in your repository.',
      ],
      ['02', 'Preview', 'Build the real site with its generator and theme.'],
      ['03', 'Release', 'See every upload, cache, and verification stage.'],
      ['04', 'Recover', 'Retry safely or restore the last verified manifest.'],
    ],
    architectureKicker: 'ADAPTERS, NOT ASSUMPTIONS',
    architectureTitle: [
      'Hexo is the first proof.',
      'Not the product boundary.',
    ],
    architectureBody:
      "Generator, repository, assets, publisher, and cache are versioned contracts. The first vertical targets Hexo and Tencent's static-site stack; the core remains provider-independent.",
    architectureLink: 'Understand the architecture',
    mapLabel: 'Adapter architecture diagram',
    mapCore: 'MODULAR CORE',
    mapState: 'drafts · jobs · release state',
    adapters: [
      ['GENERATOR', 'Hexo'],
      ['REPOSITORY', 'Local Git'],
      ['ASSETS', 'Filesystem / COS'],
      ['PUBLISH', 'Filesystem / COS'],
      ['CACHE', 'None / Tencent'],
    ],
    finalLabel: 'APACHE-2.0 · SELF-HOSTED · SINGLE-USER V0.1',
    finalTitle: ['Make publishing feel', 'like writing again.'],
    finalAction: 'Start self-hosting',
    footer: 'A publishing workbench for sites that belong to files.',
    builtOpen: 'Apache-2.0 · Built in the open',
  },
  'zh-cn': {
    description:
      'Blog Studio 是面向现有 Markdown 静态网站的自托管写作与发布工具，无需迁移内容。',
    title: 'Blog Studio — 为现有 Markdown 网站而生的写作与发布工具',
    skip: '跳到正文',
    navLabel: '主导航',
    homeLabel: 'Blog Studio 首页',
    nav: ['工作方式', '文档', 'GitHub'],
    selfHost: '安装指南',
    heroKicker: '为现有 Markdown 网站而生',
    heroTitle: ['保留现有网站，', '更顺手地写作。'],
    heroLede:
      '继续使用 Markdown、Git、现有生成器和托管服务。在浏览器中完成写作、AI 协助、真实预览和发布。',
    quickStart: '查看安装指南',
    source: '浏览源代码',
    proofLabel: '核心特点',
    proof: ['内容仍在仓库', '使用真实主题预览', '发布前可审查'],
    previewLabel: 'Blog Studio 产品预览',
    preview: {
      saved: '草稿已保存',
      publish: '发布 →',
      articles: '文章',
      search: '⌕ 搜索',
      articleTitles: [
        '用 Blog Studio 管理现有博客',
        '发布前需要检查什么',
        '为什么内容仍放在 Git 中',
      ],
      articleMeta: ['草稿 · 刚刚', '已发布 · 8 月 1 日', '已发布 · 7 月 28 日'],
      essayMeta: '随笔 · 阅读 7 分钟',
      essayTitle: ['让写作和发布', '回到同一个地方'],
      essayIntro: '从草稿到上线，不必在多个工具之间来回切换。',
      essayBody:
        '编辑器随时保存草稿；准备上线时，再检查文件变化和每一步发布结果。',
      quote: '内容留在仓库，发布过程清晰可查。',
      releaseLabel: '发布 / 0284',
      releaseTitle: '可以发布',
      stages: ['预检', '构建网站', '规划差异', '上传并验证'],
      stageMeta: ['0.2 秒', '3.8 秒', '4 个文件', '等待中'],
      summary: ['+3 项变更', '0 项删除'],
    },
    journeyKicker: '从写作到上线',
    journeyTitle: ['四步完成一次', '清晰的发布。'],
    journeyStages: [
      ['01', '写作', '直接编辑现有 Markdown，原有 front matter 保持不变。'],
      ['02', '预览', '用网站自己的生成器和主题查看真实效果。'],
      ['03', '发布', '确认文件变化后，再执行构建、上传和线上检查。'],
      ['04', '恢复', '发布失败时安全重试，必要时恢复上一个版本。'],
    ],
    architectureKicker: '从 Hexo 开始，保持可扩展',
    architectureTitle: ['先支持 Hexo，', '也能接入其他工具。'],
    architectureBody:
      'Blog Studio 把生成器、仓库、资源、发布和缓存拆成独立适配器。当前重点支持 Hexo 与腾讯云静态网站，也为其他文件式网站保留扩展方式。',
    architectureLink: '查看适配器架构',
    mapLabel: '适配器架构图',
    mapCore: '模块化核心',
    mapState: '草稿 · 任务 · 发布状态',
    adapters: [
      ['生成器', 'Hexo'],
      ['仓库', '本地 Git'],
      ['资源', '文件系统 / COS'],
      ['发布', '文件系统 / COS'],
      ['缓存', '无 / 腾讯云'],
    ],
    finalLabel: 'APACHE-2.0 · 自托管 · V0.1 单用户版',
    finalTitle: ['不迁移内容，', '直接开始写作。'],
    finalAction: '查看安装指南',
    footer: '为现有 Markdown 网站而生的写作与发布工具。',
    builtOpen: 'Apache-2.0 · 开放构建',
  },
};
