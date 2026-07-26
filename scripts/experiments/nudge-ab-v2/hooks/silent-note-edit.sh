#!/usr/bin/env bash
# EXPERIMENT SCAFFOLDING (nudge-ab-v2) — NOT a shipped plugin hook.
#
# Populates FEATURE-2's session test-ledger with the edit the agent just made,
# WITHOUT emitting any model-visible reminder text. It exists so ledger
# population is held CONSTANT across both arms of the verify-tests A/B, leaving
# the real Stop advisory (recap-stop.sh, toggled by LIEN_RECAP) as the only
# thing that varies between arms.
#
# Why not just use the shipped test-reminder.sh to populate the ledger? Because
# test-reminder.sh couples the recording with an edit-time reminder that NAMES
# the associated test file. That naming would hand the agent the very
# information this experiment withholds (the test is deliberately not named
# after its source), collapsing the discriminator. So test-reminder.sh is held
# off in both arms (LIEN_TEST_REMINDER=off) and the recording it would
# otherwise do is provided here, silently and identically in both arms.
#
# Mirrors the defensive shape of the real hooks (jq guard, session_id
# hardening, cwd resolution, best-effort). Emits nothing on any path.
set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

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
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0 ;;
esac

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  (cd "$cwd" && lien verify-tests note-edit --session "$session_id" --file "$file_path" >/dev/null 2>&1) || true
else
  lien verify-tests note-edit --session "$session_id" --file "$file_path" >/dev/null 2>&1 || true
fi

exit 0
