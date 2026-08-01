# Roadmap

Roadmap phases are capability gates, not calendar promises. A phase is complete
only after its acceptance checklist and real-environment verification pass.

## Phase 0 — Foundation

**Outcome:** a public, documented repository with enforceable architecture.

- [x] Create public `DjangoAILab/blog-studio` repository.
- [x] Record product definition, architecture, roadmap, and v0.1 checklist.
- [x] Scaffold pnpm/Turborepo TypeScript workspace.
- [x] Add formatting, linting, unit tests, type checking, and CI.
- [x] Define core schemas and adapter contracts with conformance tests.
- [x] Publish configuration JSON Schema and example configuration.
- [ ] Add contribution, security, and architecture decision documentation.

## Phase 1 — Content and writing vertical

**Outcome:** an existing compatible site can be opened and edited safely.

- [x] Administrator-managed workspace registration and compatibility scan.
- [x] Generic command and Hexo generator adapters.
- [x] Document discovery, front matter round-trip, and stable document IDs.
- [x] Draft snapshot persistence with optimistic revisions.
- [ ] Responsive editor shell with visual and source modes.
- [ ] Immediate local image preview and background upload state.
- [ ] Real Hexo preview lifecycle and proxy.
- [ ] Browser tests covering create, edit, autosave, reload, and preview.

## Phase 2 — Assets and publishing

**Outcome:** one browser action publishes and verifies the reference blog.

- [ ] Filesystem and Tencent COS asset adapters.
- [ ] image validation, metadata stripping, resizing, and WebP policy.
- [ ] article-scoped immutable asset keys.
- [ ] Build manifest and local filesystem publisher.
- [ ] Tencent COS diff publisher without per-file remote HEAD fan-out.
- [ ] Tencent CDN cache adapter.
- [ ] Release state machine, logs, cancellation, recovery, and rollback.
- [ ] Public URL release-marker verification.
- [ ] End-to-end publish against a non-production prefix.
- [ ] Controlled production deployment without changing existing URLs.

## Phase 3 — Product delivery

**Outcome:** Blog Studio is installable, understandable, and maintainable.

- [ ] Production Docker image and Compose file.
- [ ] Traefik deployment example for `blog-editor.internal.wj2015.com`.
- [ ] Backup, restore, upgrade, and rollback commands.
- [ ] Landing page based on the verified product journey.
- [ ] Documentation site: quick start, concepts, configuration, adapters,
      providers, security, operations, and Hexo migration.
- [ ] API and adapter reference generated from source.
- [ ] Accessibility, responsive, performance, and visual QA.
- [ ] Deploy to the home server and pass cold-restart verification.
- [ ] Publish v0.1.0 release with checksums and release notes.

## Phase 4 — Ecosystem hardening

**Outcome:** external users can adopt the generic architecture.

- [ ] S3-compatible asset provider.
- [ ] GitHub Actions publisher and status integration.
- [ ] Hugo or Astro second generator adapter to prove portability.
- [ ] Adapter authoring template and conformance suite.
- [ ] Import diagnostics and anonymized support bundle.
- [ ] Upgrade compatibility policy and configuration migrations.

## Deferred product capabilities

These are deliberately outside v0.1 implementation but must not be blocked by
the domain model:

- user/team membership, roles, review, and comments;
- scheduled releases and editorial calendar;
- AI writing, transformation, and agent protocol;
- collaborative cursors and simultaneous editing;
- hosted control plane and multi-tenant isolation;
- content analytics, experiments, and distribution channels.
