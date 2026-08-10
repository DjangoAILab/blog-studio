# Site Agent AI-assisted production checklist

**Status:** Accepted by owner on 2026-08-10

**Scope:** Blog Studio project finish line

**Source design:** [Site Agent platform design](../plans/2026-08-10-site-agent-platform-design.md)
**Execution plan:** [Site Agent implementation plan](../plans/2026-08-10-site-agent-platform.md)

A checked item is valid only when it links to a focused automated test, browser
recording, migration fixture, command output, or real-environment observation.
Passing a broad test suite does not replace evidence for the behavior named by
the item.

## Verifiable goal

Without changing Blog Studio's existing Web application architecture, deliver a
Site-scoped Agent that can be opened from any page, keeps multiple durable
Sessions across page and article navigation, understands explicit one-message
context and uploaded images, and can inspect or modify the complete Site
filesystem workspace through bounded tools. The owner can choose per-mutation
approval or YOLO execution, inspect resulting filesystem and Git changes, and
retain human control of publishing. The project is presented honestly through a
verified documentation site and README recording.

The goal is achieved only when one reproducible acceptance journey proves all of
the following:

1. Open Site A and Site B in separate tabs; each URL, preview destination, and
   Session list remains bound to the correct explicit `siteId`.
2. Create two Sessions for Site A, switch articles and application pages, then
   return to either Session without losing its history or Site scope.
3. From an editor, attach the current article and one selected Markdown range.
   The selection appears in exactly one submitted message and remains visible in
   history without being injected into the next message.
4. Upload an image to chat attachment storage, receive a result from the
   separately configured vision adapter, and retain both the original and the
   derived interpretation on the originating message.
5. In approval mode, a proposed file mutation performs no write until approval;
   after approval, the expected Site file and reviewable diff change.
6. In YOLO mode, another permitted mutation runs without an approval prompt but
   produces the same audit evidence and remains inside the Site root.
7. Absolute paths, `..`, symlink escape, general shell, free-form Git arguments,
   remote Git mutation, `git clean`, and whole-repository hard reset are rejected
   without side effects.
8. Two mutating Sessions for Site A serialize behind one writer lock while a
   permitted mutation or read on Site B can proceed independently.
9. Archive and restore a Session, restart Studio, and resume it without replaying
   completed tools or losing message, attachment, approval, and terminal-state
   evidence.
10. Upload an image through the article resource flow with no compression policy
    and prove byte, format, extension, and metadata preservation. Enable a Site
    policy and prove only new uploads follow its explicit format, quality,
    maximum-width, and metadata choices.
11. Review the resulting local Git status/diff and perform one bounded,
    path-specific recovery operation. No public Site, publish target, or remote
    repository is changed by the Agent journey.
12. Complete the journey using the published Astro/Starlight documentation and
    show its stable core in a readable 20–30 second README GIF.

## Owner confirmation gate

These boxes confirm the consolidated product direction, not implementation
completion. The owner confirmed the complete gate on 2026-08-10.

- [x] **Finish line:** this project stops at AI-assisted production plus honest
      public documentation; autonomous publishing, a hosted Agent, and
      multi-user collaboration remain outside the goal.
- [x] **Product scope:** `Site` is the Agent and Session owner. The Agent follows
      Site navigation rather than a page or article; editor pages only add
      current-article context.
- [x] **Workspace authority:** the Agent may manage the complete filesystem below
      the existing Site workspace root. The preview/dev server only opens the
      configured preview port and owns no Agent responsibility.
- [x] **Execution boundary:** Pi file tools remain the base, general shell is
      absent, and Git is exposed only through fixed structured operations.
      Approval and YOLO share the same hard boundary.
- [x] **Recovery policy:** there is no special trash or backup for an untracked
      file deleted by a permitted operation; Git remains the normal recovery
      mechanism for tracked files.
