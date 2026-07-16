#!/usr/bin/env bash
# PreToolUse hook on Task: when the parent launches a subagent, augment its
# prompt before it fires. Subagents start fresh and don't inherit parent
# context, so the prompt is the only channel to reach them.
#
# Two independent mandates, branching on subagent_type:
#   - Explore-flavor subagents (Explore/lien:Explore/project:Explore) get the
#     Lien MCP tool-usage mandate (discovery-time). Idempotent — skips when
#     the prompt already references a Lien MCP tool. Disable via
#     LIEN_EXPLORE_INJECT=off.
#   - Every other subagent_type (the code-writing "builder" agents — the
#     ones actually adding complexity) gets a plan-time complexity nudge,
#     but ONLY when the prompt names a file that's both a real path and
#     carries functions at/near their complexity budget. The behavioral A/B
#     in docs/development/nudge-behavioral-ab.md showed this exact warning
#     shape cuts threshold crossings 8/8->3/8 for the read-hook's version
#     (annotate-read.sh, #772); builder subagents never saw it because they
#     don't go through a Read hook. Silent when no candidate path resolves
#     or none has headroom. Disable via LIEN_SUBAGENT_NUDGE=off.
#
# Both branches are idempotent and fail-open: any failure (missing jq/lien,
# unindexed repo, empty prompt) passes the original tool_input through
# unchanged.

set -u

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
# Different Claude Code versions name this tool differently:
#   newer: Agent      older: Task
# Accept both so the hook keeps working across upgrades.
case "$tool_name" in
  Agent|Task) ;;
  *) exit 0 ;;
esac

subagent="$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty')"
prompt="$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty')"
[ -n "$prompt" ] || exit 0

case "$subagent" in
  Explore|lien:Explore|"project:Explore") is_explore=1 ;;
  *) is_explore=0 ;;
esac

# Echo back the full tool_input with only the prompt mutated. updatedInput
# replaces the whole object — missing fields would silently break the
# subagent call. Shared by both branches below.
emit_updated_prompt() {
  printf '%s' "$input" | jq --arg new_prompt "$1" '
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: (.tool_input | .prompt = $new_prompt)
      }
    }
  '
}

if [ "$is_explore" = "1" ]; then
  # Env kill switch.
  if [ "${LIEN_EXPLORE_INJECT:-}" = "off" ]; then
    exit 0
  fi

  # Idempotence: if the parent already pointed the subagent at a Lien MCP
  # tool, don't double-instruct.
  case "$prompt" in
    *mcp__plugin_lien_lien__*) exit 0;;
  esac

  # Don't inject the mandate if the repo has no usable Lien index — would
  # point the subagent at tools that return empty for everything and
  # burn calls on dead ends. The sqlite structural.db file is the canonical
  # "is this repo indexed?" signal.
  . "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0
  cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    store="$(cd "$cwd" && "${LIEN_CMD[@]}" path --store 2>/dev/null)"
  else
    store="$("${LIEN_CMD[@]}" path --store 2>/dev/null)"
  fi
  [ -n "$store" ] && [ -f "$store/structural.db" ] || exit 0

  injection='

[Lien] MCP tools are REQUIRED for keyword and structural codebase queries in this repo. Use Lien tools as your primary discovery mechanism — grep/glob/Read are fallbacks ONLY for exact-literal lookups (error strings, config keys, TODOs).

Required tools:
  • mcp__plugin_lien_lien__search_code — REQUIRED for keyword/full-text discovery. Full-text (BM25) search: phrase queries with concrete keywords/identifiers/domain terms that appear in the code ("chunk overlap config", "parse import statement"), NOT full natural-language questions — there are no embeddings, so paraphrase queries score worse.
  • mcp__plugin_lien_lien__list_functions — REQUIRED for "find all X" / pattern-based structural lookup (10× faster than grep).
  • mcp__plugin_lien_lien__get_files_context — REQUIRED before reporting on any file you exploratively read (returns imports, callers, test associations).
  • mcp__plugin_lien_lien__get_dependents — REQUIRED before reporting an exported symbol change is "safe" or complete.

