---
title: The core user journey
description: The four outcomes Blog Studio must connect without hiding production risk.
---

Blog Studio exists to remove the coordination tax between an idea and a safe
release. It is not a CMS database, hosted control plane, or Hexo admin panel.

## 1. Return to the work

The author opens a configured workspace and continues from the latest
acknowledged draft. Discovery never rewrites files. Drafts are stored in SQLite
with optimistic versions, while the published Markdown file remains canonical.

A compatible editor must always provide source mode. Visual editing is a
convenience, not a reason to discard unknown front matter, raw HTML, or generator
syntax.

## 2. See the real result

Preview runs the configured static-site generator in the workspace and proxies
its output. This is intentionally slower than a fake Markdown preview on first
start, but it preserves theme, plugin, permalink, and legacy-resource behavior.

## 3. Make production change legible

A release is not a shell command. It is a persisted state machine:

1. preflight the workspace and target;
2. apply the selected draft to source;
3. build and hash output;
4. compare it with the last verified manifest;
5. upload immutable assets before referencing pages;
6. invalidate the exact cache surface;
7. verify the public marker and URLs.

Every provider operation is awaited and recorded. A no-op diff performs no
uploads.

## 4. Recover without improvising

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

Multi-user collaboration, scheduled publishing, and AI writing are later
product capabilities. v0.1 keeps identifiers, durable jobs, and adapter
boundaries compatible with those directions without shipping placeholder UI or
runtime services for them.
