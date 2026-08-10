# Site Agent Platform Design

**Status:** Accepted direction; core Pi feasibility verified.

The consolidated finish-line Goal and evidence requirements are tracked in the
[AI-assisted production checklist](../checklists/site-agent-ai-assisted-production.md),
accepted by the owner on 2026-08-10.

## Goal

Extend the existing Blog Studio Web application through AI-assisted production.
The finish line is a Site-scoped Agent that can understand context, edit the
whole website workspace, manage several durable sessions, review or automatically
apply permitted changes, and interpret uploaded images. Autonomous publishing,
general shell access, multi-user collaboration, and cloud execution are outside
this scope.

## Product model

```text
Blog Studio Web application
  Site
    filesystem workspace
    preview URL/profile
    drafts and ChangeSets
    Agent sessions
      messages
      one-turn context attachments
      uploaded attachments
      tool calls and approvals
```

`Site` remains the root product object. `Workspace` remains its trusted checkout.
The Agent is a Site capability, not a new application architecture. A page adds
context but never owns a Session.

## Interaction model

The Agent panel is mounted above the application router and remains available on
the library, editor, preview, ChangeSet, Site, and settings surfaces. Switching
pages preserves the current Session. Switching Sites changes the available
Session list and the workspace root.

Every browser tab carries an explicit `siteId` in its URL. Preview state and
`previewUrl` are resolved from that Site, preventing several tabs or several
Sites from sharing a transient global preview destination. The active Session
selection is tab-local; Session data itself is durable and visible in every tab
for the same Site.

Session management includes create, rename, switch, archive, restore, and list
active/archived sessions. Archive hides and freezes a Session without deleting
messages or attachments.

The editor contributes the current article path, document identifier, title,
and editor state to each submitted message. The Agent reads current content from
the workspace. An unsaved buffer may be attached as a one-turn snapshot rather
than copied into every message.

Selecting Markdown exposes an `Ask Agent` action. The selection appears as a
removable composer chip. Submission materializes its source path, range, content,
and fingerprint into that user message once. It remains in history but is not
automatically attached to later messages.

## Runtime and tools

Pi is embedded in the existing Studio Node.js server through a thin TypeScript
adapter. The adapter owns creation, cancellation, event streaming, model choice,
and reconstruction of Agent sessions. It does not own the workspace.

Allowed tools are:

- Pi filesystem inspection and mutation tools constrained to the Site root;
- structured Git inspection: status, diff, log, and show;
- bounded Git recovery: explicit-path restore and reversal of changes attributable
  to the current Agent turn;
- page-specific helper tools that add ergonomic Site knowledge without reducing
  whole-workspace authority.

Pi's general `bash` tool is absent. There is no arbitrary command string, command
interpolation, hook execution, remote Git mutation, `git clean`, or whole-repo
`reset --hard`.

Direct Agent edits have normal filesystem semantics. Existing draft source
revision checks detect stale working copies. Blog Studio does not maintain a
trash directory or a special backup for untracked files.

## Approval and concurrency

Two modes are visible in the Agent composer:

- `approval`: each mutating tool call shows the operation, target paths, and
  available diff before execution;
- `yolo`: permitted mutations execute immediately.

Read, list, and search operations do not prompt. Hard path and tool boundaries
apply in both modes.

Effective preference resolution is:

```text
Session override > Site override > global default
```

Global and Site preferences are durable. A Session override is also persisted
with that Session but does not change sibling sessions.

One writer lock exists per Site. Different Sites may run concurrently. Several
Sessions within one Site may stream or perform read-only work, but mutating turns
serialize behind the same Site lock.

## Persistence decision

Blog Studio already uses SQLite for owner sessions, Sites, drafts, ChangeSets,
configuration history, jobs, and audit evidence. Pi natively uses JSONL session
trees. Maintaining both as writable transcript stores is rejected.

Pi-owned JSONL is the sole conversation transcript. SQLite stores the Site link,
name, archive state, preferences, attachment references, approval/audit indexes,
and Pi session-file identity. It does not duplicate message bodies.

The POC found that the public Pi SDK takes a concrete `SessionManager` whose
append-only JSONL tree owns compaction, tool results, model changes, branches,
and migrations. A Studio-owned SQLite transcript would therefore reproduce Pi
internals and create an upgrade-sensitive compatibility layer. Keeping metadata
in SQLite and transcripts in Pi's native format is the simpler persistent model;
backup and migration treat both stores as one application data set.

## Attachment and vision flow

Chat uploads first enter application attachment storage outside the Site root.
An `Attachment` stores message ownership, filename, MIME type, size, disk path,
and processing state. It is not an article resource.

Images are sent to a separately selected vision model. The original image and
the resulting OCR/description are stored on the same user message. Vision
failure does not discard the upload or block the text conversation; the user can
retry. Copying an attachment into the Site is an explicit Agent file operation
and follows the active approval mode.

## Article resources and image processing

The existing resource pipeline remains the article upload feature. It validates
files, stores them through the Site AssetProvider, creates portable Markdown,
and freezes referenced assets into ChangeSets. Local and COS-backed Sites keep
their current provider semantics.

Image processing becomes opt-in. The per-Site policy is conceptually:

```yaml
resources:
  images:
    enabled: false
    format: original
    quality: 80
    maxWidth: 2560
    stripMetadata: false
```

With processing disabled, the upload preserves bytes, format, extension, and
metadata. Content-addressed naming may still add a digest. When enabled, format,
quality, resize, and metadata behavior are explicit. Existing resources are
never recompressed automatically.

## Failure behavior

- Path escape or a forbidden tool returns a typed failure and performs no work.
- A stale editor draft uses the existing revision-conflict experience.
- A busy Site writer lock queues or rejects the new mutating turn visibly.
- A canceled run records completed tool calls and a terminal canceled state.
- Vision failures retain the original attachment.
- A process restart recovers durable sessions without replaying completed tools.
- A deleted untracked file has no Studio recovery promise.

## POC acceptance

The core POC demonstrates items 1–4, 6, and the persistence/context mechanics
of 5, 7, and 8. The remaining production acceptance work is tracked in the
implementation plan:

1. Pi SDK creation inside the Studio process without spawning the CLI.
2. A tool allowlist that includes filesystem tools but excludes `bash`.
3. Direct edits below two independent temporary Site roots with path escape
   rejection.
4. Per-Site writer serialization and cross-Site independence.
5. Session create, append, restart, resume, archive metadata, and event replay
   from one transcript source of truth.
6. Effective global/Site/Session approval preference resolution.
7. User message content containing one-turn article, selection, and attachment
   references without accidental reinjection.
8. Image-content compatibility and a replaceable vision-model adapter boundary.
9. No writes to the public Site, publish target, or remote Git state.

The POC records the chosen persistence approach and discarded alternative in a
verification document before production migrations are designed.

## Roadmap and external presentation

Phase 5 finishes public presentation before Agent claims are added:

- rebuild the existing Astro/Starlight `apps/website` from verified journeys;
- deploy it through GitHub Pages;
- record a short README GIF once the relevant journey is stable;
- show Site selection, article editing, direct preview, ChangeSet review, and
  later the verified Agent journey without advertising unfinished behavior.

Phase 6 stops at AI-assisted production. Publishing remains an explicit human
operation through the existing release workflow.
