# Native Draft Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a newly created Hexo native draft render at its real preview URL without mutating canonical source.

**Architecture:** Reuse the generator adapter's existing draft promotion capability inside the preview sandbox. Resolve and serve the preview with the promoted reference; leave existing post preview behavior unchanged.

**Tech Stack:** TypeScript, Fastify, Vitest, Hexo adapter, pnpm.

---

### Task 1: Add the failing native-draft preview regression

**Files:**

- Modify: `apps/studio/server/test/app.test.ts`

1. Make the fake Hexo executable render every Markdown file under
   `source/_posts`, deriving its permalink from front matter and filename.
2. Extend the existing native draft release test to request preview before
   release, follow the returned URL, and assert the saved body is present.
3. Assert the canonical source remains in `_drafts` after preview.
4. Run
   `corepack pnpm --filter @blog-studio/studio exec vitest run server/test/app.test.ts -t "promotes exactly one native draft"`
   and verify the new assertion fails with a missing preview file.

### Task 2: Promote only the selected draft in the preview sandbox

**Files:**

- Modify: `apps/studio/server/services/previews.ts`
- Modify: `packages/adapter-hexo/src/adapter.ts`
- Test: `packages/adapter-hexo/test/adapter.test.ts`

1. Capture the result of `writeDocument`.
2. When the selected reference belongs to `drafts`, require
   `promoteDocument`, promote it to `posts` in the sandbox, and retain the
   returned reference.
3. Resolve the public URL and persist the preview session using that effective
   reference.
4. Remove Hexo's global `--draft` preview flag and pass only the configured
   site timezone as the child process `TZ` value.
5. Verify the Hexo command regression and focused Studio test pass.

### Task 3: Verify and ship the repair

**Files:**

- Modify: `artifacts/verification/staging-release.md`

1. Run Studio tests, typecheck, lint, then the repository verification suite.
2. Commit and push `codex/fix-native-draft-preview`; open a protected-branch PR
   and require green CI before merge.
3. Build the merged revision on home-server, recreate the service with both
   Traefik and Tencent overrides, and verify health/auth/public-site hashes.
4. Repeat preview and the real staging provider release journey.
