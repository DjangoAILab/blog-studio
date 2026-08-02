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

## 1. Prepare directories and secrets

```sh
mkdir -p config data secrets workspace backups
cp deploy/traefik/.env.example .env
cp examples/config/blog-studio.yml config/blog-studio.yml
umask 077
openssl rand -base64 32 > secrets/auth_token
openssl rand -base64 48 > secrets/cookie_secret
chown -R 1000:1000 data workspace
```

Clone or copy the site into `workspace/` and install dependencies with its own
lockfile. Set `workspace.root: /workspaces/blog` in the configuration. Ensure the
configured UID can write source, generated output, and local publish targets.

## 2. Validate and start

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:4310/api/health
```

Open the configured HTTPS origin and enter the value from
`secrets/auth_token`. All non-health application APIs still require a signed
session; mutations additionally require same-origin CSRF validation.

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
| `config/blog-studio.yml` | `/config/blog-studio.yml` | administrator policy          |
| `workspace/`             | `/workspaces/blog`        | files, Git, generator         |
| `secrets/*`              | `/run/secrets/*`          | login and cookie secrets      |

The static public site has no request-time dependency on these mounts or on
Studio availability.

## Prove the container contract

```sh
BLOG_STUDIO_SMOKE_IMAGE=blog-studio:local pnpm container:smoke
```

The isolated smoke test checks non-root identity, a read-only root filesystem,
health, authentication, acknowledged draft persistence, clean SIGTERM, and
container recreation. It does not mount a real site or call a provider.

Continue with [workspace configuration](/docs/configuration/workspaces/) and a
[backup drill](/docs/operations/backup-restore/).
