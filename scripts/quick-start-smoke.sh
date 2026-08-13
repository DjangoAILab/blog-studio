#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-quick-start.XXXXXX")"
project="blog-studio-quick-start-$$"
port="${BLOG_STUDIO_QUICK_START_PORT:-24310}"
origin="http://127.0.0.1:${port}"
owner_password='quick-start-owner-password'
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
printf '%s\n' "$cookie_secret" >"$fixture/secrets/cookie_secret"
chmod 600 "$fixture/secrets/cookie_secret"
git -C "$fixture/workspace" init --quiet
git -C "$fixture/workspace" config user.name 'Blog Studio Quick Start'
git -C "$fixture/workspace" config user.email 'quick-start@localhost'
git -C "$fixture/workspace" add .
git -C "$fixture/workspace" commit --quiet -m 'Initialize example workspace'

compose config --quiet
if [[ "${BLOG_STUDIO_QUICK_START_SKIP_BUILD:-false}" != 'true' ]]; then
  compose build --pull studio
fi
printf '%s\n' "$owner_password" | compose run --rm -T studio \
  node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite \
  --password-stdin
compose up -d studio

fail_studio() {
  echo "quick-start studio did not become healthy${1:+: $1}" >&2
  compose ps >&2 || true
  compose logs --tail=200 studio >&2 || true
  exit 1
}

container="$(compose ps -aq --status running studio)"
container="${container%%$'\n'*}"
[[ -n "$container" ]] || fail_studio 'container id missing after compose up'
health='missing'
for _ in $(seq 1 90); do
  if ! docker inspect "$container" >/dev/null 2>&1; then
    fail_studio 'container disappeared'
  fi
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  if [[ "$health" == 'healthy' ]]; then
    break
  fi
  if [[ "$health" == 'unhealthy' || "$health" == 'exited' || "$health" == 'dead' ]]; then
    fail_studio "$health"
  fi
  sleep 0.5
done
[[ "$health" == 'healthy' ]] || fail_studio "$health"
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/api/sites")" == '401' ]]

session="$(curl --fail --silent --show-error \
  --cookie-jar "$fixture/cookies" \
  --header "Origin: $origin" \
  --header 'Content-Type: application/json' \
  --data "{\"password\":\"$owner_password\"}" \
  "$origin/api/session")"
csrf="$(node -e 'const input=JSON.parse(process.argv[1]);process.stdout.write(input.csrfToken)' "$session")"
setup="$(curl --fail --silent --show-error "$origin/api/setup/status")"
node -e '
const input=JSON.parse(process.argv[1]);
if(input.ready!==false||input.credentials?.state!=="ready"||input.configuration?.state!=="valid"||input.site?.state!=="not-registered")process.exit(1);
' "$setup"
discovery="$(curl --fail --silent --show-error \
  --cookie "$fixture/cookies" \
  "$origin/api/sites/discover")"
node -e '
const item=JSON.parse(process.argv[1]).candidates[0];
if(item?.candidateId!=="example-blog"||item?.capabilities?.generator!=="command"||item?.capabilities?.createDocuments!==false||item?.capabilities?.publishConfigured!==false||item?.repository?.available!==true)process.exit(1);
' "$discovery"
registered="$(curl --fail --silent --show-error \
  --request POST \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  --header 'Content-Type: application/json' \
  --data '{"candidateId":"example-blog","displayName":"Example Blog"}' \
  "$origin/api/sites")"
site_id="$(node -e 'const input=JSON.parse(process.argv[1]);if(!input.site?.id)process.exit(1);process.stdout.write(input.site.id)' "$registered")"
setup="$(curl --fail --silent --show-error "$origin/api/setup/status")"
node -e 'const input=JSON.parse(process.argv[1]);if(input.ready!==true||input.site?.state!=="registered")process.exit(1)' "$setup"

documents="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/sites/$site_id/content?collection=posts")"
document_id="$(node -e 'const item=JSON.parse(process.argv[1]).content.items[0];if(item.title!=="Welcome to Blog Studio"||item.state!=="published")process.exit(1);process.stdout.write(item.documentId)' "$documents")"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/sites/$site_id/content/$document_id?collection=posts")"
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
  "$origin/api/sites/$site_id/content/$document_id/working-copy?collection=posts")"
node -e 'if(JSON.parse(process.argv[1]).draft.version!==1)process.exit(1)' "$saved"

preview="$(curl --fail --silent --show-error \
  --request POST \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  "$origin/api/sites/$site_id/content/$document_id/preview?collection=posts&mode=enhanced")"
preview_url="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).preview.url)' "$preview")"
curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin$preview_url" | grep -q 'Quick Start verified body'
test -s "$fixture/data/blog-studio.sqlite"
[[ -z "$(git -C "$fixture/workspace" status --short)" ]]

echo 'quick start passed: owner password, Site discovery/registration, Git repository, unified content, durable autosave, real preview, publish disabled'
