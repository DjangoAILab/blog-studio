# Site Agent Pi POC verification

**Date:** 2026-08-10

**Pi package:** `@earendil-works/pi-coding-agent@0.84.1`
**Result:** Core architecture is feasible; proceed with the staged implementation plan.

## Verified

- The Pi SDK creates an Agent Session inside the Blog Studio Node.js process
  without spawning a CLI and without making a model request.
- Session subscriptions emit start/end/settled lifecycle events under a local
  fake provider, and abort stops the active stream. Pi records the raw abort as
  an error message with `This operation was aborted`; the Studio runtime must
  normalize that result to its durable `canceled` terminal state.
- The active filesystem tools are `read`, `write`, `edit`, `grep`, `find`, and
  `ls`; `bash` is absent. Fixed-shape local Git inspection tools are added by
  the production boundary without introducing a command-string channel.
- Pi's built-in path schema accepts absolute paths, so `cwd` alone is not a
  boundary. Wrapping Pi's tool definitions before execution preserves Pi
  behavior while rejecting `..`, absolute-path, and symlink escapes.
- `SessionManager` persists an append-only JSONL tree and reopens it with the
  same session identity. A Markdown selection remains one typed custom message
  in history and model context rather than being reinjected into later messages.
- Text plus image content and attachment metadata round-trip through the same
  session representation, leaving the vision provider replaceable.
- Approval preference resolution is `Session > Site > global`.
- A writer lock serializes mutations within one Site while independent Sites
  continue concurrently.

The executable POC lives in `packages/agent-runtime-pi`. Its tests use temporary
directories only and make no network request or remote Git mutation.

## Persistence decision

Use Pi JSONL as the sole transcript source of truth. Use Studio SQLite for
product metadata only: Site association, title, archive state, preferences,
attachments, approvals/audit indexes, and the Pi session-file identity.

The public Pi SDK accepts a concrete `SessionManager`; it does not expose a
generic transcript storage interface. Reconstructing its session tree in SQLite
would duplicate branching, compaction, model changes, tool results, migrations,
and recovery behavior. Mirroring messages into both stores is also rejected.

Operationally, the SQLite database, Pi session directory, and attachment store
form one backup/migration unit.

## Commands and results

```text
pnpm --filter @blog-studio/agent-runtime-pi test
  3 files passed; 16 tests passed

pnpm --filter @blog-studio/agent-runtime-pi typecheck
  passed

pnpm --filter @blog-studio/agent-runtime-pi build
  passed
```

Dependency installation explicitly disables install scripts for `@google/genai`
and `protobufjs`; the existing reviewed `esbuild` and `sharp` allowances remain
unchanged. The POC does not require the newly denied scripts.

## Production follow-through

The production work identified by this POC is now implemented and mapped in the
[AI-assisted production checklist](../checklists/site-agent-ai-assisted-production.md).
Runtime/API, policy, context/vision, original-resource, browser, and recovery
evidence lives beside this record in `docs/verification/`.
