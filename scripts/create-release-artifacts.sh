#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tag=''
source_ref=''
image=''
digest=''
output=''
allow_untagged=false

usage() {
  echo 'usage: create-release-artifacts.sh --tag TAG --ref GIT_REF --image IMAGE --digest SHA256 --output DIRECTORY [--allow-untagged]' >&2
}

while (($# > 0)); do
  case "$1" in
    --tag | --ref | --image | --digest | --output)
      if (($# < 2)); then
        usage
        exit 2
      fi
      case "$1" in
        --tag) tag="$2" ;;
        --ref) source_ref="$2" ;;
        --image) image="$2" ;;
        --digest) digest="$2" ;;
        --output) output="$2" ;;
      esac
      shift 2
      ;;
    --allow-untagged)
      allow_untagged=true
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$tag" || -z "$source_ref" || -z "$image" || -z "$digest" || -z "$output" ]]; then
  usage
  exit 2
fi
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]]; then
  echo "invalid semantic release tag: $tag" >&2
  exit 2
fi
if [[ ! "$image" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]]; then
  echo "invalid container image reference: $image" >&2
  exit 2
fi
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo 'container digest must be lowercase sha256 with 64 hexadecimal characters' >&2
  exit 2
fi

commit="$(git -C "$repository_root" rev-parse --verify "$source_ref^{commit}")"
if [[ "$allow_untagged" != true ]]; then
  tag_commit="$(git -C "$repository_root" rev-parse --verify "refs/tags/$tag^{commit}")"
  if [[ "$tag_commit" != "$commit" ]]; then
    echo "tag $tag does not point at source commit $commit" >&2
    exit 1
  fi
fi

if [[ -e "$output" && ! -d "$output" ]]; then
  echo "release output is not a directory: $output" >&2
  exit 1
fi
mkdir -p "$output"
if find "$output" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "release output must be empty: $output" >&2
  exit 1
fi

archive="blog-studio-$tag.tar.gz"
git -C "$repository_root" archive \
  --format=tar.gz \
  --prefix="blog-studio-$tag/" \
  --output="$output/$archive" \
  "$commit"
cp "$repository_root/docs/releases/v0.1.0.md" "$output/RELEASE_NOTES.md"
cp "$repository_root/docs/guides/upgrading.md" "$output/UPGRADE.md"
printf '%s@%s\n' "$image" "$digest" >"$output/container-digest.txt"

node - "$output/release-metadata.json" "$tag" "$commit" "$image" "$digest" "$archive" <<'NODE'
import { writeFileSync } from 'node:fs';

const [, , path, tag, commit, image, digest, archive] = process.argv;
writeFileSync(
  path,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      tag,
      sourceCommit: commit,
      sourceArchive: archive,
      container: { image, digest, immutableReference: `${image}@${digest}` },
      releaseNotes: 'RELEASE_NOTES.md',
      upgradeGuide: 'UPGRADE.md',
    },
    null,
    2,
  )}\n`,
);
NODE

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

(
  cd "$output"
  for file in \
    "$archive" \
    container-digest.txt \
    release-metadata.json \
    RELEASE_NOTES.md \
    UPGRADE.md; do
    checksum "$file"
  done
) >"$output/SHA256SUMS"

bash "$repository_root/scripts/verify-release-artifacts.sh" "$output"
echo "created verified release artifacts for $tag at $commit in $output"
