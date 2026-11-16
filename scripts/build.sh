#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_BIN="${TORE_NODE_BIN:-$(command -v node || true)}"
if ! "$NODE_BIN" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' 2>/dev/null; then
  NODE_BIN="$HOME/.local/share/hermes-shared-node-runtime/bin/node"
fi
if ! "$NODE_BIN" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' 2>/dev/null; then
  echo 'Derleme için Node.js 22.12+ gerekli. TORE_NODE_BIN ile açıkça seçin.' >&2
  exit 1
fi
"$NODE_BIN" local-reader/build.cjs
# Paths can otherwise survive in panic strings in a redistributable executable.
TORE_BUILD_ROOT="$(pwd -P)"
TORE_CARGO_ROOT="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$TORE_BUILD_ROOT=/tore-source --remap-path-prefix=$TORE_CARGO_ROOT=/cargo --remap-path-prefix=$HOME=/builder"
cargo build --locked --manifest-path server/Cargo.toml
