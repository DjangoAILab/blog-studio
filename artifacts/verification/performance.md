# Performance verification — 2026-08-02

Measurements use the deployed reference workspace with 93 articles. API
requests originate on the home server and traverse the production HTTPS
Traefik route. Browser measurements originate on the author's Mac over the
home LAN in headless Chrome and wait for the Milkdown ProseMirror surface to be
visible and editable.

## Results

| Journey                                                           | Samples |     Median |        p95 |          Gate |
| ----------------------------------------------------------------- | ------: | ---------: | ---------: | ------------: |
| Published-document listing                                        |      50 |  59.149 ms |  75.107 ms |      < 200 ms |
| Acknowledged autosave                                             |      30 |  62.514 ms |  97.403 ms |      < 150 ms |
| Authenticated shell reload to editable surface (final deployment) |       5 |   859.5 ms |   880.2 ms |       < 1.5 s |
| Immediate first login to editable surface (final deployment)      |       5 | 2,110.2 ms | 2,605.8 ms | informational |

Each autosave used the real SQLite repository and an unchanged real article,
with monotonically increasing expected versions. Version 30 was explicitly
discarded, a follow-up read returned no draft, and Git reported zero workspace
changes.

The first automated login before editor preloading took 2,671.3 ms. That
measurement led to preloading the split 344 KiB-gzip editor module while the
login screen is visible. A deliberately worst-case test that submits the token
immediately after DOM readiness still takes 2.61 seconds p95; a human typing the
token gives the preload more time. The `< 1.5 s` product gate applies to the
recurring authenticated writing-shell journey, which is 880.2 ms p95.

## Build path

- cold real Hexo/theme preview: 10.731 seconds;
- preview response: HTTP 200 in 33.951 ms;
- Docker context after excluding runtime state: 590 KB, down from about 617 MB;
- repeat Docker build with only a VCS label change: under one second with the
  OpenSSL, dependency, and application layers cached.

## Provider-backed release

The final deterministic Tencent staging release completed in 193.427 seconds:
roughly 35 seconds for preflight, Hexo build, planning, COS publishing, and
verification around a 157.8-second classic CDN directory-refresh task. The
immediately following byte-identical release completed as a no-op in 4.774
seconds with no object uploads and no cache task.

Two real release requests used by forced-restart fault injection returned their
asynchronous `202` records in 0.103 and 0.200 seconds. The authoring interface is
therefore not held open for provider completion; it follows the durable release
timeline while the background job awaits COS and CDN.

On 2026-08-03 the product owner explicitly accepted provider-aware v0.1 gates
based on this real staging evidence:

| Release boundary                   |  Measured | Accepted gate |
| ---------------------------------- | --------: | ------------: |
| Asynchronous release request       |   0.200 s |         < 1 s |
| Byte-identical no-op completion    |   4.774 s |        < 15 s |
| Studio-controlled changed work     |     ~35 s |        < 90 s |
| Awaited provider-backed completion | 193.427 s |       < 5 min |

All four revised gates pass. Completion continues to mean that Blog Studio has
awaited and validated the provider task; the user interface does not report a
release as complete while cache invalidation is still pending. Tencent's
[published classic CDN guidance](https://cloud.tencent.com/document/product/228/3946)
allows approximately five minutes for global URL refresh to take effect. The
provider-aware split therefore makes the source of latency observable without
weakening completion semantics. Migrating the production domain to EdgeOne is
not part of v0.1.
