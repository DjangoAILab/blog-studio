# Home-server deployment verification — 2026-08-02

## Scope

- host: `wang@home-server`
- service directory: `/home/wang/services/blog-studio`
- verified revision: `1f879e9ced55f73f1e103666291dcc4a22befc66`
- public editor: `https://blog-editor.internal.wj2015.com`
- reverse proxy: existing Traefik `websecure` entrypoint and shared network
- reference workspace: a separate clone of `wangerzi/blog`
- public blog: remains served from Tencent COS and classic Tencent CDN; it has
  no runtime dependency on Blog Studio or the home server

No Tencent console setting, COS object, CDN cache entry, source article, or
legacy resource was changed during deployment verification.

## Runtime controls

- container user is `1000:1000` and the root filesystem is read-only;
- container memory is capped at 2 GiB and preview scratch space is a 1 GiB
  `tmpfs` after a real reference build proved 256 MiB insufficient;
- only the existing Traefik network is attached;
- the authentication token and cookie secret were generated on the server,
  mounted from files with mode `0600`, and never printed;
- publishing remains fail-closed because Tencent credentials are not present;
- the deployed image exposes its exact Git revision through an OCI label.

After the final deployment, the local health endpoint, external HTTPS health,
public blog, and sampled legacy resource all returned `200`; the container
reported `healthy` with the exact verified revision in its OCI label.

## Real reference-site observations

| Observation                                 |           Result |
| ------------------------------------------- | ---------------: |
| Documents discovered                        |               93 |
| Document listing                            |       112.754 ms |
| Document read                               |        66.943 ms |
| Cold real-theme preview build               |         10.731 s |
| Generated preview fetch                     | 200 in 33.951 ms |
| Reference workspace Git changes after tests |                0 |

The first real preview failed with `ENOSPC` under the original 256 MiB preview
scratch limit. Raising only that isolated `tmpfs` to 1 GiB made the unchanged
reference build pass; the application memory limit remains 2 GiB.

## Cold-restart and fault-domain proof

An unchanged existing article was saved as draft version 1, the Studio
container was stopped, and three independent endpoints were observed:

| Endpoint while Studio was stopped             | HTTP |
| --------------------------------------------- | ---: |
| Studio health through Traefik                 |  504 |
| `https://blog.wj2015.com/`                    |  200 |
| `https://blog.wj2015.com/static/reading.jpeg` |  200 |

After restart, both container-local and external HTTPS health returned `200`.
The restored SQLite draft had the same version and body SHA-256 as before the
restart. Its explicit discard returned `200`; a follow-up read returned no
draft and the reference workspace remained clean.

This proves a Studio outage does not interrupt the public blog and that an
acknowledged draft survives a real container restart.

## Backup and restore

- online backup completed in 16 seconds;
- archive: `blog-studio-backup-20260802T043354Z.tar.gz`, 615,900,923 bytes;
- an isolated restore completed in 8 seconds and passed archive checksum,
  SQLite integrity, configuration, and all 93 post checks;
- daily backup is installed at 03:30;
- retention deletes only named Blog Studio archive/checksum files older than
  30 days inside the dedicated backup directory;
- current stored backup total is 615,905,128 bytes; a same-size daily upper
  bound is about 18.5 GB before compression ratios change.

## Build-context hardening

Production-like server state made a packaging flaw observable: `runtime/` was
1.3 GB and was not excluded, so a build sent about 617 MB to Docker. The final
Dockerfile hard-excludes `runtime/`, reducing the measured context to 590 KB.
Moving the VCS label after the security-update and copy layers was verified by
a second build with only a different VCS reference: it completed in under one
second and reported all expensive runtime layers as cached.

The final feature deployment sent 173.73 KiB of context, reused the OpenSSL
layer, built in 40 seconds, and reached both local and external health before
acceptance.

## Managed-asset cleanup proof

The final deployed container processed an existing PNG through the bounded
Sharp Worker and stored it below the selected article's immutable managed
prefix. The read-only orphan plan returned exactly that new key; confirmed
deletion returned `200` and count 1; a second plan returned zero. The reference
workspace returned to zero Git changes, while the public blog and sampled
legacy resource remained `200`. No pre-existing asset was a deletion candidate.
