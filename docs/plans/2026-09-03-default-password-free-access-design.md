# Default password-free access

## Decision

Blog Studio defaults to password-free access because its primary deployment is
one person's local machine or trusted LAN. Operators retain the existing Owner
password flow by setting `BLOG_STUDIO_AUTH_MODE=password`; the application does
not infer network trust or prevent either choice.

## Runtime flow

The executable resolves an absent `BLOG_STUDIO_AUTH_MODE` to `none`. In that
mode, the browser posts an empty session request on startup. The server accepts
it only from an exact configured origin, returns signed session and CSRF
cookies, and requires both for protected APIs. Reopening an existing session
reuses its CSRF value so another tab does not invalidate an active tab.

In `password` mode, credential initialization, password login, rate limiting,
rotation, revocation, logout, and legacy migration behavior remain unchanged.
The authentication status endpoint reports the active mode so the UI can
either enter automatically or show the login/setup screen. System Settings
shows password controls only in password mode and explains that anyone who can
reach the origin can edit in password-free mode.

Existing password verifiers remain stored while password-free mode is active.
This makes switching modes a reversible configuration change.

## Verification and rollout

Server tests cover origin rejection, signed-session enforcement, CSRF rejection
and acceptance, session reuse, and disabled password mutation. Browser tests
cover direct password-free entry as well as the complete existing password
login/change/logout journey. Quick Start exercises the default mode, while the
container smoke test explicitly exercises password mode and cold restart.

The home-server Blog Editor inherits `BLOG_STUDIO_AUTH_MODE=none` from the
checked-in Compose default and reference environment. The unstable deployment
recreates the container without rewriting a user's explicit mode override.
