#!/usr/bin/env bash
set -euo pipefail

project_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${BLOG_STUDIO_SMOKE_IMAGE:-blog-studio:test}"
port="${BLOG_STUDIO_OPERATIONS_SMOKE_PORT:-14311}"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-operations-smoke.XXXXXX")"
origin="http://127.0.0.1:${port}"
export COMPOSE_PROJECT_NAME="blog-studio-operations-smoke"
export BLOG_STUDIO_IMAGE="$image"
export BLOG_STUDIO_LOCAL_PORT="$port"
export BLOG_STUDIO_ALLOWED_ORIGINS="$origin"
export BLOG_STUDIO_SECURE_COOKIES=false
export BLOG_STUDIO_DATA_PATH="$fixture/data"
export BLOG_STUDIO_CONFIG_PATH="$fixture/config/blog-studio.yml"
export BLOG_STUDIO_WORKSPACE_PATH="$fixture/workspace"
export BLOG_STUDIO_AUTH_TOKEN_PATH="$fixture/secrets/auth_token"
export BLOG_STUDIO_COOKIE_SECRET_PATH="$fixture/secrets/cookie_secret"
export BLOG_STUDIO_BACKUP_PATH="$fixture/backups"

cleanup() {
  docker compose -f "$project_directory/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$fixture"
}
trap cleanup EXIT INT TERM

mkdir -p \
  "$fixture/config" \
  "$fixture/data" \
  "$fixture/secrets" \
  "$fixture/workspace/source/_drafts" \
  "$fixture/workspace/source/_posts"
chmod 755 "$fixture" "$fixture/config" "$fixture/secrets"
chmod 777 "$fixture/data" "$fixture/workspace"
printf '%s\n' 'operations-smoke-auth-token' >"$fixture/secrets/auth_token"
printf '%s\n' 'operations-smoke-cookie-secret-with-more-than-thirty-two-characters' >"$fixture/secrets/cookie_secret"
chmod 644 "$fixture/secrets/auth_token" "$fixture/secrets/cookie_secret"
cat >"$fixture/workspace/package.json" <<'JSON'
{"private":true,"dependencies":{"hexo":"smoke-fixture"}}
JSON
cat >"$fixture/workspace/_config.yml" <<'YAML'
url: http://example.invalid
permalink: :year/:month/:day/:title/
YAML
cat >"$fixture/workspace/source/_posts/hello.md" <<'MARKDOWN'
---
title: Operations smoke test
date: 2026-08-02 10:00:00
---
Original source body.
MARKDOWN
cat >"$fixture/config/blog-studio.yml" <<'YAML'
version: 1
workspace:
  id: operations-blog
  root: /workspaces/blog
generator:
  adapter: hexo
repository:
  adapter: local-git
assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    protectedPrefixes: [static]
    publicBaseUrl: http://example.invalid/
publish:
  adapter: filesystem
  options:
    directory: /workspaces/blog/.published
verification:
  baseUrl: http://example.invalid
YAML

wait_for_health() {
  for _ in $(seq 1 60); do
    container_id="$(docker compose -f "$project_directory/docker-compose.yml" ps --quiet studio)"
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)"
    [[ "$status" == 'healthy' ]] && return
    [[ "$status" != 'unhealthy' ]] || break
    sleep 0.5
  done
  docker compose -f "$project_directory/docker-compose.yml" logs studio >&2
  return 1
}

login() {
  curl --fail --silent --show-error \
    --cookie-jar "$fixture/cookies" \
    --header "Origin: $origin" \
    --header 'Content-Type: application/json' \
    --data '{"token":"operations-smoke-auth-token"}' \
    "$origin/api/session"
}

save_draft() {
  local expected_version="$1"
  local body="$2"
  local session csrf documents document_id document revision payload
  session="$(login)"
  csrf="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).csrfToken)' "$session")"
  documents="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/operations-blog/documents?collection=posts")"
  document_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).documents[0].ref.documentId)' "$documents")"
  document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/operations-blog/documents/$document_id?collection=posts")"
  revision="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).source.revision)' "$document")"
  payload="$(node -e 'process.stdout.write(JSON.stringify({expectedVersion:Number(process.argv[1]),sourceRevision:process.argv[2],frontMatter:{title:"Operations smoke test",date:"2026-08-02 10:00:00"},body:process.argv[3]+"\n"}))' "$expected_version" "$revision" "$body")"
  curl --fail --silent --show-error \
    --request PUT \
    --cookie "$fixture/cookies" \
    --header "Origin: $origin" \
    --header "x-csrf-token: $csrf" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$origin/api/workspaces/operations-blog/documents/$document_id/draft?collection=posts"
}

docker compose -f "$project_directory/docker-compose.yml" up --detach --no-build
wait_for_health
first="$(save_draft 0 'Backed up durable draft.')"
node -e 'if(JSON.parse(process.argv[1]).draft.version!==1) process.exit(1)' "$first"
archive="$($project_directory/scripts/backup.sh)"
test -s "$archive"
test -s "$archive.sha256"

second="$(save_draft 1 'Mutation that restore must remove.')"
node -e 'if(JSON.parse(process.argv[1]).draft.version!==2) process.exit(1)' "$second"
docker compose -f "$project_directory/docker-compose.yml" stop studio >/dev/null
"$project_directory/scripts/restore.sh" --confirm "$archive"
docker compose -f "$project_directory/docker-compose.yml" up --detach --no-build
wait_for_health

session="$(login)"
documents="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/operations-blog/documents?collection=posts")"
document_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).documents[0].ref.documentId)' "$documents")"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/operations-blog/documents/$document_id?collection=posts")"
node -e 'const draft=JSON.parse(process.argv[1]).draft; if(draft?.version!==1 || draft.body!=="Backed up durable draft.\n") process.exit(1)' "$document"
test "$(find "$fixture" -maxdepth 1 -type d -name '.blog-studio-pre-restore-*' | wc -l | tr -d ' ')" = '1'

echo 'operations smoke passed: online SQLite backup, checksum, destructive mutation, validated restore, cold restart'
