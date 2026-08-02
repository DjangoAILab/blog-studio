---
title: Publish and roll back
description: Understand manifest diffs, ordered mutation, cache invalidation, verification, and rollback.
sidebar:
  order: 4
---

## Release stages

The visible timeline moves through preflight, build, plan, asset upload, page
upload, cache invalidation, and public verification. Release and event records
are persisted before execution so a restart has deterministic recovery data.

## Manifest planning

Each generated file is represented by a portable path, content hash, byte size,
content type, and release phase. The publisher compares the new manifest with
the last verified one:

- unchanged hashes are skipped;
- new or changed immutable assets are uploaded first;
- HTML, indexes, feeds, sitemap, and the release marker follow;
- deletion is limited to the explicitly managed target; and
- protected legacy prefixes are outside application ownership.

A remote-object provider should use the retained manifest rather than issuing a
HEAD request for every output file.

## Verification

Publishing is successful only after provider operations resolve and the public
verifier observes the expected release marker. Cache acceptance alone is not
proof that a visitor can retrieve the new version.

## Cancellation and rollback

Cancellation is cooperative and checked between safe mutation boundaries. If a
release fails after target mutation begins, automatic rollback restores the
prior verified bytes and marker. Manual rollback is an online release operation:
it restores production but does not erase the author's current source edits.

Always retain the previous deployment mechanism until the new production
vertical passes its staging and rollback gates.
