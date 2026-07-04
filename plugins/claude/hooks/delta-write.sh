#!/usr/bin/env bash
# PostToolUse hook on Edit|Write|MultiEdit: compute the complexity delta for the
# file just edited and, ONLY when the edit introduced a NEW threshold crossing,
# surface a one-line warning via additionalContext. Silent in every other case.
#
# Drives the same Phase-1 primitive as `lien delta`, through the single-file
# fast path `lien delta --file <path> --format json`, so the hook's verdict and
# the CLI's verdict can never diverge. An always-on hook that fired on advisory
# movement (worsened-but-under, pre-existing) would become wallpaper and burn
# context, so it emits ONLY for gate-failing verdicts (crossed / new-over).
#
# Best-effort throughout — never fails the user's edit. Disable via
# LIEN_DELTA_HOOK=off.

set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

# Env kill switch.
if [ "${LIEN_DELTA_HOOK:-}" = "off" ]; then
  exit 0
fi

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
case "$tool_name" in
  Edit | Write | MultiEdit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
[ -n "$file_path" ] || exit 0

# Run the single-file delta as JSON, from the session's cwd so the git root and
# project root resolve against the right repo (multi-repo safe). Any failure
# (not a git repo, unsupported file, git error → exit 2) yields empty/non-JSON
# output and we stay silent.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  json="$(cd "$cwd" && lien delta --file "$file_path" --format json 2>/dev/null)"
else
  json="$(lien delta --file "$file_path" --format json 2>/dev/null)"
fi
[ -n "$json" ] || exit 0

# Build the warning from the regressions[] array ONLY (crossed / new-over).
# Empty array → jq emits nothing → we stay silent. Lists up to the top 3
# functions (already sorted worst-first by the primitive), each as
# "name metric before→after (threshold N)"; a newly-added over-threshold
# function shows its "before" as "new".
msg="$(printf '%s' "$json" | jq -r '
  (.regressions // []) as $r
  | ($r | length) as $n
  | if $n == 0 then empty else
      ( [ $r[0:3][]
          | ( [ .metrics[] | select(.verdict == "crossed" or .verdict == "new-over-threshold") ][0] ) as $m
          | select($m != null)
          | (if (.parentClass // "") != "" then .parentClass + "." + .symbolName else .symbolName end) as $name
          | $name + " " + $m.metricType + " "
            + (if $m.before == null then "new" else ($m.before | tostring) end)
            + "→" + ($m.after | tostring)
            + " (threshold " + ($m.threshold | tostring) + ")"
        ] | join("; ") )
      + (if $n > 3 then " (+\($n - 3) more)" else "" end)
    end
')"
[ -n "$msg" ] || exit 0

text="⚠ lien delta: ${msg} — consider simplifying before you commit."

# additionalContext is the only field that reaches the model on the next turn
# (verified in CC 2.1.142; a bare systemMessage does not). Match annotate-read.sh.
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$text" | jq -Rs .)"

exit 0
