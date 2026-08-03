---
title: Tencent COS and cache providers
description: Provider contracts, deployment shape, and the staging gates required before a real Tencent release.
---

:::caution[Integration status]
The COS publisher/storage and Tencent CDN/EdgeOne clients are wired into the
production Studio registry and covered by unit and fault-injection tests. The
reference account has passed isolated staging and read-only production baseline
adoption. Ordinary production content writes remain a separate, explicitly
gated privilege phase.
:::

## Runtime credentials

YAML contains only environment-variable references. A direct environment value
is supported, but the supplied Tencent Compose override uses Docker secret
files so credentials do not appear in the workspace configuration:

```sh
umask 077
printf '%s' "$TENCENT_SECRET_ID" > secrets/tencent_secret_id
printf '%s' "$TENCENT_SECRET_KEY" > secrets/tencent_secret_key

docker compose \
  -f docker-compose.yml \
  -f deploy/tencent/docker-compose.override.yml \
  up -d
```

For a reference such as `env: TENCENT_SECRET_ID`, Studio first reads
`TENCENT_SECRET_ID`; when it is absent, it reads the file named by
`TENCENT_SECRET_ID_FILE`. The browser receives neither value nor file path.

Use a dedicated programmatic CAM sub-user. Do not reuse a root-account key or
an existing CI key whose policy has not been audited. The repository includes a
copy-and-edit
[`cam-staging-policy.example.json`](https://github.com/DjangoAILab/blog-studio/blob/main/deploy/tencent/cam-staging-policy.example.json).
Replace its account, bucket, region, host, and run prefix before attaching it.
For an existing production deployment, use the separate
[`cam-production-adoption-policy.example.json`](https://github.com/DjangoAILab/blog-studio/blob/main/deploy/tencent/cam-production-adoption-policy.example.json)
first; it can inventory production and write retained state plus the exact
release marker, but it cannot overwrite or delete ordinary public objects.

Keep `/` literal in COS resource ARNs, but encode every slash as `%2F` in the
`cos:prefix` condition values. Tencent matches that condition against the
URL-encoded `prefix` request parameter; a visually plausible condition with
literal slashes can therefore deny the intended `GetBucket` inventory. The
checked-in policy smoke test locks this distinction down.

The staging policy intentionally grants no bucket configuration, bucket
creation, account bucket listing, or production-prefix object permission. Its
COS object operations match the SDK calls Studio actually makes:

- `GetBucket` for paginated inventory, constrained by `cos:prefix`;
- `GetObject`, `PutObject`, and `DeleteObject` for verification, promotion,
  retained rollback state, and rollback;
- `PurgeUrlsCache`, `PurgePathCache`, and `DescribePurgeTasks` for classic CDN.

Tencent's current CAM capability table classifies those three CDN APIs as
operation-level actions whose resource must be `*`. A policy cannot further
restrict them to one URL path. Compensating controls are therefore mandatory:

1. use a sub-user that has only the listed actions;
2. keep `verification.baseUrl` fixed to the one expected host and staging path;
3. deploy the secret only to the Studio container through read-only Docker
   secret files;
4. rotate or delete the staging key before granting production-prefix COS
   access;
5. optionally restrict the CAM policy by source IP only when the server has a
   verified stable egress address.

The example is a policy template, not proof that Tencent accepted the policy.
Validate it in CAM and run the staging gates before enabling production.

## COS publishing model

The publisher plans from the last retained release manifest instead of issuing a
remote HEAD request for each generated file. Uploads use bounded concurrency,
retry only retryable failures, and await every object operation.

Assets are promoted before pages. The marker and exact manifest become the
verification and rollback boundary. Provider deletion is limited to the
configured managed target; protected legacy prefixes remain outside ownership.

## Adopting an existing deployment

An existing bucket root is never treated as an empty Blog Studio target. To
manage it without changing legacy URLs, opt in explicitly:

```yaml
publish:
  adapter: tencent-cos
  options:
    targetPrefix: /
    allowBucketRoot: true
    allowBaselineAdoption: true
    statePrefix: _blog-studio
    protectedPrefixes:
      - static
```

Studio then disables ordinary publishing until an administrator confirms
**adopt existing deployment**. Adoption paginates the managed COS target,
excludes Blog Studio's state prefix, downloads every object, and records its
exact content hash, size, media type, and cache policy. Only after the complete
inventory succeeds does it write a release marker and retained baseline state;
public site bytes are not rewritten.

The operation refuses a target that already contains a Blog Studio marker. A
partial or previously managed target must be recovered from its retained state,
not silently re-adopted. After adoption, the first normal release is planned
against the verified baseline, so unchanged legacy paths remain untouched and
rollback has a precise boundary.

Keep adoption and normal publishing as different privilege phases. The
production-adoption policy grants `GetObject` across the managed target, but
its only public `PutObject`/`DeleteObject` resource is
`blog-studio-release.json`; retained manifests and rollback metadata are scoped
to the configured state prefix. It grants URL refresh, not directory refresh,
because adoption only invalidates the exact marker. After inspecting the first
read-only diff, replace this policy with a separately reviewed production policy
that grants content writes only if promotion is approved. Do not expand the
adoption identity in place.

## CDN and EdgeOne cache model

The cache adapter accepts exact URLs and directory paths, selects the configured
Tencent product, observes documented batch limits, records request IDs, and
polls task status. API acceptance is still followed by public marker
verification.

Large sites should not spend one URL-purge quota item for every generated page
and mutable asset when the publish target already has an isolated URL root.
Configure that boundary explicitly:

```yaml
cache:
  adapter: tencent-cdn
  options:
    directoryPurgeRoot: https://blog.example.com/__blog-studio-staging/v0.1/
```

Studio then validates every affected target against the same origin and path
boundary before submitting one directory purge. A target outside the boundary
fails closed. Omit this option for shared or legacy URL trees that require
exact-target invalidation.

Upgrading from classic CDN to EdgeOne may improve newer edge capabilities and
consolidate configuration, but it also changes provider APIs, cache semantics,
diagnostics, and operational rollback. Blog Studio therefore treats it as a
replaceable cache adapter—not as a required migration for the first release.

## Reference deployment gates

1. Inventory current COS prefixes, public URLs, cache product, and headers
   without storing credentials in evidence.
2. Back up deployment configuration and retain the prior publishing command.
3. Use a cloned workspace and non-production prefix/domain.
4. Publish a synthetic article and article-scoped image.
5. Inject build, upload, cache, network, and restart failures.
6. Compare generated URL inventory and legacy resources.
7. Adopt the existing deployment as a verified baseline without rewriting its
   public objects.
8. Promote one controlled real change only after every earlier gate passes.

Use separate privilege phases:

1. **staging:** read/write/delete only a unique hidden staging target and its
   state prefix, plus the three CDN actions above;
2. **adoption:** read the production target and write only Blog Studio's state
   prefix; do not overwrite or delete public objects;
3. **production:** grant target write/delete only after adoption, staging
   release, CDN marker verification, and rollback evidence all pass.

Never combine these phases into an unaudited broad key just to shorten setup.

The public blog must not depend on the internal Studio host after promotion.

Start from the repository's
[`examples/reference/hexo-cos.example.yml`](https://github.com/DjangoAILab/blog-studio/blob/main/examples/reference/hexo-cos.example.yml)
and keep staging under an isolated prefix and origin URL.
