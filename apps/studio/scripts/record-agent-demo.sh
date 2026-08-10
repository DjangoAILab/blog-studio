#!/usr/bin/env bash
set -euo pipefail

studio_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_pid=''

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

cd "$studio_directory"
corepack pnpm build
bash scripts/e2e-server.sh &
server_pid=$!

for _attempt in {1..120}; do
  if curl --silent --fail http://127.0.0.1:14311/api/health >/dev/null; then
    node scripts/record-agent-demo.mjs "$@"
    exit 0
  fi
  sleep 0.25
done

echo 'Timed out waiting for the disposable Agent demo server' >&2
exit 1
