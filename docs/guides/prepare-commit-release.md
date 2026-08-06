# Prepare, commit and release

Blog Studio separates a calm writing workflow from three progressively stronger
effects. Preparing is safe to inspect repeatedly. Applying changes canonical
files. Committing fixes selected local paths in Git. Releasing contacts a remote
Provider only after a separate confirmation.

## Before preparation

Editing a published article creates a versioned SQLite working copy. Autosave,
reload, Markdown preview and resource insertion do not rewrite the canonical
Markdown file. Native drafts remain native generator drafts.

If the canonical file changes outside Studio, normal editing stops. Studio
shows the current disk source and the saved working copy together. Choose either
to retain the working copy on the new source revision or, after a second
confirmation, discard it for the disk version. Neither version is silently
overwritten.

## 1. Prepare changes

**准备更改** freezes a durable ChangeSet containing the exact:

- source and working-copy revisions, front matter and bodies;
- referenced resource records and content hashes;
- Site configuration hash;
- Git branch, HEAD, managed diffs, untracked/ignored paths and staging state.

Preparation does not write canonical content, run a production build, create a
Git commit, push, upload, invalidate a cache or verify a public URL. Repeating it
with identical inputs returns the same prepared record. Changed inputs create a
new frozen review and supersede the old one.

Review every document before/after body, resource and repository path. Resolve
document conflicts before continuing.

## 2. Apply to local files

Applying requires its own checkbox confirmation. Immediately before writing,
Studio rechecks the Git head and working tree, configuration, document/draft
revisions and referenced resources. If anything changed, no stale record is
applied. Choose **按最新状态重新准备**, review the refreshed record and confirm
again.

Apply journals its intended writes before touching files. Synchronous failure
rolls back earlier writes; a cold start recovers a recognizable interrupted
apply and refuses ambiguous external content. After success, the canonical
files are local changes only—there is still no Git commit or remote effect.

## 3. Create a local commit

Enter an editable commit message and review exact paths. Applied document paths
are mandatory; unrelated working-tree paths start unchecked. Studio preserves
unrelated staged work, restores the prior Git index if commit creation fails,
records the resulting commit ID and never pushes.

Use the trusted host for branch management, remote configuration and pushes.
The Studio boundary is a local selected-path checkpoint.

## 4. Release the reviewed commit

Remote release appears only for a committed ChangeSet and a configured publish
Provider. It is visually separate and requires the exact confirmation phrase
shown in the dialog. The release builds from a detached worktree at the recorded
commit, not from whichever files happen to be in the live checkout.

The timeline exposes preflight, build, plan, upload, cache, verification,
cancellation, failure and rollback states. A successful prior release may offer
a separately confirmed rollback. Provider rollback is different from restoring
the Studio application or SQLite backup.

Never test this boundary against a production Site casually. Use a disposable
filesystem/staging Provider first, and do not initiate a production content
release without the owner's explicit confirmation for that specific attempt.

## Failure checklist

- **Preparation conflict:** close the review, resolve the visible source or
  working-copy conflict, and prepare again.
- **Repository/configuration changed:** use the in-dialog re-prepare action and
  re-review every changed path.
- **Apply interrupted:** stop manual edits, cold-start Studio and inspect the
  recovered ChangeSet before another attempt.
- **Commit failed:** inspect Git status/index on the trusted host; unrelated work
  should remain intact.
- **Release failed:** read the last stage event, preserve the immutable commit
  and manifest, and use cancellation/rollback only when the timeline offers it.

See [Backup and restore](backup-restore.md) for application-state recovery and
[Upgrade and rollback](upgrading.md) for container rollback.
