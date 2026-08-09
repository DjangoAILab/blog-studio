#!/usr/bin/env bash
set -euo pipefail

studio_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/blog-studio-browser-e2e.XXXXXX")"
server_pid=''
invalid_server_pid=''
uninitialized_server_pid=''
mutator_pid=''

cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$invalid_server_pid" ]]; then kill "$invalid_server_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$uninitialized_server_pid" ]]; then kill "$uninitialized_server_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$mutator_pid" ]]; then kill "$mutator_pid" >/dev/null 2>&1 || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT INT TERM

mkdir -p \
  "$fixture/data" \
  "$fixture/published" \
  "$fixture/site/node_modules/.bin" \
  "$fixture/site/source/_drafts" \
  "$fixture/site/source/_posts" \
  "$fixture/site/source/static"

cat >"$fixture/site/package.json" <<'JSON'
{"private":true,"dependencies":{"hexo":"browser-fixture"}}
JSON
cat >"$fixture/site/_config.yml" <<'YAML'
url: http://example.invalid
permalink: :year/:month/:day/:title/
YAML

cat >"$fixture/invalid-blog-studio.yml" <<'YAML'
version: 1
workspace:
  id: invalid-browser-blog
YAML
cat >"$fixture/site/source/_posts/hello.md" <<'MARKDOWN'
---
title: Existing article
date: 2026-08-02T10:00:00.000Z
tags: [Browser, Existing]
---
Existing body.
MARKDOWN
BLOG_STUDIO_E2E_IMAGE="$fixture/site/source/static/reading.jpeg" \
node --input-type=module -e '
  import { writeFile } from "node:fs/promises";
  await writeFile(
    process.env.BLOG_STUDIO_E2E_IMAGE,
    Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=", "base64"),
  );
'
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
content:
  collections:
    posts:
      path: source/_posts
      draftPath: source/_drafts
  fields:
    featured:
      label: 精选
      type: boolean
      default: false
    mood:
      label: 心情
      type: string
      enum: [calm, focused]
      default: calm
verification:
  baseUrl: http://example.invalid/
developmentProfiles:
  hexo-preview:
    label: Hexo 本地预览
    command: $fixture/site/node_modules/.bin/hexo
    args: []
    baseUrl: http://127.0.0.1:4000/
    previewUrl: http://127.0.0.1:4000/
YAML

git -C "$fixture/site" init --initial-branch=main >/dev/null
git -C "$fixture/site" config user.name 'Blog Studio Browser Test'
git -C "$fixture/site" config user.email 'browser-test@blog-studio.invalid'
git -C "$fixture/site" add .
git -C "$fixture/site" commit -m 'Create browser test Site' >/dev/null

studio_database="$fixture/data/studio.sqlite"
printf '%s' 'browser-test-owner-password' | \
  node "$studio_directory/dist/server/cli.js" auth init \
    --database "$studio_database" --password-stdin >/dev/null

invalid_studio_database="$fixture/data/invalid-studio.sqlite"
printf '%s' 'browser-test-owner-password' | \
  node "$studio_directory/dist/server/cli.js" auth init \
    --database "$invalid_studio_database" --password-stdin >/dev/null

BLOG_STUDIO_CONFIG_PATHS="$fixture/invalid-blog-studio.yml" \
BLOG_STUDIO_WORKSPACE_ROOT="$fixture" \
BLOG_STUDIO_DATABASE_PATH="$invalid_studio_database" \
BLOG_STUDIO_COOKIE_SECRET='browser-test-invalid-cookie-secret-with-thirty-two-characters' \
BLOG_STUDIO_ALLOWED_ORIGINS='http://127.0.0.1:14312' \
BLOG_STUDIO_SECURE_COOKIES=false \
BLOG_STUDIO_HOST=127.0.0.1 \
BLOG_STUDIO_PORT=14312 \
BLOG_STUDIO_CLIENT_DIRECTORY="$studio_directory/dist/client" \
node "$studio_directory/dist/server/main.js" &
invalid_server_pid=$!

BLOG_STUDIO_CONFIG_PATHS="$fixture/blog-studio.yml" \
BLOG_STUDIO_WORKSPACE_ROOT="$fixture" \
BLOG_STUDIO_DATABASE_PATH="$fixture/data/uninitialized-studio.sqlite" \
BLOG_STUDIO_COOKIE_SECRET='browser-test-uninitialized-cookie-secret-thirty-two-characters' \
BLOG_STUDIO_ALLOWED_ORIGINS='http://127.0.0.1:14313' \
BLOG_STUDIO_SECURE_COOKIES=false \
BLOG_STUDIO_HOST=127.0.0.1 \
BLOG_STUDIO_PORT=14313 \
BLOG_STUDIO_CLIENT_DIRECTORY="$studio_directory/dist/client" \
node "$studio_directory/dist/server/main.js" &
uninitialized_server_pid=$!

BLOG_STUDIO_E2E_SOURCE="$fixture/site/source/_posts/hello.md" \
node --input-type=module -e '
  import { createServer } from "node:http";
  import { readFile, writeFile } from "node:fs/promises";
  import { dirname, join } from "node:path";
  const source = process.env.BLOG_STUDIO_E2E_SOURCE;
  let savedSource;
  createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    if (request.url === "/mutate") {
      await writeFile(source, `---\ntitle: Existing article\ndate: 2026-08-02T10:00:00.000Z\ntags: [Browser, Existing]\n---\nExisting body changed outside Studio.\n`);
    } else if (request.url === "/touch-repository") {
      await writeFile(join(dirname(source), "..", "e2e-unrelated.txt"), "unrelated repository change\n");
    } else if (request.url === "/break-source") {
      savedSource = await readFile(source, "utf8");
      await writeFile(source, "---\ntitle: [\n---\nincompatible front matter\n");
    } else if (request.url === "/restore-source" && savedSource) {
      await writeFile(source, savedSource);
      savedSource = undefined;
    } else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(204).end();
  }).listen(14314, "127.0.0.1");
' &
mutator_pid=$!

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
