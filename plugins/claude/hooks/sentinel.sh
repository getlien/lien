#!/usr/bin/env bash
# PostToolUse hook: write sentinels for Lien impact-analysis calls.
# Sentinels live under <store>/gate-sessions/<session_id>/ and carry the
# call timestamp in their mtime.
#
# Matched tools:
#   mcp__plugin_lien_lien__get_files_context  → fc-<hash>
#   mcp__plugin_lien_lien__get_dependents     → dep-<hash>
#   mcp__plugin_lien_lien__find_similar       → fs-<hash> (per cited file)
#
# Best-effort: never fails the post-tool-use pipeline.

set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$tool_name" ] || exit 0
[ -n "$session_id" ] || exit 0

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && lien path --store 2>/dev/null)"
else
  store="$(lien path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

session_dir="$store/gate-sessions/$session_id"
mkdir -p "$session_dir" 2>/dev/null || exit 0

canonicalize() {
  # Match gate.sh: strip $cwd/ prefix, then strip a leading "./".
  local p="$1"
  if [ -n "$cwd" ]; then
    case "$p" in
      "$cwd"/*) p="${p#$cwd/}";;
      "$cwd") p="";;
    esac
  fi
  case "$p" in
    ./*) p="${p#./}";;
  esac
  printf '%s' "$p"
}

hash_path() {
  # $1 = canonical file path → 8-char md5 hex
  if command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$1" | md5sum | awk '{print substr($1,1,8)}'
  else
    printf '%s' "$1" | md5 | awk '{print substr($NF,1,8)}'
  fi
}

write_sentinel() {
  # $1 = prefix (fc|dep|fs), $2 = file path (absolute or relative)
  local prefix="$1" file_path="$2" rel h
  [ -n "$file_path" ] || return
  rel="$(canonicalize "$file_path")"
  h="$(hash_path "$rel")"
  [ -n "$h" ] || return
  : > "$session_dir/$prefix-$h"
}

case "$tool_name" in
  mcp__plugin_lien_lien__get_files_context)
    # tool_input.filepaths is string | string[]
    paths_json="$(printf '%s' "$input" | jq -c '.tool_input.filepaths // empty')"
    if [ -n "$paths_json" ]; then
      if printf '%s' "$paths_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
        printf '%s' "$paths_json" | jq -r '.[]' | while IFS= read -r p; do
          write_sentinel fc "$p"
        done
      else
        p="$(printf '%s' "$paths_json" | jq -r '.')"
        write_sentinel fc "$p"
      fi
    fi
    ;;

  mcp__plugin_lien_lien__get_dependents)
    p="$(printf '%s' "$input" | jq -r '.tool_input.filepath // empty')"
    write_sentinel dep "$p"
    ;;

  mcp__plugin_lien_lien__find_similar)
    # tool_result is the MCP wire format: { content: [ { type: "text", text: "<json string>" } ] }
    # The inner JSON has { results: [ { metadata: { file: "..." } } ] }
    text="$(printf '%s' "$input" | jq -r '.tool_result.content[0].text // .tool_response.content[0].text // empty' 2>/dev/null)"
    if [ -n "$text" ]; then
      printf '%s' "$text" | jq -r '.results[]?.metadata.file // empty' 2>/dev/null | while IFS= read -r p; do
        [ -n "$p" ] && write_sentinel fs "$p"
      done
    fi
    ;;
esac

exit 0
