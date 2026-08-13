import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

const executeFile = promisify(execFile);
const studioRoot = resolve(import.meta.dirname, '..');
const mediaRoot = resolve(studioRoot, '../../docs/media');
const coverPhoto = resolve(mediaRoot, 'cover-afternoon.jpg');
const output = process.argv[2] ?? resolve(mediaRoot, 'site-agent-demo.gif');
const recordings = await mkdtemp(resolve(tmpdir(), 'blog-studio-agent-demo-'));
await mkdir(dirname(output), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: recordings, size: { width: 1440, height: 900 } },
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const video = page.video();
const sourceVideo = resolve(recordings, 'site-agent-demo.webm');
const pause = (ms = 900) => page.waitForTimeout(ms);

const writingPrompt =
  '识别照片里的物件和光线，把 #1 整理成带小标题的短文，并写一句图片说明。';

try {
  await page.goto('http://127.0.0.1:14311/');
  await pause();
  await page.getByLabel('Owner 密码').fill('browser-test-owner-password');
  await page.getByRole('button', { name: '进入 Studio' }).click();
  await pause();
  const addSite = page.getByRole('button', { name: '添加这个站点' });
  if (await addSite.count()) {
    await addSite.click();
    await pause(1_200);
  }

  await page.getByRole('button', { name: '内容', exact: true }).click();
  const library = page.getByRole('complementary', { name: '内容库' });
  await library.waitFor();
  await pause();
  await library.getByRole('button', { name: /Existing article/ }).click();
  await pause();
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  const source = page.getByLabel('Markdown 源码');
  await source.waitFor();
  await source.fill(
    '窗边这张桌子适合写成一篇午后短文。\n\n![午后书桌](/static/reading.jpeg)\n',
  );
  await pause();
  await source.evaluate((element) => {
    const textarea = element;
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  });
  await page.keyboard.down('Shift');
  for (let offset = 0; offset < 16; offset += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await pause();
  const addToChat = page.getByRole('button', { name: '加入对话' });
  await addToChat.waitFor();
  await page.screenshot({
    path: resolve(mediaRoot, 'ai-add-to-chat.png'),
    animations: 'disabled',
  });
  await addToChat.click();

  const panel = page.getByRole('complementary', { name: /AI/ });
  await panel.waitFor();
  await panel.locator('.tagify__tag', { hasText: '#1' }).waitFor();
  await pause();

  await panel.locator('.agent-upload-button input').setInputFiles(coverPhoto);
  await panel.locator('.studio2-attachment').waitFor();
  await pause();

  const composer = panel.getByRole('textbox', { name: '发送给 AI' });
  await composer.click();
  await page.keyboard.type(writingPrompt, { delay: 18 });
  await page.keyboard.press('Escape');
  await panel.locator('.agent-session-title').click();
  await pause(1_200);
  const panelBox = await panel.boundingBox();
  if (panelBox) {
    await page.screenshot({
      path: resolve(mediaRoot, 'ai-composer.png'),
      animations: 'disabled',
      clip: {
        x: Math.max(0, panelBox.x - 8),
        y: Math.max(0, panelBox.y - 8),
        width: panelBox.width + 16,
        height: panelBox.height + 16,
      },
    });
  }
  await page.screenshot({
    path: resolve(mediaRoot, 'ai-workbench.png'),
    animations: 'disabled',
  });

  await panel.getByRole('button', { name: 'AI 设置' }).click();
  await page.getByRole('dialog', { name: 'AI 设置' }).waitFor();
  await pause();
  await page.screenshot({
    path: resolve(mediaRoot, 'ai-settings.png'),
    animations: 'disabled',
  });
  await page
    .getByRole('dialog', { name: 'AI 设置' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await pause(2_400);
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
  'fps=12,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop',
  '0',
  output,
]);

console.log(output);
