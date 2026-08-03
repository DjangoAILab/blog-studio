# Production phase B verification — 2026-08-03

## Outcome

The adopted `blog.wj2015.com` deployment completed one controlled Blog Studio
publish and one explicit rollback. The public blog remained available throughout,
all eleven protected legacy paths retained their adopted bytes, and the final
target inventory, content inventory, marker, and sixteen sampled public resources
match the pre-publish baseline exactly.

The successful release was
`release-7a9c346a-90ba-4a2b-abaa-ba75992ec94c`. It reached `succeeded` after
marker verification, then the one requested rollback reached `rolled-back`.
There were zero active releases after the exercise. Raw durable timelines and
every monitoring sample are retained in
[`production-phase-b/publish-rollback.json`](production-phase-b/publish-rollback.json).

## Immutable inputs and runtime

- workspace: `wj2015-blog`; target: `production-v0.1`;
- adopted release: `release-085314a6-85f5-48aa-8837-3a14eec58b2a`;
- deployed protected `main` revision:
  `8d2332913085aadc32963a517657636fad8704f1`;
- image: `blog-studio:home-8d23329`, OCI revision equal to the full merge SHA;
- container: UID/GID `1000:1000`, read-only root filesystem, healthy;
- external health `200`; unauthenticated workspace access `401`;
- configuration SHA-256:
  `5523e1ac408bdaeb9c2e9c7c3ecf212700c25b2032e5b8c2d78b3fc673129e27`;
- pre-phase-B backup:
  `/home/wang/services/blog-studio/runtime/backups/blog-studio-backup-20260803T102629Z.tar.gz`,
  checksum verified and mode `0600`;
- prior images and pre-upgrade `.env` files remain available on the server.

The legacy GitHub Actions publisher remains manual-only, so it could not run
concurrently with this exercise.

## Separate writer identity

- API-only CAM user: `blog-studio-production-writer-v01`;
- CAM account ID: `100051300505`; console user path ID: `26361309`;
- custom policy: `BlogStudioProductionWriterV01`, policy ID `281403618`,
  active version `1`;
- no console login, groups, preset policies, account bucket listing, wildcard COS
  actions, bucket configuration, EdgeOne action, or `PurgePathCache` permission;
- allows only the configured target/state reads, ordinary target/state writes,
  explicit protected exact/descendant write denies, `PurgeUrlsCache`, and
  `DescribePurgeTasks`.

The generated policy and CAM read-back compared equal before activation. The
writer probe proved target/state listing, protected-object read, state
put/get/delete with cleanup, and denial outside the configured prefixes. A CAM
management call was separately denied. The one-time credential CSV was removed
from both the workstation and server after the values were installed directly
as mode-`0600` Docker secret files.

The writer key is retained as the operating production credential. Its first
scheduled rotation is **2026-11-01** (within 90 days), or immediately after any
suspected exposure. Rotation requires overlapping old/new probes, a Studio-only
restart, and removal of the old key after health and read-only plan gates pass.

The adoption CAM user and policy remain unchanged for audit history. Its
superseded API key is not part of the running Studio configuration, but its
disable operation is still open: the Tencent console session expired while the
request remained asynchronous, and an isolated read-only COS probe still
returned `200`. The signed release remains gated until a renewed console
session reports the key disabled and the same probe is rejected. No account,
policy, group, or public object was changed while diagnosing that delay.

## Plan and safe planning rejection

The final authenticated isolation plan generated 1,963 objects, preserved eleven
protected baseline objects, and produced an effective 1,974-object manifest:

| Plan field               |     Result |
| ------------------------ | ---------: |
| additions                |          0 |
| reviewed content changes |        354 |
| synthetic marker change  |          1 |
| deletions                |          0 |
| changed content bytes    | 13,281,808 |

