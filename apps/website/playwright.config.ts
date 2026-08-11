import { defineConfig, devices } from '@playwright/test';

const configuredBase = (process.env.BLOG_STUDIO_DOCS_BASE ?? '').replace(
  /^\/+|\/+$/g,
  '',
);
const previewUrl = `http://127.0.0.1:4322${configuredBase ? `/${configuredBase}/` : '/'}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 2,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'corepack pnpm preview --host 127.0.0.1 --port 4322',
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
    },
  ],
});
