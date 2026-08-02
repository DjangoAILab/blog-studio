# Container and operations verification — 2026-08-02

## Scope

The release image and Compose workflow were exercised locally on Docker Desktop
with a generated one-article Hexo-compatible fixture. No reference-blog file,
public object, DNS record, Traefik route, or Tencent resource was changed.

## Image evidence

- base image: digest-pinned Node.js `22.21.1-bookworm-slim`;
- local image: `blog-studio:test`;
- local image size: 145,991,128 bytes;
- configured runtime identity: `node` (UID 1000);
- healthcheck: public `/api/health` on container port 4310.

## Reproducible gates

```sh
docker build --tag blog-studio:test .
CI=true BLOG_STUDIO_SMOKE_IMAGE=blog-studio:test corepack pnpm container:smoke
CI=true BLOG_STUDIO_SMOKE_IMAGE=blog-studio:test corepack pnpm operations:smoke
```

The first smoke gate verified:

- effective UID 1000;
- read-only container root;
- dropped capabilities and `no-new-privileges` launch policy;
- health transition to `healthy`;
- unauthenticated workspace API returns 401;
- mounted secret-file login and CSRF session;
- acknowledged draft persisted to the mounted SQLite database;
- SIGTERM exits with status 0; and
- a removed/recreated container recovers the draft from the same data mount.

The operations gate verified:

- Compose startup from the built image;
- online SQLite backup while Studio remained available;
- atomic archive plus SHA-256 sidecar;
- an acknowledged post-backup mutation;
- mandatory service stop before restore;
- checksum, archive-format, path, and SQLite integrity validation;
- preservation of the replaced state in `.blog-studio-pre-restore-*`; and
- cold restart returning exactly the backed-up draft version and body.

Both commands exited 0. The synthetic fixture and containers were removed by
the test traps after completion.
