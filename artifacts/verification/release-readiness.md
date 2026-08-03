# Release readiness — 2026-08-03

## Automated gates

CI run [30784753095](https://github.com/DjangoAILab/blog-studio/actions/runs/30784753095)
passed formatting, lint, type checking, unit/integration tests, production
builds, the complete Playwright authoring journey, production dependency
audit, deterministic release-artifact smoke tests, repository scan, production
image build, the documented generic Quick Start, and final image scan on
protected `main` revision `c3fca472c9e1073dfc0748e859ab0dc1234a0ebc`.

The browser journey proves native draft creation, autosave acknowledgement,
browser reload recovery, real generator preview, and explicit discard. The
browser journey also exercises read-only orphan inspection; integration tests
cover preview, stale-plan conflict, confirmed deletion, and protected scope.
The repository and final image contain no unaccepted critical vulnerability. One
moderate `uuid@9.0.1` finding remains transitively required by the current
Tencent SDK; its latest checked release still carries that dependency, so it is
recorded rather than misreported as zero findings.

GitHub's branch protection API was rechecked after the current deployment and
confirmed that `main` requires strict
`quality` and `security` checks, applies the rule to administrators, requires
linear history and resolved review conversations, and rejects force-pushes and
branch deletion. This evidence update is intentionally delivered through a
pull request to exercise the protected-branch path.

The protected-baseline correction subsequently passed required `quality` and
`security` checks in run
[30796876548](https://github.com/DjangoAILab/blog-studio/actions/runs/30796876548)
and merged as `68cd1ef2b88bd3d4d59e3aa1b4b058ae7f07cc3e`.

The container smoke portability correction then passed both required checks in
run [30800593199](https://github.com/DjangoAILab/blog-studio/actions/runs/30800593199)
and merged through pull request
[#26](https://github.com/DjangoAILab/blog-studio/pull/26) as protected `main`
revision `0aa4c727fe3199e6aadfe889db0f6c3ddda7d3e1`. The exact image built from that
revision passed the full smoke on the Docker-only home server, so the documented
production verification no longer relies on a host Node installation.

Production phase B's exact-URL classic CDN correction passed both required
checks in run
[30811297432](https://github.com/DjangoAILab/blog-studio/actions/runs/30811297432)
and merged through pull request
[#29](https://github.com/DjangoAILab/blog-studio/pull/29). The protected-prefix
service propagation correction then passed both required checks in run
[30811979371](https://github.com/DjangoAILab/blog-studio/actions/runs/30811979371)
and merged through pull request
[#30](https://github.com/DjangoAILab/blog-studio/pull/30) as protected `main`
revision `8d2332913085aadc32963a517657636fad8704f1`. That exact revision completed the
controlled production publish and rollback below.

## Real-environment gates completed

- reference Hexo build and 93-document compatibility;
- 12 public HTML URLs and 12 legacy asset hashes sampled without URL changes;
- deployed Docker/Traefik runtime, HTTPS, auth boundary, and health checks;
- protected `main` is deployed with an exact OCI revision label, a fresh
  checksum-verified pre-upgrade backup, and a successful real Hexo preview;
- current protected `main` revision `0aa4c727fe3199e6aadfe889db0f6c3ddda7d3e1`
  is deployed with the hardened runtime controls and all prior rollback images
  retained;
- draft cold restart, public-blog independence, API/autosave latency;
- online backup and isolated restore within the 15-minute RTO.
- dependency-free, documentation-only generic command Quick Start through
  authenticated edit, durable autosave, and real preview.
- deterministic release-artifact generation and verification, including a
  corrected multi-platform OCI dry-run with provenance and SBOM attestations.
- a dedicated staging CAM identity whose COS permissions are confined to the
  staging site and state prefixes, with out-of-scope access denied;
- a real Tencent COS and classic CDN staging publish, provider-failure
  rollback, public marker verification, deterministic rebuild, and immediate
  no-op release with zero object uploads and zero cache tasks;
- a forced restart after seven changed pages reached COS, followed by automatic
  exact rollback, previous-marker verification through origin and CDN, and
  explicit draft cleanup;
- exact production samples before and after staging remained byte-identical.
- a dedicated API-only production adoption identity with no ordinary content
  writes, complete 1,973-object baseline adoption, marker/state consistency,
  and unchanged public-content inventory;
- a first production diff generated read-only against the adopted baseline,
  exposing 355 changes and 10 deletions without applying or refreshing them.
- protected-baseline reconciliation that retains all ten legacy URL objects
  and the drifting static object, with filesystem and COS regression tests;
- a deployed second read-only production plan with 0 additions, 354 reviewed
  managed changes, 0 deletions, and the same 1,973-object content manifest;
- a repeat of that plan from the current deployed image, using read-only state
  and a deliberately unusable provider client, again produced 0 additions, 354
  content changes, 0 deletions, and 11 protected objects; the raw plan's one
  additional 189-byte change is solely the synthetic next-release marker;
- a 354-object public semantic audit: 344 reduce exactly to reviewed
  deterministic metadata/order/link transformations, while eight stale
  canonical article shells plus `archive.html` and `content.json` were
  inspected separately; no provider mutation occurred.

## Measured release performance

The final deterministic changed-content staging release completed in 193.427
seconds. The application-controlled work before cache completion took roughly
35 seconds; the contained classic CDN directory refresh took roughly 157.8
seconds. The immediately following no-op release completed in 4.774 seconds
without uploads or cache work.

On 2026-08-03 the product owner explicitly accepted four provider-aware v0.1
gates: request acknowledgement `< 1 s`, no-op completion `< 15 s`,
Studio-controlled changed-release work `< 90 s`, and awaited provider-backed
completion `< 5 min`. The measured maxima above are 0.200 seconds, 4.774
seconds, roughly 35 seconds, and 193.427 seconds respectively, so all four
gates pass. This does not redefine completion: Blog Studio still awaits and
validates the Tencent task before marking a release complete. Migrating the
production domain to EdgeOne is not bundled into v0.1.

## Production phase B completed

The product owner authorized production phase B and the final zero-addition,
zero-deletion plan. A separate API-only production writer was created from the
generated least-privilege policy; the adoption identity was not expanded. The
writer passed scoped target/state operations, protected-object read, cleanup,
outside-prefix denial, and CAM-management denial probes.

One controlled release reached `succeeded` only after Tencent cache-task and
public-marker verification. One explicit rollback then restored the adopted
marker, manifest, complete target inventory, and all sixteen continuously
sampled public resources. The public site remained available through 691
complete sample sweeps, all eleven protected legacy paths retained their
adopted bytes, and no release remains active. Full counts, durations, provider
request IDs, hashes, and raw timelines are recorded in
[`production-phase-b.md`](production-phase-b.md).

The owner's existing `id_ed25519` public key is registered as a GitHub SSH
signing key and a disposable signature was verified before release work. The
writer credential is the only operating production credential and has a first
scheduled rotation date of 2026-11-01. The adoption-only CAM user and policy
remain unchanged for audit history. Disabling its superseded API key is the
only remaining credential-disposition gate: the Tencent console session expired
before the asynchronous disable request completed, and a subsequent read-only
COS probe proved that the key was still active. The release must not claim this
gate until console read-back and a rejected credential probe both agree.

All product and controlled-publish gates required before the signed `v0.1.0`
tag are green. After the credential-disposition gate above closes, the release
workflow will build the multi-platform image, attach its immutable digest,
generate deterministic checksums/source/notes/upgrade artifacts, and publish
the GitHub release from that verified tag.

The configured application fails closed at these provider boundaries. Tencent
console configuration is still classic CDN, and no EdgeOne migration is part
of v0.1.

The legacy automatic writer was frozen by `wangerzi/blog` pull request #63:
pull requests still build, while COS upload now requires an explicit manual
dispatch. The deterministic-output compatibility change then passed its tests
and merged through pull request #62. Both pull-request runs skipped the COS
upload step, and neither merge produced a push-triggered production upload.

## Credential boundary for production

The completed staging credential remains restricted to
`blog.wj2015.com/__blog-studio-staging/v0.1/**` and its matching retained-state
prefix; authenticated probes confirmed that current production objects are
denied. It must not be expanded or silently reused for production.

Production adoption uses the dedicated API-only CAM sub-user
`blog-studio-production-v01` and custom policy
`BlogStudioProductionAdoptV01`. It can read the existing
`blog.wj2015.com/**` target, but its only public write/delete resource is the
exact Blog Studio marker. It may write retained state under the configured
state prefix and request exact-URL cache refresh. It cannot apply the normal
content plan above and must not be expanded in place.

Any normal writer must be a separately authorized identity limited to the same
managed target and minimum cache actions. The legacy GitHub Actions writer is
already non-automatic, so two systems cannot publish concurrently without an
explicit manual action.
