#!/bin/bash
# Fleet Commander Installer
# Installs hook scripts, merges settings.json, and adds MCP server entry
# into a target repo's .claude directory.
#
# Usage: ./scripts/install.sh [/path/to/target/repo]
#   If no path given, auto-detects the git repo root from current directory.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Target repo: argument or auto-detect
TARGET="${1:-$(git rev-parse --show-toplevel 2>/dev/null || echo "")}"
if [ -z "$TARGET" ]; then
  echo "Error: No target repo specified and not in a git repository"
  echo "Usage: $0 /path/to/target/repo"
  exit 1
fi

# Normalise path (resolve symlinks, remove trailing slash)
TARGET="$(cd "$TARGET" && pwd)"

echo "Installing Fleet Commander into: $TARGET"
echo ""

# ── 1. Copy hook scripts ─────────────────────────────────────────
HOOK_DIR="$TARGET/.claude/hooks/fleet-commander"
mkdir -p "$HOOK_DIR"

# Copy all .sh files from the hooks directory
cp "$FC_ROOT/hooks/"*.sh "$HOOK_DIR/"
chmod +x "$HOOK_DIR/"*.sh

echo "  Copied hook scripts to $HOOK_DIR"

# ── 2. Merge into .claude/settings.json ──────────────────────────
SETTINGS="$TARGET/.claude/settings.json"
EXAMPLE="$FC_ROOT/hooks/settings.json.example"

if [ -f "$SETTINGS" ]; then
  # Merge Fleet Commander hook entries into existing settings,
  # preserving all existing hooks. Uses Node for reliable JSON handling.
  node -e "
    const fs = require('fs');
    const existing = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
    const example = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));

    if (!existing.hooks) existing.hooks = {};

    for (const [hookType, entries] of Object.entries(example.hooks || {})) {
      for (const entry of entries) {
        // Only add fleet-commander entries; skip others like pr-watcher
        const commands = (entry.hooks || []).map(h => h.command || '');
        const isFC = commands.some(c => c.includes('fleet-commander'));
        if (!isFC) continue;

        // Ensure the array exists for this hook type
        if (!existing.hooks[hookType]) existing.hooks[hookType] = [];

        // Check if this exact entry already exists (idempotent)
        const entryStr = JSON.stringify(entry);
        const alreadyExists = existing.hooks[hookType].some(
          e => JSON.stringify(e) === entryStr
        );
        if (!alreadyExists) {
          existing.hooks[hookType].push(entry);
        }
      }
    }

    fs.writeFileSync(process.argv[1], JSON.stringify(existing, null, 2) + '\n');
  " "$SETTINGS" "$EXAMPLE"
  echo "  Merged hook entries into existing settings.json"
else
  mkdir -p "$TARGET/.claude"
  cp "$EXAMPLE" "$SETTINGS"
  echo "  Created settings.json from template"
fi

# ── 3. Add MCP server entry to .mcp.json ─────────────────────────
MCP_JSON="$TARGET/.mcp.json"

# Convert FC_ROOT to a form usable in JSON (forward slashes)
FC_ROOT_JSON=$(printf '%s' "$FC_ROOT" | sed 's|\\|/|g')

if [ -f "$MCP_JSON" ]; then
  node -e "
    const fs = require('fs');
    const mcp = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
    if (!mcp.mcpServers) mcp.mcpServers = {};
    mcp.mcpServers['fleet-commander'] = {
      command: 'node',
      args: [process.argv[2] + '/mcp/dist/server.js'],
      env: { FLEET_SERVER_URL: 'http://localhost:4680' }
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(mcp, null, 2) + '\n');
  " "$MCP_JSON" "$FC_ROOT_JSON"
else
  node -e "
    const fs = require('fs');
    const mcp = {
      mcpServers: {
        'fleet-commander': {
          command: 'node',
          args: [process.argv[1] + '/mcp/dist/server.js'],
          env: { FLEET_SERVER_URL: 'http://localhost:4680' }
        }
      }
    };
    fs.writeFileSync(process.argv[2], JSON.stringify(mcp, null, 2) + '\n');
  " "$FC_ROOT_JSON" "$MCP_JSON"
fi
echo "  Added MCP server entry to .mcp.json"

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "Fleet Commander installed successfully!"
echo "  Hooks:    $HOOK_DIR"
echo "  Settings: $SETTINGS"
echo "  MCP:      $MCP_JSON"
