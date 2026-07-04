#!/usr/bin/env bash
# PreToolUse hook on Task: when the parent launches an Explore-flavor
# subagent, append a short reminder about Lien's MCP tools to the
# subagent's prompt. Subagents start fresh and don't inherit parent
# context, so the prompt is the only channel to nudge them toward Lien
# tools for codebase exploration.
#
# Idempotent — skips when the prompt already references a Lien MCP tool.
# Disable via LIEN_EXPLORE_INJECT=off.
#
# Best-effort: any failure passes the original input through unchanged.

set -u

command -v jq >/dev/null 2>&1 || exit 0

# Env kill switch.
if [ "${LIEN_EXPLORE_INJECT:-}" = "off" ]; then
  exit 0
fi

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
case "$subagent" in
  Explore|lien:Explore|"project:Explore") ;;
  *) exit 0 ;;
esac

prompt="$(printf '%s' "$input" | jq -r '.tool_input.prompt // empty')"
[ -n "$prompt" ] || exit 0

# Idempotence: if the parent already pointed the subagent at a Lien MCP
# tool, don't double-instruct.
case "$prompt" in
  *mcp__plugin_lien_lien__*) exit 0;;
esac

# Don't inject the mandate if the repo has no usable Lien index — would
# point the subagent at tools that return empty for everything and
# burn calls on dead ends. The sqlite structural.db file is the canonical
# "is this repo indexed?" signal.
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && lien path --store 2>/dev/null)"
else
  store="$(lien path --store 2>/dev/null)"
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

new_prompt="${prompt}${injection}"

# Echo back the full tool_input with only the prompt mutated. updatedInput
# replaces the whole object — missing fields would silently break the
# subagent call.
printf '%s' "$input" | jq --arg new_prompt "$new_prompt" '
  {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: (.tool_input | .prompt = $new_prompt)
    }
  }
'

exit 0
