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

## Protected-main RC.2 rehearsal — 2026-08-03

After the current runtime deployment evidence merged, protected `main` commit
`53d504dd15449c131062fb599d40834a60e6e854` was exercised again with candidate
label `v0.1.0-rc.2`. The label was passed only to the local artifact generator:
no Git tag, registry push, or GitHub Release was created.

The production workflow's exact image settings were used for a local OCI
export: `linux/amd64`, `linux/arm64`, maximum provenance, and SBOM generation.
The build transferred 565.45 kB of context and passed the 1,019-entry lockfile
supply-chain policy for both platforms. Inspection read every manifest and
config directly from the OCI archive and proved:

| Scope       | Digest                                                                    | Revision label                             | User   |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| image index | `sha256:e0e3d82c76d4a690a324c31736751c31346a97303f080a0af6d85477d9150ded` | —                                          | —      |
| linux/amd64 | `sha256:ab4fc960660207b1228fa9994a7a2bd5d12700052ec915a3eac527279c953959` | `53d504dd15449c131062fb599d40834a60e6e854` | `node` |
| linux/arm64 | `sha256:0c630eb6b53b0e386901729d52595bcf3b508e6d6b47e977edaa8a103c237726` | `53d504dd15449c131062fb599d40834a60e6e854` | `node` |

Both platform configs expose the Apache-2.0 license, and the index contains two
additional attestation manifests. The 193,146,880-byte OCI archive had SHA-256
`9a5ee10dcd6661fa3c7a30b3a678500a567e9d590eb4862a743629ca3b7573f7`.
It remained a local test input and was moved to the system Trash after
verification.

The release generator bound that image-index digest to the source commit and
created two independent `v0.1.0-rc.2` directories. Recursive comparison found
no difference, and the verifier passed each directory independently. The first
bundle contained these hashes:

```text
bff89ae7544a0241c23364b7adffad18db2ef02d99eb007a25e767d776068bee  blog-studio-v0.1.0-rc.2.tar.gz
bee64ca57396317cf579c289e403a9f5ab097d19cf70afc6a52d05884939d7e9  container-digest.txt
505ef5eb20e4a74bd3ab7cdf0041a959ca2ded4afea3fe5c94a518b561a1cdac  release-metadata.json
6edb61163430a68a4cdcf6f9f72fb6fdcdde525267f880189c574ce411bfe347  RELEASE_NOTES.md
d57cfbcaee6f8a6cabb49b4b6654c7244e6c06637065def938da8dfb2599348a  UPGRADE.md
```

Signing readiness was audited separately. The workstation currently has no
OpenPGP secret key configured for Git and the public GitHub account exposes no
GPG or SSH signing key. No key was generated or registered implicitly. The
release workflow therefore remains fail-closed until the owner establishes a
GitHub-verifiable signing identity; after production phase B evidence merges,
the final workflow will rebuild from the signed tag's exact commit rather than
reuse this rehearsal digest.
