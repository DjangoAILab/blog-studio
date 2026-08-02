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
