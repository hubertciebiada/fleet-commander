#!/bin/bash
# Bump the fleet-commander version across all stamped files.
#
# Usage: bash scripts/bump-version.sh <new-version>
#   e.g.: bash scripts/bump-version.sh 0.0.14
#
# Updates version stamps in:
#   - package.json (version field)
#   - package-lock.json (version field)
#   - .claude/settings.json (_fleetCommanderVersion field)
#   - templates/workflow.md (HTML comment line 1)
#   - templates/agents/*.md (YAML frontmatter _fleetCommanderVersion)
#   - templates/guides/*.md (HTML comment line 1)
#   - prompts/default-prompt.md (HTML comment line 1)
#   - prompts/*-prompt.md (HTML comment line 1)
#   - hooks/*.sh (comment line 2)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/bump-version.sh <new-version>"
  echo "  e.g.: bash scripts/bump-version.sh 0.0.14"
  exit 1
fi

NEW_VERSION="$1"

# Validate format
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must be in X.Y.Z format, got: $NEW_VERSION"
  exit 1
fi

OLD_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8')).version)" "$ROOT/package.json")"
echo "Bumping version: $OLD_VERSION -> $NEW_VERSION"

UPDATED=0

# ── Helper: sed in-place (cross-platform) ──────────────────────
sedi() {
  sed -i "$@" 2>/dev/null || sed -i '' "$@"
}

# ── package.json ────────────────────────────────────────────────
sedi "s|\"version\": \"${OLD_VERSION}\"|\"version\": \"${NEW_VERSION}\"|" "$ROOT/package.json"
echo "  package.json"
UPDATED=$((UPDATED + 1))

# ── package-lock.json (top-level + packages."" entry) ──────────
if [ -f "$ROOT/package-lock.json" ]; then
  sedi "s|\"version\": \"${OLD_VERSION}\"|\"version\": \"${NEW_VERSION}\"|g" "$ROOT/package-lock.json"
  echo "  package-lock.json"
  UPDATED=$((UPDATED + 1))
fi

# ── .claude/settings.json ──────────────────────────────────────
if [ -f "$ROOT/.claude/settings.json" ]; then
  sedi "s|\"_fleetCommanderVersion\": \"${OLD_VERSION}\"|\"_fleetCommanderVersion\": \"${NEW_VERSION}\"|" "$ROOT/.claude/settings.json"
  echo "  .claude/settings.json"
  UPDATED=$((UPDATED + 1))
fi

# ── Markdown: HTML comment line 1 ──────────────────────────────
bump_md_comment() {
  local file="$1"
  local first_line
  first_line="$(head -1 "$file")"
  if echo "$first_line" | grep -q "fleet-commander v"; then
    sedi "1s|fleet-commander v[0-9]*\.[0-9]*\.[0-9]*|fleet-commander v${NEW_VERSION}|" "$file"
    echo "  ${file#$ROOT/}"
    UPDATED=$((UPDATED + 1))
  fi
}

# ── Agent markdown: YAML frontmatter ───────────────────────────
bump_agent_md() {
  local file="$1"
  if grep -q "_fleetCommanderVersion:" "$file" 2>/dev/null; then
    sedi "s|_fleetCommanderVersion: \"[0-9]*\.[0-9]*\.[0-9]*\"|_fleetCommanderVersion: \"${NEW_VERSION}\"|" "$file"
    echo "  ${file#$ROOT/}"
    UPDATED=$((UPDATED + 1))
  fi
}

# ── Shell: comment line 2 ──────────────────────────────────────
bump_sh() {
  local file="$1"
  local second_line
  second_line="$(sed -n '2p' "$file")"
  if echo "$second_line" | grep -q "fleet-commander v"; then
    sedi "2s|fleet-commander v[0-9]*\.[0-9]*\.[0-9]*|fleet-commander v${NEW_VERSION}|" "$file"
    echo "  ${file#$ROOT/}"
    UPDATED=$((UPDATED + 1))
  fi
}

# ── Run across all files ────────────────────────────────────────

# workflow + guides
bump_md_comment "$ROOT/templates/workflow.md"
for f in "$ROOT"/templates/guides/*.md; do
  [ -f "$f" ] || continue
  bump_md_comment "$f"
done

# agent templates
for f in "$ROOT"/templates/agents/*.md; do
  [ -f "$f" ] || continue
  bump_agent_md "$f"
done

# prompts (default + per-project)
for f in "$ROOT"/prompts/*.md; do
  [ -f "$f" ] || continue
  bump_md_comment "$f"
done

# hooks
for f in "$ROOT"/hooks/*.sh; do
  [ -f "$f" ] || continue
  bump_sh "$f"
done

echo ""
echo "Done: $UPDATED files updated to v${NEW_VERSION}."
echo "Run 'bash scripts/verify-version-stamps.sh' to confirm."
