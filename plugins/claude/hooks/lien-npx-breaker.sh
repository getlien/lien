#!/usr/bin/env bash
# Drop-in replacement for a direct `npx -y @liendev/lien@latest` call,
# installed into `LIEN_CMD` by `lien-resolve.sh` (only when no global `lien`
# is on PATH — the default plugin setup — and the breaker is enabled). Every
# hook script still invokes "${LIEN_CMD[@]}" <subcommand> <args...> exactly
# as before; this wrapper receives that same argv, so no other hook script
# needed to change.
#
# Writes a Unix timestamp to $LIEN_NPX_BREAKER_MARKER immediately before the
# real npx call, and removes it immediately after — on ANY normal exit here,
# success or failure alike. If this process is SIGKILLed mid-call (Claude
# Code's own 5000ms hook timeout is the only bound that exists — see
# lien-resolve.sh — while npx hangs on an unreachable/black-holed registry),
# the marker is never removed. That's the whole point: a SIGKILL can't be
# trapped, so this process has no way to record its own failure, but a
# LATER invocation can read the marker's age and infer "the last attempt
# never finished" even though nothing here ever told it so directly. See
# lien-resolve.sh for the read side of this contract.
set -u

marker="${LIEN_NPX_BREAKER_MARKER:?lien-npx-breaker.sh requires LIEN_NPX_BREAKER_MARKER}"
mkdir -p "$(dirname "$marker")" 2>/dev/null
date +%s > "$marker" 2>/dev/null

npx -y @liendev/lien@latest "$@"
rc=$?

rm -f "$marker" 2>/dev/null
exit "$rc"
