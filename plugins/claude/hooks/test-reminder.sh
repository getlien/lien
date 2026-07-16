#!/usr/bin/env bash
# PostToolUse hook on Edit|Write|MultiEdit: after an edit, remind the model
# which test files are associated with the file it just changed. Closes the
# read -> write -> verify loop the way `annotate-read.sh`'s plan-time nudge
# (#772) closed read -> write: CLAUDE.md mandates checking `testAssociations`
# and running those tests after a change, but nothing nudged it before this.
#
# Deliberately a sibling script, not folded into `delta-write.sh` — that
# script's whole job is the complexity-delta gate; this one's is test
# association. Both are separate hook entries on the same
# `Edit|Write|MultiEdit` matcher in hooks.json and run independently.
#
# Uses `lien annotate <file> --tests-only`, the cheap test-association-only
# path (a single `vectorDB.scanAll()`, no dependency-graph BFS) — see
# `runTestsOnly` in annotate-cmd.ts. Silent when the file has no associated
# tests. TTL-suppressed per file per session (same touchfile pattern and
# `annotated-sessions/` directory as `annotate-read.sh`, so the existing
# SessionStart/SessionEnd GC covers this too) so an edit burst on one file
# only reminds once per window.
#
# Best-effort throughout — never fails the user's edit. Disable via
# LIEN_TEST_REMINDER=off.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

# Env kill switch.
if [ "${LIEN_TEST_REMINDER:-}" = "off" ]; then
  exit 0
fi

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
case "$tool_name" in
  Edit | Write | MultiEdit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$file_path" ] || exit 0
[ -n "$session_id" ] || exit 0

# Defensive: session_id will be embedded in a filesystem path. Reject anything
# outside [A-Za-z0-9_-] so a crafted value can't traverse out of the
# session dir (same hardening as annotate-read.sh / annotate-end.sh).
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0;;
esac

# Resolve store from the session's cwd so multi-repo setups work correctly.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && "${LIEN_CMD[@]}" path --store 2>/dev/null)"
else
  store="$("${LIEN_CMD[@]}" path --store 2>/dev/null)"
fi
# Gate on a real index existing, not just a resolvable store path — the
# same "is this repo indexed?" signal augment-explore-task.sh uses.
[ -n "$store" ] && [ -f "$store/structural.db" ] || exit 0

# Per-session, per-file suppression, sharing annotate-read.sh's
# `annotated-sessions/` directory (and therefore its SessionStart/SessionEnd
# GC) but namespaced with a "test-reminder:" prefix before hashing, so this
# hook's touchfile never collides with annotate-read.sh's own suppression
# state for the same file.
ttl_min="${LIEN_ANNOTATE_TTL_MIN:-5}"
case "$ttl_min" in
  ''|*[!0-9]*) ttl_min=5;;
esac
hash="$(printf '%s' "test-reminder:$file_path" | md5sum 2>/dev/null | awk '{print substr($1,1,8)}')"
if [ -z "$hash" ]; then
  hash="$(printf '%s' "test-reminder:$file_path" | md5 2>/dev/null | awk '{print substr($NF,1,8)}')"
fi
[ -n "$hash" ] || exit 0

session_dir="$store/annotated-sessions/$session_id"
touchfile="$session_dir/$hash"
if [ -f "$touchfile" ]; then
  if find "$touchfile" -mmin -"$ttl_min" 2>/dev/null | grep -q .; then
    # Within TTL — already reminded for this file recently. Stay silent.
    [ -d "$session_dir" ] && touch "$session_dir" 2>/dev/null
    exit 0
  fi
fi

# Invoke from cwd so resolveProjectRoot works under subdirectory cwds.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  reminder="$(cd "$cwd" && "${LIEN_CMD[@]}" annotate "$file_path" --tests-only 2>/dev/null)"
else
  reminder="$("${LIEN_CMD[@]}" annotate "$file_path" --tests-only 2>/dev/null)"
fi

# No associated tests → `lien annotate --tests-only` prints nothing → stay
# silent (and don't mark the touchfile — nothing to suppress next time).
[ -n "$reminder" ] || exit 0

mkdir -p "$session_dir" 2>/dev/null || exit 0
: > "$touchfile"
touch "$session_dir" 2>/dev/null

# additionalContext is the channel that actually reaches the model on the
# next turn (verified in CC 2.1.142; matches annotate-read.sh/delta-write.sh).
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$reminder" | jq -Rs .)"

exit 0
