# Site Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the owner-approved Site lifecycle, lossless metadata,
search/sorting, isolated local development, and filesystem release closure;
merge it into `main` and deploy the verified image to `internal.wj2015.com`.

**Architecture:** Keep Markdown and Git canonical. Replace static startup-only
workspace configuration with a host-policy service plus atomically versioned
per-Site YAML; SQLite records lifecycle/audit/revisions. Preserve front matter
as both raw YAML and structured values, operate development servers only in
managed sandboxes, and keep configuration activation separate from content
ChangeSets.

**Tech Stack:** TypeScript 6, Node 22, Fastify 5, React 19, SQLite, YAML v2,
Vitest, Playwright, pnpm/Turborepo, Docker Compose, Hexo and command adapters.

---

## Execution rules

- Add a failing focused test before each behavior change; run it red, implement
  the smallest passing behavior, then run the focused suite.
- Commit each independently reviewable task. Do not overwrite or normalize real
  blog content during tests; use copied fixtures and temporary SQLite files.
- Keep development and release subprocesses argument-array based, allowlisted,
  cancellable, logged, and scoped to an isolated sandbox.
- Every external deployment step begins with a read-only inventory and backup,
  and preserves a tested rollback image until final acceptance passes.

### Task 1: Establish v0.3 evidence and migration baseline

**Files:**

- Create: `docs/verification/v0.3-baseline.md`
- Create: `docs/verification/v0.3-release-candidate.md`
- Create: `docs/checklists/v0.3-site-lifecycle.md`
- Modify: `docs/roadmap.md`
- Test: existing full baseline suites

1. Capture branch, clean-tree state, package-manager/runtime versions, current
   reference-site data contract, and deployment inventory without secrets.
2. Run the current focused Studio, Hexo adapter, release, and browser suites;
   record exact commands/results.
3. Add unchecked evidence links for every item in the v0.3 checklist.
4. Commit `docs: establish v0.3 implementation baseline`.

### Task 2: Fix preview layout and introduce content time/sort contracts

**Files:**

- Modify: `apps/studio/src/features/preview/preview-pane.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Modify: `packages/core/src/domain/documents.ts`
- Modify: `packages/adapter-hexo/src/adapter.ts`
- Modify: `apps/studio/server/services/content.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/src/app/api.ts`
- Modify: `apps/studio/src/features/library/content-library.tsx`
- Modify: `apps/studio/src/features/site/site-overview.tsx`
- Test: `apps/studio/server/test/app.test.ts`, `apps/studio/e2e/authoring.spec.ts`, `packages/adapter-hexo/test/adapter.test.ts`

1. Write browser/layout regression assertions for bannerless and fallback preview
   canvas height; make them fail against the current grid.
2. Give the preview canvas the flexible row independent of fallback rendering;
   validate desktop and mobile screenshots.
3. Add `publishedAt`, `contentUpdatedAt`, `filesystemModifiedAt`,
   `workingCopySavedAt`, and `activityAt` to domain/API summaries.
4. Parse Hexo `date`/`updated` as content timestamps; retain mtime only for
   diagnostics and external-change detection.
5. Add validated sort field/direction query parameters, deterministic null and
   `documentId` tie-break behavior, and default `activityAt desc`.
6. Add field/direction controls to the library and Site overview; persist query
   state in URL and test pagination stability.
7. Commit `fix: correct preview layout and content ordering`.

### Task 3: Complete global search and metadata indexing

**Files:**

- Create: `apps/studio/src/features/search/global-search.tsx`
- Modify: `apps/studio/src/features/shell/studio-navigation.tsx`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `apps/studio/server/services/content.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Test: `apps/studio/test/api.test.ts`, `apps/studio/e2e/authoring.spec.ts`

1. Add failing browser tests: top-nav search focuses a dialog, debounce searches
   without Enter, Escape closes/restores focus, and URL state survives reload.
2. Add search fields for categories and schema-marked metadata, while retaining
   body-free list responses.
3. Implement an accessible command/search dialog plus library autofocus and
   debounced request cancellation.
4. Verify keyboard navigation, empty/loading/error states, query sorting, and
   no request races when switching Site.
5. Commit `feat: add global content search`.

