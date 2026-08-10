import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing page communicates the verified journey', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /write where your site already lives/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeVisible();
  await expect(page.getByText('Files remain canonical.')).toBeVisible();
  await expect(page.getByText('Hexo is the first proof.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /read the quick start/i }),
  ).toHaveAttribute('href', '/docs/');
});

test('documentation navigation, deep links, and search load', async ({
  page,
}) => {
  await page.goto('/docs/concepts/core-journey/');
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

test('pages do not overflow a narrow viewport', async ({ page }) => {
  for (const path of [
    '/',
    '/docs/',
    '/docs/use/agent/',
    '/docs/operations/backup-restore/',
  ]) {
    await page.goto(path);
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
    '/',
    '/docs/',
    '/docs/use/agent/',
    '/docs/use/publishing/',
  ]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const severeViolations = results.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );

    expect(severeViolations, `${path} accessibility violations`).toEqual([]);
  }
});