- [x] **Session model:** multiple Sessions can be created, renamed, switched,
      archived, restored, and resumed; Session data belongs to one Site while
      active Session selection may remain tab-local.
- [x] **Persistence model:** Pi JSONL is the sole transcript source; SQLite stores
      Site association, archive/preferences, attachment references, and
      approval/audit indexes without duplicating message bodies.
- [x] **Context model:** article, editor buffer, Markdown selection, diff,
      preview error, ChangeSet, file, and image are explicit one-message
      attachments rather than silently persistent prompt state.
- [x] **Upload model:** chat attachments start outside the Site workspace and
      enter it only through an explicit file operation; article resources remain
      the existing separate AssetProvider flow.
- [x] **Image policy:** article image uploads preserve the original by default;
      compression/conversion is optional per Site, applies only to new uploads,
      and never bulk-rewrites existing resources.
- [x] **Multi-Site preview:** preview compatibility continues to use the existing
      direct URL/port model; explicit `siteId` prevents tabs and Sites from
      sharing the wrong preview destination.
- [x] **Presentation:** the existing Astro/Starlight site is the documentation
      base, GitHub Pages is the publishing target, and README media is recorded
      only from a stable verified journey.

## 0. Feasibility gate

- [x] Pi SDK initializes inside the Studio Node.js process without spawning its
      CLI or making a model request. Evidence:
      [Pi POC verification](../verification/site-agent-pi-poc.md).
- [x] The Pi tool set contains `read`, `write`, `edit`, `grep`, `find`, and `ls`
      but not `bash`. Evidence:
      [Pi POC verification](../verification/site-agent-pi-poc.md).
- [x] Lexical, absolute-path, and symlink escapes are rejected before Pi tool
      execution. Evidence:
      [Pi POC verification](../verification/site-agent-pi-poc.md).
- [x] Pi JSONL reopens one-message Markdown and image content, making it viable
      as the single transcript store. Evidence:
      [Pi POC verification](../verification/site-agent-pi-poc.md).
- [x] Approval preference precedence and per-Site writer serialization have
      executable tests. Evidence:
      [Pi POC verification](../verification/site-agent-pi-poc.md).

## 1. Runtime and durable Session metadata

- [x] The Studio server owns a thin `AgentRuntime` adapter for create, resume,
      stream, cancel, and dispose; no separate Agent service or CLI process is
      required. Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] SQLite migrations store Site association, Pi session identity, display
      name, archive state, timestamps, effective overrides, attachment links,
      and audit indexes without storing a second transcript. Evidence:
      [Agent persistence verification](../verification/site-agent-persistence.md).
- [x] Session create, rename, list, switch, archive, restore, and cold-restart
      resume have focused repository and API tests. Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] Backup and restore treat SQLite, the Pi session directory, and attachment
      storage as one versioned operational data set. Evidence:
      [Agent persistence verification](../verification/site-agent-persistence.md).
- [x] A missing, corrupt, incompatible, or orphaned Pi JSONL file produces an
      actionable state and never silently starts a replacement conversation.
      Evidence:
      [persistence verification](../verification/site-agent-persistence.md).

## 2. Tool authority, approval, and recovery

- [x] Every Pi filesystem tool validates the resolved canonical Site root,
      including non-existent write targets and symlinked ancestors. Evidence:
      [Site Agent tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] Structured Git tools implement only status, diff, log, show, explicit-path
      restore, and reversal attributable to the current Agent turn. Evidence:
      [tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] General shell, arbitrary executable/argument strings, hooks, aliases,
      configuration mutation, remote Git mutation, clean, and whole-repository
      hard reset have negative tests proving they are unreachable. Evidence:
      [Site Agent tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] Read/list/search tools run without approval. Every filesystem or Git
      mutation in approval mode waits for a durable decision before execution.
      Evidence:
      [tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] YOLO bypasses prompts only; it does not bypass path, tool, Site-lock,
      authentication, audit, or redaction policy. Evidence:
      [tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] Effective mode resolves as `Session > Site > global`, persists at each
      supported scope, and is always visible in the composer before submission.
      Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] The UI states clearly that a permitted YOLO deletion of an untracked file
      may be irreversible in Blog Studio. Evidence:
      [browser journey](../verification/site-agent-browser-journey.md).
