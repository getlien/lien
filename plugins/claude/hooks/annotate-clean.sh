#!/usr/bin/env bash
# SessionStart hook: GC stale annotated-sessions/ dirs, FEATURE 2's
# test-sessions/ ledger files (test-verification-nudge.md), the
# nudge-build/ per-session build-stamp cache (issue #916, nudge-build.ts),
# and (HOOKS-6) annotate-read.sh's breaker-open notice markers. Keeps state
# from concurrent sessions intact (don't wipe other-session state on
# startup); only removes entries that haven't been touched in >24h.

set -u

# HOOKS-6: GC stale breaker-open notice markers FIRST, before the jq/lien
# requirement below — this directory is machine-global (same tmp-dir family
# as lien-npx-breaker.sh's own markers, computed with the exact same default
# formula annotate-read.sh uses, so a custom LIEN_NPX_BREAKER_MARKER/
# LIEN_NPX_BREAKER_UNTIL_MARKER override is honored here too), not
# store-scoped, specifically so it can be swept even when `lien` itself is
# unresolvable, i.e. exactly the condition that creates these markers.
marker_default="${TMPDIR:-/tmp}/lien-npx-breaker/inflight"
until_default="$(dirname "${LIEN_NPX_BREAKER_MARKER:-$marker_default}")/breaker-open-until"
notice_dir="$(dirname "${LIEN_NPX_BREAKER_UNTIL_MARKER:-$until_default}")/notice-shown"
[ -d "$notice_dir" ] && find "$notice_dir" -mindepth 1 -maxdepth 1 -type f -mmin +1440 -exec rm -f {} + 2>/dev/null

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

# FEATURE 2's session ledger: one <sessionId>.jsonl file per session (not a
# per-session directory, unlike annotated-sessions/ above), so the find
# targets files, not dirs.
test_sessions_root="$store/test-sessions"
if [ -d "$test_sessions_root" ]; then
  find "$test_sessions_root" -mindepth 1 -maxdepth 1 -type f -mmin +1440 -exec rm -f {} + 2>/dev/null
fi

# nudge-build/: one <sessionId>.json build-stamp cache per session (files,
# like test-sessions/ above, not directories).
nudge_build_root="$store/nudge-build"
if [ -d "$nudge_build_root" ]; then
  find "$nudge_build_root" -mindepth 1 -maxdepth 1 -type f -mmin +1440 -exec rm -f {} + 2>/dev/null
fi

# Pre-warm the resolver's npx fallback in the background (detached, so this
# SessionStart hook returns immediately). Without a global lien install the
# first real hook invocation would otherwise pay npx's cold package install
# and blow its timeout; after this warm-up every later call is ~300ms.
("${LIEN_CMD[@]}" --version >/dev/null 2>&1 &)

exit 0
