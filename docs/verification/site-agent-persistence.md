# Site Agent persistence verification

**Date:** 2026-08-10
**Schema migrations:** 9, `site-agent-metadata`; 10,
`site-agent-turn-events`
**Result:** Product metadata, durable turn/event semantics, runtime/API
integration, and versioned operational backup/restore are implemented.

## Verified metadata boundary

SQLite now stores:

- Site-scoped Agent Session identity, Pi session ID, portable transcript key,
  display name, active/archive state, timestamps, and optional Session approval
  override;
- global and per-Site approval preferences;
- attachment identity, owning Session/message, filename, MIME type, byte size,
  hash, external storage key, processing state, and vision model identifier;
- an append-only-oriented tool audit index containing Site, Session, turn/tool
  identifiers, affected paths, mutation flag, approval decision, terminal state,
  and timestamps.

SQLite deliberately does not store transcript messages, attachment bytes,
vision interpretations, raw tool arguments, or raw tool results. Those remain
in Pi JSONL or the application attachment store, preserving one source of truth
for each payload.

## Verified behavior

- Session metadata survives database reopen and remains filtered by Site.
- Session rename, archive, restore, and active/archived listing are covered.
- Approval resolution is `Session > Site > global > safe approval default`.
- A Session override cannot be written through a different Site identity.
- Attachments bind once to a Pi message and track vision processing without
  copying image or interpretation content into SQLite.
- Tool audit records move from requested/pending to an indexed terminal state
  without duplicating transcript payloads.
- Migrations 9 and 10 are transactional and included in the migration suite.
- Online SQLite backup, Pi JSONL, and attachment bytes are copied into one
  versioned, checksummed directory and restored only into a new empty target.
- A cold restore verifies SQLite integrity, every referenced Pi transcript and
  attachment hash, then reopens the Session with its original Pi identity and
  history.
- Missing, empty, corrupt, newer-incompatible, identity-mismatched, and orphaned
  Pi JSONL are classified as actionable integrity errors. Verification never
  creates a replacement transcript.

- Queued/running/approval states, append-only event cursors, decision timestamps,
  cancellation, terminal states, and restart interruption are durable.
- Authenticated APIs and the UI surface Session, attachment, approval, turn, and
  transcript-unavailable states without reconstructing a second transcript.

## Reproduce

```sh
corepack pnpm@11.18.0 --filter @blog-studio/persistence test
corepack pnpm@11.18.0 --filter studio test
```
