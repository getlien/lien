#!/usr/bin/env bash
# PostToolUse hook on Read: surface Lien impact analysis as a
# system-reminder annotation alongside the file content.
#
# Habituation guard (default ON; opt out with LIEN_ANNOTATE_GUARD=off):
#   (a) per-session dedup — annotate a given file at most ONCE per session
#       (integrates with the existing touchfile; guard OFF restores the older
#       LIEN_ANNOTATE_TTL_MIN-minute re-annotation window instead).
#   (b) risk floor — pass --min-risk (LIEN_ANNOTATE_MIN_RISK, default 'medium')
#       so `lien annotate` stays silent for below-floor files unless they carry
#       a complexity/headroom concern. See docs/architecture/nudge-telemetry.md.
#
# Also records a nudge-shown event (for the `lien stats` funnels) whenever an
# annotation is actually emitted. Skips files outside Lien's indexed extension
# set. Best-effort throughout — never fails the Read pipeline.

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

# Run lien from the session's cwd (if valid) so multi-repo setups resolve the
# right store/root; else run in place. All lien calls in this hook go through it.
run_lien() {
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    (cd "$cwd" && "$@")
  else
    "$@"
  fi
}

# Resolve store from the session's cwd so multi-repo setups work correctly.
store="$(run_lien "${LIEN_CMD[@]}" path --store 2>/dev/null)"
[ -n "$store" ] || exit 0

# Extension filter: skip if extension isn't in Lien's indexed set.
ext="${file_path##*.}"
if [ "$ext" = "$file_path" ]; then
  # No extension at all.
  exit 0
fi
if ! run_lien "${LIEN_CMD[@]}" path --extensions 2>/dev/null | grep -Fxq "$ext"; then
  exit 0
fi

# Habituation guard mode. Default ON. LIEN_ANNOTATE_GUARD=off restores the older
# always-on behavior (TTL-windowed re-annotation, no risk floor).
guard="${LIEN_ANNOTATE_GUARD:-on}"

# Risk floor passed to `lien annotate` (guard ON only). Empty = no floor.
min_risk=""
if [ "$guard" != "off" ]; then
  min_risk="${LIEN_ANNOTATE_MIN_RISK:-medium}"
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
  if [ "$guard" = "off" ]; then
    # Legacy: suppress only within the TTL window; re-annotate afterwards.
    if find "$touchfile" -mmin -"$ttl_min" 2>/dev/null | grep -q .; then
      # Touch the session dir so SessionStart cleanup sees this session as
      # active even if no new annotation is emitted for >24h.
      [ -d "$session_dir" ] && touch "$session_dir" 2>/dev/null
      exit 0
    fi
  else
    # Guard ON: per-session dedup — this file was already annotated this
    # session (ignore mtime), so stay silent for the rest of the session.
    [ -d "$session_dir" ] && touch "$session_dir" 2>/dev/null
    exit 0
  fi
fi

# Invoke from cwd so resolveProjectRoot works under subdirectory cwds. The
# risk floor (guard ON) is passed via --min-risk; guard OFF omits it entirely.
if [ -n "$min_risk" ]; then
  annotation="$(run_lien "${LIEN_CMD[@]}" annotate "$file_path" --min-risk "$min_risk" 2>/dev/null)"
else
  annotation="$(run_lien "${LIEN_CMD[@]}" annotate "$file_path" 2>/dev/null)"
fi

# Trivial/below-floor impact → `lien annotate` prints nothing → stay silent.
[ -n "$annotation" ] || exit 0

# Record the annotation so suppression kicks in next time. Truncating an
# existing touchfile doesn't update the parent dir's mtime on most
# filesystems, so touch the dir explicitly to keep SessionStart cleanup
# from GC'ing this session at the 24h threshold.
mkdir -p "$session_dir" 2>/dev/null || exit 0
: > "$touchfile"
touch "$session_dir" 2>/dev/null

# Record a nudge-shown event for the `lien stats` funnels (best-effort; its own
# kill switch is LIEN_NUDGE_EVENTS=off). Only reached when we actually emit.
# --hooks-dir stamps the event with a build identity (see nudge-build.ts) so a
# later empty window in `lien stats` can tell "no engagement" apart from
# "recording was impossible" — the exact failure mode of issue #916.
run_lien "${LIEN_CMD[@]}" nudge note-shown \
  --session "$session_id" --nudge annotate --file "$file_path" --hooks-dir "$LIEN_HOOKS_DIR" \
  >/dev/null 2>&1 || true

# Emit the hookSpecificOutput JSON. additionalContext is the channel that
# actually reaches the model on the next turn (verified in CC 2.1.142).
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$annotation" | jq -Rs .)"

exit 0
