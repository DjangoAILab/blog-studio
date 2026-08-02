# Backup and restore

Blog Studio backs up acknowledged drafts and operational history from SQLite,
the administrator configuration, and non-generated workspace files. Provider
objects and mounted secret files are intentionally outside this archive.

## Create a consistent backup

Keep the Studio running so the script can use SQLite's online backup API:

```sh
BLOG_STUDIO_BACKUP_PATH=/srv/backups/blog-studio scripts/backup.sh
```

The script writes an archive atomically and a sibling SHA-256 file. It excludes
`node_modules`, `public`, and `.published`; these are reproducible outputs. The
workspace should also have a remote Git copy, and remote media should have
provider versioning or an independent backup.

Paths default to the Compose layout and can be overridden:

```sh
BLOG_STUDIO_DATA_PATH=/srv/blog-studio/data \
BLOG_STUDIO_CONFIG_PATH=/srv/blog-studio/config/blog-studio.yml \
BLOG_STUDIO_WORKSPACE_PATH=/srv/blog-studio/workspace \
BLOG_STUDIO_BACKUP_PATH=/srv/backups/blog-studio \
scripts/backup.sh
```

Backups contain article content and may contain repository history. Store them
with mode `0600`, encrypt them at rest, keep at least one off-host copy, and
test restore regularly. Secrets need a separate protected backup.

## Restore drill

Restoring replaces the configured SQLite data, config file, and workspace. It
therefore requires an explicit confirmation flag and refuses to run while the
Studio service is active.

```sh
docker compose stop studio
BLOG_STUDIO_IMAGE=blog-studio:0.1.0 \
scripts/restore.sh --confirm \
  /srv/backups/blog-studio/blog-studio-backup-YYYYMMDDTHHMMSSZ.tar.gz
```

Before replacing data, the script verifies the checksum, rejects traversal
paths, checks the backup format, and runs SQLite `PRAGMA integrity_check` with
the selected image. Existing paths are moved to a timestamped
`.blog-studio-pre-restore-*` directory beside the data directory. Do not delete
that directory until the restored Studio has passed validation.

Reinstall the site's locked dependencies because generated dependencies are not
archived, then start and verify:

```sh
docker compose up -d studio
curl --fail http://127.0.0.1:4310/api/health
docker compose logs --tail=200 studio
```

Validate all of the following before declaring recovery complete:

1. authentication succeeds at the HTTPS hostname;
2. the latest acknowledged draft and release timeline are present;
3. the configured workspace scans successfully;
4. real generator preview builds; and
5. a no-op release plans zero uploads.

If validation fails, stop Studio, move the newly restored paths aside, and move
the three retained paths (`data`, `blog-studio.yml`, and `workspace`) back from
the `.blog-studio-pre-restore-*` directory.

## Scheduling

Run `scripts/backup.sh` from the host scheduler only after a manual restore drill
has passed. Alert on a non-zero exit and copy both the archive and checksum
off-host. Retention and provider-object backup are deployment policy, so the
repository does not install a host cron job automatically.

`pnpm operations:smoke` performs a safe, isolated proof: it creates a draft,
backs it up online, creates a later destructive mutation, restores the archive,
restarts the container, and verifies that the earlier version returns.
