# Product Evolution

**Status:** Accepted direction, 2026-08-04. This document records durable
product sequencing after v0.1. It is not a commitment to ship speculative UI
or inactive Agent controls before their capability gates pass.

## Priority rule

Blog Studio must finish the hard, trustworthy publishing-workbench journey
before content statistics, AI analysis, or growth features compete for product
attention. The order is:

1. define the Site-first journeys and select a minimal interaction/design
   kernel so new flows are not implemented twice;
2. implement the hard product foundations with that kernel;
3. complete the high-fidelity interaction system across the verified journeys;
4. publish a landing and documentation experience based on verified product
   evidence;
5. add a permissioned Agent platform;
6. add derived statistics and AI analysis.

Markdown, site configuration, assets, and Git remain portable sources of truth.
SQLite may own identity, sessions, drafts, indexes, change sets, jobs, Agent
sessions, tool audit records, and rebuildable derived data.

## Product model

`Site` is the user-facing root object. A Site owns content, resources, preview
capabilities, change sets, release targets, and later Agent sessions. A
`Workspace` is the trusted technical checkout behind a Site and should appear
only in advanced settings and diagnostics.

Published documents and drafts belong to one content library. Editing a
published document creates a working copy. A `ChangeSet` freezes exact draft,
asset, configuration, and repository revisions for review. Preparing a change
set is safe and repeatable; creating a local commit and publishing to a remote
target are separate explicit actions.

## Horizon 1 — v0.2 hard capabilities

v0.2 is the next engineering priority. It is complete only when:

- first-run, content-library, editor/preview, and ChangeSet interaction models
  have selected desktop and mobile targets plus the minimal tokens needed to
  keep new UI work coherent;
- a trusted CLI bootstrap initializes the owner password, the UI can change it,
  and a CLI reset revokes existing sessions;
- first run can discover, inspect, confirm, and register a Site without exposing
  raw configuration IDs as its display identity;
- one searchable content library can open, edit, preview, and inspect published
  documents, native drafts, and modified working copies;
- Markdown preview always works, generator preview is an enhanced capability,
  and `ready` is never reported before the target response is verified;
- resources support policy-controlled attachments in addition to the existing
  image optimization path;
- `Prepare changes` collects all managed local changes into a reviewable,
  invalidation-safe ChangeSet;
- local Git commit and remote release remain two separately confirmed actions;
- every failure has a visible product state, actionable diagnostic, and safe
  recovery path.

No statistics dashboard or Agent surface is required for this gate. Full visual
and motion-system coverage remains a separate gate, but interaction design is a
prerequisite rather than a cleanup pass after v0.2 implementation.

**Current checkpoint (2026-08-05):** the hard capabilities, selected interaction
system, disposable browser/container journeys, and Studio-only home-server
upgrade/rollback rehearsal are implemented and evidenced. Final acceptance is
waiting only for the owner-selected production credential and the authenticated
`wj2015-blog` journey. See the
[v0.2 release-candidate index](../verification/v0.2-release-candidate.md).

## Horizon 2 — interaction and visual system

The desired quality bar is inspired by the iOS 26 design language and motion
model, not a literal copy of Apple UI. The design concept is **a living
editorial room**:

- stable paper-like content and diff surfaces form the content layer;
- restrained glass-like navigation, toolbars, command surfaces, sheets, and
  transient controls form the functional layer;
- motion communicates origin, destination, save state, preview transitions,
  change-set assembly, and Agent activity instead of decorating idle screens;
- desktop, tablet, and mobile share the same spatial model while adapting
  sidebars, floating controls, sheets, and navigation placement;
- reduced motion, reduced transparency, increased contrast, keyboard access,
  and non-blur fallbacks are first-class acceptance states;
- large-area blur, perpetual animation, glass inside article content, and
  low-contrast translucency are explicitly rejected.

Before a production visual rewrite, the core first-run, content library,
editor/preview, and change-set review journeys need selected high-fidelity
desktop and mobile targets. Implementation should establish semantic color,
material, elevation, typography, spacing, radius, motion, and focus tokens
before individual screens diverge.

## Horizon 3 — public website and distribution

Once the redesigned product journey is real and screenshot-ready,
`apps/website` should become the canonical landing, documentation, and release
surface deployed by GitHub Pages.

