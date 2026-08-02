---
title: Troubleshooting
description: Diagnose health, authentication, workspace, preview, release, and recovery failures without risking production.
---

## Container never becomes healthy

```sh
docker compose ps
docker compose logs --tail=200 studio
docker compose config
```

Check that both secret files are non-empty and readable by the configured UID,
the config file is mounted at `/config/blog-studio.yml`, `/data` is writable,
and every workspace root is below `/workspaces`.

## Login succeeds but APIs return 401 or 403

- `BLOG_STUDIO_ALLOWED_ORIGINS` must exactly match scheme, host, and port.
- HTTPS deployments require Secure cookies; local HTTP smoke tests explicitly
  disable them.
- A changed cookie secret invalidates old sessions. Clear site cookies and log
  in again.
- Do not put Studio behind a proxy that rewrites the browser Origin.

## Workspace scan fails

Confirm the mounted path, UID/GID permissions, generator config, package metadata,
and locked dependencies. Symlinks resolving outside the allowed root are
rejected intentionally. Inspect the repository before changing containment
rules.

## Preview fails or times out

Run the exact site's build locally in the mounted workspace with the same Node
major version. Native dependencies must match the server architecture. Fix the
generator or dependency lock; do not bypass the adapter timeout by accepting an
unbounded process.

## Release fails before upload

This is the safest failure class: production has not changed. Read the preflight
and build events, correct the source or generator, then create a new release.

## Release rolls back

Keep the structured event log and provider request IDs. Verify that the public
marker returned to the previous release. Do not immediately retry a provider
authentication, quota, or cache-policy error until its root cause is known.

## Restore refuses to run

The service must be stopped, the `.sha256` sidecar must be beside the archive,
and the selected image must contain the SQLite validation utility. A rejection
is a safety gate; do not unpack the archive directly over live paths.

## Public blog is unavailable

The public site should not route through Blog Studio. Diagnose its static host,
object store, CDN, DNS, and certificate independently. Stopping Studio should
have no observable effect on public requests.
