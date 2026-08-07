# Markdown Preview Resource Capability Design

**Status:** selected from real home-server acceptance on 2026-08-06.

## Problem

The Markdown iframe intentionally uses `sandbox=""`, so it has an opaque
origin. Its HTML loaded successfully with the owner's cookie, but subresource
requests to the authenticated Site resource route did not carry that cookie
and returned `401`. Existing API tests injected authentication headers directly
and therefore missed the browser boundary.

## Selected design

Keep the opaque iframe sandbox and the authenticated Site/workspace resource
routes unchanged. Each Markdown preview already has a cryptographically random,
short-lived session ID. During rendering, collect the exact local `src`/`href`
values rewritten into the HTML and bind them, plus the Site/document/collection
or legacy workspace context, to that preview session.

Local URLs become:

```text
/api/markdown-previews/<random-id>/resource?source=<encoded-exact-source>
```

Only this route bypasses the normal session hook. The handler must first prove
that the preview session exists and has not expired, then require the decoded
source to be an exact member of the session's referenced-resource set. It then
uses the existing generator resolver and `resolveWorkspacePath` boundary. The
response is `no-store`, `nosniff`, and receives the existing restrictive
resource CSP.

The random preview ID is a bounded bearer capability, consistent with the
existing generated-preview content URLs. `Referrer-Policy: no-referrer`, the
five-minute expiry, exact source allowlist, and path resolver limit exposure.
The capability cannot list resources, select another Site/document, traverse
the workspace, or survive a restart.

## Rejected alternatives

- `sandbox="allow-same-origin"` would make cookies work but weaken the strongest
  content isolation boundary.
- Relaxing authentication for the normal Site resource route would grant far
  broader access than one rendered preview needs.
- Embedding every resource as a data URL would increase memory and response
  size, duplicate media handling, and poorly fit video or large attachments.

## Verification

- Service tests prove local URL collection, exact allowlisting, remote URL
  preservation, and expiry.
- API tests fetch a referenced resource without authentication through the
  preview capability, reject an unreferenced resource, and keep the normal
  resource route authenticated.
- The browser journey asserts an image inside the fully sandboxed Markdown
  iframe has loaded bytes.
- The exact rebuilt Linux image must repeat quick-start, container, operations,
  home-server switch/rollback, real Markdown preview, Git/hash, and cold-start
  gates before acceptance.
