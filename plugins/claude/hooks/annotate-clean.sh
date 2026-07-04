#!/usr/bin/env bash
# SessionStart hook: GC stale annotated-sessions/ dirs.
# Keeps state from concurrent sessions intact (don't wipe other-session
# state on startup); only removes dirs that haven't been touched in >24h.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

input="$(cat)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && "${LIEN_CMD[@]}" path --store 2>/dev/null)"
else
  store="$("${LIEN_CMD[@]}" path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

# `find -mtime +N` truncates partial days; +1 actually means ">48h old",
# not ">24h". Use -mmin +1440 (24 * 60 minutes) to express "older than 24
# hours" exactly.
sessions_root="$store/annotated-sessions"
if [ -d "$sessions_root" ]; then
  find "$sessions_root" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null
fi

# Pre-warm the resolver's npx fallback in the background (detached, so this
# SessionStart hook returns immediately). Without a global lien install the
# first real hook invocation would otherwise pay npx's cold package install
# and blow its timeout; after this warm-up every later call is ~300ms.
("${LIEN_CMD[@]}" --version >/dev/null 2>&1 &)

exit 0
