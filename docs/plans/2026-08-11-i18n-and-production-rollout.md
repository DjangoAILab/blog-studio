# Internationalized Website and Production Rollout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish complete English and Simplified Chinese README/website experiences, eliminate GitHub Pages base-path link failures, and upgrade the internal Blog Studio installation to the current Site Agent release with working CLIProxy language and vision models.

**Architecture:** Keep the Astro/Starlight static site and the existing Studio Web application architecture. Give both public languages explicit URL prefixes (`en` and `zh-cn`), generate a base-aware static redirect at the site root, use Starlight's native locale routing for documentation, and share the custom landing-page structure through locale data. Production continues to run one Studio container against the existing mounted data and workspace; Pi receives operator-owned runtime files and the vision adapter receives a read-only Docker secret.

**Tech Stack:** Astro, Starlight, TypeScript, Playwright, pnpm, Docker Compose, Pi coding-agent SDK, CLIProxy, GitHub Pages, Traefik.

---

### Task 1: Lock the public URL and locale contract

**Files:**

- Create: `apps/website/src/lib/locales.ts`
- Modify: `apps/website/e2e/site.spec.ts`

1. Add failing browser assertions for `/en/`, `/zh-cn/`, `/en/docs/`, and `/zh-cn/docs/`.
2. Assert that `/` points visitors to the base-aware `/en/` URL.
3. Assert reciprocal language links and correct document `lang` values.
4. Run `corepack pnpm --filter @blog-studio/website e2e` and confirm the new cases fail.
5. Add a typed locale contract defining `en` as the default and `zh-cn` as Simplified Chinese.

### Task 2: Internationalize the landing page

**Files:**

- Create: `apps/website/src/components/LandingPage.astro`
- Create: `apps/website/src/content/landing.ts`
- Create: `apps/website/src/pages/en/index.astro`
- Create: `apps/website/src/pages/zh-cn/index.astro`
- Modify: `apps/website/src/pages/index.astro`
- Modify: `apps/website/src/styles/landing.css`

1. Extract the current landing markup into one component with typed localized copy.
2. Preserve the existing English content at `/en/`.
3. Add a complete, natural Simplified Chinese version at `/zh-cn/`.
4. Add visible English/简体中文 switching and locale-specific metadata.
5. Turn the root page into a base-aware static default-language redirect with a usable fallback link.
6. Add canonical and alternate-language metadata without client-side preference storage.
7. Run the focused website browser tests and correct desktop/mobile regressions.

### Task 3: Internationalize all Starlight documentation

**Files:**

- Modify: `apps/website/astro.config.mjs`
- Move: `apps/website/src/content/docs/docs/**` to `apps/website/src/content/docs/en/docs/**`
- Create: `apps/website/src/content/docs/zh-cn/docs/**`
- Modify: `apps/website/src/content.config.ts`
- Modify: `apps/website/src/styles/docs.css`

1. Configure explicit `en` and `zh-cn` Starlight locales with `en` as `defaultLocale`.
2. Translate sidebar group labels and localized site metadata.
3. Move all 18 English documents under the `en` locale without changing their relative slugs.
4. Create complete Simplified Chinese counterparts for all 18 documents, preserving commands, identifiers, security boundaries, and links.
5. Verify Starlight's native language picker maps equivalent pages and emits Chinese UI strings.
6. Build locally with `BLOG_STUDIO_DOCS_BASE=/blog-studio` and confirm both locale trees exist with no fallback notices.

### Task 4: Make every public link base- and locale-safe

**Files:**

- Modify: `apps/website/src/content/docs/en/docs/**/*.md*`
- Modify: `apps/website/src/content/docs/zh-cn/docs/**/*.md*`
- Modify: `apps/website/scripts/check-links.mjs`
- Modify: `apps/website/e2e/site.spec.ts`

1. Add a failing generated-site check that rejects internal root links which omit the configured project base.
2. Replace `/docs/...` links with locale-preserving relative links.
3. Click through “Self-host Blog Studio” and “Understand the journey” in the built project-base site.
4. Exercise their Chinese equivalents and representative nested links.
5. Run the link checker against both `/` and `/blog-studio/` bases.

### Task 5: Add a complete Chinese README and public URLs

**Files:**

- Modify: `README.md`
- Create: `README.zh-CN.md`

