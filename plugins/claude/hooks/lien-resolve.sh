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
# On failure, `LIEN_RESOLVE_FAIL_REASON` is set to `breaker_open` (the npx
# circuit breaker below is tripped) or `no_binary` (neither `lien` nor `npx`
# exists) so a caller that needs to distinguish can, e.g.:
#   if ! . "$(dirname "${BASH_SOURCE[0]}")/lien-resolve.sh"; then
#     [ "$LIEN_RESOLVE_FAIL_REASON" = "breaker_open" ] && ...
#     exit 0
#   fi
# annotate-read.sh is the one caller that does this (HOOKS-6) — see its own
# comments for why.
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
#
# Known false-positive trigger: a stale in-flight marker is the fingerprint
# of an untrapped kill, but it cannot tell WHY the process was killed — a
# registry hang is only one cause. The same fingerprint is left by the lid
# closing / the machine sleeping mid-call (wall clock jumps forward past
# LIEN_NPX_BREAKER_STALE_SEC the moment it wakes), a Ctrl-C or session kill
# landing on the process group (SIGINT is untrapped here too — anything that
# terminates this process before it reaches its own cleanup line has the
# same effect as a SIGKILL), or an OOM kill. In every one of these cases the
# registry is actually fine and the breaker still opens, silencing nudges
# for the full cooldown even though nothing is wrong. This isn't a new
# failure class for this hook suite — missing `jq`, an unindexed repo, and a
# dozen other conditions already fail this silently — and it's strictly
# better than the 5s-stall-per-edit it replaces. It self-heals once the
# cooldown lapses; LIEN_NPX_BREAKER_COOLDOWN_SEC lowers the wait, and
# LIEN_NPX_BREAKER=off disables the mechanism entirely.
#
# Why the default cooldown is 300s and not shorter, given false positives
# from the paragraph above are plausible: the two failure shapes have very
# different persistence and severity profiles. A benign kill is a one-off,
# coincidental event — it can only produce a false trip if it happens to
# land during the narrow window a hook is actually running (measured at
# 200-600ms end to end in normal operation), so across a whole session the
# odds of it landing in that window at all are low, and the cost when it
# does is just a few minutes of missing nudges (silence, not breakage,
# self-healing, in a suite that's already advisory-only throughout). A real
# black-holed registry, by contrast, is a standing network condition
# (corporate proxy, VPN, firewall) that typically does NOT resolve itself
# within a single work session — it stays down until the user changes
# network config, so a short cooldown mostly buys nothing there (the retry
# just hangs again) while making the *common* pattern strictly worse: every
# cooldown expiry re-probes and re-stalls ~5s, so a 60s cooldown costs
# roughly 5x more cumulative stall time than 300s over a long session on a
# persistently broken network (~one 5s stall/minute vs. one every 5
# minutes). Given the rare/low-severity profile of the false-positive case
# against the common/high-cost profile of the true-positive case this
# breaker exists for, 300s is kept as the default. Lower it via
# LIEN_NPX_BREAKER_COOLDOWN_SEC if a false trip's silence is worse for a given
# workflow than the occasional extra stall.
# This hooks directory's own absolute path — passed as `--hooks-dir` to `lien
# nudge note-shown`/`note-signal`/`recap` so the nudge-events ledger can stamp
# each event with a content hash of the LIVE hooks (see nudge-build.ts and
# issue #916). Resolved once here (not duplicated per sibling script) via the
# same BASH_SOURCE trick every hook already uses to find lien-resolve.sh
# itself, `cd`+`pwd`'d to an absolute path since a relative one wouldn't
# survive a sibling script's own `cd "$cwd"` before it shells out.
LIEN_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# HOOKS-6: WHY resolution failed, for the one caller that cares
# (annotate-read.sh, whose complexity/headroom annotation is covered by the
# #938/#978 never-suppress guarantee). Every other hook still just treats a
# nonzero return as "stay silent" via `|| exit 0` and never reads this — set
# unconditionally (cleared on the success paths below) so `set -u` callers
# can safely reference `${LIEN_RESOLVE_FAIL_REASON:-}` either way.
# "breaker_open" specifically means: an actual annotation attempt was
# skipped, not merely deferred, because the npx circuit breaker below is (or
# was just now) tripped — as opposed to "no_binary" (neither `lien` nor
# `npx` exists at all), which no fallback in this repo can do anything about.
LIEN_RESOLVE_FAIL_REASON=""

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
      LIEN_RESOLVE_FAIL_REASON="breaker_open"
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
          LIEN_RESOLVE_FAIL_REASON="breaker_open"
          return 1
        fi
      fi
    fi

    export LIEN_NPX_BREAKER_MARKER="$marker"
    LIEN_CMD=(bash "$(dirname "${BASH_SOURCE[0]}")/lien-npx-breaker.sh")
  fi
else
  LIEN_RESOLVE_FAIL_REASON="no_binary"
  return 1
fi
