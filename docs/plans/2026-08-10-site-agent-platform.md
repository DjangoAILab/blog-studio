# Site Agent Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Site-scoped Pi Agent to the existing Blog Studio Web application without changing its core architecture or exposing a general shell.

**Architecture:** Embed Pi behind a thin TypeScript adapter in the Studio server, bind each runtime to the selected Site workspace, and persist one durable transcript source. Keep direct Pi filesystem tools, add structured Git tools, serialize mutations with a Site writer lock, and layer global/Site/Session preferences over existing SQLite infrastructure.

**Tech Stack:** TypeScript, Pi SDK, Fastify, React, SQLite, Vitest, Playwright, Astro/Starlight, GitHub Pages.

---

### Task 1: Prove the Pi SDK boundary

**Status:** Complete — verified by the executable Pi POC.

**Files:**

- Create: `packages/agent-runtime-pi/package.json`
- Create: `packages/agent-runtime-pi/src/index.ts`
- Create: `packages/agent-runtime-pi/test/runtime.test.ts`
- Create: `packages/agent-runtime-pi/tsconfig.json`
- Create: `packages/agent-runtime-pi/tsconfig.build.json`
- Modify: `pnpm-lock.yaml`

1. Add a failing test that creates an in-memory Pi session with a deterministic
   test model/runtime and an explicit tool allowlist.
2. Assert that filesystem tools are present and `bash` is absent.
3. Implement the smallest adapter around `createAgentSession()`.
4. Verify event subscription and cancellation without a real provider call.
5. Run the package test and typecheck.

### Task 2: Decide the transcript source of truth

**Status:** Complete — Pi JSONL selected; SQLite transcript reconstruction rejected.

**Files:**

- Create: `packages/agent-runtime-pi/test/persistence.test.ts`
- Create: `docs/verification/site-agent-pi-poc.md`
- Modify: `packages/agent-runtime-pi/src/index.ts`

1. Test Pi JSONL recovery in a temporary application-controlled session
   directory.
2. Prototype reconstruction from application-owned messages using the public SDK.
3. Compare compaction, tool results, model changes, branching, migration burden,
   and archive indexing.
4. Select exactly one writable transcript store.
5. Record evidence and the rejected alternative.

### Task 3: Add Agent persistence and preferences

**Status:** Complete — schema, repositories, and a checksummed combined
backup/cold-restore exercise are verified.

**Files:**

- Modify: `packages/persistence/src/migrations.ts`
- Create: `packages/persistence/src/agent-sessions.ts`
- Create: `packages/persistence/src/agent-preferences.ts`
- Create: `packages/persistence/src/agent-attachments.ts`
- Modify: `packages/persistence/src/index.ts`
- Create: `packages/persistence/test/agent-sessions.test.ts`
- Create: `packages/persistence/test/agent-preferences.test.ts`

1. Write failing repository tests for Site-scoped sessions, archive/restore, and
   preference precedence.
2. Add the minimum schema selected by the POC.
3. Store attachment metadata and audit indexes without duplicating transcripts.
4. Verify migration, backup, and cold-restart behavior.

### Task 4: Enforce Site tool and concurrency policy

**Status:** In progress — canonical Pi file tools, fixed Git inspection and
path restore, unified approval/YOLO mutation runner, and one writer lock per Site
are verified. Durable approval/audit integration and turn-attributable reversal
remain for Tasks 5 and 10.

**Files:**

- Create: `apps/studio/server/services/site-agent-locks.ts`
- Create: `apps/studio/server/services/site-agent-tools.ts`
- Create: `apps/studio/server/test/site-agent-policy.test.ts`
- Modify: `apps/studio/server/app.ts`

1. Test two mutating turns on one Site and one turn on a second Site.
2. Implement one writer mutex per Site.
3. Expose Pi file tools below the resolved workspace root.
4. Add structured Git status/diff/log/show and bounded recovery tools.
5. Prove path escape, arbitrary commands, remote writes, clean, and hard reset
   are unavailable.
6. Verify approval and YOLO modes share the same hard policy.

### Task 5: Add Agent HTTP and streaming APIs

**Files:**

