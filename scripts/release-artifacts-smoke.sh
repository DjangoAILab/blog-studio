#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-release-artifacts.XXXXXX")"
tag='v0.1.0-rc.1'
digest='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

cleanup() {
  rm -rf "$fixture"
}
trap cleanup EXIT INT TERM

source_repo="$fixture/repository"
mkdir -p "$source_repo/docs/releases"
git -C "$repository_root" archive --format=tar HEAD | tar -xf - -C "$source_repo"
cp "$repository_root/scripts/create-release-artifacts.sh" "$source_repo/scripts/create-release-artifacts.sh"
cp "$repository_root/scripts/verify-release-artifacts.sh" "$source_repo/scripts/verify-release-artifacts.sh"
cp "$repository_root/docs/guides/upgrading.md" "$source_repo/docs/guides/upgrading.md"
cp "$repository_root/docs/releases/v0.1.0.md" "$source_repo/docs/releases/v0.1.0.md"
git -C "$source_repo" init --quiet
git -C "$source_repo" config user.name 'Blog Studio Release Smoke'
git -C "$source_repo" config user.email 'release-smoke@localhost'
git -C "$source_repo" add .
git -C "$source_repo" commit --quiet -m 'Release artifact smoke source'
commit="$(git -C "$source_repo" rev-parse HEAD^{commit})"

for run in first second; do
  bash "$source_repo/scripts/create-release-artifacts.sh" \
    --tag "$tag" \
    --ref "$commit" \
    --image ghcr.io/djangoailab/blog-studio \
    --digest "$digest" \
    --output "$fixture/$run" \
    --allow-untagged
  bash "$source_repo/scripts/verify-release-artifacts.sh" "$fixture/$run"
done

cmp "$fixture/first/blog-studio-$tag.tar.gz" "$fixture/second/blog-studio-$tag.tar.gz"
cmp "$fixture/first/SHA256SUMS" "$fixture/second/SHA256SUMS"
cmp "$fixture/first/release-metadata.json" "$fixture/second/release-metadata.json"

if bash "$source_repo/scripts/create-release-artifacts.sh" \
  --tag "$tag" \
  --ref "$commit" \
  --image ghcr.io/djangoailab/blog-studio \
  --digest "$digest" \
  --output "$fixture/unsigned" >/dev/null 2>&1; then
  echo 'untagged formal release was accepted' >&2
  exit 1
fi

if bash "$source_repo/scripts/create-release-artifacts.sh" \
  --tag "$tag" \
  --ref "$commit" \
  --image ghcr.io/djangoailab/blog-studio \
  --digest sha256:invalid \
  --output "$fixture/invalid-digest" \
  --allow-untagged >/dev/null 2>&1; then
  echo 'invalid container digest was accepted' >&2
  exit 1
fi

printf '\ncorrupted\n' >>"$fixture/second/UPGRADE.md"
if bash "$source_repo/scripts/verify-release-artifacts.sh" "$fixture/second" >/dev/null 2>&1; then
  echo 'corrupted artifact was accepted' >&2
  exit 1
fi

echo "release artifact smoke passed: deterministic archive, metadata, checksums, notes, upgrade guide, corruption rejection"
