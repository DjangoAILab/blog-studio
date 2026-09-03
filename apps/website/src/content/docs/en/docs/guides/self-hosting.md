---
title: Self-host with Docker
description: Install the single-user Studio with durable mounts, mounted secrets, and optional Traefik TLS.
---

## Prerequisites

- Docker Engine 27+ and Docker Compose v2 on Linux;
- a trusted, checked-out static-site workspace;
- the site's locked generator dependencies; and
- TLS termination or a private network.

The supplied container runs as UID/GID 1000, uses a read-only root filesystem,
drops Linux capabilities, and binds its direct recovery port only to
`127.0.0.1`.
The final image intentionally omits npm and Git: install the site's locked
dependencies before mounting the workspace, and perform Git administration on
the host. Generator executables already installed in the workspace remain
available to Studio.
Preview isolation uses a `noexec,nosuid` tmpfs. Its size defaults to 1 GiB and
can be changed with `BLOG_STUDIO_TMPFS_SIZE`; allow enough room for both a copy
of the source tree and one generated site without exceeding the container's
memory limit.

## 1. Prepare directories and secrets

```sh
mkdir -p config data/agent-runtime secrets workspace backups
cp deploy/traefik/.env.example .env
cp examples/config/blog-studio.yml config/blog-studio.yml
cp -R examples/workspace/. workspace/
umask 077
openssl rand -base64 48 > secrets/cookie_secret
chmod 700 data/agent-runtime secrets
chmod 600 secrets/cookie_secret
git -C workspace init
git -C workspace config user.name "Blog Studio Quick Start"
git -C workspace config user.email "quick-start@localhost"
git -C workspace add .
git -C workspace commit -m "Initialize example workspace"
chown -R 1000:1000 data workspace
chown -R 1000:1000 secrets
```

The example is dependency-free, uses the built-in command generator, and keeps
publishing disabled while writing, autosave, and preview remain functional. To
connect a real site, replace `workspace/` with a clean trusted checkout, install
its locked dependencies on the host, and update the adapter configuration. The
container path remains `/workspaces/blog`.

For the Site Agent, provision Pi's `auth.json`, `models.json`, and
`settings.json` under `data/agent-runtime`, owned by UID/GID 1000 and mode
`0600`; keep the directory mode `0700`. Configure `glm-5.2` as the Pi default.
For optional vision, create `secrets/vision_api_key` as the same owner and mode
`0600`, set `BLOG_STUDIO_VISION_API_KEY_PATH` to its host path, and set the
endpoint, `minimax-m3` model, and in-container key-file path in `.env`. Never
place either credential value in `.env`, YAML, or an image layer.

## 2. Choose access mode and start

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:4310/api/health
```

Blog Studio defaults to password-free access for local and trusted-LAN use.
Open the configured origin and Studio will establish a signed browser session;
mutations still require same-origin CSRF validation. Anyone who can reach that
origin can edit.

For an untrusted LAN, shared host, tunnel, or broader exposure, set
`BLOG_STUDIO_AUTH_MODE=password` in `.env` before startup and initialize the
Owner password from the trusted host:

```sh
docker compose run --rm studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite
```

Use the same trusted-container entry point for status or recovery:

```sh
docker compose run --rm studio \
  node dist/server/cli.js auth status \
  --database /data/blog-studio.sqlite
docker compose run --rm studio \
  node dist/server/cli.js auth reset \
  --database /data/blog-studio.sqlite
```

Reset revokes every existing browser session. The legacy opaque token is an
optional v0.1 migration fallback and is not part of the normal setup journey.

## 3. Join an existing Traefik network

```sh
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  config --quiet
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  up -d
```

Use both `-f` arguments for every later `up`, `restart`, `pull`, and recreated
deployment. Using only the base file removes the Traefik network and labels
from the replacement container, so local health may pass while the HTTPS route
returns `404`.

The reference defaults use `blog-editor.internal.wj2015.com`, the external
network `home-server_default`, and the `websecure` entrypoint. Override them in
`.env` for another installation. Traefik must already own the certificate and
entrypoint.

`BLOG_STUDIO_ALLOWED_ORIGINS` must exactly contain the browser-facing HTTPS
origin. Do not use a wildcard and do not expose port 4310 to a LAN or the public
internet.

## Persistent paths

| Host                     | Container                 | Content                       |
| ------------------------ | ------------------------- | ----------------------------- |
| `data/`                  | `/data`                   | SQLite drafts, jobs, releases |
| `data/agent-runtime/`    | `/data/agent-runtime`     | Pi config and credentials     |
| `config/blog-studio.yml` | `/config/blog-studio.yml` | administrator policy          |
| `workspace/`             | `/workspaces/blog`        | files, Git, generator         |
| `secrets/*`              | `/run/secrets/*`          | cookie/provider secrets       |

The static public site has no request-time dependency on these mounts or on
Studio availability.

## Prove the container contract

```sh
BLOG_STUDIO_SMOKE_IMAGE=blog-studio:local pnpm container:smoke
```

The isolated smoke test checks non-root identity, a read-only root filesystem,
health, authentication, acknowledged draft persistence, clean SIGTERM, and
container recreation. It does not mount a real site or call a provider.

Continue with [workspace configuration](../../configuration/workspaces/) and a
[backup drill](../../operations/backup-restore/).
