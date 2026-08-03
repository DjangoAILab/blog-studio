#!/usr/bin/env bash
set -euo pipefail

image="${BLOG_STUDIO_SMOKE_IMAGE:-blog-studio:test}"
port="${BLOG_STUDIO_SMOKE_PORT:-14310}"
container="blog-studio-smoke-$$"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-container-smoke.XXXXXX")"
origin="http://127.0.0.1:${port}"
auth_token="container-smoke-auth-token"
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
  "$fixture/workspace/source/_posts"
chmod 755 "$fixture" "$fixture/config" "$fixture/secrets"
chmod 777 "$fixture/data" "$fixture/workspace"
printf '%s\n' "$auth_token" >"$fixture/secrets/auth_token"
printf '%s\n' "$cookie_secret" >"$fixture/secrets/cookie_secret"
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
title: Container smoke test
date: 2026-08-02 10:00:00
---
Original source body.
MARKDOWN
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
    --env BLOG_STUDIO_AUTH_TOKEN_FILE=/run/secrets/auth_token \
    --env BLOG_STUDIO_COOKIE_SECRET_FILE=/run/secrets/cookie_secret \
    --env BLOG_STUDIO_ALLOWED_ORIGINS="$origin" \
    --env BLOG_STUDIO_SECURE_COOKIES=false \
    --mount "type=bind,src=$fixture/data,dst=/data" \
    --mount "type=bind,src=$fixture/config/blog-studio.yml,dst=/config/blog-studio.yml,readonly" \
    --mount "type=bind,src=$fixture/workspace,dst=/workspaces/blog" \
    --mount "type=bind,src=$fixture/secrets/auth_token,dst=/run/secrets/auth_token,readonly" \
    --mount "type=bind,src=$fixture/secrets/cookie_secret,dst=/run/secrets/cookie_secret,readonly" \
    "$image" >/dev/null
}

wait_for_health() {
  for _ in $(seq 1 40); do
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
  echo 'container did not become healthy' >&2
  return 1
}

login() {
  curl --fail --silent --show-error \
    --cookie-jar "$fixture/cookies" \
    --header "Origin: $origin" \
    --header 'Content-Type: application/json' \
    --data "{\"token\":\"$auth_token\"}" \
    "$origin/api/session"
}

container_node() {
  docker exec "$container" node "$@"
}

start_container
wait_for_health

[[ "$(docker exec "$container" id -u)" == '1000' ]]
if docker exec "$container" touch /root-filesystem-must-be-read-only 2>/dev/null; then
  echo 'container root filesystem is writable' >&2
  exit 1
fi
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$origin/api/workspaces")" == '401' ]]

session="$(login)"
csrf="$(container_node -e 'const input=JSON.parse(process.argv[1]); process.stdout.write(input.csrfToken)' "$session")"
documents="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/smoke-blog/documents?collection=posts")"
document_id="$(container_node -e 'const input=JSON.parse(process.argv[1]); process.stdout.write(input.documents[0].ref.documentId)' "$documents")"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/smoke-blog/documents/$document_id?collection=posts")"
revision="$(container_node -e 'const input=JSON.parse(process.argv[1]); process.stdout.write(input.source.revision)' "$document")"
payload="$(container_node -e 'process.stdout.write(JSON.stringify({expectedVersion:0,sourceRevision:process.argv[1],frontMatter:{title:"Container smoke test",date:"2026-08-02 10:00:00"},body:"Durable draft from container smoke test.\n"}))' "$revision")"
saved="$(curl --fail --silent --show-error \
  --request PUT \
  --cookie "$fixture/cookies" \
  --header "Origin: $origin" \
  --header "x-csrf-token: $csrf" \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$origin/api/workspaces/smoke-blog/documents/$document_id/draft?collection=posts")"
container_node -e 'const input=JSON.parse(process.argv[1]); if(input.draft.version!==1) process.exit(1)' "$saved"
test -s "$fixture/data/blog-studio.sqlite"

docker stop --time 10 "$container" >/dev/null
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" == '0' ]]
docker rm "$container" >/dev/null
start_container
wait_for_health

session="$(login)"
document="$(curl --fail --silent --show-error --cookie "$fixture/cookies" "$origin/api/workspaces/smoke-blog/documents/$document_id?collection=posts")"
container_node -e 'const input=JSON.parse(process.argv[1]); if(input.draft?.version!==1 || !input.draft.body.includes("Durable draft")) process.exit(1)' "$document"

echo 'container smoke passed: non-root, read-only root, health, auth, durable draft, SIGTERM, cold restart'
