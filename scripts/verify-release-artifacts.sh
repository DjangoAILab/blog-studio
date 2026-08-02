#!/usr/bin/env bash
set -euo pipefail

directory="${1:-}"
if [[ -z "$directory" || ! -d "$directory" ]]; then
  echo 'usage: verify-release-artifacts.sh DIRECTORY' >&2
  exit 2
fi

for file in SHA256SUMS container-digest.txt release-metadata.json RELEASE_NOTES.md UPGRADE.md; do
  if [[ ! -s "$directory/$file" ]]; then
    echo "missing or empty release artifact: $file" >&2
    exit 1
  fi
done

(
  cd "$directory"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check SHA256SUMS
  else
    shasum -a 256 --check SHA256SUMS
  fi
)

metadata="$(node - "$directory/release-metadata.json" "$directory/container-digest.txt" <<'NODE'
import { readFileSync } from 'node:fs';

const [, , metadataPath, digestPath] = process.argv;
const value = JSON.parse(readFileSync(metadataPath, 'utf8'));
const fail = (message) => {
  throw new Error(message);
};
if (value.schemaVersion !== 1) fail('unsupported release metadata schema');
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value.tag))
  fail('invalid metadata tag');
if (!/^[0-9a-f]{40}$/.test(value.sourceCommit)) fail('invalid source commit');
if (!/^sha256:[0-9a-f]{64}$/.test(value.container?.digest ?? ''))
  fail('invalid container digest');
if (value.container?.immutableReference !== `${value.container.image}@${value.container.digest}`)
  fail('container immutable reference mismatch');
if (readFileSync(digestPath, 'utf8') !== `${value.container.immutableReference}\n`)
  fail('container digest artifact mismatch');
if (value.sourceArchive !== `blog-studio-${value.tag}.tar.gz`)
  fail('source archive name mismatch');
if (value.releaseNotes !== 'RELEASE_NOTES.md' || value.upgradeGuide !== 'UPGRADE.md')
  fail('documentation artifact name mismatch');
process.stdout.write(`${value.tag}\t${value.sourceArchive}`);
NODE
)"
tag="${metadata%%$'\t'*}"
archive="${metadata#*$'\t'}"
if [[ ! -s "$directory/$archive" ]]; then
  echo "missing or empty source archive: $archive" >&2
  exit 1
fi

prefix="blog-studio-$tag/"
while IFS= read -r entry; do
  if [[ "$entry" != "$prefix"* ]]; then
    echo "source archive entry escapes expected prefix: $entry" >&2
    exit 1
  fi
done < <(tar -tzf "$directory/$archive")

for path in README.md LICENSE CHANGELOG.md docs/guides/upgrading.md; do
  if ! tar -tzf "$directory/$archive" "$prefix$path" >/dev/null 2>&1; then
    echo "source archive is missing required path: $path" >&2
    exit 1
  fi
done

expected="$(printf '%s\n' "$archive" container-digest.txt release-metadata.json RELEASE_NOTES.md UPGRADE.md | sort)"
actual="$(awk '{print $2}' "$directory/SHA256SUMS" | sed 's/^\*//' | sort)"
if [[ "$actual" != "$expected" ]]; then
  echo 'SHA256SUMS does not cover the exact required artifact set' >&2
  exit 1
fi

echo "release artifacts verified: $tag"
