---
title: Connect a Hexo site
description: Treat Hexo as the first generator adapter while preserving custom syntax, permalinks, and legacy resources.
---

## Compatibility model

The Hexo adapter detects a workspace from its package metadata and `_config.yml`,
discovers `_posts` and `_drafts`, preserves unknown front matter, and uses Hexo's
own permalink and build behavior. It does not turn the core product into a Hexo
database schema.

Synthetic and read-only reference scans cover Chinese filenames, raw HTML, Hexo
tags, custom front matter, and existing resolvable permalinks.

## Mount and prepare the repository

1. Work from a clone, not the only copy of a site.
2. Confirm the working tree is clean and backed up.
3. Install the exact dependencies from the site's lockfile on the target
   architecture.
4. Ensure the Studio UID owns or can write the workspace.
5. Keep the old deployment path available until staging promotion succeeds.

Minimal generator configuration:

```yaml
workspace:
  id: personal-blog
  root: /workspaces/blog

generator:
  adapter: hexo

repository:
  adapter: local-git
```

The generator command comes from the trusted adapter and workspace. It is not
editable from the browser.

Hexo themes and plugins must produce reproducible bytes for an unchanged
workspace. Avoid helpers that append `Date.now()` or random values to every
page; use a content-derived asset version instead. Studio assigns the same
release timestamp to sandbox and canonical document writes, so Hexo sites that
use `updated_option: mtime` do not generate a second change merely because a
verified draft was committed after publishing.

## Resource migration policy

Do not move old resources merely to match the new article-scoped convention.
Keep legacy paths such as `/static/**` protected and reachable. Configure new
media under a managed prefix such as `media/posts/{documentId}/...` so resources
group naturally without changing old URLs.

## Acceptance before production

- a read-only scan changes no workspace hash;
- opening and saving a representative document preserves unknown front matter;
- real preview uses the installed theme and plugins;
- generated URL inventory matches the prior build;
- a staging-prefix release verifies its marker;
- build, upload, cache, network, restart, and rollback failure drills pass; and
- legacy public URLs remain reachable after promotion.

Do not make the first provider test against the production prefix.
