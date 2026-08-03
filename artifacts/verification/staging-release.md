# Reference staging release evidence

Date: 2026-08-02 to 2026-08-03

Status: isolated Tencent staging mutation, rollback, cache refresh, public
verification, reproducible Hexo output, and no-op release verified. Production
baseline adoption and production-prefix mutation remain explicitly gated.

## Authenticated production inventory

The Tencent Cloud console was inspected read-only in the user's authenticated
browser. No COS object, CDN rule, DNS record, credential, or account permission
was changed.

| Item                           | Observed value                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| COS bucket                     | `webstatic-1252276051`                                                                              |
| Region                         | `ap-shanghai`                                                                                       |
| Managed production prefix      | `blog.wj2015.com/`                                                                                  |
| Objects visible at prefix root | year/archive/category/theme directories plus HTML, feeds, JSON, and legacy `static/`                |
| CDN product                    | Tencent classic CDN, webpage/small-file acceleration                                                |
| CDN domain state               | `blog.wj2015.com`, enabled, global                                                                  |
| CDN CNAME                      | `blog.wj2015.com.cdn.dnsv1.com.cn`                                                                  |
| Origin                         | COS over HTTPS, `webstatic-1252276051.cos.ap-shanghai.myqcloud.com`                                 |
| Origin URL rewrite             | `/*` → host `webstatic-1252276051.cos-website.ap-shanghai.myqcloud.com`, path `/blog.wj2015.com/$1` |
| Cache key                      | all query parameters retained; path case-sensitive                                                  |
| Edge cache                     | origin policy by default; `/*.html` and `/` cached 10 minutes                                       |
| Browser cache                  | `jpg;png;css;js` cached 3 hours                                                                     |
| Error cache                    | 404 cached 10 seconds                                                                               |

The inventory matches the public DNS and response-header baseline recorded in
`reference-compatibility.md`. It also explains the historical stale-publish
experience: HTML and the homepage may remain at edge nodes for ten minutes when
the legacy uploader does not submit a purge.

## Migration decision

- Keep classic CDN for v0.1. Do not migrate the domain or CNAME to EdgeOne in
  the same change as the publishing-control-plane migration.
- Publish to the existing `blog.wj2015.com/` COS prefix so every public URL and
  legacy `/static/**` path remains stable.
- Preserve the existing CDN origin rewrite exactly. Blog Studio's cache adapter
  submits exact changed URLs/directories and then verifies the public release
  marker; API acceptance alone is not success.
- Put new article media under `media/posts/{documentId}/<content-hash>.<ext>`.
  Historical `static/**` remains protected from deletion.
- Before the first production diff, use baseline adoption to hash the full
  existing prefix and write only Blog Studio state plus
  `blog-studio-release.json`.

## Isolated staging target

The final non-production shape is a hidden subtree below the existing public
host. It replaces the earlier proposed top-level `blog-studio-staging/site`
shape so that the same production rewrite and CDN route can be tested without
changing any legacy URL:

| Item                | Value                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| COS target prefix   | `blog.wj2015.com/__blog-studio-staging/v0.1`                                                             |
| Retained state      | `blog-studio-state/blog.wj2015.com/__blog-studio-staging/v0.1`                                           |
| Public verification | `https://blog.wj2015.com/__blog-studio-staging/v0.1/`                                                    |
| Direct origin       | `https://webstatic-1252276051.cos.ap-shanghai.myqcloud.com/blog.wj2015.com/__blog-studio-staging/v0.1/`  |
| Cache provider      | Tencent classic CDN; every purge and verification URL is derived from the fixed public verification base |
| Baseline adoption   | disabled                                                                                                 |

The synthetic article and media must be clearly marked as staging and must not
be copied outside this hidden subtree. Before and after the run, deterministic
production samples and the legacy production prefix inventory will be compared.

## Remaining mutation gates

- Compare the final controlled production plan with the complete production
  prefix inventory before baseline adoption.
- Create or expand a credential for the production prefix only after a new
  explicit authorization. The staging identity must not be reused as an
  implicit production grant.
- Adopt the production baseline, inspect the first production diff, publish,
  verify, and retain the immediately preceding manifest for rollback.

Until those gates pass, the legacy GitHub Actions uploader remains the only
production writer and the production prefix is untouched.

## Least-privilege staging identity

The user authorized creation of a staging CAM identity and completed the
console MFA challenge. The resulting API-only sub-user is
`blog-studio-staging-v01` (UIN `100051281078`) with custom policy
`BlogStudioStagingV01` (policy ID `281349441`). Credentials are mounted from
server-side mode-`0600` files and never returned to the browser or committed.

An authenticated probe proved all intended boundaries:

- put/get/list/delete succeeded below the staging target and retained-state
  prefixes;
