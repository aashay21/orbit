#!/usr/bin/env bash
# Opens the installed Orbit app window (Chrome PWA) once the Orbit service is answering,
# so at login the window never lands on a "can't connect" page while the server starts.
# Usage: open-app.sh <chrome-app-id>     (DRY_RUN=1 prints the command instead)
set -euo pipefail

APP_ID="${1:?usage: open-app.sh <chrome-app-id>}"
PORT="${PORT:-4700}"

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done

CHROME="$(command -v google-chrome || echo /opt/google/chrome/google-chrome)"
CMD=("$CHROME" --profile-directory=Default --app-id="$APP_ID")
if [ "${DRY_RUN:-}" = 1 ]; then echo "${CMD[@]}"; exit 0; fi
exec "${CMD[@]}"
