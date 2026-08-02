# Blog Studio

Blog Studio is a self-hosted publishing workbench for file-based websites.
It keeps Markdown, Git, the existing static-site generator, and the existing
hosting stack while making the complete writing-to-production journey usable
from one browser tab.

> Status: v0.1 release candidate. Local/Filesystem and reference Hexo journeys
> are verified; the final Tencent provider exercise and `v0.1.0` tag remain
> release gates.

## Product promise

- Write without waiting for Git or deployments.
- Paste media into an article-scoped asset library.
- Preview with the real site generator and theme.
- Publish through a visible, verifiable release pipeline.
- Preserve existing files, URLs, and infrastructure.

The first production integration targets Hexo, Tencent COS, Tencent CDN, and
GitHub. The core contracts are generator-, storage-, repository-, and
deployment-independent.

## Quick start

Requirements: Docker Engine 27+ and Docker Compose v2. The checked-in example
workspace has no external dependencies and proves the complete writing and
preview path before you connect a real site.

```sh
git clone https://github.com/DjangoAILab/blog-studio.git
cd blog-studio
mkdir -p config data secrets workspace backups
cp deploy/traefik/.env.example .env
cp examples/config/blog-studio.yml config/blog-studio.yml
cp -R examples/workspace/. workspace/
umask 077
openssl rand -base64 32 > secrets/auth_token
openssl rand -base64 48 > secrets/cookie_secret
git -C workspace init
git -C workspace config user.name "Blog Studio Quick Start"
git -C workspace config user.email "quick-start@localhost"
git -C workspace add .
git -C workspace commit -m "Initialize example workspace"
```

Make sure the configured container UID/GID can write `data/` and `workspace/`.
The supplied configuration already points at `/workspaces/blog`, uses the
generic command adapter, and keeps publishing disabled until a real target is
configured.

```sh
docker compose config --quiet
docker compose build
docker compose up -d
curl --fail http://127.0.0.1:4310/api/health
```

Open the configured HTTPS route, enter `secrets/auth_token`, edit “Welcome to
Blog Studio,” and choose preview. To connect your own site, replace the example
workspace with a clean trusted checkout, install its locked dependencies on the
host, and select its generator/publisher adapters in the configuration.

Port 4310 binds only to localhost. Use the supplied Traefik override, another
TLS reverse proxy, or a private tunnel for browser access; do not expose the
plain HTTP port to a LAN or the internet. See the [complete self-hosting
guide](docs/guides/self-hosting.md) before configuring a remote publisher.

## Architecture in one paragraph

Studio owns browser sessions, durable draft snapshots, jobs, and release
evidence. The configured generator owns Markdown semantics and the final site
shape. Versioned adapters own repository access, article-scoped assets,
publication, and cache invalidation. A release builds in an isolated workspace,
uploads immutable assets before pages, verifies a public marker, and only then
commits a native draft promotion. The public static site never depends on the
Studio process being online.

## Develop and verify

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @blog-studio/studio e2e
corepack pnpm container:smoke
```

Node.js 22 and pnpm 11.18.0 are the supported development toolchain. The CI
workflow also audits production dependencies and scans both the repository and
final container image for unaccepted critical findings.

## Documentation

- [Product definition](docs/product/product-definition.md)
- [Architecture](docs/architecture/overview.md)
- [Roadmap](docs/roadmap.md)
- [v0.1 release checklist](docs/checklists/v0.1.md)
- [v0.1 implementation plan](docs/plans/2026-08-02-blog-studio-v0.1.md)
- [Self-hosting](docs/guides/self-hosting.md)
- [Backup and restore](docs/guides/backup-restore.md)
- [Verification evidence](artifacts/verification/release-readiness.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
