# Production baseline adoption — 2026-08-03

## Scope and stop condition

The product owner authorized production phase A: create a dedicated
adoption-only identity, inventory the existing deployment, adopt it without
rewriting public content, and inspect the first normal release as a read-only
diff. This phase explicitly stops before ordinary production content writes,
deletes, or a normal release. It does not migrate classic CDN to EdgeOne.

## Dedicated CAM identity

- CAM sub-user: `blog-studio-production-v01`
- account ID: `100051290557`
- access method: programming/API only; console access disabled
- groups: none
- attached custom policy: `BlogStudioProductionAdoptV01`
- policy ID and active version: `281365490`, version 2

The policy grants production and retained-state inventory/read access. Its only
public write/delete target is the exact
`blog.wj2015.com/blog-studio-release.json` marker; retained-state writes are
limited to `blog-studio-state/blog.wj2015.com/**`. It grants exact-URL cache
refresh and task observation, but no ordinary content write/delete wildcard.
Authenticated negative probes confirmed that the staging identity cannot list
production and that the adoption identity cannot list outside its configured
prefixes.

The first inventory probe exposed a policy-template defect: literal `/`
characters in the `cos:prefix` condition caused Tencent to deny `GetBucket`
even though exact-object reads were allowed. Version 2 encodes those condition
slashes as `%2F`, including both the public and retained-state prefixes. The
same credentials then passed the intended inventory while retaining all write
restrictions. The repository examples now have a regression smoke test for
this encoding boundary.

The credential CSV downloaded from CAM was copied directly to the home server,
parsed into two mode-`0600` Docker secret files without logging their contents,
and removed by the installer. The exact local download was validated as a
regular file and permanently unlinked after installation. No secret value is
stored in this repository or in this evidence.

## Read-only pre-adoption inventory

| Measure                     |                                                        Observation |
| --------------------------- | -----------------------------------------------------------------: |
| Managed prefix              |                                                 `blog.wj2015.com/` |
| Existing public objects     |                                                              1,973 |
| Existing public bytes       |                                                        321,078,919 |
| COS-order inventory SHA-256 | `e511f086a6599da67405ffe2eb803bedb114f28fcb655cd85b1447da9f818a69` |
| Existing Blog Studio marker |                                                             absent |
| Outside-prefix listing      |                                                             denied |

Three public samples were hashed before activation: `/`, `/archives/`, and a
legacy JPEG under `/static/`. Their hashes were retained for the post-adoption
comparison.

## Activation and adoption

The home-server deployment was switched from its isolated staging
configuration to the production-adoption configuration with a mode-`0600`
backup of the prior environment. The existing image remained healthy, the
internal HTTPS origin returned `200`, and unauthenticated workspace access
returned `401`.

Baseline release
`release-085314a6-85f5-48aa-8837-3a14eec58b2a` completed successfully. Studio
downloaded and verified all 1,973 existing objects, wrote one public release
marker and its retained manifest/rollback metadata, awaited classic CDN, and
marked the target's adoption state complete. It uploaded no ordinary public
content object.

Post-adoption inventory proved:

- the managed public prefix contains 1,974 objects: the original 1,973 plus
  only `blog-studio-release.json`;
- excluding that marker, object count, byte count, and COS-order inventory hash
  are unchanged;
- retained state contains exactly the active manifest and the adopted
  release's manifest and rollback record;
- marker release ID, marker manifest hash, active manifest, and retained
  manifest agree;
- the adoption rollback record contains no public-content backup;
- the three sampled public objects remain byte-identical;
- the public marker returns `200` and references manifest hash
  `sha256:5d45c3c996fb0d27bfb9286090cc31b39696181bad8c39940c76d592df1bbd4e`.

## First normal release diff — read only

Studio built production revision
`da94f63a35e39e7061de2e92b0821a5e8dbda777` in 3.667 seconds and planned it
against the adopted manifest. The script called the generator and pure plan
builder only; it did not call publisher apply/finalize or the cache provider.

| Planned operation | Objects |      Bytes |
| ----------------- | ------: | ---------: |
| Add               |       0 |          0 |
| Change            |     355 | 14,050,320 |
| Delete            |      10 |    514,371 |

