# Native draft authoring journey

## Decision

New documents are generator-native files, not virtual database records. The
Hexo adapter creates them below `source/_drafts/` with a portable filename,
title, creation date, and empty body. Blog Studio also creates an acknowledged
SQLite draft snapshot immediately, so refresh and restart behavior is identical
for new and existing documents. The library loads both `posts` and `drafts`
collections and keeps the collection in every document reference.

Direct creation in `_posts` was rejected because another deployment watcher
could publish an unfinished article. SQLite-only documents were rejected
because they introduce a second content truth that Git and a workspace-only
restore cannot see.

## Publish boundary

Publishing a native draft must never include every Hexo draft and must not move
the canonical file before the remote release is verified. Blog Studio creates
an isolated workspace, applies the selected SQLite snapshot there, promotes
only that file from `_drafts` to `_posts`, and builds production output from the
isolation. After upload, cache completion, and public marker verification, a
commit hook applies the same write and promotion to the canonical workspace and
then deletes the acknowledged SQLite snapshot. A commit failure is a release
failure and triggers provider rollback. The isolation is always removed.

Existing-document publishing uses the same isolation and delayed canonical
commit, eliminating the current behavior where a failed build can consume a
draft. Baseline adoption and source-only releases do not need an isolation.

## Interaction and errors

The article library exposes an inline new-draft form with title and optional
portable slug. The server owns collision checks and date serialization. A
discard action requires confirmation and deletes only the version-matched
SQLite snapshot; it never deletes the file. Revision conflicts return the
existing conflict response. Unsupported generators fail closed with an
actionable capability error.

Tests cover adapter creation/promotion/collisions, API create/discard and CSRF,
failed-build source preservation, successful isolated promotion, and a browser
journey through create, autosave, refresh, preview, and discard.
