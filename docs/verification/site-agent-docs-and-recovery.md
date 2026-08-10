# Site Agent documentation, backup, and closure verification

**Date:** 2026-08-10

## Operational recovery

`apps/studio/server/test/site-agent-data.test.ts` creates real Pi JSONL and
attachment bytes beside a live SQLite database, takes an online checksummed
backup, restores into an empty cold target, runs SQLite/transcript/attachment
integrity checks, and opens the same Pi identity and history. The fixture
contains active and archived Sessions on two Sites plus completed-turn and
approved-tool audit rows. It verifies both Site workspaces byte-for-byte before
and after restore. Negative cases cover missing, corrupt, incompatible,
mismatched, and orphaned JSONL. Studio startup recovery separately proves
in-flight work becomes interrupted without tool replay.

Site workspaces are not Agent operational storage and are not replaced by this
restore. Normal local Git and the separate workspace backup policy remain the
recovery source for Site files.

## Documentation delivery

- `apps/website/src/content/docs/docs/use/agent.md` describes ownership,
  contexts, tools, modes, model configuration, attachments, vision, cancellation,
  persistence, recovery limits, and publishing separation.
- Supporting security, backup, troubleshooting, resource, journey, and generated
  configuration pages link to the same model.
- `.github/workflows/docs.yml` builds Astro/Starlight with the project base path,
  runs the internal-link checker, and deploys the artifact through official
  GitHub Pages actions pinned to immutable revisions.
- Local-root and `/blog-studio/` project-base builds are both verification gates.
- The README embeds the reproducible 21.33-second browser GIF and keeps
  autonomous publishing and deferred ecosystem work outside the claim.

## Reproduce

```sh
corepack pnpm@11.18.0 --filter @blog-studio/website build
BLOG_STUDIO_DOCS_SITE=https://djangoailab.github.io \
BLOG_STUDIO_DOCS_BASE=blog-studio \
  corepack pnpm@11.18.0 --filter @blog-studio/website build
corepack pnpm@11.18.0 --filter @blog-studio/website e2e
CI=true corepack pnpm@11.18.0 --filter studio e2e
CI=true corepack pnpm@11.18.0 check
corepack pnpm@11.18.0 format:check
```

All commands above passed on the reviewed 2026-08-10 working tree. The Pages
workflow is ready to publish after merge; this local verification does not
claim that an unmerged revision is already public.
