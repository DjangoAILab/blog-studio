---
title: Tencent COS and cache providers
description: Provider contracts, deployment shape, and the staging gates required before a real Tencent release.
---

:::caution[Integration status]
The COS publisher/storage and Tencent CDN/EdgeOne cache contracts have unit and
fault-injection coverage. The production Studio registry and reference-account
end-to-end wiring are not yet complete. Do not configure production credentials
until the reference staging task is explicitly promoted.
:::

## COS publishing model

The publisher plans from the last retained release manifest instead of issuing a
remote HEAD request for each generated file. Uploads use bounded concurrency,
retry only retryable failures, and await every object operation.

Assets are promoted before pages. The marker and exact manifest become the
verification and rollback boundary. Provider deletion is limited to the
configured managed target; protected legacy prefixes remain outside ownership.

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
7. Promote one controlled real change only after every earlier gate passes.

The public blog must not depend on the internal Studio host after promotion.
