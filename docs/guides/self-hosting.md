# Self-hosting Blog Studio

This guide installs the single-user Studio as a container beside an existing
file-based site. The generated public site does not depend on the Studio being
available.

## Prerequisites

- Linux with Docker Engine 27 or newer and Docker Compose v2;
- a checked-out, trusted site workspace with its locked generator dependencies;
- a TLS reverse proxy or private network; and
- a host user whose UID/GID owns the data and workspace directories.

The image uses Node.js 22, runs as UID/GID `1000:1000` by default, has a
read-only root filesystem, drops all Linux capabilities, and stores mutable
state only in mounted paths. The direct recovery port binds to `127.0.0.1`.
The final image intentionally omits npm and Git: install the site's locked
dependencies before mounting the workspace, and perform Git administration on
the host. Generator executables already installed in the workspace remain
available to Studio.
Preview isolation uses a `noexec,nosuid` tmpfs. Its size defaults to 1 GiB and
can be changed with `BLOG_STUDIO_TMPFS_SIZE`; allow enough room for both a copy
of the source tree and one generated site without exceeding the container's
memory limit.

## Prepare the installation

From a Blog Studio checkout:

```sh
mkdir -p config data secrets workspace backups
cp deploy/traefik/.env.example .env
cp examples/config/blog-studio.yml config/blog-studio.yml
umask 077
openssl rand -base64 48 > secrets/cookie_secret
chown -R 1000:1000 data workspace
```

Put or clone the site into `workspace/`. Install its dependencies using its own
lockfile and package manager, then make sure UID 1000 can write the workspace.
The Studio invokes the generator already present in that workspace; it does not
silently replace the site's toolchain.

Edit `config/blog-studio.yml` so that `workspace.root` is
`/workspaces/blog`. Relative asset paths are resolved below that root. Publisher
destinations must be explicit mounted paths or configured remote providers.
Keep secrets out of this YAML; provider secret fields refer to environment
variable names.

For a dependency-free first run, copy `examples/workspace/.` into `workspace/`
and use `examples/config/blog-studio.yml`. Initialize and commit that directory
as a local Git repository. This uses the built-in command generator and
`publish.adapter: none`: writing, durable autosave, and real preview work, while
the release button remains disabled until a verified target is configured.

Validate the deployment and build the image. Password-free access is the
default for local and trusted-LAN use:

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:4310/api/health
```

Open the configured hostname. The browser automatically receives a signed
session and CSRF token; anyone who can reach the allowed origin can edit. The
first journey discovers the configured workspace as a Site candidate. Review
its identity, content counts, Git state and capabilities before registration;
registration does not rewrite the Site checkout or publish anything. See
[Sites and first run](sites-and-first-run.md).

For an untrusted LAN, shared host, tunnel, or any broader exposure, opt into
password protection before starting Studio. The CLI reads the password twice
without echo and stores only a memory-hard verifier in SQLite:

```sh
printf '\nBLOG_STUDIO_AUTH_MODE=password\n' >> .env
docker compose run --rm studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite
docker compose up -d
```

Inspect credential state or recover a forgotten password from the trusted host:

```sh
docker compose run --rm studio \
  node dist/server/cli.js auth status \
  --database /data/blog-studio.sqlite
docker compose run --rm studio \
  node dist/server/cli.js auth reset \
  --database /data/blog-studio.sqlite
```

Reset increments the credential generation and revokes every browser session.
The legacy `BLOG_STUDIO_AUTH_TOKEN` fallback is for bounded v0.1 migration only:
once owner credentials exist, token login is rejected automatically.

## Tencent provider secrets

When a workspace uses Tencent COS, CDN, or EdgeOne, keep the credential values
in Docker secrets and leave only references in YAML:

```sh
umask 077
printf '%s' "$TENCENT_SECRET_ID" > secrets/tencent_secret_id
printf '%s' "$TENCENT_SECRET_KEY" > secrets/tencent_secret_key
docker compose \
  -f docker-compose.yml \
  -f deploy/tencent/docker-compose.override.yml \
  up -d
```

The override mounts both files read-only and sets only their file-location
variables in the container environment. Do not commit either file.

For a publish target isolated beneath one URL directory, configure Tencent CDN
to collapse each release's affected URLs into one directory purge:

```yaml
cache:
  adapter: tencent-cdn
  options:
    directoryPurgeRoot: https://blog.example.com/__blog-studio-staging/v0.1/
