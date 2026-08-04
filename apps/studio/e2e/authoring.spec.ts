import { expect, test } from '@playwright/test';

test('creates, autosaves, reloads, previews, and discards a native draft', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Owner 密码').fill('browser-test-owner-password');
  await page.getByRole('button', { name: '进入 Studio' }).click();
  await expect(page.getByLabel('当前工作区')).toHaveValue('test-browser-blog');

  await page.getByRole('button', { name: '新建文章' }).click();
  await page.getByLabel('标题', { exact: true }).fill('浏览器旅程');
  await page.getByLabel(/Slug/).fill('journey-draft');
  await page.getByRole('button', { name: '建立原生草稿' }).click();
  await expect(page.getByLabel('文章标题')).toHaveValue('浏览器旅程');

  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  await page
    .getByLabel('Markdown 源码')
    .fill('# 浏览器可靠草稿\n\n刷新后仍然存在。\n');
  await expect(page.getByText('刚刚保存')).toBeVisible({ timeout: 5_000 });

  await page.reload();
  await expect(page.getByLabel('文章标题')).toHaveValue('浏览器旅程');
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(/刷新后仍然存在/);

  await page.getByRole('button', { name: '检查未引用资源' }).click();
  await expect(page.getByText('没有发现未引用的文章级资源')).toBeVisible();

  await page.getByRole('button', { name: '预览全文' }).click();
  await expect(page.getByTitle('文章真实预览')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('status')).toContainText('已显示 Markdown 预览');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByText('已同步')).toBeVisible();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue('');

  await page.getByText('安全', { exact: true }).click();
  await page.getByLabel('当前密码').fill('browser-test-owner-password');
  await page
    .getByLabel('新密码', { exact: true })
    .fill('browser-test-replacement-password');
  await page.getByLabel('确认新密码').fill('browser-test-replacement-password');
  await page.getByRole('button', { name: '更新密码' }).click();
  await expect(page.getByText(/其他会话已退出/)).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('Owner 密码').fill('browser-test-replacement-password');
  await page.getByRole('button', { name: '进入 Studio' }).click();
  await expect(page.getByLabel('当前工作区')).toHaveValue('test-browser-blog');
});