- [x] Existing editor draft revision checks surface a conflict when direct Agent
      edits make a stored working copy stale. Evidence:
      [tool-policy verification](../verification/site-agent-tool-policy.md).

## 3. Concurrency, streaming, and restart behavior

- [x] One writer lock serializes all mutating Agent turns for one Site,
      regardless of Session; different Sites and read-only work remain
      independently runnable. Evidence:
      [Site Agent tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] Queued, running, waiting-for-approval, completed, failed, canceled, and
      interrupted states have durable terminal semantics and visible UI states.
      Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] Cancel records completed tool calls, stops remaining work, releases the
      Site lock, and does not report the turn as completed. Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] Restart recovery never replays an already completed or approved mutation.
      Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] Streaming reconnect resumes from an event cursor or returns an explicit
      terminal snapshot without duplicating message/tool entries. Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] Tool inputs, outputs, model errors, and audit logs redact credentials,
      authorization headers, configured secrets, and attachment storage paths
      where appropriate. Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).

## 4. Context, attachments, and vision

- [x] Agent submission contracts support article reference, dirty editor-buffer
      snapshot, Markdown selection, preview error, diff, ChangeSet, file, image,
      and attachment references with size limits and typed validation. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).
- [x] The editor automatically proposes its current article context without
      narrowing the Session's whole-Site workspace authority. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).
- [x] Every composer chip can be inspected and removed before send; materialized
      context remains on only the originating message. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).
- [x] Chat uploads use application attachment storage outside the Site root with
      MIME sniffing, filename sanitization, byte limits, ownership checks, and
      deterministic cleanup/retention rules. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).
- [x] Copying a chat attachment into the Site is an explicit mutating tool call
      governed by approval/YOLO and the Site writer lock. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).
- [x] A replaceable vision adapter supports a separately configured model such
      as MiniCPM-V through CLIProxy without coupling the main text model to that
      provider. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).
- [x] Vision failure retains the original image and text message, exposes retry,
      and never invents a successful interpretation. Evidence:
      [context/attachment/vision verification](../verification/site-agent-context-attachments-vision.md).

## 5. Global UI and multi-Site behavior

- [x] The Agent panel is mounted outside page-specific routes and can be opened
      from library, editor, preview, ChangeSet, Site, and settings pages.
      Evidence: [browser journey](../verification/site-agent-browser-journey.md).
- [x] Page/article navigation preserves the active Site Session; Site switching
      selects only Sessions belonging to the new Site. Evidence:
      [browser journey](../verification/site-agent-browser-journey.md).
- [x] URLs carry explicit `siteId`; reload, browser navigation, deep links, and
      two-tab use restore the correct Site and preview destination. Evidence:
      [browser journey](../verification/site-agent-browser-journey.md).
- [x] The active Session may differ by tab without changing Session ownership or
      hiding updates made by another tab for the same Site. Evidence:
      [browser journey](../verification/site-agent-browser-journey.md).
- [x] Session management, context chips, approval prompts, streaming output, and
      typed errors work with keyboard, screen reader, mobile reflow, reduced
      motion, and increased contrast. Evidence:
      [browser journey](../verification/site-agent-browser-journey.md).

## 6. Original-first article resources

- [x] With no image-processing configuration, new article uploads are stored
      byte-for-byte with original format, extension, and metadata. Evidence:
      [original-resource verification](../verification/site-agent-original-resources.md).
- [x] Per-Site settings explicitly control enabled state, original/WebP format,
      quality, maximum width, and metadata stripping with validated limits.
      Evidence:
      [original-resource verification](../verification/site-agent-original-resources.md).
