---
title: Security model
description: Trust boundaries and hardening expectations for a single-user self-hosted publishing workbench.
---

## Site Agent boundary

Every Agent endpoint uses the same owner session, allowed-origin, CSRF,
request-size, rate, and Site-ownership controls as the rest of Studio. SSE is
authenticated before the connection is opened. Public payloads omit attachment
storage keys, authorization values, configured secrets, and sensitive tool
material.

The Agent runtime has no general shell. Filesystem operations are canonicalized
below the selected Site and protect `.git`; Git is a fixed local-only command
surface. Approval and YOLO differ only in whether the owner prompt is required.
Neither mode permits path escape, free-form Git arguments, hooks, aliases,
remote mutation, `git clean`, or whole-repository reset.

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
come from a secret manager or environment references. For a single-owner
self-hosted installation, dedicated files outside the repository are also
acceptable when they are owned by the runtime administrator, mode `0600`,
mounted read-only into the container, and protected by the host and backup
access controls. Do not retain downloaded credential CSVs or commit `.env`,
secret files, provider logs, support bundles, or backup archives.

Rotate a compromised login token by replacing its file and recreating the
container. Rotate the cookie secret to invalidate all sessions. Do not rotate a
healthy provider key solely because an arbitrary calendar interval elapsed.
Rotate after suspected exposure, a material identity or permission-boundary
change, a provider requirement, or cryptographic deprecation. Rotation must use
the provider's least-privilege and overlap procedure; ordinary security reviews
should recheck scope and usage without issuing a new credential.

## Public-site independence

Studio downtime prevents editing and publishing but does not affect requests to
the static public site. Never route public-site traffic through the Studio
container.

Security findings should follow the repository `SECURITY.md` process once the
v0.1 governance gate lands; do not disclose credentials or private site content
in a public issue.
