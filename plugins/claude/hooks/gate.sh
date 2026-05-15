#!/usr/bin/env bash
# PreToolUse hook: gate Edit/Write on Lien-indexed files until impact
# analysis (get_files_context / get_dependents / find_similar) has run
# in the current session.
#
# Advisory by default: emits a systemMessage and exits 0.
# Blocking mode via `lien gate block` or LIEN_GATE=block: exits 2 on miss.
# Disabled via `lien gate off` or LIEN_GATE=off: silent exit 0.
#
# Gracefully degrades (silent exit 0) if `jq` or `lien` are missing.

set -u

emit_message() {
  # $1 = message string
  printf '{"systemMessage":%s}\n' "$(printf '%s' "$1" | jq -Rs .)"
}

# Hard prerequisites — if missing, do nothing.
command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

# Environment kill switch (matches LIEN_FORCE_INDEX pattern in mcp/server.ts).
if [ "${LIEN_GATE:-}" = "off" ]; then
  exit 0
fi

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

# No file path or session — can't gate; silently pass.
[ -n "$file_path" ] || exit 0
[ -n "$session_id" ] || exit 0

# Defensive: session_id will be embedded in a filesystem path. Reject anything
# outside [A-Za-z0-9_-] so a crafted value can't traverse out of gate-sessions/.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0;;
esac

# Resolve the project root and storage root via `lien path`, so the
# results stay invariant whether Claude Code's cwd is the repo root or
# a subdirectory.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  root="$(cd "$cwd" && lien path --root 2>/dev/null)"
  store="$(cd "$cwd" && lien path --store 2>/dev/null)"
else
  root="$(lien path --root 2>/dev/null)"
  store="$(lien path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0
[ -n "$root" ] || root="$cwd"

# Persistent kill switch from `lien gate off`.
if [ -f "$store/gate-disabled" ]; then
  exit 0
fi

# Determine blocking mode (file flag or env var).
mode="advisory"
if [ -f "$store/gate-blocking" ] || [ "${LIEN_GATE:-}" = "block" ]; then
  mode="block"
fi

# Extension filter: skip if file extension isn't in Lien's indexed set.
# getSupportedExtensions returns bare extensions (e.g. "ts"), no leading dot.
ext="${file_path##*.}"
if [ "$ext" = "$file_path" ]; then
  # No extension at all — skip.
  exit 0
fi
if ! lien path --extensions 2>/dev/null | grep -Fxq "$ext"; then
  exit 0
fi

ttl_min="${LIEN_GATE_TTL_MIN:-60}"
session_dir="$store/gate-sessions/$session_id"

# Canonicalize file_path to a project-root-relative form before hashing,
# so the gate matches sentinels written by sentinel.sh regardless of
# whether the caller used absolute, root-relative, or cwd-relative paths.
# Claude Code's Edit/Write carry absolute paths; the model typically
# passes root-relative paths to MCP tools because Lien's index is
# root-relative.
rel_path="$file_path"
for base in "$root" "$cwd"; do
  [ -z "$base" ] && continue
  case "$rel_path" in
    "$base"/*) rel_path="${rel_path#$base/}"; break;;
    "$base") rel_path=""; break;;
  esac
done
# Strip a leading "./" so "./foo.ts" and "foo.ts" hash identically.
case "$rel_path" in
  ./*) rel_path="${rel_path#./}";;
esac

# Hash the canonical path. md5 first 8 chars mirrors extractRepoId.
hash="$(printf '%s' "$rel_path" | md5sum 2>/dev/null | awk '{print substr($1,1,8)}')"
if [ -z "$hash" ]; then
  hash="$(printf '%s' "$rel_path" | md5 2>/dev/null | awk '{print substr($NF,1,8)}')"
fi
[ -n "$hash" ] || exit 0

# Resolve absolute target for the existence check (gate semantic depends
# on whether the file exists yet).
target_path="$file_path"
if [ "${file_path#/}" = "$file_path" ]; then
  # Relative — Claude Code's file_path is conventionally process-cwd
  # relative, so prefer $cwd. Fall back to $root only if cwd is absent
  # from the hook payload.
  if [ -n "$cwd" ]; then
    target_path="$cwd/$file_path"
  elif [ -n "$root" ]; then
    target_path="$root/$file_path"
  fi
fi

satisfied=0
if [ -d "$session_dir" ]; then
  if [ -e "$target_path" ]; then
    # Existing file — strict match.
    for prefix in fc dep fs; do
      f="$session_dir/$prefix-$hash"
      if [ -f "$f" ]; then
        # mtime within TTL?
        if find "$f" -mmin -"$ttl_min" 2>/dev/null | grep -q .; then
          satisfied=1
          break
        fi
      fi
    done
  else
    # New file — any recent fs-* or fc-* sentinel.
    if find "$session_dir" -maxdepth 1 -type f \( -name 'fs-*' -o -name 'fc-*' \) -mmin -"$ttl_min" 2>/dev/null | grep -q .; then
      satisfied=1
    fi
  fi
fi

if [ "$satisfied" = "1" ]; then
  exit 0
fi

# Build the nudge message — show the canonical (relative) path.
display_path="${rel_path:-$file_path}"
if [ -e "$target_path" ]; then
  msg="Lien gate: no recent impact analysis for $display_path. Run one of:
  • mcp__plugin_lien_lien__get_files_context({ filepaths: \"$display_path\" })  — required before Edit/Write
  • mcp__plugin_lien_lien__get_dependents({ filepath: \"$display_path\" })       — required before changing an exported symbol
Disable for this session: \`lien gate off\` (or LIEN_GATE=off)."
else
  msg="Lien gate: about to create $display_path with no prior find_similar call. Consider:
  • mcp__plugin_lien_lien__find_similar({ code: \"<the pattern you're about to write>\" })
to see if this already exists. Disable for this session: \`lien gate off\`."
fi

if [ "$mode" = "block" ]; then
  printf '%s\n' "$msg" >&2
  exit 2
fi

emit_message "$msg"
exit 0
