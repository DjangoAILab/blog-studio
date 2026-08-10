# Original-first article resource verification

**Date:** 2026-08-10
**Result:** Original storage is the default; processing is explicit and affects
only later uploads.

## Proven behavior

- With no processing configuration, an image reaches the AssetProvider with
  byte-identical content, the sniffed original media type, semantic original
  extension, and metadata intact.
- A strict owner-controlled Site policy exposes enabled state, original/WebP
  format, quality 1–100, maximum width 64–16384, and metadata stripping.
- Activating a Site policy rebuilds its pipeline. A PNG uploaded before
  activation stays byte-identical at its existing key; a later upload follows
  the selected WebP policy. No scan, rename, or bulk conversion occurs.
- Filesystem and COS providers remain behind the existing AssetProvider
  contract. Portable Markdown, protected prefixes, orphan confirmation, and
  ChangeSet resource freezing are unchanged.
- `ResourceRecord` is an upload result; no persistent resource entity was added.
  Agent attachments use separate SQLite metadata and external byte storage.

## Focused evidence

- `packages/assets/test/pipeline.test.ts`
- `packages/assets/test/resources.test.ts`
- `packages/config/test/schema.test.ts`
- `apps/studio/server/test/app.test.ts`, case “activates owner Site
  configuration atomically without exposing host policy”
- Existing resource, ChangeSet, filesystem, and Tencent provider suites.

## Reproduce

```sh
corepack pnpm@11.18.0 --filter @blog-studio/assets test
corepack pnpm@11.18.0 --filter @blog-studio/config test
corepack pnpm@11.18.0 --filter studio test
```
