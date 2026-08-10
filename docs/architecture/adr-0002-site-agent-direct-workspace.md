# ADR-0002: Embed Pi with Site-scoped direct workspace tools

## Status

Accepted; core feasibility verified by POC on 2026-08-10

## Context

Blog Studio is already a self-hosted Web application whose user-facing root is
a `Site`. Each Site points to one trusted filesystem workspace and already owns
content, preview configuration, drafts, ChangeSets, publishing, and audit
records. AI is an additional product capability; it must not replace the Web
application, move workspace ownership into a preview server, or introduce an
independent Agent service.

The desired experience is closer to Cursor than to a page-local writing
assistant. An Agent panel can be opened anywhere in Studio. Its sessions belong
to the current Site, survive article navigation, and may inspect or modify any
file below that Site's workspace root. An editor page contributes the current
article reference, but does not narrow the Agent's workspace scope.

Pi is the selected runtime. Pi provides an embeddable TypeScript SDK, sessions,
model selection, streaming events, file tools, and extension points. Giving the
model an unrestricted shell would expand the security boundary far beyond the
product requirement, while recreating every file operation behind a Blog Studio
capability API would duplicate Pi and make the integration unnecessarily
complex.

## Decision

Embed the Pi SDK in the existing Studio server process behind a thin
`AgentRuntime` adapter. A runtime instance receives the selected Site's
workspace root as its `cwd`. Because Pi file tools accept absolute paths, `cwd`
is not itself a security boundary. Blog Studio wraps every enabled Pi file-tool
definition with lexical and symlink-aware Site-root validation before Pi
executes it.

Enable Pi's filesystem tools for paths below that workspace root. Do not expose
Pi's general `bash` tool. Add fixed-shape Git tools for inspection and bounded
recovery; the model cannot supply an arbitrary executable or free-form argument
list. Initial Git tools are `status`, `diff`, `log`, `show`, path-scoped restore,
and reversal of the current Agent change. Commands such as `clean`, unrestricted
`reset --hard`, remote mutation, hooks, aliases, and configuration changes are
not available.

There is no special recovery layer for untracked files. A permitted delete has
normal filesystem semantics. Approval mode asks before every mutation; YOLO
mode executes permitted mutations immediately. Both modes retain workspace path
checks, structured tool schemas, a per-Site writer lock, and audit records.

Studio's existing draft revision checks remain authoritative. Direct Agent
edits are treated like changes from another trusted filesystem editor. If a
stored draft is based on an older source revision, Studio reports its existing
revision conflict rather than redirecting Pi through a second workspace API.

Agent sessions are Site-scoped, not page- or document-scoped. Multiple sessions
may be created and archived. The active Session may differ between browser tabs,
but every tab resolves preview state and Agent sessions through its explicit
`siteId`.

## Persistence

Pi JSONL is the transcript source of truth. Pi exposes `SessionManager` as a
concrete append-only JSONL session tree rather than a persistence interface. The
POC confirmed that custom one-turn context, image content, and history survive a
JSONL reopen. Replacing this with SQLite would require reproducing Pi's tree,
compaction, model-change, tool-result, and migration semantics.

Studio SQLite stores only product metadata: Site association, display name,
archive state, preference overrides, attachment references, approval/audit
indexes, and the Pi session-file identity. It does not mirror message bodies or
become a second writable transcript.

Global defaults, Site overrides, and Session overrides determine the effective
approval mode in that order of increasing priority. Model identifiers follow the
same ownership model where useful, but credentials stay in Pi/CLIProxy-managed
configuration or environment variables and are never stored as plaintext in the
Studio database.

## Context and attachments

Editor messages automatically carry a reference to the current article. Pi can
read its latest filesystem content. A dirty editor buffer may be attached as a
one-turn snapshot. An explicit Markdown selection is stored on exactly one user
message with its source path, range, text, and content fingerprint; history keeps
that snapshot, but later messages do not silently re-inject it.

Chat uploads are `Attachment` records stored outside the Site workspace until
the Agent explicitly copies them into the Site. Image attachments are interpreted
through a separately configured vision model, such as a MiniCPM-V endpoint behind
CLIProxy. The original attachment and derived interpretation remain associated
with the originating message.

## Resource uploads

Existing article resource uploads remain distinct from Agent attachments. They
continue to use the configured AssetProvider and may therefore be local or
remote. `ResourceRecord` is an upload result, not a second persistent resource
database.

New image uploads preserve original bytes, format, and metadata by default.
Image processing is an explicit per-Site setting. When enabled, the owner may
choose original-format or WebP output, quality, maximum width, and metadata
stripping. The policy affects new uploads only and never rewrites existing
resources automatically.

## Consequences

### Positive

- Agent capability is added without replacing the existing Web architecture.
- Pi retains its flexible file-management ecosystem while the shell boundary
  stays small and reviewable.
- Sessions and context follow the Site naturally across pages.
- Existing preview, draft conflict, ChangeSet, Git, and resource behavior remain
  available rather than being reimplemented for AI.

### Negative

- YOLO mode can permanently delete an untracked file.
- A direct Agent edit can invalidate an existing editor draft and require the
  user to resolve the normal revision conflict.
- A Site-scoped writer lock limits concurrent Agent mutation even when several
  sessions are open.
- Session backup and migration must preserve Pi JSONL alongside the Studio
  database.

## Rejected alternatives

- **Agent owned workspace or preview server:** duplicates the Site workspace and
  confuses preview lifecycle with Agent execution.
- **Independent Agent service:** adds deployment, authorization, cancellation,
  and synchronization cost to a single-node product.
- **Unrestricted shell:** provides substantially more authority than required.
- **Capability-only filesystem facade:** duplicates Pi file tools and blocks the
  desired whole-project workflow.
- **Automatic trash or untracked-file backup:** adds lifecycle and cleanup state
  that the owner explicitly chose not to maintain.

## Verification gate

The core feasibility gate passed: SDK embedding is offline-initializable, the
active tool set excludes `bash`, path traversal and symlink escape are rejected,
Pi JSONL reopens typed context and image messages, writer locks serialize per
Site, and approval precedence is deterministic. Streaming/cancellation, the
structured Git surface, and production SQLite metadata remain implementation
acceptance work. See `docs/verification/site-agent-pi-poc.md`.
