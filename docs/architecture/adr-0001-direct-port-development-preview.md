# ADR-0001: Use direct container ports for local development previews

## Status

Accepted

## Context

Blog Studio starts generator development servers in per-Site sandbox copies.
The previous browser entry point put the generated site below a Studio API path.
Static-site generators commonly emit root-relative URLs such as `/css/style.css`.
Those URLs resolve at the editor origin rather than below the API path, leaving
styles, scripts, media and navigation broken.

Blog Studio is intended for a local computer or a local server. Its deployment
operator already controls Docker port publication and the trusted ingress. The
application does not need to provide a multi-tenant public preview gateway.

## Decision

Development servers listen on explicit container ports, conventionally in the
4000--4100 range. A host-defined development profile retains an internal
`baseUrl` for Studio readiness checks and adds `previewUrl`, the browser-facing
origin selected by the deployment operator.

Studio opens `previewUrl` directly and never proxies generated site responses.
Docker/Traefik/Nginx configuration maps an optional preview hostname or local
port directly to the selected container port. The base Compose service declares
the preview port range for container-network consumers but does not publish it
on a host interface by default.

## Consequences

### Positive

- Root-relative generated assets and links retain their normal browser meaning.
- Studio contains no HTML, CSS, redirect or WebSocket rewriting code.
- The same profile works behind Traefik, host Nginx, a local port, or another
  operator-managed private ingress.

### Negative

- Anyone allowed through the operator's preview ingress can read the preview;
  Studio session authentication does not protect it.
- Concurrent servers require distinct administrator-assigned ports. There is no
  automatic port allocator.
- A stopped server makes its direct preview origin unavailable until it restarts.

## Alternatives considered

- **Path-prefixed Studio proxy:** rejected because root-relative generated URLs
  require incomplete, generator-specific content rewriting.
- **Wildcard, tokenized preview subdomains:** rejected for this local-tool
  product because lifecycle and authentication machinery exceed the need.
- **Changing only Hexo `root`:** rejected because it binds a generic generator
  feature to one generator and changes canonical URL semantics.

## References

- [Development profile guide](../guides/sites-and-first-run.md)
- [Self-hosting guide](../guides/self-hosting.md)
