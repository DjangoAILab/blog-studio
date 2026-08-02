# Reference staging release evidence

Date: 2026-08-02

Status: provider inventory complete; isolated mutation and production adoption
remain gated on a least-privilege Tencent credential.

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

The approved non-production shape is:

| Item           | Value                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| Target prefix  | `blog-studio-staging/site`                                                            |
| State prefix   | `blog-studio-staging/state`                                                           |
| Direct origin  | `https://webstatic-1252276051.cos.ap-shanghai.myqcloud.com/blog-studio-staging/site/` |
| Cache provider | none until a separate staging CDN domain exists                                       |

The synthetic article and media must be clearly marked as staging and must not
be copied into `blog.wj2015.com/`. Before and after the run, deterministic
production samples and the production prefix inventory will be compared.

## Remaining mutation gates

- Provide or create a least-privilege credential restricted to the two staging
  prefixes first; store it only as mounted secret files.
- Publish, verify the marker and exact synthetic article/media bytes, then run
  retry, network, cache-verifier, restart, and rollback fault cases.
- Compare the resulting build with the complete production prefix inventory.
- Expand the credential to the production prefix only for the explicit
  baseline-adoption and controlled-release gates.

Until those gates pass, the legacy GitHub Actions uploader remains the only
production writer and the production prefix is untouched.
