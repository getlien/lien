#!/usr/bin/env bash
# Stop hook: FEATURE 2 (did-you-run-the-tests verification) — the
# model-visible surface. Reads the session's test ledger (populated by
# test-reminder.sh's `note-edit` and test-run-note.sh's `note-run`) via
# `lien verify-tests report` and, when an edited file's associated tests were
# never observed running in a Bash command this session, blocks the stop ONCE
# with an advisory reason so the agent gets one more turn to run them (or
# explicitly disregard). See docs/architecture/test-verification-nudge.md.
#
# `stop_hook_active` (true on a re-entrant Stop after we already blocked once
# this episode) is the loop-prevention guard: we never block twice in a row
# for the same stop episode.
#
# `{"decision":"block","reason":...}` is the channel used here — see
# docs/architecture/claude-code-hook-channels.md's Stop section. The report
# text IS the reason verbatim (`formatVerifyTestsAdvisory` — text format,
# same command the hook shells out to), so this script does no message
# templating of its own; it only wraps the CLI's own text output in the JSON
# envelope, the same way it reads it.
#
# Fail-open throughout — any error, or the kill switch, allows the stop to
# proceed silently rather than trapping the agent. Disable via
# LIEN_TEST_VERIFY=off.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

# Env kill switch.
if [ "${LIEN_TEST_VERIFY:-}" = "off" ]; then
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
# (test-ledger.ts). Same hardening as every other hook in this bundle.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0 ;;
esac

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  reason="$(cd "$cwd" && "${LIEN_CMD[@]}" verify-tests report --session "$session_id" 2>/dev/null)"
else
  reason="$("${LIEN_CMD[@]}" verify-tests report --session "$session_id" 2>/dev/null)"
fi

# Nothing unverified (or a resolution error) -> the CLI prints nothing ->
# stay silent, allow the stop.
[ -n "$reason" ] || exit 0

# Record a nudge-shown event for the `lien stats` funnels (best-effort; its own
# kill switch is LIEN_NUDGE_EVENTS=off). Only reached when the advisory fires.
# No file/symbol — this nudge is session-scoped, not file-scoped.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  (cd "$cwd" && "${LIEN_CMD[@]}" nudge note-shown \
    --session "$session_id" --nudge test-verify >/dev/null 2>&1) || true
else
  "${LIEN_CMD[@]}" nudge note-shown \
    --session "$session_id" --nudge test-verify >/dev/null 2>&1 || true
fi

printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$reason" | jq -Rs .)"

exit 0
