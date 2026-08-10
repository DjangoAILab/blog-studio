---
title: The core user journey
description: The four outcomes Blog Studio must connect without hiding production risk.
---

Blog Studio exists to remove the coordination tax between an idea and a safe
release. It is not a CMS database, hosted control plane, or Hexo admin panel.

## 1. Return to the work

The owner registers a discovered Site, then returns to one content library that
merges published documents, native drafts, and modified working copies.
Discovery never rewrites files. Working copies are stored in SQLite with
optimistic versions, while the published Markdown file remains canonical.

A compatible editor must always provide source mode. Visual editing is a
convenience, not a reason to discard unknown front matter, raw HTML, or generator
syntax.

## 2. Ask for bounded assistance

The Site Agent is available from every page and keeps multiple durable Sessions
per Site. Article and Markdown-selection context is explicit and belongs to one
message; the workspace boundary remains the complete Site. File mutations use
approval or YOLO under the same hard policy, while publishing stays human-run.

## 3. See the real result

Preview first renders sanitized Markdown without a subprocess or Provider. When
supported, enhanced preview runs the configured static-site generator inside an
isolated sandbox and proxies the marker-verified target. The enhanced mode is
slower but preserves theme, plugin, permalink, and legacy-resource behavior;
failure falls back to Markdown with a typed diagnostic.

## 4. Make production change legible

A public release never begins from whichever files happen to be live at click
time. The owner first prepares an immutable ChangeSet, reviews it, applies it,
and creates a separate local Git commit. Only that recorded commit can enter the
persisted remote-release state machine:

1. preflight the reviewed revision and target;
2. build and hash output from a detached Git worktree;
3. compare it with the last verified manifest;
4. upload immutable assets before referencing pages;
5. invalidate the exact cache surface;
6. verify the public marker and URLs.

Every provider operation is awaited and recorded. A no-op diff performs no
uploads.

## 5. Recover without improvising

Before mutation, the publisher retains enough information to restore the prior
verified manifest. Preparation or build failures never touch production. A
mid-publish failure enters rollback instead of being reported as success.

Studio restart and public-site availability are separate concerns: the public
site is static and has no request-time dependency on Blog Studio.

## Why Hexo is an adapter

Hexo is the first demanding compatibility proof because it includes custom
front matter, tags, themes, plugins, permalink rules, and legacy resources. It
does not define the core domain. Generator, repository, asset, publisher, and
cache boundaries are versioned independently so another file-based generator
can implement the same journey.

## Deliberately deferred

Multi-user collaboration, scheduled or autonomous publishing, and a hosted
Agent remain outside this project finish line. AI assistance ends at local,
reviewable production changes; it does not turn preview or release into an
autonomous control plane.
