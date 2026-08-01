#!/usr/bin/env bash
# SessionEnd hook: clean up the current session's annotated-sessions dir,
# FEATURE 2's test-sessions/<sessionId>.jsonl ledger, and (HOOKS-6)
# annotate-read.sh's breaker-open notice marker, on graceful exit.
# Belt-and-braces — SessionStart's 24h-idle GC remains the load-bearing
# cleanup mechanism (covers crashes / force-quits).

set -u

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$session_id" ] || exit 0

# Defensive: session_id is interpolated into a path. Same hardening as
# the rest of the hook bundle — reject anything outside [A-Za-z0-9_-].
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0;;
esac

# HOOKS-6: remove this session's breaker-open notice marker regardless of
# whether `lien` itself is resolvable right now — same machine-global,
# store-independent, override-respecting path formula as annotate-clean.sh's
# GC of this directory and annotate-read.sh's own write side.
marker_default="${TMPDIR:-/tmp}/lien-npx-breaker/inflight"
until_default="$(dirname "${LIEN_NPX_BREAKER_MARKER:-$marker_default}")/breaker-open-until"
notice_dir="$(dirname "${LIEN_NPX_BREAKER_UNTIL_MARKER:-$until_default}")/notice-shown"
rm -f "$notice_dir/$session_id" 2>/dev/null

. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && "${LIEN_CMD[@]}" path --store 2>/dev/null)"
else
  store="$("${LIEN_CMD[@]}" path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

session_dir="$store/annotated-sessions/$session_id"
[ -d "$session_dir" ] && rm -rf "$session_dir" 2>/dev/null

test_session_file="$store/test-sessions/$session_id.jsonl"
[ -f "$test_session_file" ] && rm -f "$test_session_file" 2>/dev/null

exit 0
