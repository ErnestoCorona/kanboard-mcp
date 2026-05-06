#!/usr/bin/env bash
#
# Pre-publish gate — `scripts/preflight.sh`
#
# Single-purpose: prove the package can be installed from a clean state and that
# `npm run selftest` exits 0. Run this immediately before `npm publish`.
#
# Side effects:
#   1. Removes `node_modules/` and `package-lock.json` in the repo root.
#   2. Re-runs `npm install` from package.json.
#   3. Runs `npm run selftest` (which calls the live Kanboard API — env required).
#
# Exit code: 0 on success, non-zero on first failure.
# Idempotent: a clean install ALWAYS leaves a fresh node_modules + lockfile.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "[preflight] step 1/3 — wiping node_modules and package-lock.json"
rm -rf node_modules package-lock.json

echo "[preflight] step 2/3 — npm install (fresh)"
npm install

echo "[preflight] step 3/3 — npm run selftest"
npm run selftest

echo "[preflight] all checks passed"
