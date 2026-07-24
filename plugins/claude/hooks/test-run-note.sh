#!/usr/bin/env bash
# PostToolUse hook on Bash: FEATURE 2 (did-you-run-the-tests verification) —
# record a Bash command as a test run when it looks like one, so
# `test-verify-stop.sh` can later tell whether an edited file's associated
# tests were ever exercised this session. See
# docs/architecture/test-verification-nudge.md.
#
# A coarse shell-level keyword pre-filter runs FIRST, before shelling out to
# `lien` at all: a command matching none of these substrings can never be a
# recognized test run (the precise classification in `classifyTestCommand`,
# driven via `lien verify-tests note-run`, is a strict superset of what this
# filter lets through), so a routine non-test Bash call (ls, git status,
# cat, ...) spawns no `lien` process at all — the whole point of doing this
# check in shell rather than always shelling out and letting the CLI decide.
#
# Emits NOTHING to the model on any path — recording only, never a warning.
# Best-effort throughout; never fails the Bash call. Disable via
# LIEN_TEST_VERIFY=off.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

# Env kill switch.
if [ "${LIEN_TEST_VERIFY:-}" = "off" ]; then
  exit 0
fi

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
[ "$tool_name" = "Bash" ] || exit 0

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$command_str" ] || exit 0
[ -n "$session_id" ] || exit 0

# Defensive: session_id is interpolated into a filesystem path downstream
# (test-ledger.ts). Same hardening as every other hook in this bundle.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0 ;;
esac

# Coarse pre-filter (see header comment). Deliberately generous — a false
# match here only costs one extra `lien` invocation that then classifies the
# command precisely and may still decide not to record it; a false NEGATIVE
# here would silently drop a real test run, which this list is sized to avoid.
case "$command_str" in
  *test*|*vitest*|*jest*|*pytest*|*rspec*|*phpunit*|*mocha*|*dotnet*|*gradle*|*mvn*|*deno*|*'npm t'*) ;;
  *) exit 0 ;;
esac

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  (cd "$cwd" && "${LIEN_CMD[@]}" verify-tests note-run --session "$session_id" --command "$command_str" >/dev/null 2>&1)
else
  "${LIEN_CMD[@]}" verify-tests note-run --session "$session_id" --command "$command_str" >/dev/null 2>&1
fi

exit 0
