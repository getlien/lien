#!/usr/bin/env bash
# PostToolUse hook on Read: surface Lien impact analysis as a
# system-reminder annotation alongside the file content.
#
# Suppresses repeat annotations for the same file within a session (default
# 5 min TTL, configurable via LIEN_ANNOTATE_TTL_MIN). Skips files outside
# Lien's indexed extension set. Best-effort throughout — never fails the
# Read pipeline.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$file_path" ] || exit 0
[ -n "$session_id" ] || exit 0

# Defensive: session_id will be embedded in a filesystem path. Reject anything
# outside [A-Za-z0-9_-] so a crafted value can't traverse out of the
# session dir.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0;;
esac

# Resolve store from the session's cwd so multi-repo setups work correctly.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && "${LIEN_CMD[@]}" path --store 2>/dev/null)"
else
  store="$("${LIEN_CMD[@]}" path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

# Extension filter: skip if extension isn't in Lien's indexed set.
ext="${file_path##*.}"
if [ "$ext" = "$file_path" ]; then
  # No extension at all.
  exit 0
fi
if ! "${LIEN_CMD[@]}" path --extensions 2>/dev/null | grep -Fxq "$ext"; then
  exit 0
fi

# Per-session, per-file suppression. The same script reads and writes the
# touchfile so we can use the raw file_path's md5 directly — no abs/rel
# canonicalization required.
ttl_min="${LIEN_ANNOTATE_TTL_MIN:-5}"
# Guard against malformed env values: a non-numeric ttl would make
# `find -mmin -<X>` a syntax error, defeat suppression, and let every
# Read re-annotate. Fall back to the default if not a positive integer.
case "$ttl_min" in
  ''|*[!0-9]*) ttl_min=5;;
esac
hash="$(printf '%s' "$file_path" | md5sum 2>/dev/null | awk '{print substr($1,1,8)}')"
if [ -z "$hash" ]; then
  hash="$(printf '%s' "$file_path" | md5 2>/dev/null | awk '{print substr($NF,1,8)}')"
fi
[ -n "$hash" ] || exit 0

session_dir="$store/annotated-sessions/$session_id"
touchfile="$session_dir/$hash"
if [ -f "$touchfile" ]; then
  if find "$touchfile" -mmin -"$ttl_min" 2>/dev/null | grep -q .; then
    # Within TTL — already annotated this file recently. Stay silent.
    # Touch the session dir so SessionStart cleanup sees this session as
    # active even if no new annotation is emitted for >24h.
    [ -d "$session_dir" ] && touch "$session_dir" 2>/dev/null
    exit 0
  fi
fi

# Invoke from cwd so resolveProjectRoot works under subdirectory cwds.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  annotation="$(cd "$cwd" && "${LIEN_CMD[@]}" annotate "$file_path" 2>/dev/null)"
else
  annotation="$("${LIEN_CMD[@]}" annotate "$file_path" 2>/dev/null)"
fi

# Trivial impact → `lien annotate` prints nothing → stay silent.
[ -n "$annotation" ] || exit 0

# Record the annotation so suppression kicks in next time. Truncating an
# existing touchfile doesn't update the parent dir's mtime on most
# filesystems, so touch the dir explicitly to keep SessionStart cleanup
# from GC'ing this session at the 24h threshold.
mkdir -p "$session_dir" 2>/dev/null || exit 0
: > "$touchfile"
touch "$session_dir" 2>/dev/null

# Emit the hookSpecificOutput JSON. additionalContext is the channel that
# actually reaches the model on the next turn (verified in CC 2.1.142).
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$annotation" | jq -Rs .)"

exit 0
