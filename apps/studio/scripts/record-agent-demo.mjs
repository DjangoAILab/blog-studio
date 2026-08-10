import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

const executeFile = promisify(execFile);
const studioRoot = resolve(import.meta.dirname, '..');
const output = resolve(
  process.argv[2] ??
    resolve(studioRoot, '../../docs/media/site-agent-demo.gif'),
);
const recordings = await mkdtemp(resolve(tmpdir(), 'blog-studio-agent-demo-'));
await mkdir(dirname(output), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: recordings, size: { width: 1280, height: 720 } },
  colorScheme: 'light',
});
const page = await context.newPage();
const video = page.video();
const sourceVideo = resolve(recordings, 'site-agent-demo.webm');
const pause = () => page.waitForTimeout(1_050);

try {
  await page.goto('http://127.0.0.1:14311/');
  await pause();
  await page.getByLabel('Owner 密码').fill('browser-test-owner-password');
  await page.getByRole('button', { name: '进入 Studio' }).click();
  await pause();
  await page.getByRole('button', { name: '添加这个站点' }).click();
  await pause();

  await page.getByRole('button', { name: 'Agent' }).click();
  const panel = page.getByRole('complementary', { name: /Agent/ });
  await panel.getByRole('button', { name: '新建' }).click();
  await pause();
  await panel.getByRole('button', { name: '新建' }).click();
  await pause();
  await panel.getByLabel('Agent Session').selectOption({ index: 1 });
  await pause();
  await panel.getByLabel('执行模式').selectOption('yolo');
  await pause();
  await panel.getByLabel('执行模式').selectOption('approval');
  await pause();
  await panel.getByRole('button', { name: '关闭 Agent' }).click();

  await page.getByRole('button', { name: '内容', exact: true }).click();
  await pause();
  await page.getByRole('button', { name: /Existing article/ }).click();
  await pause();
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  const source = page.getByLabel('Markdown 源码');
  await source.evaluate((element) => {
    const textarea = element;
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  });
  await page.keyboard.down('Shift');
  for (let index = 0; index < 24; index += 1)
    await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await pause();
  await page.getByRole('button', { name: '附加选区到 Agent' }).click();
  await pause();
  await panel.getByText(/选区 · L/).hover();
  await pause();
  await panel.getByText(/文章 ·/).hover();
  await page.waitForTimeout(7_000);
} finally {
  await page.close();
  if (video) await video.saveAs(sourceVideo);
  await context.close();
  await browser.close();
}

if (!video) throw new Error('Playwright did not create a recording');
await executeFile('ffmpeg', [
  '-y',
  '-hide_banner',
  '-i',
  sourceVideo,
  '-vf',
  'fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop',
  '0',
  output,
]);

console.log(output);