Before the final revision, release
`release-489fa84d-ca12-4952-892c-909b2f159163` exposed a service-layer defect:
the protected-prefix configuration reached the COS publisher but not the release
orchestrator. It failed closed in `planning` with no upload, retained-state, or
cache stage. Pull request
[#30](https://github.com/DjangoAILab/blog-studio/pull/30) added the missing
propagation and a full adopt-then-publish protected-object regression; required
quality and security checks passed before deployment. The safe rejection is
retained in
[`production-phase-b/planning-rejection.json`](production-phase-b/planning-rejection.json).

The same gate also found that classic CDN's previous default required
`PurgePathCache` for generated directory keys. Pull request
[#29](https://github.com/DjangoAILab/blog-studio/pull/29) changed the
least-privilege default so object URLs and pretty-path cache keys both use exact
`PurgeUrlsCache` calls; explicit scoped directory purge and EdgeOne behavior are
unchanged. Both required checks passed before production deployment.

## Controlled publish

The release uploaded 355 page/metadata objects and no immutable assets or
deletions. Its 1,974-entry manifest SHA-256 is
`2a119cefb55576aed74bee710473eb38c919b7fc4e4829de0970246cf5fded2d`.

| Stage                                  |  Duration |
| -------------------------------------- | --------: |
| preflight                              |   0.008 s |
| build                                  |   4.258 s |
| plan                                   |   0.009 s |
| upload assets / prepare rollback state |  14.330 s |
| upload pages / finalize                |  13.163 s |
| classic CDN completion                 | 158.745 s |
| marker verification                    |   0.160 s |
| accepted to `succeeded`                | 190.668 s |

The provider-aware completion remains below the accepted five-minute gate;
Studio-controlled work remains below 90 seconds. CDN task
`631208027139136907` was observed as URL purge `done`; the follow-up describe
request ID is `bd39594b-8ca6-40bb-84cf-6fc836ecfd8f`.

The monitor performed 341 complete sixteen-resource checks during publication.
Every response stayed `200`; every protected path retained its baseline length
and SHA-256. The published marker resolved to the new release before rollback.

## Verified rollback and final state

The explicit rollback was accepted once and completed in 173.664 seconds. It
restored every changed object from retained state, restored the adopted active
manifest, completed CDN URL-purge task `631208320102834493`, and verified the
adopted public marker. The follow-up describe request ID is
`59c02d0f-c5b1-4183-964c-e9d2f3cc8c28`.

The monitor performed another 350 complete public checks. The first final
comparison matched all sixteen baseline resources; no settling retry was needed.
Postflight inventories are:

| Inventory               | Count |       Bytes | SHA-256                                                            |
| ----------------------- | ----: | ----------: | ------------------------------------------------------------------ |
| target including marker | 1,974 | 321,079,140 | `137c238f24bef83f4a01293df0114f17b95d78ae69395776c406e1c7f9939f1d` |
| content without marker  | 1,973 | 321,078,919 | `23f272eb2073de8272593cd51a5fd79dc653dbc3296b902a37ee182fb3458c8b` |
| retained rollback state |   360 |  16,605,495 | `d09d2f6666643077d489e5da0571bf3f657a6547e0fa178574e8a264a5660f90` |

The first two inventories are byte-for-byte identical to preflight. The larger
retained-state inventory is intentional and contains the complete rollback
snapshot and release manifest for audit/recovery. Blog Studio reported no active
release and the latest succeeded manifest remained the adopted baseline.

## Evidence index

- [`production-phase-b/preflight.json`](production-phase-b/preflight.json):
  immutable inventory, marker, samples, and protected paths;
- [`production-phase-b/plan.json`](production-phase-b/plan.json): final pure
  zero-addition/zero-deletion plan;
- [`production-phase-b/writer-probe.json`](production-phase-b/writer-probe.json):
  scoped COS request IDs and cleanup proof;
- [`production-phase-b/writer-cam-deny.json`](production-phase-b/writer-cam-deny.json):
  denied CAM-management probe;
- [`production-phase-b/publish-rollback.json`](production-phase-b/publish-rollback.json):
  durable events, status transitions, continuous public checks, provider task
  IDs, marker transition, and restoration;
- [`production-phase-b/postflight.json`](production-phase-b/postflight.json):
  restored public and retained-state inventories.

No evidence file contains a SecretKey or authentication token.
