#!/usr/bin/env bash
# SessionEnd hook: clean up the current session's annotated-sessions dir
# on graceful exit. Belt-and-braces — SessionStart's 24h-idle GC remains
# the load-bearing cleanup mechanism (covers crashes / force-quits).

set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$session_id" ] || exit 0

# Defensive: session_id is interpolated into a path. Same hardening as
# the rest of the hook bundle — reject anything outside [A-Za-z0-9_-].
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0;;
esac

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && lien path --store 2>/dev/null)"
else
  store="$(lien path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

session_dir="$store/annotated-sessions/$session_id"
[ -d "$session_dir" ] && rm -rf "$session_dir" 2>/dev/null

exit 0
