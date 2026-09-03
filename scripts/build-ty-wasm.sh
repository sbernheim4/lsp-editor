#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/.vendor"
RUFF_DIR="$VENDOR_DIR/ruff"
OUT_DIR="$ROOT_DIR/src/wasm/ty/pkg"

mkdir -p "$VENDOR_DIR"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required. Install Rust first, then rerun npm run build:ty-wasm." >&2
  exit 1
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack
fi

if [ ! -d "$RUFF_DIR/.git" ]; then
  git clone --depth 1 https://github.com/astral-sh/ruff.git "$RUFF_DIR"
else
  git -C "$RUFF_DIR" fetch --depth 1 origin main
  git -C "$RUFF_DIR" checkout FETCH_HEAD
fi

(
  cd "$RUFF_DIR"
  rustup target add wasm32-unknown-unknown
)

mkdir -p "$OUT_DIR"
wasm-pack build "$RUFF_DIR/crates/ty_wasm" \
  --target web \
  --out-dir "$OUT_DIR"

echo "Built ty_wasm into $OUT_DIR"
