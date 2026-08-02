---
title: Backup and restore
description: Back up acknowledged drafts online and prove recovery before relying on automation.
---

## What is included

The backup archive contains:

- an online SQLite snapshot of drafts, jobs, releases, and events;
- the administrator workspace configuration; and
- workspace files and Git metadata, excluding generated `node_modules`,
  `public`, and `.published` directories.

Provider objects and runtime secret files are intentionally separate. Use remote
Git, provider versioning, and a protected secret backup alongside this archive.

## Create a backup

Keep Studio running so the script can use SQLite's online backup API:

```sh
BLOG_STUDIO_BACKUP_PATH=/srv/backups/blog-studio scripts/backup.sh
```

The result is an atomically renamed `.tar.gz` archive and a mode-0600 SHA-256
sidecar. Store both off-host and encrypted at rest.

## Restore

Restore is destructive and refuses to run while Studio is active:

```sh
docker compose stop studio
BLOG_STUDIO_IMAGE=blog-studio:0.1.0 \
scripts/restore.sh --confirm \
  /srv/backups/blog-studio/blog-studio-backup-YYYYMMDDTHHMMSSZ.tar.gz
```

Before replacement, the script verifies the checksum, rejects traversal paths,
checks the archive format, and runs SQLite integrity validation with the selected
image. The prior paths are moved to a timestamped
`.blog-studio-pre-restore-*` directory.

Reinstall the site's locked dependencies, start Studio, then validate:

1. HTTPS authentication;
2. the newest acknowledged draft and release timeline;
3. workspace compatibility scan;
4. real generator preview; and
5. a no-op release plan with zero uploads.

Do not delete the retained pre-restore directory until validation passes.

## Reproduce the recovery proof

```sh
BLOG_STUDIO_SMOKE_IMAGE=blog-studio:local pnpm operations:smoke
```

The isolated drill saves version 1, backs it up, saves a destructive version 2,
stops the service, restores version 1, recreates the container, and verifies the
exact earlier body. Schedule backups only after this drill succeeds on the
target host.
