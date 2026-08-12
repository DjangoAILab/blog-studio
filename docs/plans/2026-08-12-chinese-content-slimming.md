# Chinese Content Slimming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use Code workflow to implement this plan task-by-task.

**Goal:** Make the Chinese Blog Studio site faster to understand and materially shorter without changing product capabilities or weakening technical documentation.

**Architecture:** Keep the shared Astro landing component and locale data model. Simplify the shared page structure, rewrite only Chinese positioning where localization needs differ, tune responsive CSS for common laptop widths, and improve static SEO files and metadata. Preserve detailed operational facts in task-specific documentation.

**Tech Stack:** Astro 7, Starlight, TypeScript, CSS, Vitest, Playwright.

---

### Task 1: Lock the intended page structure in tests

**Files:**

- Modify: `apps/website/test/smoke.test.ts`
- Modify: `apps/website/e2e/site.spec.ts`

1. Assert the concise Chinese positioning, direct proof points, canonical metadata, and robots file.
2. Assert the removed slogan section no longer appears.
3. Run the website unit tests and confirm the new expectations fail before implementation.

### Task 2: Simplify and rewrite the landing page

**Files:**

- Modify: `apps/website/src/content/landing.ts`
- Modify: `apps/website/src/components/LandingPage.astro`
- Modify: `apps/website/src/styles/landing.css`

1. Replace translated marketing abstractions with direct Chinese benefits.
2. Remove the standalone principle band and number-led proof strip.
3. Keep the product preview, four-step journey, compact architecture explanation, and one closing CTA.
4. Keep the desktop hero in two columns at 1280px and reduce oversized vertical spacing.

### Task 3: Make the Chinese docs home task-oriented

**Files:**

- Modify: `apps/website/src/content/docs/zh-cn/docs/index.mdx`

1. State the product category and migration promise immediately.
2. Use concise task cards and direct path labels.
3. Remove internal project-management language from the entry page.

### Task 4: Complete discoverability metadata

**Files:**

- Modify: `apps/website/src/components/LandingPage.astro`
- Create: `apps/website/public/robots.txt`

1. Add Open Graph and Twitter metadata using the localized title and description.
2. Publish a robots file that allows crawling and points to the production sitemap.

### Task 5: Verify, publish, and validate production

1. Run formatting, website tests, typecheck, build, E2E, and Lighthouse audit.
2. Review desktop and mobile screenshots of the local production build.
3. Commit the reviewed change, merge it into local `main`, and push `main`.
4. Wait for CI and Documentation workflows to succeed.
5. Verify the GitHub Pages deployment SHA, production copy, metadata, links, desktop layout, and mobile layout.
