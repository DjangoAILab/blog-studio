# Native draft preview design

## Context and decision

Blog Studio creates new Hexo documents in `source/_drafts` and stores editor
changes as durable snapshots. Hexo does not include native drafts in a normal
build. The preview service previously wrote the snapshot into an isolated
workspace, resolved its future public URL, and ran the normal build. That made
the API return a plausible URL whose file did not exist.

Preview must keep the same safety boundary as release: no canonical source
mutation, exactly one selected draft in the generated site, and generator
behavior accessed through the versioned adapter contract. The selected design
therefore promotes a native draft only inside the existing preview sandbox.
After `writeDocument`, `PreviewService` calls the generator's existing
`promoteDocument` capability from `drafts` to `posts`, retains the returned
reference, and uses that reference for public URL resolution and legacy asset
fallback. Existing post previews keep their current flow.

Using Hexo's global `--draft` option was rejected because it would expose every
workspace draft and encode a Hexo-specific exception in the service. Adding a
new preview-only adapter method was rejected for v0.1 because the existing
promotion capability already expresses the required operation.

The Hexo child process also receives the site's configured `timezone` as `TZ`.
Hexo's date processor otherwise derives a different calendar day when an ISO
date is built in a UTC container for a non-UTC site, making the adapter's
resolved permalink disagree with the generated path. The environment remains
allowlisted and shell-free; no other host variables are inherited.

If a generator accepts native drafts but cannot promote them, preview fails
before build with a direct capability error. Sandbox cleanup continues through
the existing error path. A regression test uses the Hexo application fixture:
it creates and edits a native draft, requests a preview, follows the returned
URL, and asserts that only the sandbox-rendered body is available while the
canonical file remains under `_drafts`.
