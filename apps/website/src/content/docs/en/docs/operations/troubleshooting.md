---
title: Troubleshooting
description: Diagnose health, authentication, workspace, preview, release, and recovery failures without risking production.
---

## Agent Session cannot resume

An `AGENT_TRANSCRIPT_UNAVAILABLE` response means the Pi JSONL is missing,
corrupt, incompatible, or has a different Session identity. Stop Studio and
restore SQLite, `agent-sessions`, `agent-runtime`, and `agent-attachments` from
the same backup generation. Do not create a replacement JSONL under the old
Session record.

## A turn says interrupted after restart

This is intentional. Studio terminalizes queued, running, and
waiting-for-approval work without replaying tools. Inspect the durable tool
audit and working-tree diff, then submit a new message if more work is needed.

## Vision failed but upload succeeded

The original image remains attached. Verify `BLOG_STUDIO_VISION_ENDPOINT`,
`BLOG_STUDIO_VISION_MODEL`, and the optional API-key secret, then use retry on
the attachment. A failed interpretation is never presented as model output.

## Agent edit conflicts with the editor

The editor protects its stored source revision. Reload and compare the direct
workspace change before deciding whether to reapply the draft. Agent edits,
drafts, ChangeSets, local commits, and releases are deliberately separate
states.

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
