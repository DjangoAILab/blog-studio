#!/usr/bin/env bash
set -euo pipefail

studio_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-browser-e2e.XXXXXX")"
server_pid=''

cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT INT TERM

mkdir -p \
  "$fixture/data" \
  "$fixture/published" \
  "$fixture/site/node_modules/.bin" \
  "$fixture/site/source/_drafts" \
  "$fixture/site/source/_posts"

cat >"$fixture/site/package.json" <<'JSON'
{"private":true,"dependencies":{"hexo":"browser-fixture"}}
JSON
cat >"$fixture/site/_config.yml" <<'YAML'
url: http://example.invalid
permalink: :year/:month/:day/:title/
YAML
cat >"$fixture/site/source/_posts/hello.md" <<'MARKDOWN'
---
title: Existing article
date: 2026-08-02T10:00:00.000Z
---
Existing body.
MARKDOWN
cat >"$fixture/site/node_modules/.bin/hexo" <<'NODE'
#!/usr/bin/env node
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
await rm('public', { recursive: true, force: true });
await mkdir('public/2026/08/02/journey-draft', { recursive: true });
let source = 'No draft';
try { source = await readFile('source/_drafts/journey-draft.md', 'utf8'); } catch {}
await writeFile('public/index.html', '<a href="/2026/08/02/journey-draft/">Draft</a>');
await writeFile('public/2026/08/02/journey-draft/index.html', `<article>${source}</article>`);
NODE
chmod 755 "$fixture/site/node_modules/.bin/hexo"
cat >"$fixture/blog-studio.yml" <<YAML
version: 1
workspace:
  id: test-browser-blog
  root: $fixture/site
generator:
  adapter: hexo
repository:
  adapter: local-git
assets:
  adapter: filesystem
  options:
    rootDirectory: source
    managedPrefix: media/posts
    publicBaseUrl: http://example.invalid/
publish:
  adapter: filesystem
  options:
    directory: $fixture/published
verification:
  baseUrl: http://example.invalid/
YAML

studio_database="$fixture/data/studio.sqlite"
printf '%s' 'browser-test-owner-password' | \
  node "$studio_directory/dist/server/cli.js" auth init \
    --database "$studio_database" --password-stdin >/dev/null

BLOG_STUDIO_CONFIG_PATHS="$fixture/blog-studio.yml" \
BLOG_STUDIO_WORKSPACE_ROOT="$fixture" \
BLOG_STUDIO_DATABASE_PATH="$studio_database" \
BLOG_STUDIO_COOKIE_SECRET='browser-test-cookie-secret-with-at-least-thirty-two-characters' \
BLOG_STUDIO_ALLOWED_ORIGINS='http://127.0.0.1:14311' \
BLOG_STUDIO_SECURE_COOKIES=false \
BLOG_STUDIO_HOST=127.0.0.1 \
BLOG_STUDIO_PORT=14311 \
BLOG_STUDIO_CLIENT_DIRECTORY="$studio_directory/dist/client" \
node "$studio_directory/dist/server/main.js" &
server_pid=$!
wait "$server_pid"
