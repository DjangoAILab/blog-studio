import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const configuredBase = (process.env.BLOG_STUDIO_DOCS_BASE ?? '').replace(
  /^\/+|\/+$/g,
  '',
);
const sitePath = (path: string) =>
  `${configuredBase ? `/${configuredBase}` : ''}/${path.replace(/^\/+/, '')}`;

test('root sends visitors to the explicit default locale', async ({ page }) => {
  await page.goto(sitePath(''));
  await expect(page).toHaveURL(new RegExp(`${sitePath('en/')}$`));
});

test('landing pages expose the locale contract', async ({ page }) => {
  await page.goto(sitePath('en/'));
  await expect(
    page.getByRole('heading', { name: /write where your site already lives/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeVisible();
  await expect(page.getByText('Your content stays in Git')).toBeVisible();
  await expect(page.getByText('Hexo is the first proof.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /read the quick start/i }),
  ).toHaveAttribute('href', sitePath('en/docs/'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: '简体中文' })).toHaveAttribute(
    'href',
    sitePath('zh-cn/'),
  );

  await page.goto(sitePath('zh-cn/'));
  await expect(
    page.getByRole('heading', { name: /保留现有网站，更顺手地写作/ }),
  ).toBeVisible();
  await expect(page.getByText('内容仍在仓库')).toBeVisible();
  await expect(page.getByText('你的网站不是数据库中的一行。')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('link', { name: 'English' })).toHaveAttribute(
    'href',
    sitePath('en/'),
  );
});

test('documentation navigation, deep links, and search load', async ({
  page,
}) => {
  await page.goto(sitePath('en/docs/concepts/core-journey/'));
  await expect(
    page.getByRole('heading', { level: 1, name: 'The core user journey' }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1024) < 800)
    await page.getByRole('button', { name: 'Menu' }).click();
  await expect(
    page.getByRole('link', { name: 'Self-host with Docker', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Work with the Site Agent', exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1024) < 800)
    await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('.pagefind-ui__search-input')).toBeAttached({
    timeout: 15_000,
  });
  const search = page.getByRole('button', { name: /search/i }).first();
  await expect(search).toBeVisible();
  await search.click();
  await expect(page.locator('.pagefind-ui__search-input')).toBeVisible();
});

test('documentation is available in both explicit locales', async ({
  page,
}) => {
  await page.goto(sitePath('en/docs/'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page
    .getByLabel('Select language')
    .first()
    .selectOption(sitePath('zh-cn/docs/'), { force: true });
  await expect(page).toHaveURL(new RegExp(`${sitePath('zh-cn/docs/')}$`));

  await page.goto(sitePath('zh-cn/docs/'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('project-base documentation actions and nested links resolve', async ({
  page,
}) => {
  await page.goto(sitePath('en/docs/'));
  await page.getByRole('link', { name: 'Self-host Blog Studio' }).click();
  await expect(page).toHaveURL(
    new RegExp(`${sitePath('en/docs/guides/self-hosting/')}$`),
  );
  await page
    .getByRole('link', { name: 'workspace configuration', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`${sitePath('en/docs/configuration/workspaces/')}$`),
  );

  await page.goto(sitePath('zh-cn/docs/'));
  await page.getByRole('link', { name: '了解完整旅程' }).click();
  await expect(page).toHaveURL(
    new RegExp(`${sitePath('zh-cn/docs/concepts/core-journey/')}$`),
  );
});

test('pages do not overflow a narrow viewport', async ({ page }) => {
  for (const path of [
    '/en/',
    '/zh-cn/',
    '/en/docs/',
    '/zh-cn/docs/',
    '/en/docs/use/agent/',
    '/zh-cn/docs/operations/backup-restore/',
  ]) {
    await page.goto(sitePath(path));
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
      dimensions.clientWidth + 1,
    );
  }
});

test('key pages have no serious accessibility violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of [
    '/en/',
    '/zh-cn/',
    '/en/docs/',
    '/zh-cn/docs/',
    '/en/docs/use/agent/',
    '/zh-cn/docs/use/publishing/',
  ]) {
    await page.goto(sitePath(path));
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const severeViolations = results.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );

    expect(severeViolations, `${path} accessibility violations`).toEqual([]);
  }
});
