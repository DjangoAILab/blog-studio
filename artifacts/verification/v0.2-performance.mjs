import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../apps/studio/node_modules/@playwright/test');

const origin = process.env.BLOG_STUDIO_PERF_ORIGIN ?? 'http://127.0.0.1:14311';
const password =
  process.env.BLOG_STUDIO_PERF_PASSWORD ?? 'browser-test-owner-password';

if (!origin.startsWith('http://127.0.0.1:')) {
  throw new Error('This fixture verifier accepts only a loopback origin');
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

function summarize(values) {
  return {
    samples: values.length,
    medianMs: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await page.goto(origin);
  await page.getByLabel('Owner 密码').fill(password);
  await page.getByRole('button', { name: '进入 Studio' }).click();
  await page.getByRole('heading', { name: '先把你的站点带进来。' }).waitFor();
  await page.getByRole('button', { name: '添加这个站点' }).click();
  await page.getByRole('button', { name: '内容', exact: true }).waitFor();

  const setup = await page.evaluate(
    async ({ ownerPassword }) => {
      async function request(path, init = {}) {
        const response = await fetch(path, init);
        if (!response.ok)
          throw new Error(
            `${init.method ?? 'GET'} ${path}: ${response.status}`,
          );
        return response.json();
      }

      const session = await request('/api/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: location.origin,
        },
        body: JSON.stringify({ password: ownerPassword }),
      });
      const { sites } = await request('/api/sites');
      const site = sites[0];
      if (!site?.id)
        throw new Error('Performance fixture Site was not registered');

      for (let index = 1; index <= 92; index += 1) {
        await request(`/api/sites/${site.id}/content`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: location.origin,
            'x-csrf-token': session.csrfToken,
          },
          body: JSON.stringify({
            title: `Performance fixture ${index}`,
            slug: `performance-fixture-${String(index).padStart(2, '0')}`,
          }),
        });
      }

      const content = await request(
        `/api/sites/${site.id}/content?pageSize=100`,
      );
      if (content.content.total !== 93)
        throw new Error(
          `Expected 93 fixture documents, received ${content.content.total}`,
        );
      const published = content.content.items.find(
        (item) => item.sourceState === 'published',
      );
      if (!published)
        throw new Error('Published performance document is missing');
      return { csrfToken: session.csrfToken, published, siteId: site.id };
    },
    { ownerPassword: password },
  );

  const api = await page.evaluate(async ({ csrfToken, published, siteId }) => {
    async function request(path, init = {}) {
      const startedAt = performance.now();
      const response = await fetch(path, init);
      const duration = performance.now() - startedAt;
      if (!response.ok)
        throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status}`);
      return { duration, payload: await response.json() };
    }

    const listingMs = [];
    for (let index = 0; index < 50; index += 1) {
      const result = await request(
        `/api/sites/${siteId}/content?page=1&pageSize=100&collection=posts`,
      );
      listingMs.push(result.duration);
    }

    const document = await request(
      `/api/sites/${siteId}/content/${published.documentId}?collection=${published.collectionId}`,
    );
    const autosaveMs = [];
    for (let version = 0; version < 30; version += 1) {
      const saved = await request(
        `/api/sites/${siteId}/content/${published.documentId}/working-copy?collection=${published.collectionId}`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            origin: location.origin,
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            expectedVersion: version,
            sourceRevision: document.payload.source.revision,
            frontMatter: document.payload.source.frontMatter,
            body: `Performance autosave ${version + 1}.\n`,
          }),
        },
      );
      if (saved.payload.draft.version !== version + 1)
        throw new Error('Autosave version did not advance monotonically');
      autosaveMs.push(saved.duration);
    }

    await request(
      `/api/sites/${siteId}/content/${published.documentId}/working-copy?collection=${published.collectionId}`,
      {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          origin: location.origin,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ expectedVersion: 30 }),
      },
    );

    return { autosaveMs, listingMs };
  }, setup);

  async function measureTransition(destination) {
    const frames = page.evaluate(
      () =>
        new Promise((resolve) => {
          const deltas = [];
          let previous;
          const startedAt = performance.now();
          function frame(timestamp) {
            if (previous !== undefined) deltas.push(timestamp - previous);
            previous = timestamp;
            if (performance.now() - startedAt >= 750) resolve(deltas);
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }),
    );
    await page.getByRole('button', { name: destination, exact: true }).click();
    return frames;
  }

  const frameDeltas = [
    ...(await measureTransition('内容')),
    ...(await measureTransition('系统')),
    ...(await measureTransition('站点')),
  ];
  const longFrames = frameDeltas.filter((duration) => duration > 50).length;
  const result = {
    environment: 'local production build, headless Chrome, 1280x720',
    fixtureDocuments: 93,
    listing: summarize(api.listingMs),
    autosave: summarize(api.autosaveMs),
    navigationFrames: {
      ...summarize(frameDeltas),
      over50Ms: longFrames,
    },
    gates: {
      listingP95Under200Ms: percentile(api.listingMs, 0.95) < 200,
      autosaveP95Under150Ms: percentile(api.autosaveMs, 0.95) < 150,
      navigationP95Under20Ms: percentile(frameDeltas, 0.95) < 20,
      noNavigationFrameOver50Ms: longFrames === 0,
    },
  };
  if (Object.values(result.gates).some((passed) => !passed))
    process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
