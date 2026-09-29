#!/usr/bin/env bash
# Registers Orbit's MCP server with Claude Code for all your projects (user scope), so any
# session can read and update the board. Safe to re-run (e.g. after switching Node versions).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
cd "$ROOT"
[ -f dist/mcp/index.js ] || npm run build:mcp --silent

claude mcp remove --scope user orbit >/dev/null 2>&1 || true
claude mcp add --scope user orbit -- "$NODE" "$ROOT/dist/mcp/index.js"
echo "✓ Registered. New Claude Code sessions can now use Orbit (try: \"what's on my board?\")."
