#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/.vendor"
RUFF_DIR="$VENDOR_DIR/ruff"
OUT_DIR="$ROOT_DIR/src/wasm/ty/pkg"
RUFF_COMMIT="53a94487e7f35600cd2a554099f2dd7518d18798"

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
fi

git -C "$RUFF_DIR" fetch --depth 1 origin "$RUFF_COMMIT"
git -C "$RUFF_DIR" checkout --detach "$RUFF_COMMIT"

(
  cd "$RUFF_DIR"
  rustup target add wasm32-unknown-unknown
)

mkdir -p "$OUT_DIR"
wasm-pack build "$RUFF_DIR/crates/ty_wasm" \
  --target web \
  --out-dir "$OUT_DIR"

echo "Built ty_wasm into $OUT_DIR"
