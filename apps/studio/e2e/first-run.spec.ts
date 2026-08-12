import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    ),
  ).toEqual([]);
}

test('distinguishes credentials not ready from invalid configuration', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:14313/');
  await expect(
    page.getByRole('heading', { name: '让 AI 理解整个网站。' }),
  ).toBeVisible();
  await expect(page.getByText('需要先在可信终端设置 Owner 密码')).toBeVisible();
  await expect(page.getByText(/auth init/)).toBeVisible();
  await expect(page.getByLabel('Owner 密码')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '进入 Studio' }),
  ).toBeDisabled();
  await expectNoSeriousAccessibilityViolations(page);

  await page.goto('http://127.0.0.1:14312/');
  await expect(
    page.getByRole('heading', { name: 'Studio 尚未准备好。' }),
  ).toBeVisible();
  await expect(page.getByText('Owner 凭据已就绪')).toBeVisible();
  await expect(page.getByText('站点配置需要修复')).toBeVisible();
  await expect(page.getByText(/BLOG_STUDIO_CONFIG_PATHS/)).toBeVisible();
  await expect(page.getByText('等待添加站点')).toBeVisible();
  await page.getByRole('button', { name: '重新检查状态' }).focus();
  await expect(
    page.getByRole('button', { name: '重新检查状态' }),
  ).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);
});
