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

## Real-environment gates completed

- reference Hexo build and 93-document compatibility;
- 12 public HTML URLs and 12 legacy asset hashes sampled without URL changes;
- deployed Docker/Traefik runtime, HTTPS, auth boundary, and health checks;
- protected `main` is deployed with an exact OCI revision label, a fresh
  checksum-verified pre-upgrade backup, and a successful real Hexo preview;
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

## Open production gates

The production baseline is adopted with a dedicated adoption-only credential.
The deployed protected-baseline correction reduces the normal content plan to
354 reviewed managed changes with zero additions and zero deletions. All ten
legacy URL objects and the drifting immutable asset remain in the effective
manifest at their adopted hashes. Consequently these actions remain gated:

1. obtain explicit production phase B authorization for ordinary content
   writes; the read-only review is not publish authorization;
2. create a separate production writer identity after that authorization; do
   not expand the adoption identity;
3. run one controlled zero-addition, zero-deletion release and rollback
   exercise while continuously checking the legacy URLs and baseline samples;
4. create the signed `v0.1.0` release, checksums, and final upgrade bundle after
   every required gate is green.

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
