# Blog Studio v0.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build, document, deploy, and verify a generic self-hosted publishing workbench whose first production adapters safely operate the existing Hexo/COS/Tencent CDN blog.

**Architecture:** Use a TypeScript modular monorepo and one deployable Node application. Keep published content in files/Git, operational state in SQLite, and provider/generator knowledge behind versioned adapter contracts. Implement the framework-independent contracts and conformance tests before the Hexo vertical, then dogfood every release stage against a non-production prefix before production promotion.

**Tech Stack:** Node.js 22, TypeScript, pnpm, Turborepo, React, Vite, Fastify, Milkdown, Drizzle ORM, SQLite, Zod, Vitest, Playwright, Sharp, Docker, Astro/Starlight, GitHub Actions.

---

## Execution rules

- Follow TDD for domain, configuration, adapters, and release behavior.
- Commit after each task whose acceptance commands pass.
- Never change the reference blog or cloud resources before its explicit
  non-production verification task.
- Record verification evidence under `artifacts/verification/`; do not commit
  credentials, private logs, or full user content.
- Update `docs/checklists/v0.1.md` only when evidence exists.

### Task 1: Repository foundation

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.github/workflows/ci.yml`
- Create: `apps/studio/package.json`
- Create: `apps/website/package.json`
- Create: `packages/core/package.json`
- Create: `packages/config/package.json`

**Steps:**

1. Write a CI smoke test that expects workspace scripts for `lint`, `typecheck`,
   `test`, and `build`.
2. Run `corepack pnpm test` and confirm it fails because the workspace is absent.
3. Add the minimal workspace, pinned package manager, Node engine, shared
   TypeScript, ESLint, Prettier, Turborepo, and package manifests.
4. Run `corepack pnpm install --frozen-lockfile=false` to create `pnpm-lock.yaml`.
5. Run `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` and require exit 0.
6. Commit as `chore: scaffold blog studio workspace`.

### Task 2: Versioned configuration contract

**Files:**

- Create: `packages/config/src/schema.ts`
- Create: `packages/config/src/load.ts`
- Create: `packages/config/src/index.ts`
- Create: `packages/config/test/schema.test.ts`
- Create: `schemas/blog-studio.v1.schema.json`
- Create: `examples/config/blog-studio.yml`

**Steps:**

1. Write failing tests for a minimal valid v1 config, unknown adapter IDs, missing
   workspace root, secret references, unknown keys, and path traversal.
2. Run `pnpm --filter @blog-studio/config test` and confirm the expected failures.
3. Implement strict Zod schemas with serializable normalized output; secret values
   are represented only as `{ env: string }` references.
4. Generate and commit the JSON Schema from the same source definition.
5. Add an example using generic providers, with no real hostname or credential.
6. Run package tests, typecheck, and a schema/example validation command.
7. Commit as `feat: define versioned workspace configuration`.

### Task 3: Core domain and adapter SDK

**Files:**

- Create: `packages/core/src/domain/*.ts`
- Create: `packages/core/src/adapters/*.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/contracts/*.test.ts`
- Create: `packages/adapter-testkit/src/*.ts`
- Create: `packages/adapter-testkit/test/*.test.ts`

**Steps:**

1. Write failing serialization tests for Workspace, Document, DraftRevision,
   Asset, Build, PublishPlan, Release, and JobStage.
2. Write compile-time contract examples for GeneratorAdapter, RepositoryAdapter,
   AssetProvider, Publisher, and CacheProvider.
3. Implement branded identifiers, error codes, capabilities, and v1 contracts.
4. Implement reusable conformance suites using in-memory fake adapters.
5. Add an architecture test that fails when `packages/core` imports a provider or
   generator implementation package.
6. Run core and testkit suites, typecheck, and dependency-boundary checks.
7. Commit as `feat: add core domain and adapter contracts`.

### Task 4: Persistence and job primitives

**Files:**

- Create: `packages/persistence/src/schema.ts`
- Create: `packages/persistence/src/database.ts`
- Create: `packages/persistence/src/repositories/*.ts`
- Create: `packages/persistence/test/*.test.ts`
- Create: `packages/jobs/src/*.ts`
- Create: `packages/jobs/test/*.test.ts`

**Steps:**

1. Write failing tests for acknowledged draft durability, optimistic revision
   conflict, job leases, idempotency keys, restart recovery, and log redaction.
2. Implement SQLite/Drizzle migrations and repositories behind core interfaces.
3. Implement the persisted job state machine with one active lease per
   workspace/target pair.
4. Simulate process interruption and verify deterministic lease recovery.
5. Run tests against a temporary SQLite database and require no leaked handles.
6. Commit as `feat: persist drafts releases and jobs`.

### Task 5: Generic command and Hexo generator adapters

**Files:**

- Create: `packages/adapter-command/src/*.ts`
- Create: `packages/adapter-command/test/*.test.ts`
- Create: `packages/adapter-hexo/src/*.ts`
- Create: `packages/adapter-hexo/test/fixtures/**`
- Create: `packages/adapter-hexo/test/*.test.ts`

**Steps:**

1. Create synthetic fixtures for ordinary Markdown, unknown front matter, Chinese
   filenames, raw HTML, and Hexo tags; do not copy private article bodies.
2. Write failing round-trip, discovery, permalink, build, timeout, environment
   allowlist, and symlink-escape tests.
3. Implement a process runner that accepts argument arrays, never browser shell
   strings, and enforces cwd, timeout, and environment policy.
4. Implement generic command detection/build/preview capabilities.
5. Implement Hexo detection, collection inspection, gray-matter-preserving writes,
   permalink resolution, and build result parsing.
6. Run both adapters through generator conformance tests.
7. Run read-only compatibility scan against the reference blog and prove no file
   hash changes.
8. Commit as `feat: add generic command and hexo adapters`.

### Task 6: Studio API and workspace lifecycle

**Files:**

- Create: `apps/studio/server/app.ts`
- Create: `apps/studio/server/routes/*.ts`
- Create: `apps/studio/server/services/*.ts`
- Create: `apps/studio/server/test/*.test.ts`
- Create: `apps/studio/.env.example`

**Steps:**

1. Write failing API tests for health, workspace registration, compatibility scan,
   document list/read, autosave, conflict, and preview lifecycle.
2. Implement Fastify schemas and problem-detail error responses.
3. Enforce workspace-root containment, origin/CSRF rules, secure sessions, request
   limits, and secret-redacting logs.
4. Implement adapter registry from administrator configuration only.
5. Implement preview process reuse, health checks, idle shutdown, and safe proxy.
6. Run API integration tests and security-negative tests.
7. Commit as `feat: expose secure studio workspace api`.

### Task 7: Editor experience

**Files:**

- Create: `apps/studio/src/app/**`
- Create: `apps/studio/src/features/editor/**`
- Create: `apps/studio/src/features/workspaces/**`
- Create: `apps/studio/src/features/releases/**`
- Create: `apps/studio/src/styles/**`
- Create: `apps/studio/e2e/editor.spec.ts`

**Steps:**

1. Write Playwright tests for first-run setup, open document, visual/source switch,
   autosave/reload, conflict, keyboard navigation, and narrow viewport.
2. Build the responsive shell and accessible workspace/document navigation.
3. Integrate Milkdown with source fallback; preserve unsupported constructs as raw
   blocks and test Markdown round trips.
4. Implement local-first typing state, debounced server snapshots, visible save
   status, offline/error recovery, and revision conflict UI.
5. Add preview pane with reconnect and generator error presentation.
6. Run component, accessibility, and browser tests.
7. Capture and inspect desktop/mobile screenshots before committing.
8. Commit as `feat: build markdown writing workspace`.

### Task 8: Asset pipeline and providers

**Files:**

- Create: `packages/assets/src/*.ts`
- Create: `packages/assets/test/*.test.ts`
- Create: `packages/storage-filesystem/src/*.ts`
- Create: `packages/storage-cos/src/*.ts`
- Create: `packages/storage-cos/test/*.test.ts`
- Modify: `apps/studio/src/features/editor/**`

**Steps:**

1. Write failing tests for filename sanitization, MIME sniffing, size/pixel limits,
   content hashes, immutable document scopes, legacy-prefix rejection, and retry.
2. Implement Sharp-based image processing with bounded resources and deterministic
   outputs.
3. Implement filesystem storage and pass the asset-provider conformance suite.
4. Implement COS storage behind an SDK client interface and test with a fake server;
   permanent credentials remain server-side.
5. Add paste/drop optimistic preview, upload progress, retry, and resulting Markdown
   insertion to the editor.
6. Verify no asset operation can delete or overwrite the configured legacy prefix.
7. Commit as `feat: add article scoped asset pipeline`.

### Task 9: Release orchestration and providers

**Files:**

- Create: `packages/release/src/*.ts`
- Create: `packages/release/test/*.test.ts`
- Create: `packages/publisher-filesystem/src/*.ts`
- Create: `packages/publisher-cos/src/*.ts`
- Create: `packages/cache-tencent/src/*.ts`
- Create: `apps/studio/src/features/releases/**`

**Steps:**

1. Write failing state-machine tests for preflight, build, manifest diff, ordered
   upload, cache invalidation, verification, retry, interruption, and rollback.
2. Implement content-hash manifests and ensure a no-op release has zero uploads.
3. Implement filesystem publisher and conformance tests.
4. Implement COS publisher with bounded concurrency and awaited failures; no remote
   HEAD request is used for every generated file.
5. Implement Tencent CDN cache invalidation behind a client interface.
6. Implement release-marker verification with bounded retry and explicit failure.
7. Expose release timeline, cancellation, diagnostics, and rollback in Studio.
8. Run fault-injection and API/UI integration tests.
9. Commit as `feat: orchestrate verified static site releases`.

### Task 10: Container and self-host operations

**Files:**

- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `deploy/traefik/docker-compose.override.yml`
- Create: `deploy/traefik/.env.example`
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `docs/guides/self-hosting.md`
- Create: `docs/guides/backup-restore.md`

**Steps:**

1. Add container smoke tests for non-root identity, health endpoint, writable data
   mounts, read-only root filesystem, signal handling, and cold restart.
2. Build a multi-stage image with pinned base image and healthcheck.
3. Add Compose volumes, resource limits, secret references, and localhost-only
   direct port binding.
4. Add Traefik labels parameterized for `blog-editor.internal.wj2015.com` without
   embedding private network configuration.
5. Implement atomic SQLite/workspace metadata backup and tested restore scripts.
6. Run clean Compose install, backup, destructive test-data replacement, restore,
   and cold-restart verification.
7. Commit as `feat: package self hosted deployment`.

### Task 11: Landing page and documentation

**Files:**

- Create: `apps/website/src/pages/index.astro`
- Create: `apps/website/src/content/docs/**`
- Create: `apps/website/src/components/**`
- Create: `apps/website/src/styles/**`
- Create: `apps/website/playwright.config.ts`
- Create: `apps/website/e2e/*.spec.ts`

**Steps:**

1. Write content outline and browser checks for navigation, docs deep links,
   responsive layouts, accessibility, and no unverified capability claims.
2. Build a distinctive landing page around the real writing-preview-release
   journey and captured product UI.
3. Build Starlight docs covering quick start, concepts, configuration, Hexo,
   adapters, COS, publishing, security, operations, and troubleshooting.
4. Generate configuration and adapter API reference from source.
5. Run link checking, accessibility, Lighthouse, desktop/mobile visual review, and
   production build.
6. Commit as `docs: launch product site and documentation`.

### Task 12: Reference-blog staging integration

**Files:**

- Create: `examples/reference/hexo-cos.example.yml`
- Create: `artifacts/verification/reference-compatibility.md`
- Create: `artifacts/verification/staging-release.md`
- Modify only after backup/verification: reference-blog deployment workflow and
  publishing script.

**Steps:**

1. Back up current deployment configuration and record current public URL checks,
   object prefixes, headers, and checksums without storing secrets.
2. Configure Blog Studio against a cloned reference workspace and non-production
   COS prefix/domain.
3. Open, edit, preview, and publish a synthetic test document with article-scoped
   media; verify exact live content and release marker.
4. Inject build, upload, cache, network, and restart failures; verify production is
   unchanged and retry/rollback evidence is correct.
5. Compare generated public output and existing URL inventory before promotion.
6. Only after all gates pass, replace the reference deployment path while retaining
   the previous workflow as an immediate rollback option.
7. Publish one controlled real change and verify old and new resource paths.
8. Commit reference integration changes separately with rollback instructions.

### Task 13: Home-server deployment

**Files:**

- Create: `artifacts/verification/home-server-deployment.md`
- Create: `artifacts/verification/performance.md`
- Create: `artifacts/verification/release-readiness.md`

**Steps:**

1. Validate target ports, Traefik network, storage path, resource headroom, DNS,
   TLS, and backup location read-only.
2. Deploy the pinned image with CPU/memory limits and mounted secrets.
3. Verify HTTPS, authentication boundary, healthcheck, logs, persistent autosave,
   build tools, and preview proxy.
4. Run cold restart and restore tests.
5. Measure editor load, API p95, autosave p95, Hexo build, and typical release.
6. Complete the full production user journey at
   `blog-editor.internal.wj2015.com`.
7. Record exact version, image digest, configuration checksum, and rollback command.

### Task 14: Release and handoff

**Files:**

- Create: `CHANGELOG.md`
- Create: `.github/workflows/release.yml`
- Create: `.github/ISSUE_TEMPLATE/**`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Update: `README.md`
- Update: `docs/checklists/v0.1.md`

**Steps:**

1. Add dependency, license, secret, container, unit, integration, browser, and build
   gates to CI/release automation.
2. Run the complete repository test suite from a clean checkout.
3. Review every checklist item against committed or private verification evidence;
   leave any unsupported item unchecked.
4. Have the quick start executed using documentation only.
5. Tag and publish `v0.1.0` with image digest, checksums, release notes, upgrade, and
   rollback instructions.
6. Verify the GitHub release, container pull, website, documentation, installed
   Studio, and public reference blog.
7. Mark the implementation goal complete only when all required v0.1 gates pass.
