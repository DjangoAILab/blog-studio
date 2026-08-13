---
title: Work with the Site Agent
description: Use durable Site-scoped AI Sessions while keeping file, Git, preview, and publishing boundaries explicit.
---

The Site Agent is an AI-assisted production surface inside the existing Blog
Studio Web application. It follows the selected **Site**, not one page or one
article. Opening content, preview, ChangeSets, Site management, or settings does
not replace the active Session. Switching Sites does.

The Agent works directly in the same on-disk workspace used by the editor and
the configured generator. A preview provider only starts or points to a preview
URL; it does not host the Agent runtime or copy the workspace.

## Start and manage Sessions

Open **AI** from any application page. Create as many independent Sessions
as the Site needs, then rename, switch, archive, or restore them from the panel.
The Session list is owned by the explicit `siteId` in the URL. The active choice
is remembered per browser tab, so two tabs may focus different Sessions without
moving either Session to another Site.

The Pi JSONL file is the sole chat transcript. SQLite stores only Site
association, display/archive state, preferences, attachment references, turns,
events, and approval/audit indexes. Restarting Studio resumes the same Pi
identity; missing or corrupt transcripts produce an actionable error and are
never silently replaced.

## Attach one-message context

The current page is turn context. In the visual toolbar or Markdown source
mode, select a range and choose **加入对话**. The passage becomes a removable
`#1` / `#2` mix tag inside the composer, so you can write “这一段 #1 跟这一段
#2 矛盾”. The same Session can attach a photograph: a vision adapter describes
it, and the original file stays on the transcript.

Inspect or remove every tag and attachment before sending. Its materialized
content is written into that user message exactly once and remains visible in
Session history; it is not hidden state and is not injected into the next
message. These references help the model, but never narrow its Site-wide
filesystem authority.

## Choose approval or YOLO

The effective mode is always visible above the composer:

- **每次审批** lets reads and searches run immediately, but holds every file or
  Git mutation until the owner approves the durable tool request.
- **YOLO** skips that prompt only. Authentication, ownership, typed tools, path
  checks, Site writer locking, audit records, and secret redaction still apply.

YOLO can permanently delete an untracked file. Blog Studio does not maintain a
special trash copy for that case. Use local Git for tracked-file recovery and
review status and diff before release. The bounded current-turn recovery tool
restores only the Agent-produced state and refuses to overwrite later human
work.

## File and Git authority

The Agent can read, search, create, edit, move, and delete below the canonical
Site root. Absolute paths, `..` escapes, symlink escapes, and `.git` internals
are rejected. There is no general shell. Git is available only through fixed
local operations: status, diff, bounded log/show, one tracked-path restore, and
current-turn attributable reversal. Arbitrary arguments, hooks, aliases,
configuration changes, remotes, `git clean`, and repository-wide hard reset are
not tools.

One writer lock serializes mutations across all Sessions for a Site. Reads and
other Sites remain independent. Direct Agent edits can make an open editor
revision stale; resolve the surfaced conflict before saving or preparing a
ChangeSet.

Agent edits are working-tree changes. A ChangeSet is a separate review artifact;
a local Git commit is another explicit step; publishing is still a separately
triggered, human-reviewed release workflow. The Agent cannot publish.

## Attach files and use vision

Composer uploads are stored under Blog Studio application data, outside every
Site root. Files are size-limited, MIME-sniffed, sanitized, hashed, and bound to
their owning Site Session. Sending an image keeps the original attachment and
asks the separately configured vision adapter for an interpretation. If vision
fails, the message and original remain, and the panel offers retry without
claiming an interpretation succeeded.

Attachments are retained with their Session, including while it is archived,
and are included in the operational backup. The current product has archive and
restore but no destructive Session deletion, so it performs no age-based or
implicit attachment purge. A failed metadata write removes the just-written
orphan immediately; otherwise retention is deterministic and never tied to
article resource cleanup.

An attachment enters the Site only when the Agent explicitly calls the
`import_attachment` mutation tool with a destination. Approval or YOLO and the
same Site lock apply. Article resource uploads are a different flow; see
[Manage article resources](../assets/).

### Main language model

Blog Studio deliberately uses Pi's native provider and model configuration
instead of translating it into a second application-specific model schema. The
runtime directory defaults to `agent-runtime` beside the Studio SQLite file;
override it with `BLOG_STUDIO_AGENT_RUNTIME_DIRECTORY`. Provision Pi's
`auth.json`, `models.json`, and `settings.json` there as operator-owned files.
That keeps built-in providers, OpenAI-compatible proxies, model selection,
compaction, and future Pi upgrades on one compatibility path. This directory is
outside the Site and inaccessible to Agent file tools.

The main language model must support tool calling. The production CLIProxy is
configured as an Anthropic Messages-compatible provider in Pi's `models.json`;
Pi's `settings.json` selects `glm-5.2`. Credentials belong in a mode-0600
`auth.json`, never in Site YAML, Compose environment values, or chat context.
The runtime directory must be owned by the Studio UID/GID with mode `0700`, and
all three JSON files must be owned by the same identity with mode `0600`.

Configure an OpenAI-compatible vision endpoint, including a CLIProxy route to a
MiniCPM-V model, with:

```sh
BLOG_STUDIO_VISION_ENDPOINT=http://cliproxy.internal/v1/chat/completions
BLOG_STUDIO_VISION_MODEL=minimax-m3
BLOG_STUDIO_VISION_API_KEY_FILE=/run/secrets/vision_api_key
```

`BLOG_STUDIO_VISION_API_KEY` is also accepted, but the supplied Compose contract
uses an owner-only mode-0600 host file mounted read-only at the path above. Set
`BLOG_STUDIO_VISION_API_KEY_PATH` to that host file and never put its contents in
`.env`. Without an endpoint, image upload still works and vision reports an
explicit unconfigured state.

## Cancel, reconnect, and recover

Turns expose queued, running, waiting-for-approval, completed, failed, canceled,
and restart-interrupted states. Cancel preserves already completed tool audits,
stops remaining model work, releases the writer lock, and never reports success.
The event stream reconnects from a durable cursor or returns an explicit
terminal snapshot, so messages and tool events are not duplicated.

Before upgrades, back up SQLite plus `agent-sessions` and `agent-attachments`
as one versioned data set; protect Pi runtime configuration separately with
other operator secrets. See [Backup and
restore](../../operations/backup-restore/) and
[Troubleshooting](../../operations/troubleshooting/).
