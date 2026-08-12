# AI Content Workspace Positioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish a consistent AI-first product position across the Blog Studio website, repository metadata, documentation, and product introduction.

**Architecture:** Keep the existing landing component structure and restyle its copy and product preview through the localized content model. Cascade the same message hierarchy through repository and documentation entry points, then deploy the documentation site through the existing main-branch GitHub Pages workflow.

**Tech Stack:** Astro, Starlight, React, TypeScript, Vitest, Playwright, GitHub Actions.

---

### Task 1: Lock public claims in website tests

**Files:**

- Modify: `apps/website/test/smoke.test.ts`
- Modify: `apps/website/e2e/site.spec.ts`

1. Replace the former publishing-workbench hero expectations with assertions
   for the AI content workspace, Site Agent, approval, and human-reviewed
   publishing claims.
2. Run `corepack pnpm --filter @blog-studio/website test` and confirm the new
   expectations initially fail.

### Task 2: Reposition the localized landing page

**Files:**

- Modify: `apps/website/src/content/landing.ts`
- Modify: `apps/website/src/components/LandingPage.astro`

1. Rewrite localized metadata, hero, proof strip, product preview, journey,
   architecture bridge, and final CTA around the approved message hierarchy.
2. Add a direct Site Agent CTA without changing routing architecture.
3. Run the website unit tests and confirm they pass.

### Task 3: Cascade positioning through project entry points

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `package.json`
- Modify: `apps/website/src/content/docs/en/docs/index.mdx`
- Modify: `apps/website/src/content/docs/zh-cn/docs/index.mdx`
- Modify: `apps/website/astro.config.mjs`
- Modify: `apps/studio/index.html`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `docs/product/product-definition.md`

1. Apply the category, capability, differentiator, and trust promise in both
   languages while preserving operational detail and product limits.
2. Leave historical release notes unchanged.

### Task 4: Verify the release candidate

**Files:**

- Verify: all modified files

1. Run formatting checks, website tests, website production build, link checks,
   and Playwright tests with the GitHub Pages base path.
2. Visually inspect desktop and mobile landing pages.
3. Run the repository-wide `corepack pnpm check` gate.

### Task 5: Publish the positioning update

**Files:**

- Commit: all scoped changes

1. Commit the verified update on `codex/ai-content-workspace-positioning`.
2. Push the branch, open a ready pull request, merge it after required checks,
   and wait for the Documentation workflow to deploy GitHub Pages.
3. Verify the live English and Chinese landing pages show the new metadata and
   hero. Do not create a semantic version tag for a copy-only release.
