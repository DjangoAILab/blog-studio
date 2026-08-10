# Site Agent browser journey verification

**Date:** 2026-08-10
**Journey:** `apps/studio/e2e/authoring.spec.ts`

The disposable browser fixture registers two filesystem Sites with distinct
workspace roots and preview destinations (`:4000` and `:4100`). Two browser
tabs open explicit `siteId` URLs. Each tab shows the matching Site, preview
profile, and isolated Session list.

The journey then proves that the global Agent panel survives Site, content,
editor, source, preview, ChangeSet review, and settings navigation; creates and
switches multiple Sessions; archives/restores one; exposes approval and YOLO
with its untracked-deletion warning; proposes the current article; and captures,
displays, expands, and removes Markdown-selection context. ChangeSet review has
an in-dialog Agent entry because the modal correctly isolates the application
behind it. The same run retains the existing authoring, resource, preview,
conflict, ChangeSet, and release-review assertions.

The README GIF is generated from this same disposable Studio fixture by
`apps/studio/scripts/record-agent-demo.sh`. It is not a mockup.

## Reproduce

```sh
CI=true corepack pnpm@11.18.0 --filter studio e2e
corepack pnpm@11.18.0 --filter studio record:agent-demo
ffprobe -v error -show_entries format=duration,size \
  docs/media/site-agent-demo.gif
```

Expected media facts: 960×540, 12 fps, 21.33 seconds, 4,792,407 bytes, SHA-256
`b3678909a25e64775cdef1497a7ae505d330de0c042df667c0d8f63ce318531e`.

The 2026-08-10 acceptance run passed both Studio Playwright projects (the full
authoring journey and first-run recovery). The documentation journey separately
passed eight desktop/mobile Playwright cases, including keyboard-relevant Axe
rules, narrow viewport reflow, navigation, search, and deep links.
