#!/usr/bin/env bash
# Builds Orbit and installs it as a systemd *user* service that starts at login,
# restarts on failure and serves http://127.0.0.1:$PORT. Safe to re-run (e.g. after
# switching Node versions with nvm, since the unit pins the node binary's path).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4700}"
NODE="$(command -v node)"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/orbit.service"

cd "$ROOT"
echo "→ Installing dependencies"
npm install --no-audit --no-fund --loglevel=error
echo "→ Building"
npm run build --silent

mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<UNIT
[Unit]
Description=Orbit task board (http://127.0.0.1:$PORT)

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$NODE $ROOT/dist/server/index.js
Environment=PORT=$PORT
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable orbit.service >/dev/null
systemctl --user restart orbit.service

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "✓ Orbit is running at http://127.0.0.1:$PORT"
    echo "  Data: $ROOT/data   Logs: journalctl --user -u orbit"
    exit 0
  fi
  sleep 0.5
done
echo "✗ Orbit didn't come up. Check: journalctl --user -u orbit -n 50" >&2
exit 1
