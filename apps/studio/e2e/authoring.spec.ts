import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

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

test('creates, autosaves, reloads, previews, and discards a native draft', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByLabel('Owner 密码').fill('browser-test-owner-password');
  await page.getByRole('button', { name: '进入 Studio' }).click();
  await expect(
    page.getByRole('heading', { name: '先把你的站点带进来。' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'test-browser-blog', level: 2 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '添加这个站点' }).click();
  await expect(
    page.getByRole('heading', { name: 'test-browser-blog' }),
  ).toBeVisible();
  await expect(page.getByLabel('当前站点')).toContainText('test-browser-blog');

  await page.getByRole('button', { name: '站点资料' }).click();
  await expect(page.getByRole('heading', { name: '站点资料' })).toBeVisible();
  const concurrentPage = await page.context().newPage();
  await concurrentPage.goto('/');
  await concurrentPage.getByRole('button', { name: '站点资料' }).click();
  await concurrentPage.getByLabel('站点名称').fill('Background Update');
  await concurrentPage.getByRole('button', { name: '保存站点资料' }).click();
  await expect(
    concurrentPage.getByText(/站点资料已保存；Markdown/),
  ).toBeVisible();

  await page.getByLabel('站点名称').fill('Browser Test Blog');
  await page.getByRole('button', { name: '保存站点资料' }).click();
  const settingsConflict = page
    .getByRole('alert')
    .filter({ hasText: '发现并发修改' });
  await expect(settingsConflict).toBeVisible();
  await expect(
    settingsConflict.getByText('Background Update', { exact: true }),
  ).toBeVisible();
  await expect(
    settingsConflict.getByText('Browser Test Blog', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '以我的输入重试' }).click();
  await expect(page.getByText(/站点资料已保存；Markdown/)).toBeVisible();
  await expect(page.getByText('更新站点资料')).toHaveCount(2);
  await page.getByLabel('关闭').click();
  await concurrentPage.close();
  await expect(
    page.getByRole('heading', { name: 'Browser Test Blog' }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole('button', { name: '内容', exact: true }).click();
  const library = page.getByRole('complementary', { name: '内容库' });
  await expect(library).toBeVisible();
  const globalSearch = page.getByRole('button', { name: '搜索内容' });
  await globalSearch.click();
  const globalSearchDialog = page.getByRole('dialog', { name: '搜索内容' });
  const globalSearchInput = globalSearchDialog.getByLabel('全局搜索');
  await expect(globalSearchInput).toBeFocused();
  await globalSearchInput.fill('Existing');
  await expect(
    globalSearchDialog.getByRole('button', { name: /Existing article/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(/contentSearch=Existing/);
  await globalSearchInput.press('Escape');
  await expect(globalSearchDialog).toHaveCount(0);
  await expect(globalSearch).toBeFocused();
  const sortField = library.getByLabel('排序属性');
  await expect(sortField).toHaveValue('activityAt');
  await sortField.selectOption('title');
  await expect(page).toHaveURL(/contentSort=title/);
  await library.getByRole('button', { name: '当前为降序' }).click();
  await expect(page).toHaveURL(/contentDirection=asc/);
  await sortField.selectOption('activityAt');
  await library.getByRole('button', { name: '当前为升序' }).click();
  await expect(page).not.toHaveURL(/contentSort|contentDirection/);
  await expect(
    library.getByRole('button', { name: /Existing article/ }),
  ).toBeVisible();
  await page
    .getByLabel('内容状态')
    .getByRole('button', { name: /已发布/ })
    .click();
  await expect(
    library.getByRole('button', { name: /Existing article/ }),
  ).toBeVisible();
  await library.getByRole('textbox', { name: '搜索内容' }).fill('Existing');
  await library.getByRole('textbox', { name: '搜索内容' }).press('Enter');
  await expect(
    library.getByRole('button', { name: /Existing article/ }),
  ).toBeVisible();
  await page.getByLabel('清除搜索').click();
  await library.getByRole('button', { name: '筛选内容' }).click();
  const advancedFilters = library.getByRole('form', { name: '内容筛选' });
  await advancedFilters.getByLabel('集合').selectOption('posts');
  await advancedFilters.getByLabel('标签').selectOption('Browser');
  await advancedFilters.getByLabel('从').fill('2026-01-01');
  await advancedFilters.getByLabel('到').fill('2026-12-31');
  await advancedFilters.getByRole('button', { name: '应用筛选' }).click();
  await expect(
    library.getByRole('button', { name: /Existing article/ }),
  ).toBeVisible();
  await expect(library.getByRole('button', { name: /筛选内容/ })).toContainText(
    '4',
  );
  await library.getByRole('button', { name: '清除' }).click();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole('button', { name: '新建文章' }).first().click();
  await page.getByLabel('标题', { exact: true }).fill('浏览器旅程');
  await page.getByLabel(/Slug/).fill('journey-draft');
  await page.getByRole('button', { name: '建立原生草稿' }).click();
  await expect(page.getByLabel('文章标题')).toHaveValue('浏览器旅程');
  const articleProperties = page.getByLabel('文章属性');
  await articleProperties.getByLabel('标签').fill('Browser, Draft');
  await articleProperties.getByLabel('分类').fill('Engineering');
  await articleProperties.getByLabel('精选').check();
  await articleProperties.getByLabel('心情').selectOption('focused');
  await expect(page.getByText('刚刚保存')).toBeVisible({ timeout: 5_000 });
  await page.reload();
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await expect(page.getByLabel('文章属性').getByLabel('标签')).toHaveValue(
    'Browser, Draft',
  );
  await expect(page.getByLabel('文章属性').getByLabel('分类')).toHaveValue(
    'Engineering',
  );
  await expect(page.getByLabel('文章属性').getByLabel('精选')).toBeChecked();
  await expect(page.getByLabel('文章属性').getByLabel('心情')).toHaveValue(
    'focused',
  );

  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  await page
    .getByLabel('Markdown 源码')
    .fill(
      '# 浏览器可靠草稿\n\n刷新后仍然存在。\n\n![Preview fixture](/static/reading.jpeg)\n',
    );
  await expect(page.getByText('刚刚保存')).toBeVisible({ timeout: 5_000 });

  await page.route(
    '**/api/sites/*/content/*/resources?*',
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'temporary storage fault' }),
      });
    },
    { times: 1 },
  );
  await page.getByLabel('选择资源文件').setInputFiles({
    name: 'retry-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('retry resource fixture'),
  });
  const retryResource = page
    .locator('.studio3-resource-toast')
    .filter({ hasText: 'retry-notes.txt' });
  await expect(retryResource).toContainText('temporary storage fault');
  await retryResource.getByRole('button', { name: '重试' }).click();
  await expect(retryResource).toContainText('文本已插入 · 本地存储');

  await page.getByLabel('选择资源文件').setInputFiles({
    name: 'writing-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('browser resource fixture'),
  });
  const insertedResource = page
    .locator('.studio3-resource-toast')
    .filter({ hasText: 'writing-notes.txt' });
  await expect(insertedResource).toContainText('文本已插入 · 本地存储');
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(
    /writing-notes\.txt/,
  );
  await expect(page.getByText('刚刚保存')).toBeVisible({ timeout: 5_000 });

  await page.getByLabel('选择资源文件').setInputFiles({
    name: 'unsafe.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ unsafe executable fixture'),
  });
  const rejectedResource = page
    .locator('.studio3-resource-toast')
    .filter({ hasText: 'unsafe.exe' });
  await expect(rejectedResource).toContainText('已拒绝，未存储');
  await rejectedResource.getByRole('button', { name: '移除' }).click();
  await expect(rejectedResource).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await expect(page.getByLabel('文章标题')).toHaveValue('浏览器旅程');
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(/刷新后仍然存在/);

  await page.getByRole('button', { name: '预览全文' }).click();
  await expect(page.getByTitle('文章全文预览')).toBeVisible({
    timeout: 10_000,
  });
  await expect
    .poll(async () => {
      const box = await page.getByTitle('文章全文预览').boundingBox();
      return box?.height ?? 0;
    })
    .toBeGreaterThan(300);
  const markdownFrame = page.frameLocator('iframe[title="文章全文预览"]');
  const previewImage = markdownFrame.getByRole('img', {
    name: 'Preview fixture',
  });
  await expect(previewImage).toBeVisible();
  await expect
    .poll(() =>
      previewImage.evaluate(
        (image) => image instanceof HTMLImageElement && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '站点主题' }).click();
  await expect(page.getByRole('status')).toContainText('Markdown 预览');
  await expect
    .poll(async () => {
      const box = await page.getByTitle('文章全文预览').boundingBox();
      return box?.height ?? 0;
    })
    .toBeGreaterThan(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await page.getByTitle('文章全文预览').boundingBox();
      return box?.height ?? 0;
    })
    .toBeGreaterThan(300);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '返回编辑' }).click();
  await expectNoSeriousAccessibilityViolations(page);

  await page
    .getByRole('button', { name: /准备更改/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: '更改审阅' })).toBeVisible();
  await expect(page.getByText('冻结记录未写入文件')).toBeVisible();
  await page.getByRole('button', { name: '完成' }).click();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByText('已同步')).toBeVisible();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue('');
  await expect(page.getByText('2 个未引用资源')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '审阅并清理' }).click();
  await expect(page.getByText('2 个未引用资源')).toHaveCount(0);

  await library.getByRole('button', { name: /Existing article/ }).click();
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  await page
    .getByLabel('Markdown 源码')
    .fill('Existing body.\n\nReviewed through the browser journey.\n');
  await expect(page.getByText('刚刚保存')).toBeVisible({ timeout: 5_000 });

  const incompatibleSource = await request.post(
    'http://127.0.0.1:14314/break-source',
  );
  expect(incompatibleSource.status()).toBe(204);
  await page.reload();
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await library.getByRole('button', { name: /Existing article/ }).click();
  await page.getByText('高级 YAML').click();
  await expect(
    page.getByText(
      '原始 YAML 无法解析。修复后会直接替换这一段属性，正文不会改变。',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '修复原始 YAML' }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  const compatibleAgain = await request.post(
    'http://127.0.0.1:14314/restore-source',
  );
  expect(compatibleAgain.status()).toBe(204);
  await page.reload();
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await library.getByRole('button', { name: /Existing article/ }).click();

  const mutation = await request.post('http://127.0.0.1:14314/mutate');
  expect(mutation.status()).toBe(204);

  await page.reload();
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await page
    .getByRole('complementary', { name: '内容库' })
    .getByRole('button', { name: /Existing article/ })
    .click();
  await expect(
    page.getByRole('heading', {
      name: '文件版本在编辑期间发生了变化',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Existing body changed outside Studio.'),
  ).toBeVisible();
  await expect(
    page.getByText('Reviewed through the browser journey.'),
  ).toBeVisible();
  await page.getByRole('button', { name: '以新版为基准保留我的编辑' }).click();
  await page.getByRole('button', { name: 'Markdown 源码' }).click();
  await expect(page.getByLabel('Markdown 源码')).toHaveValue(
    /Reviewed through the browser journey/,
  );

  await page
    .getByRole('button', { name: /准备更改/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: '更改审阅' })).toBeVisible();
  await expect(page.getByText('source/_posts/hello.md').first()).toBeVisible();
  const repositoryMutation = await request.post(
    'http://127.0.0.1:14314/touch-repository',
  );
  expect(repositoryMutation.status()).toBe(204);
  await page.getByRole('button', { name: '应用到本地文件…' }).click();
  await page.getByLabel(/我确认应用这份冻结记录/).check();
  await page.getByRole('button', { name: '确认应用' }).click();
  await expect(
    page.getByRole('button', { name: '按最新状态重新准备' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '按最新状态重新准备' }).click();
  await page.getByRole('button', { name: '应用到本地文件…' }).click();
  await page.getByLabel(/我确认应用这份冻结记录/).check();
  await page.getByRole('button', { name: '确认应用' }).click();
  await expect(page.getByText('已写入本地，尚未提交')).toBeVisible({
    timeout: 5_000,
  });
  await page.getByLabel('提交说明').fill('Browser reviewed content');
  await page.getByRole('button', { name: '创建本地提交' }).click();
  await expect(page.getByText('本地提交已创建')).toBeVisible({
    timeout: 5_000,
  });
  await page.getByLabel(/输入以下确认语句/).fill('RELEASE COMMITTED CHANGESET');
  await page.getByRole('button', { name: '开始远端发布' }).click();
  await expect(page.getByText('RELEASE', { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    page.getByText(
      /等待开始|环境检查|生成站点|计算发布计划|上传资源|上传页面|刷新缓存|线上校验|发布完成|发布失败/,
    ),
  ).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: '完成' }).click();

  await page.getByRole('button', { name: '系统', exact: true }).click();
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
  await expect(page.getByLabel('当前站点')).toContainText('Browser Test Blog');
  await expectNoSeriousAccessibilityViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '内容', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: '工作区面板' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '文章', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: '内容库' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '写作', exact: true }).click();
  await expect(page.getByLabel('文章标题')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        [
          ...document.querySelectorAll(
            '.studio3-library-slot,.writing-panel,.studio3-preview-slot',
          ),
        ].filter((element) => getComputedStyle(element).display !== 'none')
          .length,
    ),
  ).toBe(1);
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole('button', { name: '文章', exact: true }).click();
  await page.route(
    '**/api/sites/*/content?*',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.continue();
    },
    { times: 1 },
  );
  const mobileLibrary = page.getByRole('complementary', { name: '内容库' });
  await mobileLibrary.getByLabel('搜索内容').fill('no-matching-document');
  await mobileLibrary.getByLabel('搜索内容').press('Enter');
  await expect(page.getByText('正在整理内容…')).toBeVisible();
  await expect(page.getByText('没有匹配内容')).toBeVisible();

  const brokenSource = await request.post(
    'http://127.0.0.1:14314/break-source',
  );
  expect(brokenSource.status()).toBe(204);
  await mobileLibrary.getByLabel('搜索内容').fill('still-no-match');
  await mobileLibrary.getByLabel('搜索内容').press('Enter');
  await expect(page.getByText('没有匹配内容')).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const restoredSource = await request.post(
    'http://127.0.0.1:14314/restore-source',
  );
  expect(restoredSource.status()).toBe(204);
  await page.getByLabel('清除搜索').click();
  await expect(
    mobileLibrary.getByRole('button', { name: /Existing article/ }),
  ).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-reduced-transparency', value: 'reduce' },
      { name: 'prefers-contrast', value: 'more' },
    ],
  });
  expect(
    await page.evaluate(() => ({
      contrast: matchMedia('(prefers-contrast: more)').matches,
      motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transparency: matchMedia('(prefers-reduced-transparency: reduce)')
        .matches,
    })),
  ).toEqual({ contrast: true, motion: true, transparency: true });
  const preferenceStyles = await page.evaluate(() => {
    const navigation = getComputedStyle(
      document.querySelector('.studio2-nav')!,
    );
    const prepare = getComputedStyle(
      document.querySelector('.studio2-prepare-button')!,
    );
    return {
      backdrop: navigation.backdropFilter,
      border: navigation.borderColor,
      transition: prepare.transitionDuration,
    };
  });
  expect(preferenceStyles).toMatchObject({
    backdrop: 'none',
    border: 'rgba(0, 0, 0, 0.45)',
  });
  expect(Number.parseFloat(preferenceStyles.transition)).toBeLessThanOrEqual(
    0.00001,
  );
  await expectNoSeriousAccessibilityViolations(page);
});
