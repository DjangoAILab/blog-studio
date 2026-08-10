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
- [x] Add contribution, security, and architecture decision documentation.

## Phase 1 — Content and writing vertical

**Outcome:** an existing compatible site can be opened and edited safely.

- [x] Administrator-managed workspace registration and compatibility scan.
- [x] Generic command and Hexo generator adapters.
- [x] Document discovery, front matter round-trip, and stable document IDs.
- [x] Draft snapshot persistence with optimistic revisions.
- [x] Responsive editor shell with visual and source modes.
- [x] Immediate local image preview and background upload state.
- [x] Real Hexo preview lifecycle and proxy.
- [x] Browser tests covering create, edit, autosave, reload, and preview.

## Phase 2 — Assets and publishing

**Outcome:** one browser action publishes and verifies the reference blog.

- [x] Filesystem and Tencent COS asset adapters.
- [x] image validation, metadata stripping, resizing, and WebP policy.
- [x] article-scoped immutable asset keys.
- [x] Build manifest and local filesystem publisher.
- [x] Tencent COS diff publisher without per-file remote HEAD fan-out.
- [x] Tencent CDN and EdgeOne cache adapter contract.
- [x] Release state machine, durable logs, cancellation, and rollback.
- [x] Public URL release-marker verification.
- [x] Cold-restart release recovery against real provider state.
- [x] End-to-end publish against a non-production prefix.
- [x] Controlled production deployment without changing existing URLs.

## Phase 3 — Product delivery

**Outcome:** Blog Studio is installable, understandable, and maintainable.

- [x] Production Docker image and Compose file.
- [x] Traefik deployment example for `blog-editor.internal.wj2015.com`.
- [x] Backup, restore, upgrade, and rollback commands.
- [x] Landing page based on the verified product journey.
- [x] Documentation site: quick start, concepts, configuration, adapters,
      providers, security, operations, and Hexo migration.
- [x] API and adapter reference generated from source.
- [x] Accessibility, responsive, performance, and visual QA.
- [x] Deploy to the home server and pass cold-restart verification.
- [x] Publish v0.1.0 release with checksums and release notes.

## Phase 4 — Site-first hard capabilities

**Outcome:** the reliable v0.1 engine becomes a complete daily product before
statistics, AI analysis, or growth work competes for attention.

Implementation and disposable production-like acceptance are complete. Phase
acceptance remains open until the owner initializes the real home-server
credential and the final authenticated reference-Site journey passes.

- [x] Select the first-run, library, editor/preview, and ChangeSet interaction
      models plus a minimal responsive design and motion-token kernel before
      implementing their new production surfaces.
- [x] Trusted first-run owner-password setup, in-product change, CLI reset, and
      session revocation.
- [x] Site discovery, registration, display identity, settings, and capability
      diagnostics.
- [x] Unified searchable library for published documents, native drafts, and
      modified working copies.
- [x] Published-document editing without mutating canonical files until an
      approved change set is applied.
- [x] Immediate Markdown preview plus verified generator-preview enhancement
      and actionable fallback states.
- [x] Policy-controlled generic resources in addition to image processing.
- [x] Durable ChangeSet preparation across managed drafts, resources,
      configuration, and repository changes.
- [x] Separate confirmations for preparing, creating a local Git commit, and
      releasing to a remote target.
- [x] Browser journeys and failure evidence for first run, daily editing,
      preview, ChangeSet review, commit, and publish.

## Phase 5 — Interaction system and public distribution

**Outcome:** real product journeys reach a distinctive, responsive, accessible
quality bar and can be presented honestly to external users.

- [x] Complete and apply high-fidelity desktop and mobile targets for
      onboarding, library, editor/preview, ChangeSet review, settings, and
      security.
- [x] Establish semantic content/material/elevation/type/spacing/motion/focus
      tokens and non-glass fallbacks.
- [x] Apply the iOS 26-inspired “living editorial room” interaction model
      without putting glass or perpetual motion in the content layer.
- [x] Verify reduced motion, reduced transparency, increased contrast, keyboard
      access, responsive reflow, and performance budgets.
- [x] Rebuild `apps/website` from verified Studio journeys and current release
      evidence.
- [x] Record and optimize a 20--30 second README GIF from the verified writing,
      preview, ChangeSet, and later Agent journey.
- [x] Add a verified GitHub Pages build/deploy workflow with project-base links;
      public deployment follows merge to the configured Pages branch.
- [ ] Add durable routes from the landing and build stories to
      `https://blog.wj2015.com`.

## Phase 6 — Permissioned Agent platform

**Outcome:** one Site-scoped Agent can assist production across the complete
website workspace without receiving a general shell or autonomous publishing
authority.

- [x] Pass the embedded Pi SDK POC gate and select Pi JSONL as the transcript
      source of truth before adding production migrations. See the
      [verification record](verification/site-agent-pi-poc.md).
- [x] Implement Pi behind a thin `AgentRuntime` boundary in the existing Studio
      server, with direct Site-root filesystem tools and no general shell.
- [x] Add structured Git inspection and bounded recovery tools without arbitrary
      commands, remote mutation, clean, or whole-repository hard reset.
- [x] Persist Site-scoped Agent sessions, archive state, context attachments,
      tool calls, approval evidence, and global/Site/Session preferences.
- [x] Add the global Agent panel, multi-Session management, and tab-safe Site
      and preview selection.
- [x] Add one-turn current-article, Markdown-selection, diff, preview-error,
      ChangeSet, file, and image context attachments.
- [x] Add a separately configured vision-model adapter for image understanding.
- [x] Add approval and YOLO modes plus one writer lock per Site.
- [x] Preserve original image uploads by default and add explicit per-Site
      compression, format, resize, quality, and metadata settings.
- [x] Add cancellation, redaction, restart recovery, audit, draft-conflict, and
      adversarial tool-policy tests before enabling mutating tools by default.

## Phase 7 — Ecosystem and derived intelligence

**Outcome:** portability and rebuildable intelligence expand after the core and
Agent boundaries are proven.

- [ ] S3-compatible asset provider.
- [ ] GitHub Actions publisher and status integration.
- [ ] Hugo or Astro second generator adapter to prove portability.
- [ ] Adapter authoring template and conformance suite.
- [ ] Import diagnostics and anonymized support bundle.
- [ ] Upgrade compatibility policy and configuration migrations.
- [ ] Rebuildable content index, statistics, word-frequency analysis, and
      optional AI-derived insights.

See [Product Evolution](product/product-evolution.md) and the
[Site Agent design](plans/2026-08-10-site-agent-platform-design.md) for the
durable design, and use the
[AI-assisted production checklist](checklists/site-agent-ai-assisted-production.md)
as the evidence-backed completion gate.

## Still deferred

- user/team membership, roles, review, and comments;
- scheduled releases and editorial calendar;
- collaborative cursors and simultaneous editing;
- hosted control plane and multi-tenant isolation;
- autonomous publication;
- general Agent shell access and Agent-managed remote Git operations;
- public MCP exposure before the Site Agent boundary is proven.
