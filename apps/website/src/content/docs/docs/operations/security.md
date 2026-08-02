---
title: Security model
description: Trust boundaries and hardening expectations for a single-user self-hosted publishing workbench.
---

Blog Studio v0.1 is designed for one trusted author and administrator. It should
run on a private network or behind a TLS reverse proxy. It is not a multi-tenant
isolation boundary.

## Browser boundary

- A long random access token creates a signed, same-site session.
- Mutating APIs require an exact allowed Origin, a signed CSRF cookie, and the
  matching CSRF header.
- Cookies are Secure by default; disabling this is only for local smoke tests.
- Permanent storage or cache credentials never enter browser responses.
- Request bodies and asset uploads have explicit limits.

## Workspace boundary

- Configuration is administrator-managed and strict.
- Workspace, document, and asset paths must remain under configured roots after
  symlink resolution.
- Browser input cannot define arbitrary shell commands.
- Generator processes use argument arrays, timeouts, and an environment
  allowlist.
- A repository is executable input: inspect and trust it before mounting.

## Container boundary

The supplied Compose service runs as a non-root UID/GID, drops all capabilities,
sets `no-new-privileges`, uses a read-only root filesystem, and mounts only
explicit writable data/workspace paths. The application port binds to localhost;
Traefik reaches the container over an external Docker network.

## Secret handling

The authentication and cookie secrets are mounted files. Provider secrets should
come from a secret manager or environment references. Do not commit `.env`,
secret files, provider logs, support bundles, or backup archives.

Rotate a compromised login token by replacing its file and recreating the
container. Rotate the cookie secret to invalidate all sessions. Provider-key
rotation must follow the provider's own least-privilege and overlap procedure.

## Public-site independence

Studio downtime prevents editing and publishing but does not affect requests to
the static public site. Never route public-site traffic through the Studio
container.

Security findings should follow the repository `SECURITY.md` process once the
v0.1 governance gate lands; do not disclose credentials or private site content
in a public issue.
