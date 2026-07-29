#!/usr/bin/env bash
# PostToolUse hook on Lien's MCP tools: record a follow-up "signal" for the
# `lien stats` nudge funnels (telemetry v2). PostToolUse fires for MCP tools
# too, with names like `mcp__plugin_lien_lien__get_dependents`. We care about
# two of them:
#   • get_dependents     — the signal the blast-radius nudge asks for, and one
#                          of the two the read-time annotation asks for.
#   • get_files_context  — the other read-time-annotation signal.
# A later same-session call of one of these is what `nudge-stats.ts` joins back
# to a prior nudge-shown event. Recording only — emits NOTHING to the model.
#
# The matcher (hooks.json) is prefix-robust (`mcp__.*__get_dependents|...`) so it
# works regardless of how the plugin's MCP server name is prefixed; this script
# re-derives the precise signal from the tool name and ignores anything else.
#
# Best-effort throughout; never fails the tool call. Disable recording with
# LIEN_NUDGE_EVENTS=off (the same switch the CLI honors).

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

# Env kill switch (shared with the CLI's own recording gate).
if [ "${LIEN_NUDGE_EVENTS:-}" = "off" ]; then
  exit 0
fi

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
[ -n "$tool_name" ] || exit 0
[ -n "$session_id" ] || exit 0

# session_id is stored as data (not a path component) in nudge-events.jsonl, but
# harden it the same way as the rest of the bundle for consistency.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0 ;;
esac

# Precise signal derivation from the (possibly prefixed) MCP tool name.
case "$tool_name" in
  *get_dependents) signal="get_dependents" ;;
  *get_files_context) signal="get_files_context" ;;
  *) exit 0 ;;
esac

# Best-effort file/symbol extraction from the tool_input, for the raw log and
# any future file-matched refinement (the v1 funnel joins on session + time
# only). get_dependents uses `filepath`/`symbol`; get_files_context uses
# `filepaths` (string or array — take the first).
if [ "$signal" = "get_dependents" ]; then
  file="$(printf '%s' "$input" | jq -r '.tool_input.filepath // empty')"
  symbol="$(printf '%s' "$input" | jq -r '.tool_input.symbol // empty')"
else
  file="$(printf '%s' "$input" | jq -r '
    (.tool_input.filepaths // .tool_input.filepath) as $f
    | if ($f | type) == "array" then ($f[0] // empty) else ($f // empty) end')"
  symbol=""
fi

# Build the optional flags without tripping `set -u` on empty arrays under older
# bash: append only when present. --hooks-dir stamps a build identity (see
# nudge-build.ts / issue #916).
set -- nudge note-signal --session "$session_id" --signal "$signal" --hooks-dir "$LIEN_HOOKS_DIR"
[ -n "$file" ] && set -- "$@" --file "$file"
[ -n "$symbol" ] && set -- "$@" --symbol "$symbol"

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  (cd "$cwd" && "${LIEN_CMD[@]}" "$@" >/dev/null 2>&1) || true
else
  "${LIEN_CMD[@]}" "$@" >/dev/null 2>&1 || true
fi

exit 0
