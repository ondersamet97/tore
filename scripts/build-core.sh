#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Pin wasm-bindgen to core/Cargo.lock. Remap build-machine paths in panic strings.
if [[ "$(wasm-bindgen --version)" != "wasm-bindgen 0.2.105" ]]; then
  echo 'Install wasm-bindgen-cli 0.2.105 before rebuilding the compatibility assets.' >&2
  exit 1
fi
TORE_BUILD_ROOT="$(pwd -P)"
TORE_CARGO_ROOT="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$TORE_BUILD_ROOT=/tore-source --remap-path-prefix=$TORE_CARGO_ROOT=/cargo --remap-path-prefix=$HOME=/builder"
cargo build --locked --release --target wasm32-unknown-unknown --manifest-path core/Cargo.toml
wasm-bindgen core/target/wasm32-unknown-unknown/release/tore_core.wasm --target web --out-dir core/pkg
wasm-bindgen core/target/wasm32-unknown-unknown/release/tore_core.wasm --target nodejs --out-dir core/pkg-node
python3 - <<'PY'
from pathlib import Path
for folder in ('pkg', 'pkg-node'):
    data = Path('core', folder, 'tore_core_bg.wasm').read_bytes()
    assert b'/Users/' not in data and b'/home/' not in data, 'Unmapped personal build path'
print('Both compatibility WASM files rebuilt; personal path scan passed.')
PY
