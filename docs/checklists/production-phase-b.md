# Production phase B checklist

This checklist promotes an adopted Tencent COS deployment from read-only
planning to one controlled production publish and rollback. It is deliberately
separate from baseline adoption: completing phase A is not authorization to
create or install a writer credential.

## Authorization and immutable inputs

- [x] The product owner has explicitly authorized production phase B, including
      creation of a separate writer and one controlled publish/rollback.
- [x] The adoption CAM user remains unchanged; no writer action is added to its
      policy or groups.
- [x] The deployed workspace revision, adopted release ID, marker hash, public
      inventory, and protected-prefix list are recorded.
- [x] The latest read-only plan has zero additions, zero deletions, and only the
      reviewed change set. Any new drift stops this checklist.
- [x] The legacy publisher remains frozen and cannot run concurrently.
- [x] A fresh online backup and checksum, prior Studio image, prior `.env`, and
      prior production configuration are retained.

## Generate the least-privilege policy

Use the deployed Blog Studio configuration as the source of truth so no
protected prefix is transcribed by hand. The command reads configuration only;
it never reads Tencent credentials.

```sh
policy_directory=$(mktemp -d)
chmod 700 "$policy_directory"
node scripts/tencent-production-writer-policy.mjs \
  --config /absolute/path/to/blog-studio.production.yml \
  --app-id 1250000000 \
  --output "$policy_directory/production-writer-policy.json"
```

- [x] Account ID, region, bucket, target prefix, state prefix, and every
      `publish.options.protectedPrefixes` entry match the deployed target.
- [x] Public and retained-state list/read/write resources are the only COS
      allows.
- [x] Every protected prefix has both an exact-object and descendant explicit
      deny for `PutObject` and `DeleteObject`.
- [x] The release marker is writable and is not listed as protected.
- [x] CDN permissions contain only `PurgeUrlsCache` and
      `DescribePurgeTasks`; `PurgePathCache`, EdgeOne, bucket configuration,
      account bucket listing, and wildcard COS actions are absent.
- [x] `corepack pnpm policy:smoke` passes before the generated policy is used.

## Create and prove the separate identity

- [x] Create a new API-only CAM sub-user with no console login and no groups.
- [x] Attach only the generated custom policy; do not attach a preset COS/CDN
      policy.
- [x] Read the active policy version back from CAM and compare its JSON with the
      locally reviewed file.
- [x] With the new credential, target/state `GetBucket` succeeds and an
      outside-prefix listing is denied.
- [x] A known protected production object remains readable.
- [x] Put/get/delete of a unique object under the retained-state prefix succeeds
      and leaves no probe object behind.
- [x] Do not probe protected-object denial by attempting to overwrite a real
      public object. The explicit-deny structure and policy read-back are the
      non-destructive proof before release.
- [x] Install the two credential values directly as mode-`0600` Docker secret
      files without printing them; destroy any downloaded credential CSV after
      successful installation.

## Activate without publishing

- [x] Recreate only Studio with the base, Traefik, and Tencent Compose files.
- [x] Container health and external HTTPS health return `200`; unauthenticated
      workspace access returns `401`.
- [x] Studio still runs non-root with a read-only root filesystem and the exact
      expected OCI revision.
- [x] Public root, archives, marker, sampled static objects, and every protected
      legacy URL retain their pre-activation status and hashes.
- [x] An authenticated build/plan repeats zero additions and zero deletions.

## Controlled publish and rollback

- [x] Start exactly one release and record every durable stage/event, provider
      request ID, object count, byte count, cache task, and marker verification.
- [x] Continuously check the marker, public root, archives, sampled current
      pages, static hashes, and all protected legacy URLs while the release
      progresses. No fixed canary delay is required after these gates pass.
- [x] Stop and roll back immediately on an unexpected plan, provider failure,
      cache timeout/failure, marker mismatch, protected URL/hash change, or
      public verification failure.
- [x] After success, invoke the verified rollback operation once and prove that
      the adopted marker, previous manifest, public samples, and protected URLs
      are restored exactly.
- [x] Confirm retained rollback state is complete, no release remains active,
      and the public blog stayed independent of Studio throughout.

## Evidence and credential disposition

- [x] Record only policy/user IDs, release IDs, request IDs, counts, durations,
      and hashes—never secret values.
- [x] Keep the adoption identity unmodified for audit history; disable or remove
      its active key after the writer path is proven.
- [x] Retain or rotate the writer key according to the operating decision, and
      document its storage controls, rotation triggers, and overlap procedure.
- [x] Merge evidence through protected `main` before signing `v0.1.0`.
