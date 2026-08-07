# Editor Protected Source and Development Profiles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make visual authoring lossless for commented/raw Markdown, make
content sorting and filtering discoverable, and replace owner-supplied process
commands with host-defined local-development profiles.

**Architecture:** Treat raw HTML comments as opaque source owned by Markdown,
not as editable prose. The visual editor will render a stable atomic placeholder
and serialize its original bytes unchanged. Development commands move entirely
to host policy profiles; the owner can select a profile per Site but cannot
submit an executable path or arguments. The content library remains backed by
the existing sort API but gains one responsive query toolbar.

**Tech Stack:** TypeScript 6, React 19, Milkdown/Crepe, unified/remark parsing,
Fastify 5, Zod, SQLite, Vitest, Playwright, pnpm, Docker Compose, Hexo.

---

## Acceptance checklist

- [ ] HTML comments and other unsupported raw blocks never appear as article
      prose in visual mode.
- [ ] Editing adjacent visible text leaves every protected raw block byte-stable
      and in source order; normal local images continue to render.
- [ ] The library exposes sort, direction, filters, active-filter count and
      clearing as one keyboard-accessible responsive tool card.
- [ ] The default remains `activityAt desc`; URL query restoration and current
      content-selection behavior remain unchanged.
- [ ] An owner can choose a host-defined local-development profile in the Site
      UI, while owner YAML rejects executable paths, arguments and environment
      values.
- [ ] Profile process, local base URL, readiness path and environment allowlist
      are all host-policy values; the deployed Hexo profile runs only in its
      sandbox through the same-origin proxy.
- [ ] Focused unit/API/browser tests, full quality/security checks, a production
      backup, deployment, rollback readiness and internal HTTPS acceptance pass.

## Task 1: Protected raw-source visual editor model

**Files:**

- Create: `apps/studio/src/features/editor/protected-source.ts`
- Modify: `apps/studio/src/features/editor/visual-editor.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Test: `apps/studio/src/features/editor/protected-source.test.ts`

1. Write failing tests for parsing HTML comments, retaining their exact source
   text, serializing them in order, and leaving fenced-code lookalikes alone.
2. Add a CommonMark-aware protected-source importer/exporter that represents
   comments and unsupported raw HTML as opaque tokens, never via broad regex
   replacement.
3. Add a Milkdown atomic node/view labelled `已隐藏的 Markdown 源块`; default it
   to compact metadata and provide an explicit source-mode handoff rather than
   rendering its hidden content.
4. Rehydrate each token only during serialization; reject a save if token
   identity is corrupted rather than silently losing source.
5. Run the focused tests and commit the independent editor change.

## Task 2: Authoring regression and visual evidence

**Files:**

- Modify: `apps/studio/e2e/authoring.spec.ts`
- Modify: `apps/studio/server/test/app.test.ts`
- Test fixture: copied temporary Hexo document only

1. Add the supplied article's comment pattern to an isolated fixture.
2. Assert visual mode renders a protected block rather than prompt text or
   commented image syntax, while an ordinary image uses the resource endpoint.
3. Edit a visible paragraph, save, re-read the source and assert commented
   regions are byte-identical.
4. Capture desktop screenshots for the visual and Markdown-source modes.
5. Run the focused browser/API suites and commit the regression coverage.

## Task 3: Content query toolbar

**Files:**

- Modify: `apps/studio/src/features/library/content-library.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Modify: `apps/studio/e2e/authoring.spec.ts`

1. Add a failing browser test for changing sort, toggling direction, opening
   filters, clearing them, and retaining the selected document.
2. Replace the disconnected sort and filter rows with one semantic
   `整理内容` toolbar/card: flexible sort select, fixed minimum-size direction
   button, filter trigger/count and clear action.
3. Preserve the existing query state and API contract; add desktop, narrow
   library and mobile CSS behavior without horizontal overflow.
4. Verify keyboard focus order, accessible pressed/expanded states and URL
   restoration, then commit the UI change.

## Task 4: Host-defined development profiles

**Files:**

- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.ts`
- Modify: `apps/studio/server/services/workspaces.ts`
- Modify: `apps/studio/server/services/sites.ts`
- Modify: `apps/studio/server/services/development.ts`
- Modify: `apps/studio/server/services/site-configurations.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/src/app/api.ts`
- Test: `packages/config/test/schema.test.ts`, `apps/studio/server/test/development.test.ts`, `apps/studio/server/test/app.test.ts`

1. Write failing schema tests that owner YAML accepts only a named profile and
   rejects command, args, base URL, arbitrary environment and shell paths.
2. Define host-only profile metadata (id, label, executable, args, local URL,
   readiness path, timeout, logs and environment allowlist) and resolve a
   selected owner profile against it.
3. Preserve no-profile behavior for existing Sites; transform legacy host
   development policy into an explicit `default` profile without exposing its
   command in owner YAML.
4. Make the supervisor receive only a resolved host profile, retaining sandbox,
   same-origin proxy, timeout and log behavior.
5. Expose safe profile descriptors to the UI; never expose credentials or
   arbitrary process arguments as mutable owner fields.
6. Run focused configuration/development/API tests and commit the policy work.

## Task 5: Discoverable Site configuration UI

**Files:**

- Create: `apps/studio/src/features/settings/development-profile-editor.tsx`
- Modify: `apps/studio/src/features/settings/site-configuration-editor.tsx`
- Modify: `apps/studio/src/features/settings/site-settings.tsx`
- Modify: `apps/studio/src/features/site/local-development.tsx`
- Modify: `apps/studio/src/features/site/site-overview.tsx`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Test: `apps/studio/e2e/authoring.spec.ts`, `apps/studio/e2e/first-run.spec.ts`

1. Add a failing browser test for `配置本地调试` opening Site settings and for
   selecting/activating a profile.
2. Make the Site-settings sheet controllable from the empty local-development
   state; show a direct configuration action instead of a dead-end message.
3. Add a profile picker with host-controlled command summary and local URL;
   keep advanced content-field YAML intact and versioned.
4. After activation, reload capabilities and allow start/open/restart/stop;
   show useful failed/no-profile messages.
5. Test keyboard flow, revision conflict, no-profile state and responsive
   rendering, then commit the UI work.

## Task 6: Docs, release, deployment and evidence

**Files:**

- Modify: `docs/guides/sites-and-first-run.md`
- Create: `docs/checklists/v0.3.1-editor-and-dev-profiles.md`
- Create: `docs/verification/v0.3.1-editor-and-dev-profiles.md`
- Create: `docs/releases/v0.3.1.md`

1. Document the distinction between public URL, release verification URL and
   host-defined local-development profiles.
2. Run focused suites, `CI=true corepack pnpm check`, formatting, browser E2E,
   container smoke and production-image security scan.
3. Push a PR, require green quality/security checks, merge only after review of
   the diff and production rollback plan.
4. Back up the internal deployment, build from merged `main`, configure the
   Hexo host profile, deploy one Studio container, prove sandbox start/proxy,
   protected editor behavior, sorted filtering and HTTPS health, and retain the
   prior image for rollback.
