#!/usr/bin/env bash
set -euo pipefail

image="${BLOG_STUDIO_SMOKE_IMAGE:-blog-studio:test}"
port="${BLOG_STUDIO_SMOKE_PORT:-14310}"
container="blog-studio-smoke-$$"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-container-smoke.XXXXXX")"
origin="http://127.0.0.1:${port}"
owner_password="container-smoke-owner-password"
cookie_secret="container-smoke-cookie-secret-with-more-than-thirty-two-characters"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  rm -rf "$fixture"
}
trap cleanup EXIT INT TERM

mkdir -p \
  "$fixture/config" \
  "$fixture/data" \
  "$fixture/secrets" \
  "$fixture/workspace/node_modules/.bin" \
  "$fixture/workspace/source/_drafts" \
  "$fixture/workspace/source/_posts" \
  "$fixture/workspace/source/static"
chmod 755 "$fixture" "$fixture/config" "$fixture/secrets"
chmod 777 "$fixture/data" "$fixture/workspace"
printf '%s\n' "$cookie_secret" >"$fixture/secrets/cookie_secret"
chmod 644 "$fixture/secrets/cookie_secret"

cat >"$fixture/workspace/package.json" <<'JSON'
{"private":true,"dependencies":{"hexo":"smoke-fixture"}}
JSON
cat >"$fixture/workspace/_config.yml" <<'YAML'
url: http://example.invalid
permalink: :year/:month/:day/:title/
YAML
cat >"$fixture/workspace/source/_posts/hello.md" <<'MARKDOWN'
---
title: Container smoke test
date: 2026-08-02 10:00:00
---
Original source body.
MARKDOWN
printf '%s\n' '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="#0a84ff" d="M0 0h2v2H0z"/></svg>' \
  >"$fixture/workspace/source/static/preview-capability.svg"
cat >"$fixture/workspace/node_modules/.bin/hexo" <<'NODE'
#!/usr/bin/env node
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
await rm('public', { recursive: true, force: true });
await mkdir('public/2026/08/02/hello', { recursive: true });
const source = await readFile('source/_posts/hello.md', 'utf8');
await writeFile('public/index.html', '<a href="/2026/08/02/hello/">Smoke</a>');
await writeFile('public/2026/08/02/hello/index.html', source);
NODE
chmod 755 "$fixture/workspace/node_modules/.bin/hexo"
git -C "$fixture/workspace" init --quiet
git -C "$fixture/workspace" config user.name 'Blog Studio Container Smoke'
git -C "$fixture/workspace" config user.email 'container-smoke@localhost'
git -C "$fixture/workspace" add .
git -C "$fixture/workspace" commit --quiet -m 'Initialize container fixture'

cat >"$fixture/config/blog-studio.yml" <<'YAML'
version: 1
workspace:
  id: smoke-blog
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

start_container() {
  docker run --detach \
    --name "$container" \
    --init \
    --read-only \
    --user 1000:1000 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
    --publish "127.0.0.1:${port}:4310" \
    --env BLOG_STUDIO_CONFIG_PATHS=/config/blog-studio.yml \
    --env BLOG_STUDIO_WORKSPACE_ROOT=/workspaces \
    --env BLOG_STUDIO_DATABASE_PATH=/data/blog-studio.sqlite \
    --env BLOG_STUDIO_COOKIE_SECRET_FILE=/run/secrets/cookie_secret \
    --env BLOG_STUDIO_ALLOWED_ORIGINS="$origin" \
    --env BLOG_STUDIO_SECURE_COOKIES=false \
    --mount "type=bind,src=$fixture/data,dst=/data" \
    --mount "type=bind,src=$fixture/config/blog-studio.yml,dst=/config/blog-studio.yml,readonly" \
    --mount "type=bind,src=$fixture/workspace,dst=/workspaces/blog" \
    --mount "type=bind,src=$fixture/secrets/cookie_secret,dst=/run/secrets/cookie_secret,readonly" \
    "$image" >/dev/null
}

wait_for_health() {
  # The image healthcheck starts after 10s and runs every 30s. Give Docker
  # enough time to schedule the first probe on a cold or busy host.
  for _ in $(seq 1 120); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")"
    if [[ "$status" == "healthy" ]]; then
      return
    fi
    if [[ "$status" == "unhealthy" ]]; then
      docker logs "$container" >&2
      return 1
    fi
    sleep 0.5
  done
  docker logs "$container" >&2
  docker inspect --format '{{json .State.Health}}' "$container" >&2
  echo 'container did not become healthy' >&2
  return 1
}

wait_for_setup_status() {
  for _ in $(seq 1 40); do
    if [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/api/setup/status" || true)" == '200' ]]; then
      return
    fi
    sleep 0.25
  done
  docker logs "$container" >&2
  echo 'container setup status did not become reachable' >&2
  return 1
}

login() {
  curl --fail --silent --show-error \
    --cookie-jar "$fixture/cookies" \
    --header "Origin: $origin" \
    --header 'Content-Type: application/json' \
    --data "{\"password\":\"$owner_password\"}" \
    "$origin/api/session"
}

container_node() {
  docker exec "$container" node "$@"
}

printf '%s\n' "$owner_password" | docker run --rm --interactive \
  --user 1000:1000 \
  --mount "type=bind,src=$fixture/data,dst=/data" \
  "$image" node dist/server/cli.js auth init \
  --database /data/blog-studio.sqlite \
  --password-stdin

