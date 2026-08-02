# Release orchestration verification — 2026-08-02

## Scope

This evidence covers the provider-independent release engine, local filesystem
publisher, Tencent COS publisher contract, Tencent CDN/EdgeOne cache contract,
SQLite release history, Studio API, and release timeline UI. It does not claim a
real Tencent account or production-domain release; those remain staging gates.

## Reproducible gate

Run from the repository root:

```sh
CI=true corepack pnpm exec prettier --check .
CI=true corepack pnpm exec turbo run lint typecheck test build --output-logs=errors-only
```

Observed result: 64 of 64 tasks succeeded across 16 packages.

## Verified invariants

| Invariant                                                        | Executable evidence                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| One active release per workspace/target                          | `packages/persistence/test/releases.test.ts` partial unique-index test |
| A preparation or build failure never calls a publisher           | `packages/release/test/orchestrator.test.ts` failure tests             |
| Identical generated content performs no provider/cache operation | release manifest and orchestrator no-op tests                          |
| Immutable assets precede pages                                   | orchestrator call-order test and phased filesystem publisher test      |
| Source bytes are verified before target mutation                 | filesystem publisher corruption test                                   |
| COS planning has no per-object HEAD fan-out                      | COS fake client observes zero remote calls during `plan()`             |
| Provider completion waits for every bounded worker               | COS injected failure settles with zero active workers                  |
| Changed index, feed, and sitemap URLs enter invalidation         | orchestrator cache-input assertion                                     |
| Purge completion is polled to success/failure                    | Tencent cache provider tests                                           |
| Public proof binds release ID, random token, and manifest hash   | marker verifier input assertion and bounded HTTP verifier              |
| Partial publish and post-mutation cancellation roll back         | orchestrator fault-injection tests                                     |
| Exact prior bytes and deleted files are restored                 | filesystem and COS rollback tests                                      |
| Browser draft version is the content actually published          | Studio API end-to-end test reads the published generated page          |
| Timeline survives request completion                             | SQLite stages/events and Studio release-detail API tests               |

## Product UI review

A production Studio build was run against a synthetic one-article Hexo workspace
and an isolated filesystem target. The complete browser journey reached a green
release proof containing all seven stages, provider events, public-marker proof,
and online rollback controls. The proof remained available after reload. The same
release was inspected at 390 × 844: article/write/proof navigation, timeline,
log, and controls remained readable without horizontal overflow. Browser console
inspection reported no warning or error.

This review also exposed and fixed an initialization defect: Crepe's first
Markdown normalization event was being treated as an author edit, creating a
draft just by opening an article. Initialization is now ignored; a subsequent
reload produced no autosave request.

## Tencent API constraints encoded

- Classic CDN URL purge requests are split at 1,000 URLs and directory purge
  requests at 500 paths, matching Tencent Cloud's
  [PurgeUrlsCache](https://cloud.tencent.com/document/api/228/37870) and
  [PurgePathCache](https://cloud.tencent.com/document/product/228/37871)
  contracts.
- EdgeOne uses `CreatePurgeTasks`, requires `ZoneId`, and keeps its batch size
  plan-configurable because limits vary by plan. See
  [CreatePurgeTasks](https://cloud.tencent.com/document/api/1552/80703) and the
  [EdgeOne purge guide](https://cloud.tencent.com/document/product/1552/70759).
- Both modes require task-status confirmation rather than treating submission as
  completion. The production SDK client wiring and account-level quota check are
  intentionally deferred to the Tencent staging gate.

## Remaining gates

- Wire real COS/CDN credentials through server-only secret references.
- Run against an isolated Tencent prefix/domain and inject network/cache failures.
- Prove cold-restart rollback against persisted provider state.
- Inventory legacy public URLs before and after the controlled production cutover.
- Reduce the lazily loaded visual-editor chunk before claiming the home-LAN
  interactive-time performance gate.
