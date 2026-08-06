#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
input_list="$(mktemp "${TMPDIR:-/tmp}/blog-studio-candidate-inputs.XXXXXX")"
manifest_stream="$(mktemp "${TMPDIR:-/tmp}/blog-studio-candidate-manifest.XXXXXX")"

cleanup() {
  rm -f "$input_list" "$manifest_stream"
}
trap cleanup EXIT INT TERM

hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  else
    shasum -a 256
  fi
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

cd "$repository_root"
git ls-files --cached --others --exclude-standard -z | sort -z >"$input_list"

file_count=0
while IFS= read -r -d '' file; do
  case "$file" in
    Dockerfile | .dockerignore | .npmrc | package.json | pnpm-lock.yaml | pnpm-workspace.yaml | tsconfig.base.json | apps/* | packages/* | scripts/*)
      printf '%s\0' "$file" >>"$manifest_stream"
      hash_file "$file" | cut -d' ' -f1 >>"$manifest_stream"
      file_count=$((file_count + 1))
      ;;
  esac
done <"$input_list"

digest="$(hash_stream <"$manifest_stream" | cut -d' ' -f1)"
printf 'sha256:%s files=%s\n' "$digest" "$file_count"