start_container
wait_for_health

[[ "$(docker exec "$container" id -u)" == '1000' ]]
if docker exec "$container" touch /root-filesystem-must-be-read-only 2>/dev/null; then
  echo 'container root filesystem is writable' >&2
  exit 1
fi
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/api/sites")" == '401' ]]

session="$(login)"
csrf="$(container_node -e 'const input=JSON.parse(process.argv[1]); process.stdout.write(input.csrfToken)' "$session")"
discovery="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/sites/discover")"
container_node -e 'const item=JSON.parse(process.argv[1]).candidates[0];if(item?.candidateId!=="smoke-blog"||item?.contentCounts?.posts!==1||item?.repository?.available!==true)process.exit(1)' "$discovery"
registered="$(curl --fail --silent --show-error \
  --request POST \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  --header 'Content-Type: application/json' \
  --data '{"candidateId":"smoke-blog","displayName":"Container Smoke Site"}' \
  "$origin/api/sites")"
site_id="$(container_node -e 'const input=JSON.parse(process.argv[1]);if(!input.site?.id)process.exit(1);process.stdout.write(input.site.id)' "$registered")"
documents="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/sites/$site_id/content?collection=posts")"
document_id="$(container_node -e 'const input=JSON.parse(process.argv[1]);const item=input.content.items[0];if(item?.state!=="published")process.exit(1);process.stdout.write(item.documentId)' "$documents")"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/sites/$site_id/content/$document_id?collection=posts")"
revision="$(container_node -e 'const input=JSON.parse(process.argv[1]); process.stdout.write(input.source.revision)' "$document")"
payload="$(container_node -e 'process.stdout.write(JSON.stringify({expectedVersion:0,sourceRevision:process.argv[1],frontMatter:{title:"Container smoke test",date:"2026-08-02 10:00:00"},body:"Durable draft from container smoke test.\n\n![Capability resource](/static/preview-capability.svg)\n"}))' "$revision")"
saved="$(curl --fail --silent --show-error \
  --request PUT \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$origin/api/sites/$site_id/content/$document_id/working-copy?collection=posts")"
container_node -e 'const input=JSON.parse(process.argv[1]); if(input.draft.version!==1) process.exit(1)' "$saved"
markdown_preview="$(curl --fail --silent --show-error \
  --request POST \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  "$origin/api/sites/$site_id/content/$document_id/preview?collection=posts&mode=markdown")"
markdown_preview_url="$(container_node -e 'process.stdout.write(JSON.parse(process.argv[1]).preview.url)' "$markdown_preview")"
markdown_html="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin$markdown_preview_url")"
capability_url="$(container_node -e '
const match=/src="([^"]*\/api\/markdown-previews\/[^"]+\/resource\?source=[^"]+)"/.exec(process.argv[1]);
if(!match)process.exit(1);
process.stdout.write(match[1].replaceAll("&amp;","&"));
' "$markdown_html")"
capability_headers="$fixture/capability-headers"
curl --fail --silent --show-error \
  --dump-header "$capability_headers" \
  --output "$fixture/capability-resource" \
  "$origin$capability_url"
grep -qi '^content-type: image/svg+xml' "$capability_headers"
grep -qi '^cache-control: no-store' "$capability_headers"
grep -q '<svg' "$fixture/capability-resource"
test -s "$fixture/data/blog-studio.sqlite"

docker stop --time 10 "$container" >/dev/null
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" == '0' ]]
docker rm "$container" >/dev/null
docker run --rm \
  --user 1000:1000 \
  --mount "type=bind,src=$fixture/data,dst=/data" \
  "$image" node -e \
  'const{mkdir,writeFile}=require("node:fs/promises");(async()=>{await mkdir("/data/preview-sandboxes/preview-interrupted",{recursive:true});await writeFile("/data/preview-sandboxes/preview-interrupted/partial","partial")})()'
start_container
wait_for_health
[[ -z "$(find "$fixture/data/preview-sandboxes" -mindepth 1 -maxdepth 1 -print -quit)" ]]

session="$(login)"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/sites/$site_id/content/$document_id?collection=posts")"
container_node -e 'const input=JSON.parse(process.argv[1]); if(input.draft?.version!==1 || !input.draft.body.includes("Durable draft")) process.exit(1)' "$document"

docker stop --time 10 "$container" >/dev/null
docker rm "$container" >/dev/null
cat >"$fixture/config/blog-studio.yml" <<'YAML'
version: invalid
YAML
start_container
wait_for_setup_status
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/api/health")" == '503' ]]
setup="$(curl --fail --silent --show-error "$origin/api/setup/status")"
container_node -e 'const input=JSON.parse(process.argv[1]);if(input.ready!==false||input.configuration?.state!=="invalid"||input.configuration?.nextAction!=="repair-configuration"||input.site?.state!=="unavailable")process.exit(1)' "$setup"
session="$(login)"
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --cookie "$fixture/cookies" "$origin/api/sites")" == '503' ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == 'true' ]]
docker stop --time 10 "$container" >/dev/null
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" == '0' ]]

echo 'container smoke passed: non-root, read-only root, health, auth, Git repository, Site registration, durable working copy, sandbox resource capability, SIGTERM, cold restart, interrupted preview recovery, fail-closed degraded setup'
