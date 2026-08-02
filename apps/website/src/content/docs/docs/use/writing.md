---
title: Write and autosave
description: How document discovery, editing modes, and durable drafts preserve file content.
sidebar:
  order: 1
---

## Open an existing document

The configured generator adapter discovers collections and returns stable
document references. Listing a workspace is read-only: files that you do not
edit remain byte-identical.

When a document opens, Studio shows the newest acknowledged draft when one
exists; otherwise it shows the file source. The header save state distinguishes
local changes, an in-flight save, a confirmed snapshot, an error, and an
optimistic-version conflict.

## Choose the right editing mode

- **Visual mode** is useful for ordinary Markdown structure.
- **Source mode** is the lossless escape hatch for raw HTML, Hexo tags, or
  syntax the visual editor cannot represent safely.

Studio may choose source mode automatically when it detects generator-specific
constructs. Switching modes must not itself create a draft change.

## What an acknowledged save means

An autosave response includes a monotonically increasing draft version. Once
acknowledged, that version survives browser refresh and service restart in the
mounted SQLite database. A request with a stale expected version is rejected as
a conflict instead of silently overwriting newer work.

Draft save does **not** commit Git, rewrite the source file, build the site, or
publish. Those remain explicit release actions.

## Conflict recovery

When Studio reports a conflict:

1. copy any unsaved text you need to retain;
2. reload the current server draft;
3. reconcile the two versions in source mode; and
4. save again against the current version.

v0.1 is a trusted single-user product, but optimistic revisions also protect
against stale tabs and prepare the data model for later collaboration.
