#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != '--confirm' || -z "${2:-}" ]]; then
  echo 'Usage: scripts/restore.sh --confirm <backup.tar.gz>' >&2
  echo 'The Studio service must be stopped. Current state is retained beside the restored paths.' >&2
  exit 2
fi

archive="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
checksum="$archive.sha256"
project_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_directory="${BLOG_STUDIO_DATA_PATH:-$project_directory/data}"
config_path="${BLOG_STUDIO_CONFIG_PATH:-$project_directory/config/blog-studio.yml}"
workspace_directory="${BLOG_STUDIO_WORKSPACE_PATH:-$project_directory/workspace}"
image="${BLOG_STUDIO_IMAGE:-blog-studio:local}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f "$archive" || ! -f "$checksum" ]]; then
  echo 'backup archive or .sha256 sidecar is missing' >&2
  exit 1
fi
if docker compose -f "$project_directory/docker-compose.yml" ps --status running --quiet studio | grep -q .; then
  echo 'stop the Studio service before restore: docker compose stop studio' >&2
  exit 1
fi
if command -v shasum >/dev/null 2>&1; then
  (cd "$(dirname "$archive")" && shasum -a 256 --check "$(basename "$checksum")")
else
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$checksum")")
fi

if tar -tzf "$archive" | awk '/^(\/|\.\.\/)/ || /\/\.\.\// { found=1 } END { exit found ? 0 : 1 }'; then
  echo 'backup contains an unsafe path' >&2
  exit 1
fi
staging="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-restore.XXXXXX")"
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT INT TERM
tar -C "$staging" -xzf "$archive"
grep -qx 'format=blog-studio-backup-v1' "$staging/metadata"
test -f "$staging/data/blog-studio.sqlite"
test -f "$staging/config/blog-studio.yml"
test -d "$staging/workspace"

docker run --rm \
  --entrypoint node \
  --mount "type=bind,src=$staging/data,dst=/restore" \
  "$image" \
  /opt/blog-studio/scripts/sqlite-verify.mjs /restore/blog-studio.sqlite

rollback_root="$(dirname "$data_directory")/.blog-studio-pre-restore-$timestamp"
if [[ -e "$rollback_root" ]]; then
  echo "rollback path already exists: $rollback_root" >&2
  exit 1
fi
mkdir -p "$rollback_root"
[[ ! -e "$data_directory" ]] || mv "$data_directory" "$rollback_root/data"
mkdir -p "$(dirname "$data_directory")"
mv "$staging/data" "$data_directory"

mkdir -p "$(dirname "$config_path")"
[[ ! -e "$config_path" ]] || mv "$config_path" "$rollback_root/blog-studio.yml"
mv "$staging/config/blog-studio.yml" "$config_path"

[[ ! -e "$workspace_directory" ]] || mv "$workspace_directory" "$rollback_root/workspace"
mkdir -p "$(dirname "$workspace_directory")"
mv "$staging/workspace" "$workspace_directory"

echo "restore complete; previous state retained at $rollback_root"
