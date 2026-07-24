#!/usr/bin/env bash
# PostToolUse hook on Edit|Write|MultiEdit: warn, once, when an edit changed or
# removed the signature of an EXPORTED function/method. This automates
# CLAUDE.md's "run get_dependents before changing an exported symbol's
# signature" rule the same way delta-write.sh already automates the
# complexity-crossing rule — until now this one was honor-system only.
#
# Drives the same FEATURE-1 primitive as `lien api-delta`, through the
# single-file fast path `lien api-delta --file <path> --format json`, so the
# hook's warning and the CLI's own JSON can never diverge.
#
# Advisory only — there is no gate here (unlike `lien delta`), so the JSON's
# `changes[]` array is the only thing that matters; exit code is ignored.
#
# Best-effort throughout — never fails the user's edit. Disable via
# LIEN_BLAST_HOOK=off.

set -u

command -v jq >/dev/null 2>&1 || exit 0
. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0

# Env kill switch.
if [ "${LIEN_BLAST_HOOK:-}" = "off" ]; then
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

# Run the single-file check as JSON, from the session's cwd so the git root
# and project root resolve against the right repo (multi-repo safe). Any
# failure (not a git repo, unsupported file, git error -> exit 2) yields
# empty/non-JSON output and we stay silent.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  json="$(cd "$cwd" && "${LIEN_CMD[@]}" api-delta --file "$file_path" --format json 2>/dev/null)"
else
  json="$("${LIEN_CMD[@]}" api-delta --file "$file_path" --format json 2>/dev/null)"
fi
[ -n "$json" ] || exit 0

# Build the warning from changes[] (already sorted worst-first by the
# primitive: 'removed' before 'signature-changed'). The single-change case
# (by far the common one) renders a full, self-contained sentence per kind/
# enrichment state; 2-3 changes fall back to a terser combined line. Empty
# array -> jq emits nothing -> stay silent.
#
# docRefsClause (single-change only; docRefCount is always null/absent for a
# signature-changed row, so this is a no-op there) appends the docs-drift-
# shifted-left signal: which indexed doc chunks still name a symbol this edit
# just removed. See docs/architecture/blast-radius-nudge.md's docRefs section.
msg="$(printf '%s' "$json" | jq -r '
  def docRefsClause:
    if (.docRefCount // 0) > 0 then
      (.docRefPaths // []) as $paths
      | " " + (.docRefCount|tostring) + " docs reference " + .symbol + ": "
        + ($paths[0:3] | join(", "))
        + (if .docRefCount > ($paths|length)
           then " (+\(.docRefCount - ($paths|length)) more)" else "" end)
        + "."
    else "" end;
  (.changes // []) as $c
  | ($c | length) as $n
  | if $n == 0 then empty
    elif $n == 1 then
      ($c[0]) as $x
      | if $x.kind == "removed" then
          (if $x.enriched then
            "⚠ lien: exported symbol removed — " + $x.symbol
              + " (" + ($x.dependentCount|tostring) + " dependents, risk " + $x.riskLevel + ")."
              + " Callers will break — check get_dependents."
          else
            "⚠ lien: exported symbol removed — " + $x.symbol + "."
              + " Check get_dependents (index unavailable for counts)."
          end) + ($x | docRefsClause)
        else
          if $x.enriched then
            "⚠ lien: exported signature changed — " + $x.symbol
              + " (" + ($x.dependentCount|tostring) + " dependents, "
              + ($x.untestedDependentCount|tostring) + " untested, risk " + $x.riskLevel + ")."
              + " Run get_dependents before relying on callers."
          else
            "⚠ lien: exported signature changed — " + $x.symbol + "."
              + " Check get_dependents (index unavailable for counts)."
          end
        end
    else
      ( [ $c[0:3][]
          | if .kind == "removed" then
              "removed " + .symbol
                + (if .enriched then " (" + (.dependentCount|tostring) + " dependents, risk " + .riskLevel + ")" else " (index unavailable for counts)" end)
                + (if (.docRefCount // 0) > 0 then ", " + (.docRefCount|tostring) + " docs" else "" end)
            else
              .symbol
                + (if .enriched then " (" + (.dependentCount|tostring) + " dependents, " + (.untestedDependentCount|tostring) + " untested, risk " + .riskLevel + ")" else " (index unavailable for counts)" end)
            end
        ] | join("; ") ) as $joined
      | "⚠ lien: " + ($n|tostring) + " exported-signature changes — " + $joined
          + (if $n > 3 then " (+\($n - 3) more)" else "" end)
          + ". Run get_dependents before relying on callers."
    end
')"
[ -n "$msg" ] || exit 0

# additionalContext is the only field that reaches the model on the next turn
# (verified in CC 2.1.142; matches delta-write.sh / test-reminder.sh).
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$msg" | jq -Rs .)"

exit 0
