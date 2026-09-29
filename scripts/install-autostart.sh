#!/usr/bin/env bash
# Opens the Orbit app window automatically when you log in (GNOME/XDG autostart).
# Needs Orbit installed as an app from Chrome first. Run with --remove to turn it off.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$HOME/.config/autostart/orbit.desktop"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$TARGET"
  echo "✓ Orbit will no longer open at login (the service still runs)."
  exit 0
fi

LAUNCHER="$(grep -l -x "Name=Orbit" "$HOME"/.local/share/applications/chrome-*.desktop 2>/dev/null | head -1 || true)"
if [ -z "$LAUNCHER" ]; then
  echo "✗ Couldn't find the installed Orbit app. Open http://127.0.0.1:4700 in Chrome and install it first." >&2
  exit 1
fi
APP_ID="$(sed -n 's/.*--app-id=\([a-z]*\).*/\1/p' "$LAUNCHER" | head -1)"
ICON="$(sed -n 's/^Icon=//p' "$LAUNCHER" | head -1)"

mkdir -p "$(dirname "$TARGET")"
cat > "$TARGET" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Orbit
Comment=Open the Orbit board at login
Exec=bash $ROOT/scripts/open-app.sh $APP_ID
Icon=$ICON
Terminal=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
DESKTOP
echo "✓ Orbit will open at login (app $APP_ID). Turn off: npm run autostart:remove"
