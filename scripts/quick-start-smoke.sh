#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-quick-start.XXXXXX")"
project="blog-studio-quick-start-$$"
port="${BLOG_STUDIO_QUICK_START_PORT:-24310}"
origin="http://127.0.0.1:${port}"
auth_token='quick-start-auth-token-at-least-sixteen'
cookie_secret='quick-start-cookie-secret-with-more-than-thirty-two-characters'

export BLOG_STUDIO_IMAGE="${BLOG_STUDIO_QUICK_START_IMAGE:-blog-studio:quick-start}"
export BLOG_STUDIO_VCS_REF="quick-start-smoke"
export BLOG_STUDIO_UID="$(id -u)"
export BLOG_STUDIO_GID="$(id -g)"
export BLOG_STUDIO_LOCAL_PORT="$port"
export BLOG_STUDIO_ALLOWED_ORIGINS="$origin"
export BLOG_STUDIO_SECURE_COOKIES=false
export BLOG_STUDIO_DATA_PATH="$fixture/data"
export BLOG_STUDIO_CONFIG_PATH="$fixture/config/blog-studio.yml"
export BLOG_STUDIO_WORKSPACE_PATH="$fixture/workspace"
export BLOG_STUDIO_AUTH_TOKEN_PATH="$fixture/secrets/auth_token"
export BLOG_STUDIO_COOKIE_SECRET_PATH="$fixture/secrets/cookie_secret"

compose() {
  docker compose --project-directory "$repository_root" -p "$project" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$fixture"
}
trap cleanup EXIT INT TERM

mkdir -p "$fixture/config" "$fixture/data" "$fixture/secrets" "$fixture/workspace"
cp "$repository_root/examples/config/blog-studio.yml" "$fixture/config/blog-studio.yml"
cp -R "$repository_root/examples/workspace/." "$fixture/workspace/"
printf '%s\n' "$auth_token" >"$fixture/secrets/auth_token"
printf '%s\n' "$cookie_secret" >"$fixture/secrets/cookie_secret"
chmod 600 "$fixture/secrets/auth_token" "$fixture/secrets/cookie_secret"
git -C "$fixture/workspace" init --quiet
git -C "$fixture/workspace" config user.name 'Blog Studio Quick Start'
git -C "$fixture/workspace" config user.email 'quick-start@localhost'
git -C "$fixture/workspace" add .
git -C "$fixture/workspace" commit --quiet -m 'Initialize example workspace'

compose config --quiet
if [[ "${BLOG_STUDIO_QUICK_START_SKIP_BUILD:-false}" != 'true' ]]; then
  compose build --pull studio
fi
compose up -d studio

container="$(compose ps -q studio)"
for _ in $(seq 1 60); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")"
  if [[ "$health" == 'healthy' ]]; then break; fi
  if [[ "$health" == 'unhealthy' ]]; then
    compose logs --tail=200 studio >&2
    exit 1
  fi
  sleep 0.5
done
[[ "${health:-missing}" == 'healthy' ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/api/workspaces")" == '401' ]]

session="$(curl --fail --silent --show-error \
  --cookie-jar "$fixture/cookies" \
  --header "Origin: $origin" \
  --header 'Content-Type: application/json' \
  --data "{\"token\":\"$auth_token\"}" \
  "$origin/api/session")"
csrf="$(node -e 'const input=JSON.parse(process.argv[1]);process.stdout.write(input.csrfToken)' "$session")"
workspace="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces")"
node -e '
const item=JSON.parse(process.argv[1]).workspaces[0];
if(item.id!=="example-blog"||item.generator!=="command"||item.canCreateDocuments!==false||item.publishTarget.adapter!=="none"||item.publishTarget.configured!==false)process.exit(1);
' "$workspace"
scan="$(curl --fail --silent --show-error \
  --request POST \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  "$origin/api/workspaces/example-blog/scan")"
node -e '
const input=JSON.parse(process.argv[1]);
if(input.detection.detected!==true||input.detection.confidence!==1||input.model.collections.map((item)=>item.id).join(",")!=="posts,drafts")process.exit(1);
' "$scan"

documents="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/example-blog/documents?collection=posts")"
document_id="$(node -e 'const item=JSON.parse(process.argv[1]).documents[0];if(item.title!=="Welcome to Blog Studio")process.exit(1);process.stdout.write(item.ref.documentId)' "$documents")"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/example-blog/documents/$document_id?collection=posts")"
revision="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).source.revision)' "$document")"
front_matter="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).source.frontMatter))' "$document")"
payload="$(node -e 'process.stdout.write(JSON.stringify({expectedVersion:0,sourceRevision:process.argv[1],frontMatter:JSON.parse(process.argv[2]),body:"Quick Start verified body.\n"}))' "$revision" "$front_matter")"
saved="$(curl --fail --silent --show-error \
  --request PUT \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$origin/api/workspaces/example-blog/documents/$document_id/draft?collection=posts")"
node -e 'if(JSON.parse(process.argv[1]).draft.version!==1)process.exit(1)' "$saved"

preview="$(curl --fail --silent --show-error \
  --request POST \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  "$origin/api/workspaces/example-blog/documents/$document_id/preview?collection=posts")"
preview_url="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).preview.url)' "$preview")"
curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin$preview_url" | grep -q 'Quick Start verified body'
test -s "$fixture/data/blog-studio.sqlite"
[[ -z "$(git -C "$fixture/workspace" status --short)" ]]

echo 'quick start passed: command workspace, auth, article discovery, durable autosave, real preview, publish disabled'
