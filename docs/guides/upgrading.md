# Upgrade and rollback

Blog Studio keeps canonical content in the mounted workspace and operational
state in SQLite. Upgrade the Studio container independently from the generated
public site, and always pin an immutable image digest for production.

## Before upgrading

1. Read the release notes and confirm configuration compatibility.
2. Commit or otherwise back up every canonical workspace change.
3. Run `scripts/backup.sh` and copy both the archive and checksum off-host.
4. Record the current `BLOG_STUDIO_IMAGE` digest and the exact Compose file set.
5. Verify the current health endpoint and one authenticated edit/preview journey.

For a v0.1 upgrade, initialize owner credentials before exposing the v0.2
login, retain the existing configuration and SQLite database, and let migration
run only after the checksum-validated backup exists. The existing workspace is
not silently registered: after login, inspect it as a Site candidate and confirm
its public identity. The temporary legacy auth-token fallback is rejected once
owner credentials exist and should then be removed from the deployment.

## Upgrade

Set `BLOG_STUDIO_IMAGE` to the immutable reference from
`container-digest.txt`, then recreate only Studio. A Traefik installation must
keep both Compose files on every recreate:

```sh
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  pull studio
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  up -d --no-deps studio
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  ps
```

Confirm container health, HTTPS access, authentication, autosave after browser
reload, Site registration/settings, Markdown fallback and real preview. Prepare
a no-op or disposable ChangeSet to confirm review boundaries without contacting
a production Provider. The public generated site must remain reachable while
Studio is stopped or restarting.

## Application rollback

Restore the previously recorded immutable image reference and repeat the
recreate commands. Application rollback does not modify the public site or
canonical workspace. If a version changed persistent data incompatibly, stop
Studio and use the checksum-validated procedure in
`docs/guides/backup-restore.md` before starting the old image.

Provider release rollback is separate from application rollback. Use the
release timeline's verified rollback operation; never replace a populated COS
prefix manually or change existing public URL paths during an application
upgrade.
