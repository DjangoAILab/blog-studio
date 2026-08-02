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

- Provide or create a dedicated staging CAM sub-user restricted to the COS
  target and state prefixes first; store its key only as mounted secret files.
- Because Tencent classic CDN purge actions are operation-level permissions
  with resource `*`, grant only the required purge/status actions to that
  staging identity and keep Studio's fixed public verification base as the
  compensating path boundary.
- Publish, verify the marker and exact synthetic article/media bytes, then run
  retry, network, cache-verifier, restart, and rollback fault cases.
- Compare the resulting build with the complete production prefix inventory.
- Expand the credential to the production prefix only for the explicit
  baseline-adoption and controlled-release gates.

Until those gates pass, the legacy GitHub Actions uploader remains the only
production writer and the production prefix is untouched.
