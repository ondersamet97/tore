#!/bin/bash
# töre: derleme gerektirmeyen macOS paketi (evrensel ikili + MCP paketi). Yalnız yerelde üretir; hiçbir şey yayımlamaz.
# Kullanım: paketle.sh <kaynak-ağaç> <çıktı-klasörü>
set -euo pipefail
SRC="$(cd "$1" && pwd -P)"; OUT="$2"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd -P)"
VER="$(grep -m1 '^version' "$SRC/server/Cargo.toml" | sed 's/.*"\(.*\)".*/\1/')"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$OUT/target}"
( cd "$SRC" && node local-reader/build.cjs )
CARGO_ROOT="${CARGO_HOME:-$HOME/.cargo}"
# Yollar dağıtılan ikilide kalmasın.
export RUSTFLAGS="--remap-path-prefix=$SRC=/tore-source --remap-path-prefix=$CARGO_ROOT=/cargo --remap-path-prefix=$HOME=/builder --remap-path-prefix=$CARGO_TARGET_DIR=/target"
for T in aarch64-apple-darwin x86_64-apple-darwin; do
  cargo build --release --locked --manifest-path "$SRC/server/Cargo.toml" --target "$T"
done
BIN="$OUT/tore-server"
lipo -create -output "$BIN" "$CARGO_TARGET_DIR/aarch64-apple-darwin/release/tore-server" "$CARGO_TARGET_DIR/x86_64-apple-darwin/release/tore-server"
strip -x "$BIN" 2>/dev/null || true
codesign --force --sign - "$BIN" >/dev/null 2>&1 || true   # geçici (ad hoc) imza; Apple Silicon çalıştırmak için ister
lipo -info "$BIN"
# MCP paketi (.mcpb = zip): manifest + ikili
P="$OUT/mcpb"; rm -rf "$P"; mkdir -p "$P/server"; cp "$BIN" "$P/server/tore-server"; cp "$SRC/LICENSE" "$P/LICENSE"
cat > "$P/manifest.json" <<JSON
{
  "manifest_version": "0.3",
  "name": "tore",
  "display_name": "töre",
  "version": "$VER",
  "description": "Read the topics you opened in your local töre notebook; leave proposals for your review.",
  "long_description": "Connects an AI tool on this computer to your own töre notebook. The tool sees only the topics and contexts you opened in töre. It cannot change the notebook: proposals wait in an inbox until you review them. No network requests, no telemetry.",
  "author": { "name": "the töre authors" },
  "repository": { "type": "git", "url": "https://github.com/ondersamet97/tore" },
  "homepage": "https://ondersamet97.github.io/en/",
  "documentation": "https://github.com/ondersamet97/tore/blob/main/docs/MCP.md",
  "license": "AGPL-3.0-only",
  "keywords": ["notebook", "local-first", "provenance", "decisions", "privacy"],
  "server": {
    "type": "binary",
    "entry_point": "server/tore-server",
    "mcp_config": {
      "command": "\${__dirname}/server/tore-server",
      "args": ["mcp", "--data", "\${user_config.data_dir}"]
    }
  },
  "user_config": {
    "data_dir": {
      "type": "directory",
      "title": "töre notebook folder",
      "description": "The data folder of your own töre notebook (the folder töre was started with as --data).",
      "required": true
    }
  },
  "compatibility": { "platforms": ["darwin"] }
}
JSON
( cd "$P" && rm -f "$OUT/tore-mcp-darwin.mcpb" && zip -q -r -X "$OUT/tore-mcp-darwin.mcpb" manifest.json LICENSE server )
shasum -a 256 "$OUT/tore-mcp-darwin.mcpb" | tee "$OUT/tore-mcp-darwin.mcpb.sha256"
ls -la "$OUT" | grep -v target
echo "sürüm $VER"
