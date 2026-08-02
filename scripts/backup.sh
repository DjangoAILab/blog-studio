#!/usr/bin/env bash
set -euo pipefail

project_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${BLOG_STUDIO_BACKUP_PATH:-$project_directory/backups}"
data_directory="${BLOG_STUDIO_DATA_PATH:-$project_directory/data}"
config_path="${BLOG_STUDIO_CONFIG_PATH:-$project_directory/config/blog-studio.yml}"
workspace_directory="${BLOG_STUDIO_WORKSPACE_PATH:-$project_directory/workspace}"
compose_files=(-f "$project_directory/docker-compose.yml")
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="blog-studio-backup-$timestamp"

if [[ ! -f "$config_path" || ! -d "$workspace_directory" ]]; then
  echo 'configured Blog Studio config or workspace path does not exist' >&2
  exit 1
fi
mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd)"
staging="$(mktemp -d "$output_directory/.backup-staging.XXXXXX")"
database_snapshot=".backup-$timestamp.sqlite"
cleanup() {
  rm -rf "$staging"
  rm -f "$data_directory/$database_snapshot"
}
trap cleanup EXIT INT TERM

docker compose "${compose_files[@]}" exec -T studio \
  node /opt/blog-studio/scripts/sqlite-backup.mjs \
  /data/blog-studio.sqlite "/data/$database_snapshot"

mkdir -p "$staging/data" "$staging/config" "$staging/workspace"
cp "$data_directory/$database_snapshot" "$staging/data/blog-studio.sqlite"
cp "$config_path" "$staging/config/blog-studio.yml"
tar \
  --exclude='./node_modules' \
  --exclude='./public' \
  --exclude='./.published' \
  -C "$workspace_directory" \
  -cf - . | tar -C "$staging/workspace" -xf -
cat >"$staging/metadata" <<EOF
format=blog-studio-backup-v1
created_at=$timestamp
EOF

archive_temp="$output_directory/.$name.tar.gz.tmp"
archive="$output_directory/$name.tar.gz"
if [[ -e "$archive" || -e "$archive.sha256" ]]; then
  echo "backup already exists for timestamp: $archive" >&2
  exit 1
fi
tar -C "$staging" -czf "$archive_temp" metadata data config workspace
mv "$archive_temp" "$archive"
if command -v shasum >/dev/null 2>&1; then
  (cd "$output_directory" && shasum -a 256 "$(basename "$archive")" >"$(basename "$archive").sha256")
else
  (cd "$output_directory" && sha256sum "$(basename "$archive")" >"$(basename "$archive").sha256")
fi
chmod 600 "$archive" "$archive.sha256"
echo "$archive"
