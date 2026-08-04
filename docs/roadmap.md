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

- [ ] Select the first-run, library, editor/preview, and ChangeSet interaction
      models plus a minimal responsive design and motion-token kernel before
      implementing their new production surfaces.
- [ ] Trusted first-run owner-password setup, in-product change, CLI reset, and
      session revocation.
- [ ] Site discovery, registration, display identity, settings, and capability
      diagnostics.
- [ ] Unified searchable library for published documents, native drafts, and
      modified working copies.
- [ ] Published-document editing without mutating canonical files until an
      approved change set is applied.
- [ ] Immediate Markdown preview plus verified generator-preview enhancement
      and actionable fallback states.
- [ ] Policy-controlled generic resources in addition to image processing.
- [ ] Durable ChangeSet preparation across managed drafts, resources,
      configuration, and repository changes.
- [ ] Separate confirmations for preparing, creating a local Git commit, and
      releasing to a remote target.
- [ ] Browser journeys and failure evidence for first run, daily editing,
      preview, ChangeSet review, commit, and publish.

## Phase 5 — Interaction system and public distribution

**Outcome:** real product journeys reach a distinctive, responsive, accessible
quality bar and can be presented honestly to external users.

- [ ] Complete and apply high-fidelity desktop and mobile targets for
      onboarding, library, editor/preview, ChangeSet review, settings, and
      security.
- [ ] Establish semantic content/material/elevation/type/spacing/motion/focus
      tokens and non-glass fallbacks.
- [ ] Apply the iOS 26-inspired “living editorial room” interaction model
      without putting glass or perpetual motion in the content layer.
- [ ] Verify reduced motion, reduced transparency, increased contrast, keyboard
      access, responsive reflow, and performance budgets.
- [ ] Rebuild `apps/website` from verified Studio journeys and current release
      evidence.
- [ ] Deploy landing, documentation, and release links through GitHub Pages.
- [ ] Add durable routes from the landing and build stories to
      `https://blog.wj2015.com`.

## Phase 6 — Permissioned Agent platform

**Outcome:** one Site Agent can reason and act through auditable Blog Studio
capabilities without bypassing product safety boundaries.

- [ ] Define an `AgentRuntime` contract and implement Pi as the first runtime.
- [ ] Disable unrestricted Pi filesystem, edit, write, and shell tools; expose
      only scoped Blog Studio capabilities.
- [ ] Persist Agent sessions, messages, context attachments, tool calls, and
      approval evidence in SQLite.
- [ ] Add the global Site Agent and article-scoped context experience.
- [ ] Add explicit current-selection, working-copy diff, preview-error, and
      ChangeSet context attachments.
- [ ] Require review and confirmation for configuration changes, deletion,
      commit application, and remote release.
- [ ] Expose the same capability service through a scoped, read-only-by-default
      MCP server adapter.
- [ ] Add cancellation, redaction, recovery, audit, and adversarial tool-policy
      tests before enabling mutating tools by default.

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

See [Product Evolution](product/product-evolution.md) for the durable design,
sequencing rationale, Pi approaches, MCP boundary, and explicit deferrals.

## Still deferred

- user/team membership, roles, review, and comments;
- scheduled releases and editorial calendar;
- collaborative cursors and simultaneous editing;
- hosted control plane and multi-tenant isolation;
- autonomous publication and destructive Agent actions.
