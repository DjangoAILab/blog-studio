# Editor and preview verification — 2026-08-02

## Scope

This verification exercised the production client/server build against the
administrator-configured reference Hexo workspace. The public site and cloud
resources were not contacted or mutated. Draft changes were stored in a
temporary SQLite database, and preview builds ran in temporary workspace
copies.

## Automated evidence

`apps/studio/server/test/app.test.ts` proves that:

- the production client is served with a no-cache HTML entry point and CSP;
- sessions, origins, and CSRF are enforced;
- autosaves use optimistic revisions and stale writes return a conflict;
- a saved draft is applied to an isolated preview workspace;
- the original source file remains unchanged after preview generation;
- selected-document preview URLs resolve through the preview capability;
- root-relative HTML and CSS resources are rewritten through the proxy;
- stopping a preview revokes its short-lived capability URL.

The full workspace quality gate passed with 36/36 tasks:

```sh
corepack pnpm exec prettier --check .
corepack pnpm exec turbo run lint typecheck test build
```

## Browser evidence

The production build was inspected with the in-app Chromium browser at the
default desktop viewport and at 390 × 844. The following were visually and
semantically checked:

- login and authenticated workspace screens;
- 93 reference documents discovered without browser-side path configuration;
- a long Chinese title wraps at the narrow viewport;
- visual Markdown content is present on first load (including after refresh);
- source mode exposes the original Markdown;
- a title edit reaches `刚刚保存`, and restoring it reaches the same state;
- a valid document builds in an isolated workspace and renders its real Hexo
  theme in the preview pane;
- historical document images resolve through the authenticated adapter without
  changing their Markdown URLs;
- generated-theme resources that are absent from output fall back to read-only
  source assets without escaping the preview capability;
- an invalid historical date displays an explicit preview error instead of an
  empty or stale frame.

The measured valid reference preview request completed in approximately 5.0
seconds on the local machine. Screenshots contained private article content and
were inspected in-session rather than committed to the public repository.

## Source-safety observation

After autosave, refresh, service restart, preview success, and preview failure,
`git status --porcelain` in the reference workspace remained empty. No source
document or existing public URL was changed.

## Remaining gates

- Automate the browser journey with Playwright and accessibility assertions.
- Measure LAN latency and cold-container behavior on the target server.
