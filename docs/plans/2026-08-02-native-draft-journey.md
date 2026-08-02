# Native Draft Journey Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the browser journey for creating, safely editing, previewing, discarding, and publishing a new generator-native draft.

**Architecture:** Extend the versioned generator contract with optional create and promote operations. Build draft releases in an isolated workspace and commit canonical source only after public verification.

**Tech Stack:** TypeScript, Fastify, React, Hexo, Node filesystem APIs, SQLite, Vitest, Playwright.

---

### Task 1: Versioned generator operations

**Files:** `packages/core/src/domain/documents.ts`, `packages/core/src/adapters/generator.ts`, `packages/adapter-hexo/src/adapter.ts`, `packages/adapter-hexo/test/adapter.test.ts`

1. Write failing tests for portable draft creation, collisions, and promotion.
2. Add `CreateDocumentInput`, `CreateDocumentResult`, and optional adapter methods.
3. Implement Hexo creation with exclusive file creation and revision-checked rename.
4. Run `pnpm --filter @blog-studio/adapter-hexo test` and commit.

### Task 2: Create and discard API

**Files:** `apps/studio/server/routes/api.ts`, `apps/studio/server/test/app.test.ts`, `apps/studio/src/app/api.ts`

1. Write failing API tests for create, duplicate slug, discard, stale discard, and CSRF.
2. Add validated POST create and DELETE draft routes.
3. Create an initial version-1 snapshot and expose typed client methods.
4. Run Studio tests and commit.

### Task 3: Isolated release commit

**Files:** `apps/studio/server/services/workspace-sandbox.ts`, `apps/studio/server/services/previews.ts`, `apps/studio/server/services/releases.ts`, `packages/release/src/orchestrator.ts`, related tests.

1. Write failing tests proving build failure preserves canonical source and draft.
2. Extract reusable isolated-workspace creation from preview.
3. Add an orchestrator commit hook before success, including the no-op path.
4. Prepare/build the selected draft in isolation; commit and promote canonical source only after verification.
5. Clean every isolation in `finally`, run release and Studio tests, and commit.

### Task 4: Authoring UI and browser journey

**Files:** `apps/studio/src/app/studio-app.tsx`, Studio styles, `apps/studio/e2e/*`, package configuration.

1. Add tests for creating a draft, autosave, reload, preview, and discard.
2. Load and group both Hexo collections.
3. Add the inline creation form and version-matched discard action.
4. Refresh selection after promotion and expose actionable failures.
5. Run browser tests, accessibility checks, and commit.

### Task 5: Verification and deployment

**Files:** `docs/checklists/v0.1.md`, `docs/roadmap.md`, `artifacts/verification/*`

1. Run formatting, all checks, container/operations smoke, and Trivy.
2. Deploy the pinned commit to home-server without recreating Traefik.
3. Execute the real create/autosave/reload/preview/discard journey and verify Git cleanliness.
4. Record latency, cold restart, backup/restore, CI links, and remaining provider gate.