- Create: `apps/studio/server/routes/agent-api.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/server/app.ts`
- Create: `apps/studio/server/test/agent-api.test.ts`

1. Test Site-scoped Session CRUD, archive/restore, message submission,
   cancellation, and event streaming.
2. Resolve the Site workspace before creating a runtime.
3. Apply owner authentication and CSRF rules to every mutation.
4. Persist terminal run state before acknowledging completion.

### Task 6: Add context and attachment contracts

**Files:**

- Create: `packages/core/src/domain/agent.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/agent.test.ts`
- Modify: `apps/studio/server/routes/agent-api.ts`

1. Define article-reference, editor-buffer, Markdown-selection, file-attachment,
   image-interpretation, preview-error, diff, and ChangeSet context shapes.
2. Test that explicit selections materialize into one user message only.
3. Store chat uploads outside the Site root.
4. Add a replaceable vision adapter and failure/retry state.

### Task 7: Add the global Agent interface

**Files:**

- Create: `apps/studio/src/features/agent/agent-panel.tsx`
- Create: `apps/studio/src/features/agent/session-list.tsx`
- Create: `apps/studio/src/features/agent/message-composer.tsx`
- Modify: `apps/studio/src/app/api.ts`
- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `apps/studio/src/styles/studio.css`
- Create: `apps/studio/test/agent-ui.test.tsx`

1. Mount the panel outside page-specific content.
2. Filter Session management by the active `siteId`.
3. Add persistent approval-mode visibility and override controls.
4. Add upload and context chips with removal before send.
5. Stream Agent events and surface typed failures/cancellation.

### Task 8: Make Site and preview state tab-safe

**Files:**

- Modify: `apps/studio/src/app/studio-app.tsx`
- Modify: `apps/studio/src/features/site/site-switcher.tsx`
- Modify: `apps/studio/e2e/authoring.spec.ts`

1. Put `siteId` in the browser URL.
2. Restore the Site from the URL on reload and browser navigation.
3. Keep the active Session tab-local while Session data remains Site-scoped.
4. Verify two tabs with distinct Sites use the correct preview URL and Agent
   Session list.

### Task 9: Make original image preservation the default

**Files:**

- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/test/schema.test.ts`
- Modify: `packages/assets/src/index.ts`
- Modify: `packages/assets/test/resources.test.ts`
- Modify: `apps/studio/server/services/workspaces.ts`
- Modify: `apps/studio/src/features/settings/site-configuration-editor.tsx`
- Modify: `apps/studio/server/test/app.test.ts`
- Modify: `apps/website/src/content/docs/docs/use/assets.md`

1. Test byte-for-byte image preservation with no image policy configured.
2. Add per-Site opt-in settings for format, quality, maximum width, and metadata
   stripping.
3. Preserve the original extension when processing is disabled.
4. Prove existing resources are never rewritten.
5. Show the active policy in Site settings and upload UI.

### Task 10: Verify the complete Agent journey

**Files:**

- Create: `apps/studio/e2e/agent.spec.ts`
- Modify: `docs/verification/site-agent-poc.md`
- Modify: `docs/roadmap.md`

1. Open two Sites in two tabs.
2. Create and archive independent Sessions.
3. Attach an article selection and image.
4. Execute one approved edit and one YOLO edit.
5. Review Git diff and undo a bounded Agent change.
6. Restart Studio and resume both Sessions.
7. Run focused tests, then `corepack pnpm check` and Studio E2E.

### Task 11: Publish verified documentation and README media

**Files:**

- Modify: `README.md`
- Modify: `apps/website/src/content/docs/docs/concepts/core-journey.md`
- Create: `apps/website/src/content/docs/docs/use/agent.md`
- Modify: `.github/workflows/*`

1. Record the stable Agent journey at a readable desktop viewport.
2. Produce an optimized 20--30 second GIF showing Site context, selection,
   approval, diff, and result.
3. Add the GIF near the README product promise.
4. Add Agent concepts, permissions, models, attachments, and recovery docs.
5. Deploy the existing Astro/Starlight site with GitHub Pages and verify links,
   accessibility, and base paths.
