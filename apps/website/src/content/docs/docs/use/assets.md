---
title: Manage article assets
description: Immutable, article-scoped media without exposing permanent provider credentials.
sidebar:
  order: 2
---

Pasted or dropped images enter an upload lifecycle without sending permanent
cloud credentials to the browser. A local object URL provides immediate visual
feedback while the server validates and stores the asset.

## Key policy

New managed keys combine:

- a configured managed prefix;
- the immutable document ID;
- a content hash; and
- a sanitized extension.

This makes uploads idempotent and groups new resources naturally by article.
Changing a file produces a new immutable key instead of overwriting bytes behind
an existing cache URL.

## Image policy

The server independently checks declared MIME type and decoded content, removes
metadata, bounds dimensions, and produces deterministic formats according to
the configured policy. The editor inserts Markdown only after the provider
returns the durable public URL.

## Legacy resources

Existing resource paths are not migrated automatically. Configure them as
protected prefixes—for example `static`—so Studio cannot overwrite or delete
them. New article-scoped resources and old paths may coexist indefinitely.

Orphan deletion is not part of the v0.1 browser journey. Do not infer that a
missing Markdown reference authorizes destructive provider cleanup.
