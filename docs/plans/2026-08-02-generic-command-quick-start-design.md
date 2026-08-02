# Generic command Quick Start design

## Problem

The repository exposes a conforming `CommandGeneratorAdapter`, but the
production Studio factory only constructs Hexo. The checked-in Quick Start
configuration selects `command`, invokes npm even though npm is intentionally
absent from the runtime image, and points at a workspace path that differs from
the Compose mount. A container health check can pass while the documented
writing and preview journey is unusable.

This is a release blocker: Blog Studio v0.1 promises a generic adapter
architecture with Hexo as its first production proof, not a Hexo-only runtime.

## Decision

Wire the existing command adapter as the second built-in generator. Its
executable and arguments remain administrator-owned YAML; no browser endpoint
can read or mutate them. Execution continues through `spawn` with `shell:
false`, a workspace-confined working directory, bounded time/output, and an
allowlisted environment. This retains the existing trusted-workspace security
model without introducing dynamic package loading.

Command collection paths come from the versioned `content.collections.posts`
configuration. The published path maps to collection `posts`; an optional
`draftPath` maps to `drafts`. This preserves the v0.1 article UI while allowing
non-Hexo layouts. Adapter-specific options define markers, output directory,
site URL, the build executable, arguments, timeout, and environment allowlist;
unknown or mistyped options fail during startup with a path-specific error.

Add `publish.adapter: none` for a safe authoring/preview-only installation.
The workspace API reports that publishing and native creation are unavailable,
so the UI disables publishing and hides the create control instead of exposing
actions guaranteed to fail.

## Runnable example

Ship a dependency-free example workspace whose build script uses Node built-in
modules. The Quick Start copies it into the mounted workspace, initializes a
local Git repository, generates file secrets, starts Compose, authenticates,
lists a real Markdown article, autosaves a draft, and renders the generated
preview. It needs no package registry, cloud account, or fake publish target.

A repository smoke script reproduces that journey in a disposable directory
and Compose project. It checks container health and security boundaries, the
command workspace model, document discovery, acknowledged draft persistence,
and real preview content. Cleanup is scoped to the disposable Compose project
and temporary directory.

## Rejected alternatives

- Document Hexo as the only Quick Start: contradicts the generic v0.1 product
  boundary and leaves the command adapter as dead code.
- Load arbitrary adapter packages at runtime: expands the v0.1 supply-chain and
  code-execution surface before a stable plugin lifecycle exists.
- Count container health as Quick Start completion: proves process liveness,
  not the user journey promised by the documentation.

## Verification

1. Unit tests reject malformed/unknown command options and prove the factory
   creates the adapter.
2. Studio integration tests authenticate, list the example article, save a
   durable draft, build a preview, and confirm publish/create capability flags.
3. The disposable Quick Start smoke runs from documented files against the
   production container.
4. Full format, lint, typecheck, test, build, Playwright, container, operations,
   dependency, and image security gates remain green.
