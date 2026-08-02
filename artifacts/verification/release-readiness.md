# Release readiness — 2026-08-02

## Automated gates

CI run [30734218656](https://github.com/DjangoAILab/blog-studio/actions/runs/30734218656)
passed formatting, lint, type checking, unit/integration tests, production
builds, the complete Playwright authoring journey, production dependency
audit, repository scan, image build, and final image scan on final feature
revision `1f879e9ced55f73f1e103666291dcc4a22befc66`.

The browser journey proves native draft creation, autosave acknowledgement,
browser reload recovery, real generator preview, and explicit discard. The
browser journey also exercises read-only orphan inspection; integration tests
cover preview, stale-plan conflict, confirmed deletion, and protected scope.
The repository and final image contain no unaccepted critical vulnerability. One
moderate `uuid@9.0.1` finding remains transitively required by the current
Tencent SDK; its latest checked release still carries that dependency, so it is
recorded rather than misreported as zero findings.

The final documentation revision
`71f8cc4ca9abb8a73d6818f29e5ad945b0a28e42` passed both required jobs in
[CI run 30734364831](https://github.com/DjangoAILab/blog-studio/actions/runs/30734364831).
GitHub's branch protection API then confirmed that `main` requires strict
`quality` and `security` checks, applies the rule to administrators, requires
linear history and resolved review conversations, and rejects force-pushes and
branch deletion. This evidence update is intentionally delivered through a
pull request to exercise the protected-branch path.

## Real-environment gates completed

- reference Hexo build and 93-document compatibility;
- 12 public HTML URLs and 12 legacy asset hashes sampled without URL changes;
- deployed Docker/Traefik runtime, HTTPS, auth boundary, and health checks;
- draft cold restart, public-blog independence, API/autosave latency;
- online backup and isolated restore within the 15-minute RTO.

## Open external gate

No least-privilege Tencent SecretId/SecretKey is present locally or on the home
server. Consequently these actions remain intentionally blocked and were not
simulated as production success:

1. read and adopt the existing COS deployment baseline;
2. publish to a non-production prefix and verify the marker through CDN;
3. run a controlled production no-URL-change release and rollback exercise;
4. measure the real provider-backed changed-article release;
5. create the signed `v0.1.0` release after all required evidence is green.

The configured application fails closed at these provider boundaries. Tencent
console configuration is still classic CDN, and no EdgeOne migration is part
of v0.1.

## Credential boundary for the next gate

The next credential must be a dedicated staging-only CAM sub-user. COS access
is restricted to the hidden target
`blog.wj2015.com/__blog-studio-staging/v0.1/**` and the matching retained state
prefix. It receives no permission for current production objects. Tencent's
current CAM catalog marks `PurgeUrlsCache`, `PurgePathCache`, and
`DescribePurgeTasks` as operation-level CDN permissions whose resource is `*`,
so isolation at an individual URL path cannot be expressed in CAM. Studio
compensates by deriving every purge target from its fixed verification base URL,
and the credential has no other CDN action.

Production adoption and production publishing remain separate later privilege
phases; neither permission is bundled into the staging key.
