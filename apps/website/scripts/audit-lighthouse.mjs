import { spawn } from 'node:child_process';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const host = '127.0.0.1';
const port = 4324;
const origin = `http://${host}:${port}`;
const configuredBase = (process.env.BLOG_STUDIO_DOCS_BASE ?? '').replace(
  /^\/+|\/+$/g,
  '',
);
const sitePath = (path) =>
  `${configuredBase ? `/${configuredBase}` : ''}/${path.replace(/^\/+/, '')}`;
const cases = [
  { name: 'landing-en-mobile', path: sitePath('en/'), preset: undefined },
  { name: 'landing-en-desktop', path: sitePath('en/'), preset: 'desktop' },
  { name: 'landing-zh-mobile', path: sitePath('zh-cn/'), preset: undefined },
  { name: 'landing-zh-desktop', path: sitePath('zh-cn/'), preset: 'desktop' },
  { name: 'docs-en-mobile', path: sitePath('en/docs/'), preset: undefined },
  { name: 'docs-en-desktop', path: sitePath('en/docs/'), preset: 'desktop' },
  { name: 'docs-zh-mobile', path: sitePath('zh-cn/docs/'), preset: undefined },
  { name: 'docs-zh-desktop', path: sitePath('zh-cn/docs/'), preset: 'desktop' },
];
const thresholds = {
  accessibility: 0.95,
  'best-practices': 0.9,
  performance: 0.9,
  seo: 0.9,
};

function startPreview() {
  return spawn(
    'corepack',
    ['pnpm', 'preview', '--host', host, '--port', String(port)],
    { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function waitForPreview(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`preview exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}${sitePath('en/')}`);
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('preview did not become ready within 30 seconds');
}

function summarize(lhr) {
  return {
    scores: Object.fromEntries(
      Object.entries(thresholds).map(([category]) => [
        category,
        Math.round((lhr.categories[category]?.score ?? 0) * 100),
      ]),
    ),
    metrics: {
      cls: Number(
        lhr.audits['cumulative-layout-shift'].numericValue.toFixed(3),
      ),
      lcpMs: Math.round(lhr.audits['largest-contentful-paint'].numericValue),
      tbtMs: Math.round(lhr.audits['total-blocking-time'].numericValue),
    },
  };
}

const preview = startPreview();
let chrome;

try {
  await waitForPreview(preview);
  chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox'],
  });

  const failures = [];
  for (const auditCase of cases) {
    const result = await lighthouse(`${origin}${auditCase.path}`, {
      chromeFlags: ['--headless=new', '--no-sandbox'],
      logLevel: 'error',
      onlyCategories: Object.keys(thresholds),
      output: 'json',
      port: chrome.port,
      preset: auditCase.preset,
    });
    if (!result)
      throw new Error(`Lighthouse returned no result for ${auditCase.name}`);

    const summary = summarize(result.lhr);
    console.log(JSON.stringify({ case: auditCase.name, ...summary }));
    for (const [category, minimum] of Object.entries(thresholds)) {
      const actual = result.lhr.categories[category]?.score ?? 0;
      if (actual < minimum)
        failures.push(`${auditCase.name}: ${category} ${actual} < ${minimum}`);
    }
    if (summary.metrics.cls > 0.1)
      failures.push(`${auditCase.name}: CLS ${summary.metrics.cls} > 0.1`);
    if (summary.metrics.lcpMs > 2_500)
      failures.push(
        `${auditCase.name}: LCP ${summary.metrics.lcpMs}ms > 2500ms`,
      );
  }

  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log('Lighthouse thresholds passed');
} finally {
  chrome?.kill();
  preview.kill('SIGTERM');
}