The public experience should prove the product rather than advertise future
features. It should show the Site-first onboarding, published-content editing,
reliable preview, ChangeSet review, commit, and verified-release journey. The
primary calls to action lead to the GitHub repository, Quick Start, and current
release. A persistent secondary path leads to the owner's implementation
stories and reference deployment at `https://blog.wj2015.com`.

The private authenticated Studio URL is not a public demo. If an interactive
demo is added later, it must use an isolated disposable workspace with
publishing disabled.

## Horizon 4 — Agent platform

Pi is the first planned Agent runtime integration. It is not the same concept as
an LLM provider: Pi manages Agent sessions, events, model selection, and tool
execution, while model providers remain configurable beneath it. Blog Studio
should define an `AgentRuntime` boundary so Pi can be upgraded or replaced
without changing product tools or stored content.

The first integration embeds the Pi SDK behind that boundary in the existing
Studio server. Pi receives the current Site workspace as its `cwd` and retains
its filesystem inspection and mutation tools below that root. The general
`bash` tool is absent. Fixed-shape Git tools provide status, diff, log, show,
path-scoped restore, and bounded reversal without exposing arbitrary arguments,
remote mutation, clean, hooks, or whole-repository hard reset.

Approval mode prompts for every mutating tool call. YOLO mode executes permitted
mutations immediately. Both retain Site-root checks, one writer lock per Site,
typed tools, and audit records. There is no trash or special backup promise for
deleted untracked files.

There is one global Site Agent surface with several independent, archivable
Sessions. An article page is the same Site Agent with `documentId` attached
automatically. The message composer can attach the current selection, editor
buffer, diff, preview error, ChangeSet, file, or image as explicit one-turn
context. Selected text is never silently reattached to later messages.

Agent Sessions and approval preferences belong to a Site, not to a page. Global
defaults, Site overrides, and Session overrides are durable. Each browser tab
keeps an explicit `siteId` so its preview URL and Agent state cannot drift to a
different Site.

Pi JSONL and Studio SQLite must not become two independently writable transcript
stores. The POC selected Pi JSONL as the sole transcript because the public SDK
exposes a concrete session tree rather than a generic storage adapter. SQLite
continues to own Site association, archive state, preferences, attachments,
approvals, and audit indexes. Canonical content continues to live in files and
Git.

External MCP exposure is not part of the first Agent release. SiYuan and
Obsidian MCP implementations remain useful references for typed errors,
fine-grained editing, audit, and destructive-operation design, but Blog Studio
does not add another tool transport until its in-product Site Agent is proven.

## Approaches considered for Pi

1. **Embedded SDK behind `AgentRuntime` — recommended.** It supports the custom
   web UI, streaming events, direct filesystem tools, and custom tool policy
   with the least operational overhead. The POC selected native Pi JSONL for
   transcripts and SQLite for product metadata.
2. **Pi RPC subprocess.** It improves process isolation and independent upgrade
   control, but adds lifecycle, framing, credential, cancellation, and session
   synchronization complexity. Keep it as a measured fallback.
3. **Independent Agent service.** It provides the strongest scaling boundary,
   but creates premature distributed-system and authorization costs for a
   single-node self-hosted product. Defer until real concurrency requires it.

## Explicit deferrals

- word-frequency dashboards, content analytics, and AI-generated insights;
- autonomous publishing;
- multi-user Agent sharing, comments, and approval chains;
- general shell access and remote Git mutation;
- public MCP exposure before the Site Agent is proven;
- a public mutable demo;
- a second Agent runtime before the Pi boundary is proven.

## Confirmed interaction implementation

The owner selected the **Focused Workbench** direction. Production surfaces use
`@base-ui/react` for focus-managed primitives, `motion` for spatial transitions
and reduced-motion handling, and semantic CSS material/elevation/type/spacing/
radius/focus tokens with reduced-transparency, increased-contrast, and no-blur
fallbacks. The content and diff layer remains opaque and stable. The selection
and implementation evidence are recorded in the
[design selection](../verification/v0.2-design-selection.md) and
[UI kernel](../verification/v0.2-ui-kernel.md).

## Open decision

- Decide whether the GitHub Pages site should remain at the repository Pages
  path or later receive a public custom domain.

## Confirmed integration

“Pi” means the current
[`earendil-works/pi`](https://github.com/earendil-works/pi) coding-agent SDK
lineage. This repository and its SDK documentation are the compatibility source
for the future `AgentRuntime` adapter.
