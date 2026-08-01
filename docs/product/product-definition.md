# Blog Studio Product Definition

## Positioning

Blog Studio is a self-hosted publishing workbench for file-based websites. It
does not replace the user's static-site generator, repository, object storage,
CDN, theme, or public website. It connects those pieces into one reliable
browser workflow.

**Category:** publishing operations workbench.

**Primary promise:** write, preview, publish, verify, and roll back without
leaving one browser tab.

**Primary user:** an individual or small technical team that already owns a
Markdown-based static site and wants CMS-quality writing without surrendering
its files or infrastructure.

## Problem

Static sites are easy to serve but surprisingly difficult to keep publishing.
The author must coordinate a text editor, front matter, local tooling, Git,
image compression, object storage, CI, CDN invalidation, and production checks.
Each component works, yet the complete journey is slow and opaque.

Blog Studio addresses six recurring pains:

1. Saving a draft is incorrectly coupled to deploying a website.
2. Media accumulates in large unstructured folders or bloats Git history.
3. editor preview differs from the real generator and theme.
4. deployment status does not prove that the public URL is current.
5. failures require terminal and cloud-console investigation.
6. old URLs and media paths make infrastructure migration risky.

## Product boundaries

Blog Studio is not:

- a website builder or theme marketplace;
- a public blogging runtime like Ghost or WordPress;
- a replacement Markdown dialect;
- a Git hosting service;
- a multi-tenant SaaS in v0.1;
- an AI content generator in v0.1.

## Core user journeys

### First-run journey

1. Create a workspace from a local path or Git remote.
2. Detect or select a generator adapter.
3. inspect detected collections, front matter, commands, and public URLs.
4. configure asset, repository, publish, and cache providers.
5. run a compatibility scan without changing source files.
6. build and open a real preview.
7. save a versioned `blog-studio.yml` configuration.

### Daily writing journey

1. Open a recent draft or create an article.
2. Write in a Markdown-native visual editor; switch to source mode when needed.
3. Paste or drag media and receive an article-scoped stable URL.
4. Autosave without committing or deploying.
5. preview through the real generator and theme.
6. run preflight checks for metadata, links, assets, and output paths.
7. publish a visible release plan.
8. verify the public URL and retain a rollback point.

### Failure journey

1. Stop before production HTML changes whenever a prerequisite fails.
2. show the failing stage, human-readable summary, and raw diagnostic log.
3. preserve the draft and uploaded immutable assets.
4. retry only the failed or safe-to-repeat stages.
5. roll back the release manifest when public verification fails.

## Product principles

1. **Files remain sovereign.** Markdown and Git are the portable source of
   truth; internal state must never be required to render the public site.
2. **Real preview over simulated preview.** The configured generator owns
   rendering semantics.
3. **Publish is a verified state transition.** A green build is not sufficient;
   the live URL must expose the expected release marker.
4. **Adapters isolate infrastructure.** Core code has no Hexo, COS, Tencent,
   GitHub, or Traefik dependency.
5. **Compatibility before normalization.** Preserve unknown front matter,
   custom Markdown, filenames, and published URLs.
6. **Fast writing, asynchronous operations.** Typing and autosave never wait
   for Git, build, upload, or CDN operations.
7. **Safe defaults.** New immutable asset names, least-privilege credentials,
   scoped deletion, and explicit release promotion.

## v0.1 scope

### Product-level capabilities

- workspace setup and configuration validation;
- collection and document discovery through adapter contracts;
- Markdown visual/source editing with lossless compatibility fallback;
- autosave snapshots and revision conflict detection;
- article-scoped media upload and image processing;
- real generator preview;
- release preflight, build, manifest diff, publish, cache refresh, verification,
  and rollback;
- structured job history and diagnostics;
- Docker deployment and reverse-proxy compatibility;
- landing page, user documentation, configuration reference, and adapter guide.

### First production adapters

- generator: Hexo;
- repository: local Git with optional GitHub push;
- asset storage: local filesystem and Tencent COS;
- publisher: filesystem and Tencent COS;
- cache: no-op and Tencent CDN;
- generic command adapter as the compatibility escape hatch.

### Deferred product features

- teams, roles, comments, and review workflow;
- scheduled publishing;
- AI writing and agent APIs;
- real-time collaboration;
- hosted control plane;
- analytics and content calendar.

Their extension points must be represented in the domain model, but v0.1 must
not ship inactive UI or speculative services for them.

## Success metrics

- A supported existing site reaches a real preview within 10 minutes of setup.
- Editor shell becomes interactive within 1.5 seconds on the target LAN.
- Autosave acknowledgement is below 150 ms p95 and has no build dependency.
- Pasting an ordinary image shows a local preview immediately and completes
  background upload without blocking typing.
- A no-op publish does not enumerate every remote object.
- A changed-article publish completes in under 90 seconds on the reference blog,
  excluding external provider incidents.
- Existing post files and URLs remain byte/path compatible unless the user edits
  them explicitly.
- Turning off Blog Studio has no impact on the public website.
