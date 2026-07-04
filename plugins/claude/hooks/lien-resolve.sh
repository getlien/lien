#!/usr/bin/env bash
# Shared lien resolver for plugin hooks. A global `lien` install is NOT
# guaranteed — the plugin's own MCP server invokes `npx -y @liendev/lien@latest`
# for exactly that reason — so hooks must not hard-require one. Before this
# resolver existed, every hook opened with `command -v lien || exit 0`, which
# made the entire hook suite a silent no-op on machines without a global
# install (i.e. the default plugin setup).
#
# Usage (from a sibling hook script):
#   . "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0
#   "${LIEN_CMD[@]}" path --store
#
# Resolution order: global `lien` (fastest) → `npx -y @liendev/lien@latest`
# (warm npx adds ~300ms; the SessionStart hook pre-warms the cache so real
# hook invocations never pay the cold install). Fails the source (caller
# exits 0, staying silent) only when neither is available.

if command -v lien >/dev/null 2>&1; then
  LIEN_CMD=(lien)
elif command -v npx >/dev/null 2>&1; then
  LIEN_CMD=(npx -y @liendev/lien@latest)
else
  return 1
fi
