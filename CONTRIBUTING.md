# Contributing to Blog Studio

Thank you for helping make file-based publishing calmer and safer.

## Before opening a change

1. Search existing issues and read the [architecture](docs/architecture.md) and
   [product definition](docs/product.md).
2. Keep generator-, storage-, and provider-specific behavior behind an adapter;
   `packages/core` must remain provider-independent.
3. Do not introduce collaboration, scheduling, AI writing, or hosted-control-
   plane runtime services into the v0.1 line.
4. Never commit site content, cloud credentials, production configuration, or
   copied provider responses containing account secrets.

## Development

Blog Studio requires Node.js 22 and the Corepack-managed pnpm version declared
in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm container:smoke
```

Add focused tests before implementation for behavior changes. Adapter changes
should use the reusable conformance suites where applicable. A publishing
change must prove failure, retry, and rollback behavior, not only success.

## Pull requests

- Keep one coherent change per pull request.
- Explain user impact, compatibility, risk, verification, and rollback.
- Update generated reference documentation with `pnpm --filter
@blog-studio/website docs:generate` when contracts or configuration change.
- Link evidence for browser, provider, container, or production claims.
- Wait for the required `quality` check and address review before merging.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
For vulnerabilities, use the private process in [SECURITY.md](SECURITY.md).
