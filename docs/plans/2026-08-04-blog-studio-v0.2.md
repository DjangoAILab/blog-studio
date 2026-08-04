# Blog Studio v0.2 Site-first Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a migration-safe v0.2 release candidate centered on owner
credentials, Sites, unified content, reliable preview, generic resources, and a
reviewable prepare/commit/release workflow.

**Architecture:** Keep files and Git canonical. Introduce versioned SQLite
operational records behind repositories, a `SiteService` over trusted technical
workspaces, and a durable `ChangeSetService` that freezes exact revisions.
Authentication uses server-stored versioned password verifiers and revocable
sessions. Markdown preview is the guaranteed baseline; generator preview is a
verified enhancement. UI work consumes one Site-first API and must pass the
selected interaction-design gate before visual replacement.

**Tech Stack:** TypeScript 6, Node.js 22, Fastify 5, React 19, SQLite,
Vitest, Playwright, pnpm/Turborepo, local Git adapters, Markdown rendering and
sanitization libraries selected through dependency and security review.

---

### Task 1: Freeze scope, baseline, and release evidence contract

**Files:**

- Modify: `docs/product/product-evolution.md`
- Modify: `docs/roadmap.md`
- Create: `docs/checklists/v0.2.md`
- Create: `docs/verification/v0.2-baseline.md`

1. Record Pi as `earendil-works/pi`, the v0.2 exclusions, and every evidence
   requirement before implementation.
2. Capture current focused/full test results, the reproduced broken preview,
   database schema, reference configuration, Git status, and home-server
   deployment revision without recording secrets.
3. Run Markdown format and link checks; keep all gates unchecked until evidence
   exists.

### Task 2: Introduce migration-led SQLite repositories

**Files:**

- Modify: `packages/persistence/src/database.ts`
- Modify: `packages/persistence/src/index.ts`
- Create: `packages/persistence/src/migrations.ts`
- Create: `packages/persistence/src/credentials.ts`
- Create: `packages/persistence/src/sessions.ts`
- Create: `packages/persistence/src/sites.ts`
- Create: `packages/persistence/src/change-sets.ts`
- Create: `packages/persistence/test/migrations.test.ts`
- Create: `packages/persistence/test/credentials.test.ts`
- Create: `packages/persistence/test/sites.test.ts`
- Create: `packages/persistence/test/change-sets.test.ts`

1. Add failing tests that open a copied v0.1 database, migrate it exactly once,
   preserve all rows, and reject unsupported future schema versions.
2. Add numbered transactional migrations plus `schema_migrations` and repositories
   for credential generations, sessions, Sites, and immutable ChangeSets.
3. Verify fresh, v0.1 upgrade, repeated-open, interrupted-migration, foreign-key,
   and backup/restore fixtures.

### Task 3: Replace opaque-token login with an owner credential lifecycle

**Files:**

- Create: `apps/studio/server/auth/passwords.ts`
- Create: `apps/studio/server/auth/owner-auth.ts`
- Create: `apps/studio/server/cli.ts`
- Modify: `apps/studio/server/main.ts`
- Modify: `apps/studio/server/app.ts`
- Modify: `apps/studio/package.json`
- Modify: `apps/studio/.env.example`
- Modify: `apps/studio/server/test/app.test.ts`
- Create: `apps/studio/server/test/owner-auth.test.ts`
- Create: `apps/studio/server/test/cli.test.ts`

1. Write failing tests for status, initialize, login, re-authenticated change,
   CLI reset, global session revocation, rate limits, redaction, and legacy-token
   migration boundaries.
2. Implement versioned memory-hard password verification and random opaque
   server-side sessions; never allow browser bootstrap or store plaintext.
3. Add non-ambiguous CLI `auth status|init|reset` commands with terminal-safe
   input and automation-safe file/stdin options.
4. Keep a documented bounded legacy-login migration only if it can be disabled
   automatically after password initialization; otherwise require CLI setup.

### Task 4: Define and persist the Site contract

**Files:**