### Task 4: Add lossless front-matter representation and migration

**Files:**

- Modify: `packages/core/src/domain/documents.ts`
- Modify: `packages/persistence/src/migrations.ts`
- Modify: `packages/persistence/src/drafts.ts`
- Modify: `packages/adapter-hexo/src/front-matter.ts`
- Modify: `packages/adapter-hexo/src/adapter.ts`
- Modify: `apps/studio/server/services/content.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Test: `packages/persistence/test/migrations.test.ts`, `packages/persistence/test/drafts.test.ts`, `packages/adapter-hexo/test/adapter.test.ts`, `apps/studio/server/test/app.test.ts`

1. Build fixtures containing comments, quoted scalars, string/array categories,
   nested custom values, aliases if supported, and malformed YAML.
2. Add a migration for raw front-matter source/patch records that preserves
   existing v0.2 working copies exactly.
3. Parse with YAML documents/CST, expose typed fields plus raw source and parse
   diagnostics, and implement key-level AST edits/deletions.
4. Ensure unchanged raw front matter remains byte-identical; editing title/tags
   leaves unrelated syntax and comments intact.
5. Reject normal-form save for parse-invalid canonical source and expose a
   source-repair-compatible API path.
6. Commit `feat: preserve front matter losslessly`.

### Task 5: Build schema-driven front-matter authoring

**Files:**

- Modify: `packages/config/src/schema.ts`
- Modify: `packages/core/src/domain/sites.ts`
- Create: `apps/studio/src/features/editor/front-matter-editor.tsx`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Test: `packages/config/test/schema.test.ts`, `apps/studio/test/smoke.test.ts`, `apps/studio/e2e/authoring.spec.ts`

1. Define Site field schemas for type, default, enum, description, required,
   searchable, and sortable, rejecting unsafe/ambiguous definitions.
2. Add common-field controls and Site-defined controls with an advanced raw YAML
   drawer; test strings, numbers, booleans, lists, objects, nulls, and explicit
   deletion.
3. Apply configured defaults/templates to new documents while retaining Hexo
   native draft creation and promotion behavior.
4. Test keyboard/reader labels, validation messages, conflict handling, and
   source-repair mode.
5. Commit `feat: add schema-driven front matter editor`.

### Task 6: Split host policy from dynamic per-Site configuration

**Files:**

- Create: `packages/core/src/domain/site-configuration.ts`
- Create: `apps/studio/server/services/site-configurations.ts`
- Modify: `apps/studio/server/main.ts`
- Modify: `apps/studio/server/app.ts`
- Modify: `apps/studio/server/services/workspaces.ts`
- Modify: `apps/studio/server/services/sites.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `packages/persistence/src/migrations.ts`
- Modify: `packages/persistence/src/sites.ts`
- Test: `apps/studio/server/test/sites.test.ts`, `apps/studio/server/test/app.test.ts`, `packages/persistence/test/sites.test.ts`

1. Define host policy input: allowed roots, adapter allowlists, credential
   references, subprocess limits, and the `/data/sites` configuration directory.
2. Add configuration revision/audit persistence and atomic YAML write/read with
   file permissions suitable for Studio state.
3. Implement owner configuration drafts, validation, activation, rollback, and
   dynamic replacement of one Site runtime while retaining the previous active
   runtime on failure.
4. Migrate boot-time configuration paths into discoverable legacy candidates;
   preserve v0.2 deployments until an owner activates a dynamic configuration.
5. Test path/symlink/secret rejection, concurrent edits, failed reload rollback,
   and that an invalid Site cannot impact a healthy Site.
6. Commit `feat: add owner-managed site configuration`.

### Task 7: Complete Site lifecycle management UI

**Files:**

- Create: `apps/studio/src/features/site/site-manager.tsx`
- Modify: `apps/studio/src/features/onboarding/site-onboarding.tsx`
- Modify: `apps/studio/src/features/settings/site-settings.tsx`
- Modify: `apps/studio/src/features/shell/studio-navigation.tsx`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Test: `apps/studio/e2e/first-run.spec.ts`, `apps/studio/e2e/authoring.spec.ts`