1. Add reciprocal language links at the top of both files.
2. Put the public website and documentation URLs near the product introduction.
3. Translate the complete reader-facing README while preserving commands and security warnings.
4. Keep the Site Agent GIF and ensure both READMEs render it from a stable repository path.
5. Check all repository-relative and external README links.

### Task 6: Make the production Agent configuration deployable

**Files:**

- Modify: `docker-compose.yml`
- Modify: `deploy/traefik/.env.example`
- Modify: `apps/website/src/content/docs/en/docs/use/agent.md`
- Modify: `apps/website/src/content/docs/zh-cn/docs/use/agent.md`
- Modify: `apps/website/src/content/docs/en/docs/guides/self-hosting.md`
- Modify: `apps/website/src/content/docs/zh-cn/docs/guides/self-hosting.md`
- Test: `scripts/container-smoke.sh`

1. Add Compose passthrough for the Pi runtime directory and vision endpoint/model.
2. Mount a dedicated read-only vision API-key secret; do not place credentials in Compose, Git, Site YAML, or image layers.
3. Document the Pi runtime files and exact ownership/mode expectations.
4. Extend container smoke coverage to prove Agent storage survives recreation and missing optional vision configuration remains explicit.
5. Run Compose validation with and without optional Agent vision variables.

### Task 7: Prove CLIProxy language and vision compatibility

**Files:**

- Create: `docs/verification/site-agent-cliproxy-production-poc.md`

1. Read the endpoint and token from `~/.claude/settings.json` without echoing the token.
2. Inspect the installed Pi SDK schema and generate temporary operator-style `auth.json`, `models.json`, and `settings.json` for an Anthropic-compatible `glm-5.2` provider.
3. Run a no-tool, no-workspace Pi request and verify a streamed `glm-5.2` answer.
4. Call the CLIProxy OpenAI-compatible vision route with a disposable local image and `minimax-m3`.
5. Record only endpoint class, model names, timestamps, HTTP/result status, and redacted configuration shape.
6. Remove temporary credential-bearing artifacts immediately.

### Task 8: Complete local and CI-equivalent acceptance

**Files:**

- Modify as required by failures only.

1. Run formatting checks.
2. Run the website build, link checker, and Playwright suite under `/blog-studio/`.
3. Run focused Studio Agent and migration tests.
4. Run `CI=true corepack pnpm check`.
5. Build the Linux production image with revision `5f4ca39e1ae26aedb1b2a31c31d581fd56777263` or the final reviewed descendant.
6. Run quick-start, container, and operations smoke tests against that exact image.

### Task 9: Review, commit, push, and publish GitHub Pages

**Files:**

- Modify: `.github/workflows/docs.yml` if locale assertions require workflow changes.

1. Review the complete diff for accidental generated files, secrets, internal credentials, and unrelated changes.
2. Commit the plan separately, then commit implementation in reviewable units.
3. Push `codex/i18n-production-rollout` and verify repository CI.
4. Merge the reviewed branch to `main` and verify GitHub Pages publishes the exact merged revision.
5. Set the GitHub repository About homepage to `https://djangoailab.github.io/blog-studio/`.
6. Verify the root default, both languages, both formerly broken actions, and representative deep links over HTTPS.

### Task 10: Perform the reversible internal production upgrade

**Files:**

- Create: `docs/verification/2026-08-11-internal-production-rollout.md`

1. Inventory the current container, exact image ID, Compose file set, workspace revision/status, public-output hashes, health, and authentication state without reading secrets.
2. Run the production backup script, verify its checksum, and retain it on the server only.
3. Retain `blog-studio:home-v032-00cd73f` and its image ID as the rollback target.
4. Install Pi runtime files under the mounted data directory and a vision secret from the approved local CLIProxy configuration, all with restrictive ownership and modes.
5. Transfer or build the exact accepted Linux image and verify its OCI revision label.
6. Recreate only `studio` with the base, Traefik, and direct-preview Compose files.
7. Verify health, HTTPS, owner login, Site inventory, content editing/preview, multiple Agent Sessions, `glm-5.2`, `minimax-m3`, approval mode, YOLO visibility, and cold restart recovery.
8. Verify canonical Git status/revision and public-output hashes are unchanged.
9. If any hard gate fails, restore the previous image/config and verify recovery before stopping.
10. Commit and push the redacted production evidence after successful acceptance.