- Create: `packages/core/src/domain/sites.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/test/schema.test.ts`
- Create: `apps/studio/server/services/sites.ts`
- Modify: `apps/studio/server/services/workspaces.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Create: `apps/studio/server/test/sites.test.ts`

1. Add failing domain/API tests for no-Site state, trusted discovery, preview,
   registration, display-name uniqueness, settings update, capabilities, and
   v0.1 config import.
2. Add `Site` IDs/metadata/capabilities while retaining `workspaceId` only as
   an internal compatibility reference.
3. Enforce allowed-root, realpath, symlink, config, and subprocess boundaries
   before returning discovery results.

### Task 5: Build the unified content query and working-copy model

**Files:**

- Modify: `packages/core/src/domain/documents.ts`
- Modify: `packages/persistence/src/drafts.ts`
- Modify: `apps/studio/server/services/workspaces.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/server/test/app.test.ts`
- Modify: `apps/studio/test/api.test.ts`

1. Add failing tests for merged published/draft/modified results, counts,
   pagination, search/filters, published working copies, discard, and conflicts.
2. Return one stable content summary contract without fetching document bodies.
3. Preserve source revisions so published edits remain SQLite working copies
   until an approved ChangeSet is applied.

### Task 6: Guarantee Markdown preview and verify enhanced preview readiness

**Files:**

- Create: `apps/studio/server/services/markdown-previews.ts`
- Modify: `apps/studio/server/services/previews.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/server/test/app.test.ts`
- Create: `apps/studio/server/test/preview-fallback.test.ts`

1. Reproduce the known READY-plus-blank-output failure as a failing regression.
2. Implement sanitized Markdown preview with explicit raw-HTML and resource URL
   policies.
3. Require the generated target to exist, respond successfully, and contain a
   per-session marker before reporting enhanced preview ready.
4. Return typed fallback reasons for missing output, timeout, build/route error,
   unsupported engine, cancellation, and restart; reclaim every sandbox.

### Task 7: Generalize assets into policy-controlled resources

**Files:**

- Create: `packages/core/src/domain/resources.ts`
- Create: `packages/core/src/adapters/resources.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/assets/src/index.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Create: `packages/assets/test/resources.test.ts`
- Modify: `apps/studio/server/test/app.test.ts`

1. Add failing contracts for images, PDFs, archives/text fixtures, disallowed
   executable content, spoofed MIME, size limits, filenames, and traversal.
2. Preserve image optimization as one resource processor while generic allowed
   resources use immutable scoped storage without lossy transformation.
3. Return portable insertion syntax and explicit capability/status metadata.

### Task 8: Implement durable ChangeSet preparation

**Files:**

- Create: `packages/core/src/domain/change-sets.ts`
- Create: `apps/studio/server/services/change-sets.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Create: `apps/studio/server/test/change-sets.test.ts`
- Modify: `apps/studio/server/services/releases.ts`

1. Add failing tests for exact revision freezing, full managed diff, unmanaged
   files, deletion, resource/config changes, idempotence, supersession, conflict,
   interrupted apply, and restart.
2. Implement `Prepare changes` as a read/analysis operation plus durable immutable
   review record; it must never invoke build, provider, cache, Git push, or public
   verification.
3. Apply only reviewed revisions with optimistic preconditions and explicit
   recovery records.

### Task 9: Separate local commit and immutable remote release

**Files:**

- Modify: `packages/core/src/adapters/repository.ts`
- Modify: `packages/adapter-local-git/src/adapter.ts`
- Modify: `apps/studio/server/services/change-sets.ts`
- Modify: `apps/studio/server/services/releases.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `packages/adapter-local-git/test/adapter.test.ts`
- Modify: `apps/studio/server/test/releases.test.ts`

1. Add failing tests proving prepare has zero Git/provider effects, commit stages
   only approved paths, dirty unrelated files survive, and release consumes an
   immutable reviewed commit/ChangeSet.
2. Add separately authorized `apply`, `commit`, and `release` operations with
   exact effect summaries and durable identifiers.
3. Preserve the v0.1 release state-machine, verification, cancellation,
   recovery, and rollback behavior.

### Task 10: Select the interaction target and install the design kernel

**Files:**

