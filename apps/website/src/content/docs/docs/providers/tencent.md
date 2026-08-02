---
title: Tencent COS and cache providers
description: Provider contracts, deployment shape, and the staging gates required before a real Tencent release.
---

:::caution[Integration status]
The COS publisher/storage and Tencent CDN/EdgeOne clients are wired into the
production Studio registry and covered by unit and fault-injection tests. The
reference-account end-to-end release is still gated on isolated staging. Do not
point a configuration at an existing bucket root until that staging task is
explicitly promoted.
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

## CDN and EdgeOne cache model

The cache adapter accepts exact URLs and directory paths, selects the configured
Tencent product, observes documented batch limits, records request IDs, and
polls task status. API acceptance is still followed by public marker
verification.

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

The public blog must not depend on the internal Studio host after promotion.

Start from the repository's
[`examples/reference/hexo-cos.example.yml`](https://github.com/DjangoAILab/blog-studio/blob/main/examples/reference/hexo-cos.example.yml)
and keep staging under an isolated prefix and origin URL.
