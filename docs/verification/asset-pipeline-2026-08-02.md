# Asset pipeline verification — 2026-08-02

## Contract

New assets are owned by a workspace and immutable document ID. Their key is:

```text
<managed-prefix>/<document-id>/<full-sha256>-<sanitized-name>.webp
```

Legacy prefixes are configured independently and are never valid write or delete
targets. Existing Markdown URLs remain byte-identical; the authenticated editor
and isolated preview resolve them through the generator adapter.

## Automated evidence

- content signatures are checked independently from browser MIME declarations;
- byte and decoded-pixel budgets are enforced before encoding;
- Sharp auto-orients, bounds dimensions, strips metadata, and creates
  deterministic WebP output;
- filesystem storage is idempotent and refuses to overwrite corrupted content;
- filesystem and Tencent COS providers pass the shared asset contract;
- COS transient failures retry with a bounded policy and all calls are awaited;
- provider tests reject every scope outside the configured managed prefix;
- the Studio API accepts raw images only after session, origin, and CSRF checks;
- API integration proves the stored key is article-scoped and content-addressed;
- preview integration proves a root-relative legacy source asset is served from
  the isolated workspace when the generated output omits it.

No Tencent SDK client, credential, cloud bucket, public site, or reference source
file was mutated during this milestone. Production COS client wiring and a
non-production-prefix exercise remain release gates. Byte and pixel limits bound
normal processing, but hard wall-clock termination still requires moving Sharp
into a killable worker; the stricter release-checklist gate remains open.
