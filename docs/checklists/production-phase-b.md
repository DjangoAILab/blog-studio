# Production phase B checklist

This checklist promotes an adopted Tencent COS deployment from read-only
planning to one controlled production publish and rollback. It is deliberately
separate from baseline adoption: completing phase A is not authorization to
create or install a writer credential.

## Authorization and immutable inputs

- [ ] The product owner has explicitly authorized production phase B, including
      creation of a separate writer and one controlled publish/rollback.
- [ ] The adoption CAM user remains unchanged; no writer action is added to its
      policy or groups.
- [ ] The deployed workspace revision, adopted release ID, marker hash, public
      inventory, and protected-prefix list are recorded.
- [ ] The latest read-only plan has zero additions, zero deletions, and only the
      reviewed change set. Any new drift stops this checklist.
- [ ] The legacy publisher remains frozen and cannot run concurrently.
- [ ] A fresh online backup and checksum, prior Studio image, prior `.env`, and
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

- [ ] Account ID, region, bucket, target prefix, state prefix, and every
      `publish.options.protectedPrefixes` entry match the deployed target.
- [ ] Public and retained-state list/read/write resources are the only COS
      allows.
- [ ] Every protected prefix has both an exact-object and descendant explicit
      deny for `PutObject` and `DeleteObject`.
- [ ] The release marker is writable and is not listed as protected.
- [ ] CDN permissions contain only `PurgeUrlsCache` and
      `DescribePurgeTasks`; `PurgePathCache`, EdgeOne, bucket configuration,
      account bucket listing, and wildcard COS actions are absent.
- [ ] `corepack pnpm policy:smoke` passes before the generated policy is used.

## Create and prove the separate identity

- [ ] Create a new API-only CAM sub-user with no console login and no groups.
- [ ] Attach only the generated custom policy; do not attach a preset COS/CDN
      policy.
- [ ] Read the active policy version back from CAM and compare its JSON with the
      locally reviewed file.
- [ ] With the new credential, target/state `GetBucket` succeeds and an
      outside-prefix listing is denied.
- [ ] A known protected production object remains readable.
- [ ] Put/get/delete of a unique object under the retained-state prefix succeeds
      and leaves no probe object behind.
- [ ] Do not probe protected-object denial by attempting to overwrite a real
      public object. The explicit-deny structure and policy read-back are the
      non-destructive proof before release.
- [ ] Install the two credential values directly as mode-`0600` Docker secret
      files without printing them; destroy any downloaded credential CSV after
      successful installation.

## Activate without publishing

- [ ] Recreate only Studio with the base, Traefik, and Tencent Compose files.
- [ ] Container health and external HTTPS health return `200`; unauthenticated
      workspace access returns `401`.
- [ ] Studio still runs non-root with a read-only root filesystem and the exact
      expected OCI revision.
- [ ] Public root, archives, marker, sampled static objects, and every protected
      legacy URL retain their pre-activation status and hashes.
- [ ] An authenticated build/plan repeats zero additions and zero deletions.

## Controlled publish and rollback

- [ ] Start exactly one release and record every durable stage/event, provider
      request ID, object count, byte count, cache task, and marker verification.
- [ ] Continuously check the marker, public root, archives, sampled current
      pages, static hashes, and all protected legacy URLs while the release
      progresses. No fixed canary delay is required after these gates pass.
- [ ] Stop and roll back immediately on an unexpected plan, provider failure,
      cache timeout/failure, marker mismatch, protected URL/hash change, or
      public verification failure.
- [ ] After success, invoke the verified rollback operation once and prove that
      the adopted marker, previous manifest, public samples, and protected URLs
      are restored exactly.
- [ ] Confirm retained rollback state is complete, no release remains active,
      and the public blog stayed independent of Studio throughout.

## Evidence and credential disposition

- [ ] Record only policy/user IDs, release IDs, request IDs, counts, durations,
      and hashes—never secret values.
- [ ] Keep the adoption identity unmodified for audit history; disable or remove
      its active key after the writer path is proven.
- [ ] Retain or rotate the writer key according to the operating decision, and
      document the next rotation date.
- [ ] Merge evidence through protected `main` before signing `v0.1.0`.
