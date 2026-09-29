#!/usr/bin/env bash
# Stops Orbit and removes the systemd user service. Your data in ./data is kept.
set -euo pipefail
systemctl --user disable --now orbit.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/orbit.service"
systemctl --user daemon-reload
echo "✓ Orbit service removed (data left in place)"
