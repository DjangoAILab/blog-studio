# Site Agent tool-policy verification

**Date:** 2026-08-10
**Result:** Canonical Site paths, a shared durable mutation boundary, fixed local
Git inspection/recovery, attachment import, and per-Site serialization are
implemented.

## Verified hard boundary

- Pi receives canonical paths below the real Site root, not the original
  model-supplied path. Non-existent write targets are anchored to their nearest
  real ancestor; lexical, absolute, and symlink escapes fail before execution.
- Direct access to `.git` internals is rejected. Git metadata can therefore be
  touched only through the structured surface.
- The Pi general shell is absent. The exposed local Git operations are
  `git_status`, `git_diff`, `git_log`, `git_show`, and
  `git_restore_path`, and current-turn `git_revert_agent_path`; there is no executable name, free-form argument list,
  remote mutation, clean, config mutation, or repository-wide hard reset.
- Git revision, log limit, and path inputs have bounded schemas. Git runs with
  system/global config disabled, hooks disabled, external diff/text conversion
  disabled, a fixed environment, timeout, and output limit.
- `write`, `edit`, `delete_path`, `move_path`, `import_attachment`,
  `git_restore_path`, and `git_revert_agent_path` all use one typed mutation
  runner. Deleting or moving the Site root, overwriting a destination, or
  directly mutating a symlink is rejected. Paths are revalidated after approval
  under the writer lock, closing the tested ancestor-symlink swap window.
- Current-turn reversal snapshots only a tracked regular file's pre-mutation
  bytes, verifies that its current hash is still the Agent-produced state, and
  refuses to overwrite later human work. The snapshot expires with the turn;
  it is not a trash system for untracked deletion.
- Approval and YOLO enter the same per-Site writer queue. Approval holds that
  queue until its decision, rejected work never executes, two Sessions for one
  Site serialize, and another Site proceeds independently.
- A single `SiteAgentMutationCoordinator` is constructed in the existing Studio
  server process; no Agent daemon, preview-provider responsibility, or shell
  process was added.

## Focused evidence

`packages/agent-runtime-pi/test/site-agent-policy.test.ts` covers canonical path
rewriting, `.git` protection, file mutation routing, approval rejection,
approval/YOLO serialization, independent Sites, structured Git output and
path-specific restore, attributable reversal, attachment import, an
approval-time symlink swap, invalid revisions, root restore, and traversal.

`apps/studio/server/test/site-agent-policy.test.ts` covers the final server tool
composition, negative tool availability, and the one-coordinator/many-Session
writer queue.

Durable approval decisions, YOLO audits, cancellation, restart interruption,
authentication, rate limits, public redaction, and draft conflicts are covered
by `apps/studio/server/test/agent-api.test.ts` and
`apps/studio/server/test/app.test.ts`.

```sh
corepack pnpm@11.18.0 --filter @blog-studio/agent-runtime-pi test
corepack pnpm@11.18.0 --filter studio test
```