```

The provider rejects a release if any invalidation target falls outside this
root. Use the option only when the matching COS target is equally isolated and
the credential is allowed to call `PurgePathCache`. Omit it for the
least-privilege default: both concrete object URLs and generated pretty-path
cache keys are submitted through `PurgeUrlsCache`, so production credentials
do not need directory-purge permission. The explicit root avoids consuming one
URL-purge quota item per generated page or mutable asset on large isolated
sites.

## Traefik

The supplied override joins an existing external Traefik Docker network and
adds a TLS router:

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
deployment as well. Running `docker compose up` with only the base file replaces
the container without its Traefik network and labels; the application may stay
healthy locally while the public editor route returns `404`.

### Direct development preview

Studio controls a generator process but does not proxy its generated pages. To
give a Hexo process on container port 4000 its own HTTPS origin, add the preview
override as well:

```sh
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  -f deploy/traefik/docker-compose.preview-4000.override.yml \
  config --quiet
docker compose \
  -f docker-compose.yml \
  -f deploy/traefik/docker-compose.override.yml \
  -f deploy/traefik/docker-compose.preview-4000.override.yml \
  up -d
```

Set `BLOG_STUDIO_PREVIEW_HOSTNAME` to that origin and set the selected
development profile's `previewUrl` to the same HTTPS URL. The preview router
targets container port 4000 directly, so root-relative generator resources
continue to work normally. The profile's `baseUrl` remains the Studio-internal
readiness URL.

The base Compose file declares container-only ports 4000--4100 for development
servers. `expose` is not a host-port mapping. Traefik can reach those ports over
the shared Docker network; host-installed Nginx needs an explicit local mapping
in a deployment override, for example `127.0.0.1:4000:4000`, then an Nginx
`proxy_pass http://127.0.0.1:4000`. Do not publish preview ports to a LAN or the
internet unless that exposure is intentional and protected by the host ingress.

For the reference installation the defaults are:

- hostname: `blog-editor.internal.wj2015.com`;
- external network: `home-server_default`;
- entrypoint: `websecure`; and
- upstream container port: `4310`.

With the optional direct-preview override, the preview hostname is a separate
router whose upstream container port is `4000`.

Change these values in `.env`, not in the Compose files. Traefik must already
own the certificate and `websecure` entrypoint. Do not publish port 4310 on a
LAN or public interface. `BLOG_STUDIO_ALLOWED_ORIGINS` must exactly contain each
browser-facing HTTPS origin; a wildcard is deliberately unsupported.

## Configuration and filesystem boundaries

| Host path                | Container path            | Purpose                           | Backup                   |
| ------------------------ | ------------------------- | --------------------------------- | ------------------------ |
| `data/`                  | `/data`                   | SQLite drafts, releases, jobs     | required                 |
| `config/blog-studio.yml` | `/config/blog-studio.yml` | administrator policy              | required                 |
| `workspace/`             | `/workspaces/blog`        | canonical files/Git and generator | required plus remote Git |
| `secrets/*`              | `/run/secrets/*`          | cookie/provider secrets           | external secret store    |

The backup deliberately excludes generated `node_modules`, `public`, and
`.published` directories. Reinstall locked dependencies after a restore. Media
stored in COS or another provider needs that provider's own versioning and
backup policy.

## Upgrade and application rollback

Create and verify a backup before changing the image. Pin a release tag or
digest in `BLOG_STUDIO_IMAGE`, pull/build it, and recreate only Studio:

```sh
scripts/backup.sh
docker compose pull studio
docker compose up -d --no-deps studio
docker compose ps
```

If health or the writing journey fails, restore the previous image value and
run the last command again. Image rollback does not alter the published site.
If the new version changed application data, follow the tested data restore
procedure in [Backup and restore](backup-restore.md).

## Operational checks

```sh
docker compose logs --tail=200 studio
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q studio)"
docker compose exec studio id
docker compose stop -t 10 studio
docker compose up -d studio
```

The repository's `pnpm container:smoke` reproduces the container security and
cold-restart checks with an isolated synthetic Hexo Site. The quick-start and
operations smokes also prove Site discovery/registration and backup/restore
through the public Site contract. They never use a real workspace or Provider.
