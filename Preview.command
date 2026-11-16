#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
TORE_PREVIEW_ROOT="$(pwd -P)"
mkdir -p "$TORE_PREVIEW_ROOT/.preview-data/archive" "$TORE_PREVIEW_ROOT/.preview-data/runtime"
if [[ ! -x "$TORE_PREVIEW_ROOT/server/target/debug/tore-server" ]]; then
  bash "$TORE_PREVIEW_ROOT/scripts/build.sh"
fi
exec "$TORE_PREVIEW_ROOT/server/target/debug/tore-server" \
  --archive "$TORE_PREVIEW_ROOT/.preview-data/archive" \
  --data "$TORE_PREVIEW_ROOT/.preview-data/runtime" \
  --listen 127.0.0.1:0 --open
