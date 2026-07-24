#!/usr/bin/env bash
# Stop hook: the session risk-ledger recap — the model-visible surface that
# CONSOLIDATES three per-session risk signals into ONE Stop block:
#   • edited files whose associated tests were never observed running,
#   • functions this session touched that still cross a complexity threshold
#     (a live `lien delta` recompute vs HEAD),
#   • exported-API changes the blast nudge warned about with no get_dependents check.
# It replaces the old single-source test-verify-stop.sh; `lien recap` folds the
# unrun-tests advisory in verbatim. See docs/architecture/session-risk-recap.md.
#
# `stop_hook_active` (true on a re-entrant Stop after we already blocked once
# this episode) is the first loop-prevention guard; `lien recap`'s own
# ledger-based recent-block suppression (#843's mechanism, reused) is the
# second — so there is exactly one block per stop episode regardless of whether
# `stop_hook_active` is populated in a given Claude Code version.
#
# `{"decision":"block","reason":...}` is the channel used (see
# docs/architecture/claude-code-hook-channels.md's Stop section) — a one-shot
# "take one more look before you finish" interruption, not passive context. The
# recap's own text output IS the reason verbatim; this script does no message
# templating of its own, it only wraps the CLI's text in the JSON envelope.
#
# Fail-open throughout — any error, or the kill switch, allows the stop to
# proceed silently rather than trapping the agent. Disable via LIEN_RECAP=off.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

# Env kill switch.
if [ "${LIEN_RECAP:-}" = "off" ]; then
  exit 0
fi

input="$(cat)"

stop_hook_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false')"
if [ "$stop_hook_active" = "true" ]; then
  # Already blocked once this stop episode — allow the stop, never loop.
  exit 0
fi

session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
[ -n "$session_id" ] || exit 0

# Defensive: session_id is interpolated into a filesystem path downstream
# (test-ledger.ts / nudge-events.ts). Same hardening as every other hook here.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0 ;;
esac

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  reason="$(cd "$cwd" && "${LIEN_CMD[@]}" recap --session "$session_id" 2>/dev/null)"
else
  reason="$("${LIEN_CMD[@]}" recap --session "$session_id" 2>/dev/null)"
fi

# Nothing unresolved (all clean/resolved), suppressed by the recent-block
# window, or a resolution error -> the CLI prints nothing -> stay silent,
# allow the stop. The recap records its own `blocked` loop-prevention marker
# internally when it emits, so this hook does no bookkeeping of its own.
[ -n "$reason" ] || exit 0

printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$reason" | jq -Rs .)"

exit 0
