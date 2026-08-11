---
title: Preview the real site
description: Build and proxy the configured generator instead of approximating the theme.
sidebar:
  order: 3
---

Studio preview starts the configured generator inside the mounted workspace and
proxies the resulting site under an authenticated preview lifecycle.

## Before starting preview

Confirm that:

- the workspace is trusted;
- its lockfile dependencies are installed for the container architecture;
- the configured build executable exists below the workspace;
- generated output is writable by the Studio UID/GID; and
- the generator completes within the administrator timeout.

Adapter subprocesses receive an allowlisted environment and argument arrays,
not browser-provided shell fragments.

## Lifecycle

A healthy preview process is reused for the same workspace. Idle previews are
stopped, and an explicit stop ends the child process. Build errors are surfaced
as diagnostics rather than replaced with a generic Markdown rendering.

Preview is not production. It does not upload objects, invalidate a cache, or
advance release state.
