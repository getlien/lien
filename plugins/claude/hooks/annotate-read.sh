#!/usr/bin/env bash
# PostToolUse hook on Read: surface Lien impact analysis as a
# system-reminder annotation alongside the file content.
#
# Talks to a long-running per-repo `lien annotate-daemon` over a Unix
# socket. The daemon holds an open VectorDB and an in-memory suppression
# map, so the steady-state hot path is ~5–20ms. When the daemon isn't
# running, the hook auto-spawns it and retries once; on a second failure,
# falls through to the one-shot `lien annotate` (today's behavior) so the
# user never loses an annotation.

set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v lien >/dev/null 2>&1 || exit 0

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"

[ -n "$file_path" ] || exit 0
[ -n "$session_id" ] || exit 0

# Defensive: the daemon uses session_id only as a Map key now, but we
# still reject pathological values at the hook boundary so the request
# stays well-formed.
case "$session_id" in
  *[!A-Za-z0-9_-]*) exit 0;;
esac

# Resolve store from the session's cwd so multi-repo setups work correctly.
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  store="$(cd "$cwd" && lien path --store 2>/dev/null)"
else
  store="$(lien path --store 2>/dev/null)"
fi
[ -n "$store" ] || exit 0

# Extension filter: skip if extension isn't in Lien's indexed set.
ext="${file_path##*.}"
if [ "$ext" = "$file_path" ]; then
  # No extension at all.
  exit 0
fi
if ! lien path --extensions 2>/dev/null | grep -Fxq "$ext"; then
  exit 0
fi

socket_path="$store/annotate-daemon.sock"

# Build the request JSON once. The daemon expects newline-terminated NDJSON.
request_json="$(jq -nc \
  --argjson v 1 \
  --arg sid "$session_id" \
  --arg fp "$file_path" \
  --arg cwd "$cwd" \
  '{v: $v, session_id: $sid, file_path: $fp, cwd: $cwd}')"
[ -n "$request_json" ] || exit 0

# Send `$request_json` to the daemon at `$socket_path` and capture one
# response line. Tries `nc` first (preferred when available); falls back
# to `python3` (ships on macOS/Linux); finally returns empty so the
# caller takes the fall-through path.
send_to_daemon() {
  local sock="$1" payload="$2"
  if command -v nc >/dev/null 2>&1; then
    # -U: Unix socket. -w 5: 5s overall timeout. Some `nc` builds don't
    # support -w on -U; redirect stderr to /dev/null and let an empty
    # response trigger the fall-through.
    printf '%s\n' "$payload" | nc -U -w 5 "$sock" 2>/dev/null | head -n 1
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    SOCK="$sock" PAYLOAD="$payload" python3 - <<'PY' 2>/dev/null
import os, socket, sys
sock_path = os.environ["SOCK"]
payload = os.environ["PAYLOAD"]
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(5)
    s.connect(sock_path)
    s.sendall(payload.encode("utf-8") + b"\n")
    buf = b""
    while b"\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    line = buf.split(b"\n", 1)[0]
    sys.stdout.write(line.decode("utf-8", "replace"))
except Exception:
    pass
PY
    return
  fi
  return 1
}

annotation=""
if [ -S "$socket_path" ]; then
  response="$(send_to_daemon "$socket_path" "$request_json" || true)"
  if [ -n "$response" ]; then
    annotation="$(printf '%s' "$response" | jq -r '.annotation // empty' 2>/dev/null)"
  fi
fi

# Daemon missing or unresponsive → spawn it (best-effort), retry once,
# then fall through to the one-shot CLI.
if [ -z "$annotation" ] && [ ! -S "$socket_path" ]; then
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    (cd "$cwd" && nohup lien annotate-daemon --detach >/dev/null 2>&1 &) || true
  else
    (nohup lien annotate-daemon --detach >/dev/null 2>&1 &) || true
  fi
  # Brief delay to let the detached daemon bind the socket.
  sleep 0.15
  if [ -S "$socket_path" ]; then
    response="$(send_to_daemon "$socket_path" "$request_json" || true)"
    if [ -n "$response" ]; then
      annotation="$(printf '%s' "$response" | jq -r '.annotation // empty' 2>/dev/null)"
    fi
  fi
fi

# Final fall-through: synchronous one-shot. Pays the cold-start cost but
# guarantees the annotation isn't dropped if the daemon path is broken.
if [ -z "$annotation" ]; then
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    annotation="$(cd "$cwd" && lien annotate "$file_path" 2>/dev/null)"
  else
    annotation="$(lien annotate "$file_path" 2>/dev/null)"
  fi
fi

# Trivial impact → empty annotation → stay silent.
[ -n "$annotation" ] || exit 0

# Emit the hookSpecificOutput JSON. additionalContext is the channel that
# actually reaches the model on the next turn (verified in CC 2.1.142).
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' \
  "$(printf '%s' "$annotation" | jq -Rs .)"

exit 0
