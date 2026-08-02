---
title: Upgrade and rollback
description: Upgrade the Studio independently, retain Traefik routing, and roll back without touching the public site.
---

Blog Studio keeps canonical content in the mounted workspace and operational
state in SQLite. Pin an immutable image digest and upgrade the Studio container
independently from the generated public site.

## Before upgrading

1. Read the release notes and confirm configuration compatibility.
2. Commit or otherwise back up every canonical workspace change.
3. Run `scripts/backup.sh` and copy the archive plus checksum off-host.
4. Record the current image digest and exact Compose file set.
5. Verify health and one authenticated edit/preview journey.

## Recreate Studio

Set `BLOG_STUDIO_IMAGE` to the immutable reference in the release's
`container-digest.txt`. A Traefik installation must retain both Compose files:

```sh
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  pull studio
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  up -d --no-deps studio
```

Confirm container health, HTTPS access, authentication, autosave after browser
reload, and real preview. The public generated site must remain reachable while
Studio is stopped or restarting.

## Roll back

Restore the previous immutable image reference and recreate Studio with the
same Compose files. Image rollback does not modify the public site or canonical
workspace. If persistent data changed incompatibly, stop Studio and follow the
checksum-validated [backup and restore](/docs/operations/backup-restore/)
procedure before starting the old image.

Provider release rollback is a separate operation in the release timeline.
Never replace a populated COS prefix manually or change established public URL
paths as part of an application upgrade.