- Create: `docs/design/v0.2-interaction-target.md`
- Create: `docs/verification/v0.2-design-selection.md`
- Modify: `apps/studio/src/styles/studio.css`
- Modify: `apps/studio/src/app/studio-app.tsx`

1. Produce three high-fidelity desktop/mobile directions grounded in working
   journeys and the “living editorial room” principles. When the image backend
   is unavailable, an explicitly approved interactive HTML decision artifact
   is an acceptable equivalent.
2. Obtain the owner's selection before production visual implementation.
3. Encode semantic content/material/elevation/type/spacing/radius/focus/motion
   tokens and reduced-motion/transparency/high-contrast fallbacks.
4. Verify contrast, focus visibility, keyboard order, reflow, motion origin, and
   frame-time budgets on representative hardware.

### Task 11: Implement Site-first onboarding, navigation, and security UI

**Files:**

- Modify: `apps/studio/src/app/api.ts`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Create: `apps/studio/src/features/onboarding/site-onboarding.tsx`
- Create: `apps/studio/src/features/settings/site-settings.tsx`
- Create: `apps/studio/src/features/settings/security-settings.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Modify: `apps/studio/e2e/authoring.spec.ts`
- Create: `apps/studio/e2e/onboarding-and-auth.spec.ts`

1. Cover uninitialized, login, reset-revocation, no-Site, discovery, confirm,
   settings, error, mobile, keyboard, and accessibility journeys with failing
   browser tests.
2. Replace technical-token/workspace-first language with owner-password and
   Site-first progressive disclosure.
3. Preserve advanced technical diagnostics without making them the primary IA.

### Task 12: Implement library, preview, resources, and ChangeSet UI

**Files:**

- Modify: `apps/studio/src/app/api.ts`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Create: `apps/studio/src/features/library/content-library.tsx`
- Create: `apps/studio/src/features/preview/preview-pane.tsx`
- Create: `apps/studio/src/features/resources/resource-picker.tsx`
- Create: `apps/studio/src/features/changes/change-set-review.tsx`
- Modify: `apps/studio/src/features/editor/visual-editor.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Modify: `apps/studio/e2e/authoring.spec.ts`
- Create: `apps/studio/e2e/change-set.spec.ts`

1. Cover published edit, state filters, Markdown/enhanced preview and fallback,
   generic resource insertion, prepare/review, safe commit, and separately
   confirmed staging release in browser tests.
2. Make `Prepare changes` the calm primary completion action; render commit and
   remote release as progressively disclosed, effect-labeled confirmations.
3. Show every loading, empty, conflict, stale, partial, recovery, and disabled
   state represented by the API.

### Task 13: Migrate operations and documentation

**Files:**

- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `docs/guides/self-hosting.md`
- Modify: `docs/guides/upgrading.md`
- Modify: `docs/guides/backup-restore.md`
- Modify: `README.md`
- Create: `docs/guides/sites-and-first-run.md`
- Create: `docs/guides/prepare-commit-release.md`

1. Add credential initialization/reset, Site onboarding, migration backup,
   downgrade/rollback, and immutable release instructions.
2. Prove a clean quick start and a copied-v0.1 upgrade without leaking secrets
   through arguments, logs, process lists, Compose interpolation, or artifacts.
3. Remove opaque-token login instructions from the primary journey while
   documenting any bounded compatibility window.

### Task 14: Complete release-candidate and real-environment verification

**Files:**

- Create: `docs/verification/v0.2-release-candidate.md`
- Modify: `docs/checklists/v0.2.md`
- Create: `docs/releases/v0.2.0.md`

1. Run focused suites after every task, then `corepack pnpm check`, format check,
   browser tests, container/quick-start/operations/release smoke tests, security
   scans, migration recovery, and backup/restore.
2. Build and deploy the exact candidate revision to the reference home server
   using a pre-upgrade backup and a rehearsed rollback path.
3. Verify cold restart, owner login/reset, `wj2015-blog` registration, published
   edit, Markdown fallback, enhanced preview, generic resource, prepare, local
   commit, staging release, and public-blog continuity.
4. Do not initiate a production content release without explicit owner
   confirmation. Record artifacts, revisions, timings, screenshots, and remaining
   limitations; check only evidence-backed checklist items.
