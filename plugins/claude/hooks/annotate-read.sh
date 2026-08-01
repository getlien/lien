#!/usr/bin/env bash
# PostToolUse hook on Read: surface Lien impact analysis as a
# system-reminder annotation alongside the file content.
#
# Habituation guard (default ON; opt out with LIEN_ANNOTATE_GUARD=off):
#   (a) per-session dedup — annotate a given file at most ONCE per session
#       (integrates with the existing touchfile; guard OFF restores the older
#       LIEN_ANNOTATE_TTL_MIN-minute re-annotation window instead) --
#       UNLESS the file's last known annotation carried a never-suppress
#       signal (#978 below).
#   (b) risk floor — pass --min-risk (LIEN_ANNOTATE_MIN_RISK, default 'medium')
#       so `lien annotate` stays silent for below-floor files unless they carry
#       a complexity/headroom concern. See docs/architecture/nudge-telemetry.md.
#
# #978: (a) and (b) used to be describable as fully independent, but they
# aren't — `lien annotate` itself never silences a never-suppress signal
# (an incomplete dependent-attribution result, a complexity warning, or a
# headroom concern; see annotate-cmd.ts's `hasNeverSuppressSignal`), yet this
# gate ran BEFORE `lien annotate` and, on a file's second Read this session,
# exited unconditionally — content-blind by construction, so that policy
# never got a chance to apply. Fixed by having `lien annotate` exit 2
# whenever the annotation it just printed carried that signal, and recording
# that in the touchfile's CONTENT (not just its existence): '1' means "don't
# ever dedup-skip this file again this session," so a signal-carrying file
# re-invokes `lien annotate` on every read, while an ordinary file keeps the
# cheap existence-only dedup.
#
# HOOKS-12: the guard-OFF branch below used to check ONLY the touchfile's
# mtime (the pre-#978 TTL logic), never its content — so
# `LIEN_ANNOTATE_GUARD=off` (which is supposed to make suppression WEAKER,
# a TTL window instead of session-long) accidentally made it STRONGER for a
# never-suppress file: re-reading it inside the TTL window suppressed the
# one class of annotation that must never be suppressed. Fixed by checking
# the touchfile's content ('1' = never-suppress) BEFORE branching on guard
# mode at all, so that check now applies unconditionally; only an ORDINARY
# (content '0') touchfile still falls through to the guard-specific
# TTL-vs-session-dedup behavior below.
#
# HOOKS-6: the npx circuit breaker (lien-resolve.sh) fails resolution
# BEFORE `lien annotate` is ever invoked, so a never-suppress file would
# otherwise vanish, completely silently, for the whole cooldown window —
# defeating the exact guarantee above just as badly, just earlier in the
# pipeline. We can't know whether THIS file carries a never-suppress signal
# without invoking the CLI, which is exactly what's unavailable, so instead
# of staying silent we surface the degraded state itself: once per session
# (not per file — this would otherwise nag on every Read for the whole
# cooldown), via the same additionalContext channel a real annotation uses.
# No extra npx round-trip: this path never invokes LIEN_CMD.
#
# Also records a nudge-shown event (for the `lien stats` funnels) whenever an
# annotation is actually emitted. Skips files outside Lien's indexed extension
# set. Best-effort throughout — never fails the Read pipeline.

set -u

command -v jq >/dev/null 2>&1 || exit 0

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

if ! . "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh"; then
  # HOOKS-6 (see header comment). Surface a breaker-open degraded notice
  # once per session, machine-global (same tmp-dir family as the breaker's
  # own markers, computed with the exact same default formula as
  # lien-resolve.sh's own `marker`/`breaker_until` so a custom
  # LIEN_NPX_BREAKER_MARKER/LIEN_NPX_BREAKER_UNTIL_MARKER override is
  # honored here too) so this works even though `store` — which needs a
  # working `lien` to resolve — is unavailable right here.
  if [ "${LIEN_RESOLVE_FAIL_REASON:-}" = "breaker_open" ]; then
    marker_default="${TMPDIR:-/tmp}/lien-npx-breaker/inflight"
    until_default="$(dirname "${LIEN_NPX_BREAKER_MARKER:-$marker_default}")/breaker-open-until"
    notice_dir="$(dirname "${LIEN_NPX_BREAKER_UNTIL_MARKER:-$until_default}")/notice-shown"
    notice_marker="$notice_dir/$session_id"
    if [ ! -f "$notice_marker" ]; then
      mkdir -p "$notice_dir" 2>/dev/null
      if : > "$notice_marker" 2>/dev/null; then
        text="⚠ Lien unavailable this session: the npx circuit breaker is open (a prior lien call was killed, or the npm registry is unreachable). Complexity/impact annotations are suppressed until it clears — do not read this silence as \"no issues.\""
        printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
          "$(printf '%s' "$text" | jq -Rs .)"
      fi
    fi
  fi
  exit 0
fi

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
  # The never-suppress carve-out (#978) is checked FIRST and unconditionally,
  # regardless of guard mode (HOOKS-12 — see header comment): the touchfile's
  # CONTENT being '1' means this file's last known annotation carried a
  # never-suppress signal, and that must re-invoke `lien annotate` on every
  # read — guard on OR off — so the #938 carve-outs (`isTrivial`/
  # `belowRiskFloor`) always get a chance to run instead of being silenced
  # sight-unseen by this dedup gate. Only an ORDINARY (content '0')
  # touchfile falls through to the guard-mode-specific behavior below.
  if [ "$(cat "$touchfile" 2>/dev/null)" != "1" ]; then
    if [ "$guard" = "off" ]; then
      # Legacy: suppress only within the TTL window; re-annotate afterwards.
      if find "$touchfile" -mmin -"$ttl_min" 2>/dev/null | grep -q .; then
        # Touch the session dir so SessionStart cleanup sees this session as
        # active even if no new annotation is emitted for >24h.
        [ -d "$session_dir" ] && touch "$session_dir" 2>/dev/null
        exit 0
      fi
    else
      # Guard ON: per-session dedup for an ordinary annotation.
      [ -d "$session_dir" ] && touch "$session_dir" 2>/dev/null
      exit 0
    fi
  fi
fi

# Invoke from cwd so resolveProjectRoot works under subdirectory cwds. The
# risk floor (guard ON) is passed via --min-risk; guard OFF omits it entirely.
if [ -n "$min_risk" ]; then
  annotation="$(run_lien "${LIEN_CMD[@]}" annotate "$file_path" --min-risk "$min_risk" 2>/dev/null)"
else
  annotation="$(run_lien "${LIEN_CMD[@]}" annotate "$file_path" 2>/dev/null)"
fi
# exit 2 (see annotate-cmd.ts's `annotateCli`) means the annotation just
# printed carries a never-suppress signal — anything else (0, or a crash) is
# treated as an ordinary annotation, the fail-open default.
annotate_exit=$?

# Trivial/below-floor impact → `lien annotate` prints nothing → stay silent.
[ -n "$annotation" ] || exit 0

# Record the annotation so suppression kicks in next time — UNLESS
# annotate_exit says this file must never be dedup-silenced (#978): the
# touchfile's content ('1' vs anything else) is what the check above reads.
# Truncating an existing touchfile doesn't update the parent dir's mtime on
# most filesystems, so touch the dir explicitly to keep SessionStart cleanup
# from GC'ing this session at the 24h threshold.
mkdir -p "$session_dir" 2>/dev/null || exit 0
if [ "$annotate_exit" = "2" ]; then
  printf '1' > "$touchfile"
else
  printf '0' > "$touchfile"
fi
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