- [x] Optional processing affects new uploads only; existing local and remote
      resources are never recompressed or renamed automatically. Evidence:
      [original-resource verification](../verification/site-agent-original-resources.md).
- [x] Local filesystem and COS AssetProviders retain their existing storage,
      portable Markdown, protected-prefix, and ChangeSet-freezing semantics.
      Evidence:
      [original-resource verification](../verification/site-agent-original-resources.md).
- [x] `ResourceRecord` remains an upload result rather than a new persistent
      resource entity, and Agent attachments remain a separate data model.
      Evidence:
      [original-resource verification](../verification/site-agent-original-resources.md).

## 7. Security and end-to-end acceptance

- [x] Owner authentication, CSRF, origin, request-size, rate, and Site ownership
      controls protect every Agent API and streaming endpoint. Evidence:
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] Adversarial tests cover prompt-requested path escape, shell execution,
      remote mutation, secret reads, cross-Site access, approval bypass, symlink
      races, duplicate events, and restart replay. Evidence:
      [tool-policy verification](../verification/site-agent-tool-policy.md).
- [x] The complete 12-step goal journey passes against disposable Site fixtures
      and records screenshots/video, session IDs, event IDs, file hashes, diffs,
      and test commands without secrets. Evidence:
      [browser journey](../verification/site-agent-browser-journey.md) and
      [runtime/API verification](../verification/site-agent-runtime-api.md).
- [x] `CI=true corepack pnpm@11.18.0 check`, formatting, Studio browser E2E, and
      the documentation build/link checker pass at the same reviewed revision.
      Evidence:
      [documentation/recovery verification](../verification/site-agent-docs-and-recovery.md).
- [x] A production-like backup/cold-restart/restore exercise resumes archived and
      active Sessions without changing either Site workspace unexpectedly.
      Evidence:
      [documentation/recovery verification](../verification/site-agent-docs-and-recovery.md).

## 8. Documentation and project closure

- [x] `apps/website` documents Agent concepts, Site/Session ownership, approval
      versus YOLO, file/Git authority, attachments, vision configuration,
      persistence/backup, recovery limits, and troubleshooting. Evidence:
      [documentation/recovery verification](../verification/site-agent-docs-and-recovery.md).
- [x] The existing Astro/Starlight site deploys through GitHub Pages with valid
      base paths, navigation, search, accessibility, mobile layout, and internal
      links. Evidence:
      [documentation/recovery verification](../verification/site-agent-docs-and-recovery.md).
- [x] README contains an optimized, readable 20–30 second GIF recorded from the
      verified journey and does not claim unfinished or unverified behavior.
      Evidence: [browser journey](../verification/site-agent-browser-journey.md).
- [x] Public documentation distinguishes Agent file changes, ChangeSet review,
      local Git operations, and the separately human-triggered release workflow.
      Evidence:
      [documentation/recovery verification](../verification/site-agent-docs-and-recovery.md).
- [x] Roadmap marks AI-assisted production complete only after every required
      item above has reproducible evidence; autonomous publishing and deferred
      ecosystem work remain unchecked and outside the release claim. Evidence:
      [documentation/recovery verification](../verification/site-agent-docs-and-recovery.md).

## Evidence index

- [Core Pi feasibility](../verification/site-agent-pi-poc.md)
- [Agent metadata persistence](../verification/site-agent-persistence.md)
- [Production Session/runtime API verification](../verification/site-agent-runtime-api.md)
- [Tool policy and structured Git](../verification/site-agent-tool-policy.md)
- [Context, attachment, and vision verification](../verification/site-agent-context-attachments-vision.md)
- [Multi-Site browser journey](../verification/site-agent-browser-journey.md)
- [Original-first resource verification](../verification/site-agent-original-resources.md)
- [Restart, backup, and documentation verification](../verification/site-agent-docs-and-recovery.md)