1. Add failing E2E coverage for adding a second Site after first registration,
   edit/validation activation, pause/resume, repair, and unregister.
2. Implement Site manager sections: Basic, Content model, Local development,
   Resources, Publishing, and Advanced diagnostics.
3. Require recent owner authentication for command/publish-target changes and
   purge; implement unregister retention semantics and typed lifecycle states.
4. Verify responsive/keyboard states and that Site switch does not leak drafts,
   URLs, search state, or logs across Sites.
5. Commit `feat: manage site lifecycle in Studio`.

### Task 8: Implement isolated development supervisor and proxy

**Files:**

- Create: `apps/studio/server/services/development.ts`
- Create: `apps/studio/server/services/development-sandbox.ts`
- Modify: `apps/studio/server/services/workspace-sandbox.ts`
- Modify: `apps/studio/server/app.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/src/app/api.ts`
- Create: `apps/studio/src/features/site/local-development.tsx`
- Modify: `apps/studio/src/features/site/site-overview.tsx`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Test: `apps/studio/server/test/development.test.ts`, `apps/studio/e2e/authoring.spec.ts`

1. Define a non-shell command process contract: executable, args, cwd-relative
   policy, allowed environment, `baseUrl`, readiness path, timeout, and log cap.
2. Add tests proving commands never execute in the canonical workspace and that
   sandbox source plus current working copies are what the process receives.
3. Implement start/sync/restart/stop/recovery with PID identity, cancellation,
   logs, readiness checks, and stale revision reporting.
4. Proxy the sandbox local Site through authenticated Studio routes without
   exposing host-local addresses to the browser; preserve asset and websocket
   behavior only when explicitly allowed.
5. Add Site overview/editor controls and new-tab open behavior; retain embedded
   article view as secondary.
6. Test exit, timeout, hot-sync failure, Studio restart cleanup, cross-Site
   isolation, and mobile action presentation.
7. Commit `feat: add isolated local development preview`.

### Task 9: Integrate configuration revisions with ChangeSets and release safety

**Files:**

- Modify: `apps/studio/server/services/change-sets.ts`
- Modify: `packages/core/src/domain/change-sets.ts`
- Modify: `packages/persistence/src/change-sets.ts`
- Modify: `apps/studio/server/services/releases.ts`
- Modify: `packages/publisher-filesystem/src/index.ts`
- Test: `apps/studio/server/test/change-sets.test.ts`, `apps/studio/server/test/releases.test.ts`, `packages/publisher-filesystem/test/publisher.test.ts`

1. Add a failing ChangeSet test that captures active Site configuration revision
   and rejects apply/commit/release after configuration activation.
2. Exclude independent Site configuration from Git/content ChangeSet mutation;
   record the revision as a precondition and show it in review UI.
3. Harden filesystem target validation against source, data, preview sandbox,
   state, and other-Site overlap before baseline adoption or publish.
4. Test staging/atomic switch where supported, journal recovery otherwise,
   protected/unmanaged file preservation, cancellation, marker verification,
   and rollback.
5. Commit `feat: bind release safety to site configuration`.

### Task 10: Documentation, complete verification, main merge, and deployment

**Files:**

- Modify: `docs/guides/sites-and-first-run.md`
- Modify: `docs/guides/prepare-commit-release.md`
- Modify: `docs/guides/self-hosting.md`
- Create: `docs/verification/v0.3-*.md`
- Modify: `docs/checklists/v0.3-site-lifecycle.md`
- Modify: `docs/releases/v0.3.0.md`

1. Update operator/user documentation and generated configuration reference.
2. Run focused tests after each task, then full checks, format checks, E2E,
   Linux amd64 image, quick-start, container, operations, backup/restore, and
   rollback tests; write command output/evidence documents.
3. Perform read-only deployment inventory; back up Studio data and record the
   currently running image/revision and rollback procedure.
4. Merge reviewed commits into `main`, push it, build the immutable release
   image, and deploy only the Studio service at `internal.wj2015.com`.
5. Execute authenticated acceptance against a non-production filesystem target,
   verify all checklist rows, remediate failures, and only then mark the release
   candidate accepted.
6. Commit `docs: record v0.3 verification evidence` and create the release
   handoff commit.