Grep/glob are only acceptable when the query is for an exact literal string.'

  emit_updated_prompt "${prompt}${injection}"
  exit 0
fi

# --- Plan-time complexity nudge for non-Explore ("builder") subagents ---
#
# Env kill switch.
if [ "${LIEN_SUBAGENT_NUDGE:-}" = "off" ]; then
  exit 0
fi

# Idempotence: don't double-inject if the prompt already carries our marker
# (e.g. a resumed/relaunched agent).
case "$prompt" in
  *"Lien plan-time note:"*) exit 0;;
esac

. "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && "${LIEN_CMD[@]}" path --store 2>/dev/null)"
else
  store="$("${LIEN_CMD[@]}" path --store 2>/dev/null)"
fi
[ -n "$store" ] && [ -f "$store/structural.db" ] || exit 0

# Conservative path extraction: at least one directory separator, plausible
# extension (1-5 letters), deduplicated in first-appearance order. This
# over-matches (e.g. a URL fragment) by design — the on-disk existence check
# right after is what actually filters candidates, cheaply, before any
# subprocess is spawned.
MAX_CANDIDATE_PATHS=3
MAX_NUDGE_FILES=2

candidates="$(printf '%s' "$prompt" \
  | grep -oE '[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+\.[A-Za-z]{1,5}' \
  | awk '!seen[$0]++' \
  | head -n "$MAX_CANDIDATE_PATHS")"
[ -n "$candidates" ] || exit 0

root=""
block=""
hit_files=0

while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue

  exists=0
  if [ -n "$cwd" ] && [ -f "$cwd/$candidate" ]; then
    exists=1
  else
    if [ -z "$root" ]; then
      if [ -n "$cwd" ] && [ -d "$cwd" ]; then
        root="$(cd "$cwd" && "${LIEN_CMD[@]}" path --root 2>/dev/null)"
      else
        root="$("${LIEN_CMD[@]}" path --root 2>/dev/null)"
      fi
      [ -n "$root" ] || root="__none__"
    fi
    if [ "$root" != "__none__" ] && [ -f "$root/$candidate" ]; then
      exists=1
    fi
  fi
  [ "$exists" = "1" ] || continue

  # Same CLI surface #772 wired up (lien annotate <file>), which leads its
  # printed annotation with the shared complexityHeadroomWarning line
  # (get-files-context.ts, capped at the 3 worst entries per #788) whenever
  # the file has a function at/near budget. Any other annotate output
  # (dependents, test coverage) is noise for this nudge, so only the first
  # line is inspected, and only when it carries the "⚠ Lien: " marker.
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    ann="$(cd "$cwd" && "${LIEN_CMD[@]}" annotate "$candidate" 2>/dev/null)"
  else
    ann="$("${LIEN_CMD[@]}" annotate "$candidate" 2>/dev/null)"
  fi
  [ -n "$ann" ] || continue

  first_line="$(printf '%s\n' "$ann" | head -n1)"
  entries="$(printf '%s' "$first_line" | jq -Rr '
    if startswith("⚠ Lien: ") then
      sub("^⚠ Lien: "; "") | sub(" — avoid adding complexity here; prefer extraction\\.$"; "")
    else
      empty
    end
  ')"
  [ -n "$entries" ] || continue

  line="Lien plan-time note: ${candidate} has functions at/near complexity budget: ${entries}. Avoid adding complexity there; prefer extraction."
  if [ -n "$block" ]; then
    block="$(printf '%s\n%s' "$block" "$line")"
  else
    block="$line"
  fi
  hit_files=$((hit_files + 1))
  [ "$hit_files" -ge "$MAX_NUDGE_FILES" ] && break
done <<CANDIDATES
$candidates
CANDIDATES

[ -n "$block" ] || exit 0

new_prompt="$(printf '%s\n\n%s' "$prompt" "$block")"
emit_updated_prompt "$new_prompt"

exit 0
