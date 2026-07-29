#!/usr/bin/env bash
# Shared lien resolver for plugin hooks. A global `lien` install is NOT
# guaranteed — the plugin's own MCP server invokes `npx -y @liendev/lien@latest`
# for exactly that reason — so hooks must not hard-require one. Before this
# resolver existed, every hook opened with `command -v lien || exit 0`, which
# made the entire hook suite a silent no-op on machines without a global
# install (i.e. the default plugin setup).
#
# Usage (from a sibling hook script):
#   . "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh" || exit 0
#   "${LIEN_CMD[@]}" path --store
#
# Resolution order: global `lien` (fastest) → `npx -y @liendev/lien@latest`
# (warm npx adds ~300ms; the SessionStart hook pre-warms the cache so real
# hook invocations never pay the cold install). Fails the source (caller
# exits 0, staying silent) only when neither is available.
#
# Circuit breaker for an unreachable/black-holed npm registry (default on;
# opt out with LIEN_NPX_BREAKER=off). There's no portable `timeout` binary
# on macOS bash 3.2, so this can't bound npx's own hang from the inside;
# Claude Code's 5000ms hook timeout (hooks.json) is the only thing that ever
# stops a truly hung call, and it does so with an unmaskable SIGKILL that no
# trap here could intercept. So instead of trying to time-bound npx directly,
# the npx path is routed through `lien-npx-breaker.sh`, which drops a
# timestamp marker immediately before the call and removes it immediately
# after, on any normal exit. A marker left behind — found here, on a LATER
# invocation — older than LIEN_NPX_BREAKER_STALE_SEC (default 7s, just above
# the hook timeout: no legitimate single call can still be "in flight" past
# that point, so an older marker can only mean the process that wrote it was
# already killed) is exactly the fingerprint a SIGKILLed call leaves.
#
# Two markers, not one, because a single "in-flight" marker alone has a gap:
# if it just gets rewritten fresh by the NEXT attempt every time staleness is
# checked, a run of edits arriving faster than the staleness window keeps
# resetting the clock and the breaker never actually opens, even though every
# single attempt is independently hanging. So detecting staleness doesn't
# retry — it consumes the stale in-flight marker (removes it) and instead
# writes a SEPARATE "breaker open until <epoch>" marker
# (LIEN_NPX_BREAKER_UNTIL_MARKER to override; same directory as the in-flight
# marker by default) that every subsequent invocation checks FIRST, unarmed
# by any new attempt, for the full LIEN_NPX_BREAKER_COOLDOWN_SEC window
# (default 300s) — so the breaker, once open, stays open for the whole
# cooldown regardless of how many more edits arrive in the meantime. Only
# once the cooldown lapses does resolution fall through to a real retry,
# which starts the whole cycle over from a clean in-flight marker.
#
# Both markers are intentionally machine-global, not per-repo — an
# unreachable registry is a network condition, not a per-project one, and
# per-repo scoping would need its own `lien` invocation (`path --store`) just
# to find where to look, which is the exact chicken-and-egg this breaker
# exists to avoid triggering.
if command -v lien >/dev/null 2>&1; then
  LIEN_CMD=(lien)
elif command -v npx >/dev/null 2>&1; then
  if [ "${LIEN_NPX_BREAKER:-on}" = "off" ]; then
    LIEN_CMD=(npx -y @liendev/lien@latest)
  else
    marker="${LIEN_NPX_BREAKER_MARKER:-${TMPDIR:-/tmp}/lien-npx-breaker/inflight}"
    breaker_until="${LIEN_NPX_BREAKER_UNTIL_MARKER:-$(dirname "$marker")/breaker-open-until}"
    stale_after="${LIEN_NPX_BREAKER_STALE_SEC:-7}"
    cooldown="${LIEN_NPX_BREAKER_COOLDOWN_SEC:-300}"
    case "$stale_after" in ''|*[!0-9]*) stale_after=7 ;; esac
    case "$cooldown" in ''|*[!0-9]*) cooldown=300 ;; esac

    now_ts="$(date +%s 2>/dev/null)"
    case "$now_ts" in ''|*[!0-9]*) now_ts="" ;; esac

    breaker_open=0
    if [ -n "$now_ts" ] && [ -f "$breaker_until" ]; then
      until_ts="$(cat "$breaker_until" 2>/dev/null)"
      case "$until_ts" in ''|*[!0-9]*) until_ts="" ;; esac
      if [ -n "$until_ts" ]; then
        if [ "$now_ts" -lt "$until_ts" ]; then
          breaker_open=1
        else
          rm -f "$breaker_until" 2>/dev/null # cooldown elapsed; tidy up
        fi
      fi
    fi

    if [ "$breaker_open" = 1 ]; then
      # Still cooling down from a previously detected hang. Fail the source
      # (caller exits 0, silent) without even looking at the in-flight
      # marker — that's the whole point: no new attempt, no new hang.
      return 1
    fi

    if [ -n "$now_ts" ] && [ -f "$marker" ]; then
      marker_ts="$(cat "$marker" 2>/dev/null)"
      case "$marker_ts" in ''|*[!0-9]*) marker_ts="" ;; esac
      if [ -n "$marker_ts" ]; then
        age=$(( now_ts - marker_ts ))
        if [ "$age" -ge "$stale_after" ]; then
          # The last attempt never completed — almost certainly killed
          # mid-flight. Open the breaker for the cooldown window and consume
          # the stale evidence so the NEXT check (once cooldown lapses)
          # doesn't immediately re-trip on this same leftover marker.
          mkdir -p "$(dirname "$breaker_until")" 2>/dev/null
          echo $(( now_ts + cooldown )) > "$breaker_until" 2>/dev/null
          rm -f "$marker" 2>/dev/null
          return 1
        fi
      fi
    fi

    export LIEN_NPX_BREAKER_MARKER="$marker"
    LIEN_CMD=(bash "$(dirname "${BASH_SOURCE[0]}")/lien-npx-breaker.sh")
  fi
else
  return 1
fi
