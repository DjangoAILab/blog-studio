# Blog Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Blog Studio is a self-hosted AI content workspace for Markdown and Git-based
websites. Its Site Agent can understand and safely modify an existing site while
you approve tool calls, review every diff, and decide what gets published.

Keep your files, Git history, generator, theme, URLs, and hosting stack. Blog
Studio brings AI-assisted writing and site maintenance into the same verifiable
browser journey without turning your website over to a hosted AI CMS.

[Website](https://djangoailab.github.io/blog-studio/) ·
[English documentation](https://djangoailab.github.io/blog-studio/en/docs/) ·
[简体中文文档](https://djangoailab.github.io/blog-studio/zh-cn/docs/)

![Blog Studio Site Agent — durable Sessions, approval modes, and explicit Markdown context](docs/media/site-agent-demo.gif)

> Status: v0.1.0 is released. The current branch completes the evidence-backed
> Site-first and Site Agent capability gates; it is not presented as a new
> public release until the normal review and release workflow finishes.

## Product promise

- Give the Site Agent whole-Site context instead of pasting isolated fragments.
- Keep multiple durable Site-scoped Sessions with explicit article, selection,
  editor-buffer, preview, and attachment context.
- Let the Agent inspect and modify the workspace through bounded file and local
  Git tools; require per-change approval or explicitly opt into YOLO.
- Review every AI-produced change before preparing a ChangeSet, committing, or
  starting a separate human-controlled remote release.
- Write without waiting for Git or deployments.
- Attach policy-approved resources to an article-scoped library.
- Preview immediately as sanitized Markdown, then optionally with the real site
  generator and theme.
- Prepare and review a durable ChangeSet before local commit or remote release.
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
```

Make sure the configured container UID/GID can write `data/` and `workspace/`.
The supplied configuration already points at `/workspaces/blog`, uses the
generic command adapter, and keeps publishing disabled until a real target is
configured.

```sh
docker compose config --quiet
docker compose build
docker compose run --rm studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite
docker compose up -d
curl --fail http://127.0.0.1:4310/api/health
```

The initialization command reads and confirms the new owner password without
echoing it. Open the configured HTTPS route, log in with that password, edit
the discovered `Example Blog` Site, and choose preview. Registration creates
only the Site identity and audit record in SQLite. To connect your own site,
replace the example workspace with a clean trusted checkout, install its locked
dependencies on the host, configure its generator/publisher adapters, and
review the discovered candidate before registering it.

Port 4310 binds only to localhost. Use the supplied Traefik override, another
TLS reverse proxy, or a private tunnel for browser access; do not expose the
plain HTTP port to a LAN or the internet. See the [complete self-hosting
guide](docs/guides/self-hosting.md) before configuring a remote publisher.

Local generator previews are separate from the Studio UI: Studio starts the
configured development command, while the host can route a preview hostname
directly to its container port (4000--4100 by convention). See the direct
preview section of the self-hosting guide before enabling that optional ingress.

## Architecture in one paragraph

Studio owns browser sessions, Site Agent Sessions and approvals, durable draft
snapshots, jobs, and release evidence. The Agent uses typed, Site-bounded file
and local Git tools and has no general shell or publishing tool. The configured
generator owns Markdown semantics and the final site shape. Versioned adapters
own repository access, article-scoped assets, publication, and cache
invalidation. The public static site never depends on the Studio process being
online.

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
- [Site Agent guide](apps/website/src/content/docs/en/docs/use/agent.md)
- [AI-assisted production checklist](docs/checklists/site-agent-ai-assisted-production.md)
- [Site Agent verification evidence](docs/verification/site-agent-runtime-api.md)
- [v0.1 release checklist](docs/checklists/v0.1.md)
- [v0.2 release checklist](docs/checklists/v0.2.md)
- [v0.2 implementation plan](docs/plans/2026-08-04-blog-studio-v0.2.md)
- [v0.1 implementation plan](docs/plans/2026-08-02-blog-studio-v0.1.md)
- [Self-hosting](docs/guides/self-hosting.md)
- [Sites and first run](docs/guides/sites-and-first-run.md)
- [Prepare, commit and release](docs/guides/prepare-commit-release.md)
- [Backup and restore](docs/guides/backup-restore.md)
- [Upgrade and rollback](docs/guides/upgrading.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)
- [v0.2.0 release-candidate notes](docs/releases/v0.2.0.md)
- [v0.2 release-candidate evidence index](docs/verification/v0.2-release-candidate.md)
- [v0.2 operations evidence](docs/verification/v0.2-operations.md)
- [v0.2 real reference Site evidence](docs/verification/v0.2-reference-site.md)
- [Verification evidence](artifacts/verification/release-readiness.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
