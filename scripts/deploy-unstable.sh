#!/usr/bin/env bash
# Build the current Git revision and recreate the home-server Studio container.
# This is the unstable channel only. It never tags a public release.
set -euo pipefail

service_dir="${BLOG_STUDIO_SERVICE_DIR:-/home/wang/services/blog-studio}"
source_dir="${BLOG_STUDIO_SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
revision="${BLOG_STUDIO_VCS_REF:-${GITHUB_SHA:-}}"
compose_project="${BLOG_STUDIO_COMPOSE_PROJECT:-blog-studio}"

if [[ ! -d "$service_dir" ]]; then
  echo "unstable service directory is missing: $service_dir" >&2
  exit 1
fi
if [[ ! -f "$service_dir/.env" ]]; then
  echo "unstable host .env is missing: $service_dir/.env" >&2
  exit 1
fi
if [[ -z "$revision" ]]; then
  revision="$(git -C "$source_dir" rev-parse HEAD)"
fi
short_revision="$(git -C "$source_dir" rev-parse --short=7 "$revision")"
image="blog-studio:dev-${short_revision}"

compose=(
  docker
  compose
  --project-name "$compose_project"
  --project-directory "$service_dir"
  --env-file "$service_dir/.env"
  -f "$source_dir/docker-compose.yml"
  -f "$source_dir/deploy/traefik/docker-compose.override.yml"
)
if [[ -f "$source_dir/deploy/traefik/docker-compose.preview-4000.override.yml" ]]; then
  compose+=(-f "$source_dir/deploy/traefik/docker-compose.preview-4000.override.yml")
fi

echo "Building unstable image $image from $revision"
docker build \
  --build-arg "VCS_REF=$revision" \
  --tag "$image" \
  --tag blog-studio:dev \
  "$source_dir"

python3 - "$service_dir/.env" "$image" "$revision" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
image, revision = sys.argv[2], sys.argv[3]
values = {
    "BLOG_STUDIO_IMAGE": image,
    "BLOG_STUDIO_VCS_REF": revision,
}
lines = path.read_text().splitlines()
seen: set[str] = set()
next_lines: list[str] = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else ""
    if key in values:
        next_lines.append(f"{key}={values[key]}")
        seen.add(key)
    else:
        next_lines.append(line)
for key, value in values.items():
    if key not in seen:
        next_lines.append(f"{key}={value}")
path.write_text("\n".join(next_lines) + "\n")
path.chmod(0o600)
PY

echo "Recreating Studio from $image"
"${compose[@]}" up -d --no-deps --force-recreate studio
"${compose[@]}" ps

for _ in $(seq 1 20); do
  if curl --fail --silent --show-error "http://127.0.0.1:4310/api/health" >/dev/null; then
    echo "Unstable editor is healthy at revision $short_revision"
    exit 0
  fi
  sleep 3
done

echo "Unstable editor health check failed after recreating $image" >&2
exit 1
