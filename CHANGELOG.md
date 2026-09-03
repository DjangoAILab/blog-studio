# Changelog

All notable changes to Blog Studio are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-09-03

### Changed

- Password-free local and trusted-LAN access is now the default. Operators can
  opt into the existing Owner-password flow with
  `BLOG_STUDIO_AUTH_MODE=password`.
- Password-free sessions retain exact-origin and CSRF checks, and System
  Settings explains the active access boundary.

## [0.3.0] - 2026-08-14

### Added

- Site Agent: durable Site-scoped Sessions, approval or YOLO, typed file and
  local Git tools, vision attachments, and an embedded AI workbench.
- Mix-mode composer tags (`#1`, `#2`) via Tagify so selections live inside the
  prompt. The shared AI-plus **加入对话** icon sits on the Crepe toolbar and
  in source mode.
- Disk-first authoring, unified content library, owner-password onboarding,
  Site discovery, ChangeSet prepare/apply/commit/release, and the Focused
  Workbench chrome.
- Reproducible release bundles, signed-tag GHCR publish, and a documented
  unstable `dev` channel for the home-server editor.
- Site-first owner-password onboarding with trusted CLI initialization/reset,
  in-product password change, revocable opaque sessions, and global session
  invalidation.
- Trusted Site discovery/registration, capability diagnostics, optimistic
  settings updates, and a unified library for published articles, native drafts,
  and working copies.
- Guaranteed sanitized Markdown preview plus marker-verified generator preview
  readiness and typed fallback diagnostics.
- Policy-controlled generic attachments, contextual retry/rejection/orphan
  recovery, and portable Markdown insertion alongside optimized images.
- Immutable ChangeSet preparation with progressively confirmed apply,
  selected-path local Git commit, and committed-revision remote release.
- The responsive Focused Workbench design kernel with Site/content/system top
  navigation and explicit accessibility/media fallbacks.
- Generic, versioned generator, repository, asset, publisher, and cache adapter
  contracts.
- Browser Markdown writing with durable drafts, source fallback, article-scoped
  assets, and real generator previews.
- Generator-native draft creation, verified post promotion, explicit draft
  discard, and a complete browser regression journey.
- Preview-and-confirm cleanup for unreferenced article assets, with stale-plan
  conflicts and protected legacy prefixes.
- Observable manifest-based releases, public marker verification, cancellation,
  recovery, and rollback.
- Tencent COS publishing plus classic CDN and EdgeOne cache adapters.
- Explicit, non-rewriting adoption of populated COS deployment baselines.
- Hardened Docker/Compose packaging, Traefik integration, backup and restore
  scripts, landing page, and documentation site.
- Killable, memory-bounded image processing with byte, pixel, cache, and
  wall-clock limits.
- A dependency-free generic command Quick Start, authoring-only publish mode,
  reproducible release bundles, signed-tag enforcement, and standalone artifact
  verification.

### Changed

- Authoring writes the live Markdown file on autosave. Published posts with
  uncommitted Git changes appear as “未提交改动”.
- Public positioning is an AI-first content workspace. Landing and README use a
  photograph-to-essay task to show vision and outline.

[Unreleased]: https://github.com/DjangoAILab/blog-studio/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/DjangoAILab/blog-studio/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/DjangoAILab/blog-studio/compare/v0.1.0...v0.3.0
