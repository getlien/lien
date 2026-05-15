#!/usr/bin/env bash
# SessionStart hook: garbage-collect stale gate-sessions/ dirs and clear
# the session-disable flag (which only persists until the next session).

set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && lien path --store 2>/dev/null)"
else
  store="$(lien path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

# `lien gate off` clears at session boundary; explicit `block` persists.
rm -f "$store/gate-disabled"

sessions_root="$store/gate-sessions"
if [ -d "$sessions_root" ] && [ -n "$session_id" ]; then
  find "$sessions_root" -mindepth 1 -maxdepth 1 -type d ! -name "$session_id" -exec rm -rf {} + 2>/dev/null
fi

exit 0
