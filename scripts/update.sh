#!/usr/bin/env bash
# Rebuilds Orbit after code changes and restarts the service, snapshotting the
# database first. Tests must pass before anything is restarted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Snapshotting database"
node scripts/snapshot.mjs pre-update
echo "→ Installing dependencies"
npm install --no-audit --no-fund --loglevel=error
echo "→ Running tests"
npm test --silent
echo "→ Building"
npm run build --silent
echo "→ Restarting service"
systemctl --user restart orbit.service
sleep 1
systemctl --user is-active --quiet orbit.service && echo "✓ Updated and running" || { echo "✗ Service failed; see journalctl --user -u orbit -n 50" >&2; exit 1; }
