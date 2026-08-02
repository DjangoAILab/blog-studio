# Release artifact dry-run — 2026-08-02

## Boundary

This exercise used the release candidate label `v0.1.0-rc.1` without creating a
Git tag, pushing a container, or creating a GitHub Release. It verifies the
artifact path before the real Tencent provider and controlled-production gates
permit a signed `v0.1.0` release.

At the end of the exercise, both `git tag --list` and the GitHub Releases API
were empty.

## Reproducible generator and negative cases

`pnpm release:smoke` generated two bundles from one temporary committed tree and
proved that their source archives, metadata, and checksum manifests were
byte-identical. It also proved that:

- formal mode rejects a missing tag unless `--allow-untagged` is explicit;
- a malformed image digest is rejected;
- the verifier requires the exact documented artifact set and archive prefix;
- required source paths are present; and
- changing one byte in `UPGRADE.md` makes checksum verification fail.

The same smoke runs as a required CI quality step. The tag-triggered Release
workflow additionally requires semantic version syntax and a GitHub-verified,
annotated signed tag that points directly at the workflow commit before it can
authenticate to GHCR or build an image.

## Committed-tree RC exercise

Source commit:

```text
832f95e1c39b3a128a6e5de9c0df85215372dbb1
```

A BuildKit OCI export used the formal release platforms and attestations:

```sh
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg VCS_REF=832f95e1c39b3a128a6e5de9c0df85215372dbb1 \
  --provenance=mode=max \
  --sbom=true \
  --output type=oci,dest=blog-studio-v0.1.0-rc.1.oci.tar \
  .
```

Observed OCI descriptors:

| Scope       | Digest                                                                    | Revision label                             |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| image index | `sha256:3be1e25191e36a5e04580fb92bcadda41d862d2fe9b1336afb74409687397f37` | —                                          |
| linux/amd64 | `sha256:62521d069cdd78718cef02a6c7e470bbd59bc344edb168a0c8d0474254e6d27d` | `832f95e1c39b3a128a6e5de9c0df85215372dbb1` |
| linux/arm64 | `sha256:84043d9b066acd1182e4d13ce833e318d4ccf66c44ab0cc7e8275572dee36f25` | `832f95e1c39b3a128a6e5de9c0df85215372dbb1` |

The 193,121,280-byte OCI archive SHA-256 was
`94618925e02a2f6535fdefc13342ae6d01a0cdd086470a9d7afccc2352f8eb3d`.
It remained local under `/tmp` and is not a release asset.

The first manual export used an incorrectly transcribed `VCS_REF`. Inspection
of the OCI config labels caught the mismatch before artifact creation. That
export was rejected; the table and bundle above refer only to the corrected
build. This is evidence that commit labels are checked rather than inferred
from a successful build exit code.

## Verified bundle

The committed-tree generator then bound the corrected image-index digest to the
source commit and produced:

```text
82c51aae0096ad3b37fe7fd17a586ad2207d689c228e9adba38452ca2c0f7373  blog-studio-v0.1.0-rc.1.tar.gz
0656717349b2d24424e84f95473166ff10ba020d353eb9967173dbc559abe67d  container-digest.txt
d660561125523b429ed5e7ee25dd4b068952595d35ba11b3298ef9858f3648ce  release-metadata.json
6edb61163430a68a4cdcf6f9f72fb6fdcdde525267f880189c574ce411bfe347  RELEASE_NOTES.md
d57cfbcaee6f8a6cabb49b4b6654c7244e6c06637065def938da8dfb2599348a  UPGRADE.md
```

`scripts/verify-release-artifacts.sh` independently returned
`release artifacts verified: v0.1.0-rc.1`. The source archive contained only
the `blog-studio-v0.1.0-rc.1/` prefix and included `README.md`, `LICENSE`,
`CHANGELOG.md`, and `docs/guides/upgrading.md`.

The formal v0.1.0 checklist remains unchecked: no signed tag, pushed GHCR
manifest, or GitHub Release exists, and the provider-backed release gates are
still open.