The changes span 104 natural groups: 352 pages, two metadata files, and one
immutable asset (`static/libs/gitalk.min.js`). Deletions contain nine dated
article permalinks plus legacy `test.html`. Several deleted dated paths have a
corresponding generated path on a different date, so applying this plan as-is
would violate the no-URL-change requirement. The protected `static` inventory
has the same 1,590 paths on both sides but a different digest because of the one
planned asset change.

This diff is evidence that baseline adoption worked as intended: unexpected
legacy drift is visible before content privileges exist. No part of this plan
was published. Phase B requires an explicit review of URL/date preservation and
the immutable asset change, followed by a separately created production writer
identity; the adoption identity must not be expanded in place.

## Protected-baseline reconciliation

The ten deletion candidates were legacy objects left by the previous
upload-only publisher. Nine are dated article aliases whose generated canonical
date differs; `test.html` no longer has generated source. Removing any of them
would make an established URL fail even though the current canonical article
remains available. They are therefore an imported ownership boundary, not new
source documents and not duplicate articles.

The immutable change had a separate cause. Hexo interpreted
`static/libs/gitalk.min.js` as a page and embedded its filesystem modification
time in rendered locale data. The source bytes were unchanged, but a fresh
checkout produced a different output digest. The production object is retained
under the existing `static` boundary rather than overwritten with checkout-time
noise.

Pull request [#23](https://github.com/DjangoAILab/blog-studio/pull/23), merged
as `68cd1ef2b88bd3d4d59e3aa1b4b058ae7f07cc3e`, corrected a product-level gap:
protected paths had previously been excluded from deletion but could still be
overwritten, and omitted protected objects could disappear from the effective
manifest. Release planning now reconciles generated output with the adopted
baseline before the marker is generated:

- a missing protected object is carried forward from the baseline;
- changed protected output retains the baseline entry and bytes;
- new protected output without a baseline entry fails closed;
- late reconciliation after marker generation fails closed;
- publisher tests prove protected drift is not uploaded for either filesystem
  or Tencent COS targets.

Quality and security checks passed on CI run
[30796876548](https://github.com/DjangoAILab/blog-studio/actions/runs/30796876548)
before the protected merge.

## Phase B preparation diff — read only

The merged image was deployed internally with `static`, the nine exact legacy
article aliases, and `test.html` as protected prefixes. A second production
build and pure plan used the deployed configuration and adopted release
`release-085314a6-85f5-48aa-8837-3a14eec58b2a`. It made no mutating API call
and did not invoke publisher apply/finalize or the cache provider.

| Measure                         |      Result |
| ------------------------------- | ----------: |
| Build time                      |     4.126 s |
| Generated objects               |       1,963 |
| Generated bytes                 | 320,588,230 |
| Adopted content objects         |       1,973 |
| Adopted content bytes           | 321,078,919 |
| Protected baseline objects kept |          11 |
| Planned additions               |           0 |
| Planned changes                 |         354 |
| Planned changed-object bytes    |  13,281,808 |
| Planned deletions               |           0 |
| Effective manifest objects      |       1,973 |

The eleven preserved paths are the ten prior deletion candidates plus
`static/libs/gitalk.min.js`. Its generated digest changed again with checkout
time, while the effective manifest kept the production digest
`sha256:a78e96a97c973437d180a8c6a46786d702cc87ec69808cbde17d1e04122beff7`.

The 354 managed changes were then fetched from the public deployment and
compared with generated bytes, still read-only. After normalizing only the
reviewed rollout dimensions—content-derived asset version tokens, current
copyright year, filesystem-time metadata, stable taxonomy/feed/JSON ordering,
and links from the preserved aliases to their generated canonical dates—344
objects were otherwise byte-equivalent. The remaining ten were inspected
separately:

- eight generated canonical article pages replace stale historical copies of
  the site shell; the old aliases remain independently preserved;
- `archive.html` differs by its page filesystem timestamp and the same reviewed
  canonical links;
- `content.json` retains exactly 93 posts, 12 categories, and 162 tags, with no
  missing or added post; its residual differences are deterministic ordering
  and filesystem-time fields on non-post pages.

After the internal upgrade and both audits, `/`, `/archives/`, and
`/static/libs/gitalk.min.js` retained their pre-upgrade SHA-256 hashes. The
marker retained the same release ID and bytes, all ten legacy URLs returned
`200`, and no public object or CDN task was mutated. A separate production
writer and any normal release remain outside this phase.
