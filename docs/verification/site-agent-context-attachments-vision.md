# Site Agent context, attachment, and vision verification

**Date:** 2026-08-10
**Result:** Typed one-message context, external attachment storage, and a
replaceable vision adapter are implemented.

## Proven behavior

- Article, editor buffer, Markdown selection, preview error, diff, ChangeSet,
  file, attachment, and image references have strict schemas, count/size limits,
  and untrusted-data delimiters.
- Materialized context appears once in the originating Pi user message, remains
  in history, and is absent from the following message unless reattached.
- The editor proposes the current article, can add a dirty buffer, and exposes a
  keyboard-operable Markdown-selection chip. Every chip can be expanded for
  inspection or removed before send.
- Upload bytes live outside the Site root, are size-limited, MIME-sniffed,
  filename-sanitized, hashed, Session-owned, and never expose their storage key
  through HTTP.
- Image interpretation uses a separate OpenAI-compatible adapter/model. Failure
  retains the image and message, records an explicit failed state, and supports
  retry that appends the real result to the same Pi history.
- `import_attachment` is the only chat-to-Site copy path. It refuses overwrite
  and path escape and passes through the normal approval/YOLO runner and Site
  writer lock.

## Focused evidence

- `apps/studio/server/test/site-agent-context.test.ts`
- `apps/studio/server/test/agent-api.test.ts`, case “materializes one-message
  context and retains an image across vision retry”
- `packages/agent-runtime-pi/test/site-agent-policy.test.ts`, case “imports a
  Session attachment only through the mutation runner”
- `apps/studio/e2e/authoring.spec.ts` — article/selection proposal, inspection,
  removal affordance, and global panel behavior.

## Reproduce

```sh
corepack pnpm@11.18.0 --filter @blog-studio/agent-runtime-pi test
corepack pnpm@11.18.0 --filter studio test
CI=true corepack pnpm@11.18.0 --filter studio e2e
```
