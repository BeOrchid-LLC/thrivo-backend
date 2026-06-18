#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ "$#" -eq 0 ]; then
  set -- install
fi

docker run --rm \
  -v "$repo_root:/app" \
  -w /app \
  node:22-bookworm \
  npm "$@"
