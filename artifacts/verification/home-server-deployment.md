# Home-server deployment verification — 2026-08-03

## Scope

- host: `wang@home-server`
- service directory: `/home/wang/services/blog-studio`
- verified revision: `68cd1ef2b88bd3d4d59e3aa1b4b058ae7f07cc3e`
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
- publishing initially remained fail-closed without Tencent credentials; the
  later staging-only identity is documented in `staging-release.md`;
- the deployed image exposes its exact Git revision through an OCI label.

After the final deployment, the local health endpoint, external HTTPS health,
public blog, and sampled legacy resource all returned `200`; the container
reported `healthy` with the exact verified revision in its OCI label.

The server was subsequently fast-forwarded from the original feature revision
to the protected `main` revision above. Before the upgrade, a fresh online
backup (`blog-studio-backup-20260802T065717Z.tar.gz`, 615,910,194 bytes, mode
`0600`) passed its sibling SHA-256 check. The new image was built and labelled
with the full expected revision before `.env` was changed; the previous image
was retained for application rollback. Recreating only the Studio service with
both the base and Traefik Compose files restored a healthy container on the
`home-server_default` network, still running as UID 1000 with no matching error
lines in the post-deploy log.

Post-upgrade external verification returned `200` for the editor, health
endpoint, public blog, and legacy `/static/reading.jpeg`; the unauthenticated
workspace API returned `401`. A real token-backed session and workspace listing
both returned `200`. A fresh preview from the 93-document reference Hexo
workspace generated 1,971 files in 10 seconds, served its generated page with
`200`, stopped cleanly, and left zero tracked workspace changes. One initial
public-root request took 29.9 seconds, but five immediate bounded repetitions
completed in 0.078-0.171 seconds; this is recorded as a transient observation,
not treated as provider-release latency evidence.

Before any Tencent credential is introduced, the deployed publisher was moved
from the production target to the isolated target
`blog.wj2015.com/__blog-studio-staging/v0.1`. Its retained state uses the
matching `blog-studio-state/.../__blog-studio-staging/v0.1` prefix, baseline
adoption is disabled, and public verification is rooted at
`https://blog.wj2015.com/__blog-studio-staging/v0.1/`. Restarting with this
configuration left the public root and sampled `/static/**` resource at `200`.

One restart was intentionally diagnosed after the base Compose file recreated
a locally healthy container without the Traefik override. The external route
returned `404` until the service was recreated with both Compose files. Final
inspection confirmed the `home-server_default` network, the exact Host router,
external root and health `200`, and unauthenticated API `401`. The operations
guide now makes the two-file lifecycle command invariant explicit.

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
- the restart-recovery upgrade backup
  `blog-studio-backup-20260803T043352Z.tar.gz` is 618,622,507 bytes, mode
  `0600`, and passed its sibling SHA-256 check;
- the pre-upgrade online backup above also passed checksum verification;
- an isolated restore completed in 8 seconds and passed archive checksum,
  SQLite integrity, configuration, and all 93 post checks;
- daily backup is installed at 03:30;
- retention deletes only named Blog Studio archive/checksum files older than
  30 days inside the dedicated backup directory;
- current stored backup total is 3,700,936,319 bytes; a same-size daily upper
  bound is about 18.5 GB before compression ratios change.

## Build-context hardening

Production-like server state made a packaging flaw observable: `runtime/` was
1.3 GB and was not excluded, so a build sent about 617 MB to Docker. The final
Dockerfile hard-excludes `runtime/`, reducing the measured context to 590 KB.
Moving the VCS label after the security-update and copy layers was verified by
a second build with only a different VCS reference: it completed in under one
second and reported all expensive runtime layers as cached.

A later pre-upgrade backup exposed a second context boundary: the documented
default `backups/` directory was not ignored, so one server build transferred
618.74 MB before the service was recreated. The image was rejected for
deployment. The corrected build both ignores `backups/` and replaces the broad
source copy with an explicit allowlist (`apps/`, `packages/`, root package
metadata, and operational `scripts/`). A local production build transferred
549.48 kB and its container smoke passed non-root, read-only-root, health,
authentication, durable-draft, graceful-shutdown, and cold-restart checks.

The merged correction was then built on home-server with 14.49 kB of changed
context transferred by the existing BuildKit content store. Image
`blog-studio:home-c60e84d` exposed the exact full revision label and replaced
only the Studio service with all three required Compose files (base, Traefik,
and Tencent). Container-local and external health returned `200`, the editor
returned `200`, unauthenticated workspace access returned `401`, and the
container remained UID/GID `1000:1000`. The three production baseline hashes
remained exact after the upgrade and real staging releases.

The final feature deployment sent 173.73 KiB of context, reused the OpenSSL
layer, built in 40 seconds, and reached both local and external health before
acceptance.

The restart-recovery revision sent 94.95 kB of source context, built image
`blog-studio:home-c3fca47`, and exposed the exact full revision label before
deployment. Recreating only Studio with the base, Traefik, and Tencent Compose
files returned a healthy UID/GID `1000:1000` container. The editor and external
health returned `200`, unauthenticated workspace access returned `401`, and the
three production hashes remained exact before and after the real partial-write
restart rollback.

## Protected-baseline production preparation

Before deploying the protected-baseline correction, online backup
`blog-studio-backup-20260803T082409Z.tar.gz` was created at 618,752,836 bytes,
mode `0600`, and passed its sibling SHA-256 check. The prior `.env`, production
configuration, and image `blog-studio:home-c3fca47` were retained as exact
rollback inputs.

The server checkout fast-forwarded to protected `main` revision
`68cd1ef2b88bd3d4d59e3aa1b4b058ae7f07cc3e`. Its image build transferred
91.95 kB of context, passed package supply-chain policy checks, and exposed the
full revision label before runtime configuration changed. The production
configuration added only the `static` boundary, nine exact legacy article
aliases, and `test.html` to `publish.options.protectedPrefixes`.

Recreating only Studio with the base, Traefik, and Tencent Compose files
returned a healthy `1000:1000` container. Local and external health returned
`200`, the editor returned `200`, and unauthenticated workspace access returned
`401`. The public root, archives, static Gitalk asset, and production marker
retained their exact pre-upgrade hashes; all ten protected legacy URLs returned
`200`. A deployed read-only build and plan retained eleven protected baseline
objects and produced 0 additions, 354 changes, and 0 deletions without a
publisher, cache, or release mutation.

## Managed-asset cleanup proof

The final deployed container processed an existing PNG through the bounded
Sharp Worker and stored it below the selected article's immutable managed
prefix. The read-only orphan plan returned exactly that new key; confirmed
deletion returned `200` and count 1; a second plan returned zero. The reference
workspace returned to zero Git changes, while the public blog and sampled
legacy resource remained `200`. No pre-existing asset was a deletion candidate.
