# Direct-Port Development Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a local-server operator route a browser preview hostname directly
to a generator's container port, while Studio remains the safe control plane.

**Architecture:** A profile has an internal `baseUrl` used only by Studio and a
host-managed `previewUrl` opened by the browser. The generator owns preview
responses on a direct container port; Studio no longer path-proxies generated
content. The base Compose file declares, but does not host-publish, the
4000--4100 development range; optional ingress overrides route a hostname to a
selected port.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, Playwright, Docker
Compose, Traefik.

---

### Task 1: Persist the decision and release gates

**Files:**

- Create: `docs/architecture/adr-0001-direct-port-development-preview.md`
- Create: `docs/checklists/v0.3.2-direct-port-preview.md`
- Create: `docs/plans/2026-08-09-direct-port-development-preview.md`

1. Record the direct-port decision, security boundary and rejected proxy
   alternatives.
2. Record configuration, ingress, test and production acceptance gates.
3. Commit the planning documents with the implementation change set.

### Task 2: Add a host-managed browser preview URL

**Files:**

- Modify: `packages/config/src/schema.ts`
- Modify: `packages/core/src/domain/sites.ts`
- Modify: `apps/studio/server/services/workspaces.ts`
- Modify: `apps/studio/server/services/sites.ts`
- Test: `packages/config/test/*.test.ts`
- Test: `apps/studio/server/test/app.test.ts`

1. Write failing schema and API assertions for `previewUrl` on a development
   profile, while proving owner YAML cannot supply it.
2. Add an optional HTTP(S), origin-root `previewUrl` to host profiles only.
3. Carry it through loaded workspace configuration, Site capabilities and the
   development snapshot without exposing the internal base URL as a browser
   destination.
4. Run focused tests, then the package type check.

### Task 3: Replace the content proxy with a direct UI link

**Files:**

- Modify: `apps/studio/server/services/development.ts`
- Modify: `apps/studio/server/routes/api.ts`
- Modify: `apps/studio/src/features/site/local-development.tsx`
- Modify: `apps/studio/src/app/api.ts`
- Test: `apps/studio/server/test/development.test.ts`
- Test: `apps/studio/server/test/app.test.ts`
- Test: `apps/studio/e2e/authoring.spec.ts`

1. Write failing tests showing a ready profile returns its public preview URL,
   the UI opens that URL, and no proxy endpoint is needed.
2. Keep `baseUrl` for readiness and sandbox behavior; store `previewUrl` on the
   active process snapshot.
3. Delete `proxyTarget()` and the wildcard proxy route.
4. Make the ready UI show and open `previewUrl`; when absent, show an
   administrator remedy and retain restart/stop controls.
5. Run focused service/API/browser tests.

### Task 4: Declare direct preview ingress

**Files:**

- Modify: `docker-compose.yml`
- Create: `deploy/traefik/docker-compose.preview-4000.override.yml`
- Modify: `deploy/traefik/.env.example`
- Modify: `docs/guides/self-hosting.md`
- Modify: `docs/guides/sites-and-first-run.md`
- Modify: `README.md`

1. Add the container-only 4000--4100 development-port declaration to the base
   Compose service.
2. Add an opt-in Traefik router/service that maps
   `BLOG_STUDIO_PREVIEW_HOSTNAME` directly to container port 4000.
3. Document the equivalent host-Nginx loopback-port mapping and make clear that
   `expose` is not host publication.
4. Update profile examples to use explicit Hexo address/port arguments and
   `previewUrl`; remove all claims that Studio proxies generated content.
5. Run `docker compose ... config --quiet` for base and Traefik combinations.

### Task 5: Complete release verification

**Files:**

- Modify: `docs/checklists/v0.3.2-direct-port-preview.md`
- Create: `docs/verification/v0.3.2-direct-port-preview.md`

1. Run formatting, focused tests, full repository checks and browser E2E.
2. Inspect the PR diff and required GitHub checks; merge only after they pass.
3. Record the production image/configuration rollback target without retaining
   workstation backups.
4. Deploy the merged image and optional preview Traefik override to the home
   server.
5. Verify authenticated editor health, direct preview HTML/CSS/JS/image/link,
   stop/restart recovery, then mark checklist evidence with commands/results.
