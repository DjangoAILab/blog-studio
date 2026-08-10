# Site Agent runtime and API verification

**Date:** 2026-08-10
**Result:** Implemented and covered by focused runtime, persistence, HTTP, and
browser tests.

## Proven boundary

- `PiSiteAgentRuntimeFactory` creates and resumes Pi inside the Studio Node.js
  process, exposes history/events/cancel/dispose, and verifies the persisted Pi
  identity before resume. There is no Agent daemon or CLI child process.
- Authenticated Site APIs create, rename, list, archive, restore, and resume
  multiple Sessions. Cross-Site IDs return not found.
- Pi JSONL remains the sole transcript. Durable SQLite turns/events cover every
  running and terminal state, approval indexes, and reconnect cursors.
- Startup terminalizes active work as interrupted, cancels pending audit rows,
  and never replays a tool. Missing, corrupt, future-version, mismatched, and
  orphaned transcripts are actionable errors rather than replacement chats.
- Approval mode resolves and persists as Session override, then Site override,
  then global default. The UI exposes all three levels and the effective source.
- Cancellation retains succeeded tool audits, terminalizes as canceled, and a
  following mutation proves the per-Site lock was released.

## Focused evidence

- `packages/agent-runtime-pi/test/agent-runtime.test.ts` — create/resume the same
  Pi identity and durable custom context.
- `packages/agent-runtime-pi/test/transcript.test.ts` — missing, corrupt, and
  incompatible classification.
- `apps/studio/server/test/agent-api.test.ts` — complete Session lifecycle,
  Site isolation, preference precedence, cancellation, durable approval/YOLO,
  SSE cursor reconnect, restart resume, and interrupted recovery.
- `apps/studio/server/test/site-agent-data.test.ts` — identity mismatch and
  orphan detection plus verified cold restore.

## Reproduce

```sh
corepack pnpm@11.18.0 --filter @blog-studio/agent-runtime-pi test
corepack pnpm@11.18.0 --filter @blog-studio/persistence test
corepack pnpm@11.18.0 --filter studio test
```
