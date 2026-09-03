#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/src/wasm/ty/pkg"

if [ ! -f "$OUT_DIR/ty_wasm.js" ] || [ ! -f "$OUT_DIR/ty_wasm_bg.wasm" ]; then
  echo "ty_wasm artifacts are missing; building them now..."
  bash "$ROOT_DIR/scripts/build-ty-wasm.sh"
fi