- object and list access outside those prefixes was denied;
- classic CDN task query was allowed; and
- only the required classic CDN refresh/status operations use resource `*`,
  compensated by the fixed public base and directory-purge containment in the
  application configuration.

## Real provider fault and rollback evidence

The first dual preview/release attempt exhausted the isolated 1 GiB `/tmp`
because two complete Hexo sandboxes overlapped. The release service now stops
the active preview before building; subsequent preview cleanup returned `404`
as soon as release began.

A later run uploaded 1,967 staging objects but Tencent rejected exact-URL cache
refresh because that daily quota was already exhausted. The orchestrator
automatically rolled back. COS listing then returned zero objects below the
staging target, and the production root, archives, and legacy image retained
their exact baseline hashes. The cache adapter now collapses a contained
staging diff to one configured directory refresh; the directory task completed
successfully without broadening the purge above the staging root.

## Successful staging journey

Release `release-8775889d-ab60-4946-8bfd-d409d4809496` first proved the complete
provider journey: actual Hexo preview, 1,607 assets followed by 360 pages,
directory refresh, public marker verification, and canonical source commit.
The run took 255.473 seconds, of which roughly 157.8 seconds was Tencent cache
task completion.

Two subsequent releases unexpectedly uploaded almost every HTML page. Root
cause analysis found Nexmoe helpers appending `Date.now()` to every CSS and JS
URL, nondeterministic tag/search/feed ordering, and a source mtime difference
between the verified sandbox and canonical write. Blog Studio now propagates
one release timestamp to both writes. The reference blog compatibility change
is isolated in `wangerzi/blog` PR #62 and replaces wall-clock versions with
content-derived versions while preserving every asset path.

With both fixes active, release
`release-91f68bb8-0bac-477e-894d-16cad5c469e1` completed successfully:

| Check                               | Observed result                                      |
| ----------------------------------- | ---------------------------------------------------- |
| Actual Hexo preview                 | 8.401 seconds; synthetic marker present              |
| Preview cleanup after release start | `404`                                                |
| Release timestamp                   | `2026-08-03T04:09:35.262Z`                           |
| Canonical source mtime              | exact same millisecond timestamp                     |
| Changed pages                       | 358, expected one-time deterministic-output baseline |
| Cache task                          | one contained directory refresh                      |
| Total release                       | 193.427 seconds                                      |
| Public staging article              | `200`, expected marker present                       |

The immediately following release
`release-d9bde589-89a9-4cba-9613-582994a72a93` generated the same bytes. It
finished in 4.774 seconds after preflight, build, and planning, emitted
`Generated content is unchanged; release is a no-op`, uploaded no objects, and
submitted no CDN task.

## Forced-restart recovery

A first forced-restart probe exposed a real boundary race. Release
`release-7b64d281-e2a5-478f-b4e2-0a20044596a8` returned `202` in 0.103 seconds
and was killed immediately after its durable status entered
`uploading-assets`, before the COS rollback manifest existed. No target object
had been written, but startup attempted strict rollback and recorded a missing
key failure. The staging article still exposed only the preceding marker and
all production samples retained their hashes.

The publisher contract now has an optional, explicit interrupted-recovery
operation. The COS and filesystem implementations report `not-started` only
when their missing durable rollback state proves that provider mutation could
not have begun; prepared releases perform the same strict exact-byte rollback
used by manual recovery. Missing state remains an error for manual rollback.
Service and both publisher paths have regression tests on protected `main`
revision `c3fca472c9e1073dfc0748e859ab0dc1234a0ebc`.

The provider-backed re-run used release
`release-e08b96a0-0433-48c2-8480-8f01b4f9c06b`. The start request returned in
0.200 seconds. After seven of eight changed pages had been uploaded, including
the article, homepage, feed, and release marker, the container received
`SIGKILL` during `uploading-pages`. Startup found the durable rollback state,
restored the previous manifest and bytes, and marked the release `rolled-back`
with `Interrupted release was rolled back after service restart`.

Both direct COS and CDN article requests contained the preceding deterministic
marker and excluded the interrupted marker. The acknowledged test draft was
then explicitly discarded, Studio returned healthy, and the production hashes
below remained exact. This closes cold-restart recovery against real provider
state without touching the production prefix.

After evidence capture, the single untracked synthetic staging source file was
removed from the server workspace. It is retained only inside the verified
pre-upgrade backup; the live workspace returned to 93 documents and a clean Git
status.

After these runs, production samples were still byte-identical to the original
baseline:

| Production sample      | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `/`                    | `99f4ee56f26e666204122c4dd0ef0666a0ef95dbe428c7ba607e31aea8ce5673` |
| `/archives/`           | `6afb911b5afaf94d502d9cf61ffad8aaabcaee1fb910f7d72503d7ae2814ade8` |
| `/static/reading.jpeg` | `22bd07ecf69d2e63d8634b6f9e31e069763ec3b700140bea9982a2a242e49fbd` |
