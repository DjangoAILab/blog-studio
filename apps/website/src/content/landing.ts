import type { Locale } from '../lib/locales';

export interface LandingCopy {
  description: string;
  keywords: string;
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
      'Blog Studio is a self-hosted AI content workspace with a Site Agent for Markdown and Git-based websites.',
    keywords:
      'self-hosted AI, AI content workspace, Site Agent, Markdown AI, Git-based CMS, static site generator',
    title: 'Blog Studio — Self-hosted AI content workspace and Site Agent',
    skip: 'Skip to content',
    navLabel: 'Primary navigation',
    homeLabel: 'Blog Studio home',
    nav: ['How it works', 'Docs', 'GitHub'],
    selfHost: 'Self-host it',
    heroKicker: 'SELF-HOSTED AI CONTENT WORKSPACE',
    heroTitle: ['Let AI understand', 'your whole Site.'],
    heroLede:
      'Give a Site Agent your existing Markdown, Git, generator, and preview—not a pasted fragment. It can inspect and modify the workspace while you approve changes, review the diff, and decide what gets published.',
    quickStart: 'Explore the Site Agent',
    source: 'Explore the source',
    proofLabel: 'Verified product properties',
    proof: [
      'Understand the whole Site',
      'Review every AI change',
      'Keep files and Git canonical',
    ],
    previewLabel: 'Site Agent task and approval preview',
    preview: {
      saved: 'Agent connected',
      publish: 'Review changes →',
      articles: 'SITE CONTEXT',
      search: '⌕ 24 documents',
      articleTitles: [
        'Current article',
        'Site files and links',
        'Preview output',
      ],
      articleMeta: [
        'Attached · explicit',
        'Workspace · read access',
        'Generator · real theme',
      ],
      essayMeta: 'YOU · SITE-WIDE TASK',
      essayTitle: ['Fix broken links', 'across the site'],
      essayIntro:
        'Check the latest posts, repair stale internal links, and keep front matter unchanged.',
      essayBody:
        'The Site Agent searches the real workspace, explains what it found, and asks before applying bounded file changes.',
      quote: 'AI changes. You review and publish.',
      releaseLabel: 'APPROVAL / 0042',
      releaseTitle: 'Changes ready to review',
      stages: ['Read Site', 'Find links', 'Edit files', 'Preview'],
      stageMeta: ['24 docs', '3 stale', 'approval', 'waiting'],
      summary: ['4 files changed', '0 published'],
    },
    journeyKicker: 'AI THAT WORKS WITH YOUR SITE',
    journeyTitle: ['From a request', 'to reviewed changes.'],
    journeyStages: [
      [
        '01',
        'Ask',
        'Start a durable Site-scoped Session and attach only the context this message needs.',
      ],
      [
        '02',
        'Inspect',
        'Let the Agent read, search, explain, and propose bounded workspace changes.',
      ],
      [
        '03',
        'Review',
        'Approve tool calls, inspect the Git diff, and preview with the real theme.',
      ],
      [
        '04',
        'Publish',
        'Prepare and release the reviewed commit yourself; the Agent cannot publish.',
      ],
    ],
    architectureKicker: 'YOUR SITE REMAINS THE SYSTEM OF RECORD',
    architectureTitle: ['A Site-aware Agent.', 'Without an AI-owned site.'],
    architectureBody:
      'Blog Studio works directly with your existing files and local Git, then uses your real generator for preview. Hard Site boundaries, typed tools, approvals, and reviewable ChangeSets keep AI work observable without replacing your stack.',
    architectureLink: 'See the Agent boundaries',
    mapLabel: 'Site Agent boundary diagram',
    mapCore: 'SITE AGENT',
    mapState: 'Sessions · context · approvals',
    adapters: [
      ['CONTEXT', 'Article / selection'],
      ['FILES', 'Bounded workspace'],
      ['GIT', 'Local, typed tools'],
      ['PREVIEW', 'Real generator'],
      ['RELEASE', 'Human reviewed'],
    ],
    finalLabel: 'APACHE-2.0 · SELF-HOSTED · HUMAN IN THE LOOP',
    finalTitle: ['Bring AI to your site.', 'Keep ownership of both.'],
    finalAction: 'Start self-hosting',
    footer:
      'A self-hosted AI content workspace for sites that belong to files.',
    builtOpen: 'Apache-2.0 · Built in the open',
  },
  'zh-cn': {
    description:
      'Blog Studio 是面向 Markdown 与 Git 网站的自托管 AI 内容工作台，内置能理解并安全修改整个网站的 Site Agent。',
    keywords:
      '自托管 AI, AI 内容工作台, Site Agent, Markdown AI, Git CMS, 静态网站生成器',
    title: 'Blog Studio — 自托管 AI 内容工作台与 Site Agent',
    skip: '跳到正文',
    navLabel: '主导航',
    homeLabel: 'Blog Studio 首页',
    nav: ['工作方式', '文档', 'GitHub'],
    selfHost: '安装指南',
    heroKicker: '自托管 AI 内容工作台',
    heroTitle: ['让 AI 理解', '整个网站。'],
    heroLede:
      '把现有 Markdown、Git、生成器和预览交给 Site Agent，而不是只粘贴一段文字。它可以检查并修改工作区；你负责批准操作、审查差异并决定何时发布。',
    quickStart: '了解 Site Agent',
    source: '浏览源代码',
    proofLabel: '核心特点',
    proof: ['理解整个网站', '每项 AI 修改都可审查', '文件与 Git 仍是事实来源'],
    previewLabel: 'Site Agent 任务与审批预览',
    preview: {
      saved: 'Agent 已连接',
      publish: '审查变更 →',
      articles: '网站上下文',
      search: '⌕ 24 篇内容',
      articleTitles: ['当前文章', '网站文件与链接', '预览输出'],
      articleMeta: [
        '已附加 · 明确上下文',
        '工作区 · 可读取',
        '生成器 · 真实主题',
      ],
      essayMeta: '你 · 整站任务',
      essayTitle: ['修复整个网站的', '失效链接'],
      essayIntro:
        '检查最近的文章，修复失效的内部链接，并保持 front matter 不变。',
      essayBody:
        'Site Agent 搜索真实工作区，解释发现的问题，并在应用受限文件修改前请求你的批准。',
      quote: 'AI 修改，人来审查与发布。',
      releaseLabel: '审批 / 0042',
      releaseTitle: '变更等待审查',
      stages: ['读取网站', '查找链接', '修改文件', '真实预览'],
      stageMeta: ['24 篇', '3 处失效', '等待批准', '尚未开始'],
      summary: ['4 个文件变更', '0 项已发布'],
    },
    journeyKicker: '真正和网站一起工作的 AI',
    journeyTitle: ['从一句要求，', '到可审查的修改。'],
    journeyStages: [
      [
        '01',
        '提出任务',
        '创建跟随 Site 的持久 Session，只附加本条消息需要的上下文。',
      ],
      [
        '02',
        '检查网站',
        '让 Agent 读取、搜索、解释问题，并提出受边界保护的文件修改。',
      ],
      [
        '03',
        '审查修改',
        '批准工具调用、检查 Git 差异，再用网站自己的主题预览。',
      ],
      ['04', '人工发布', '由你准备并发布已审查的提交；Agent 本身不能发布。'],
    ],
    architectureKicker: '你的网站始终是事实来源',
    architectureTitle: ['理解整个 Site，', '不接管整个网站。'],
    architectureBody:
      'Blog Studio 直接使用现有文件与本地 Git，并调用网站自己的生成器完成预览。Site 边界、类型化工具、操作审批与可审查 ChangeSet，让 AI 工作清晰可查，同时保留原有技术栈。',
    architectureLink: '查看 Agent 权限边界',
    mapLabel: 'Site Agent 权限边界图',
    mapCore: 'SITE AGENT',
    mapState: '会话 · 上下文 · 审批',
    adapters: [
      ['上下文', '文章 / 选区'],
      ['文件', '受限工作区'],
      ['GIT', '本地类型化工具'],
      ['预览', '真实生成器'],
      ['发布', '人工审查'],
    ],
    finalLabel: 'APACHE-2.0 · 自托管 · 人在回路',
    finalTitle: ['把 AI 带进网站，', '把控制权留给自己。'],
    finalAction: '查看安装指南',
    footer: '为文件式网站而生的自托管 AI 内容工作台。',
    builtOpen: 'Apache-2.0 · 开放构建',
  },
};
