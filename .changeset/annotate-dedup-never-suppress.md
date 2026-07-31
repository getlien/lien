---
"@liendev/lien": patch
---

Fix the Claude Code read-hook's per-session annotation dedup silently
bypassing the #938 never-suppress policy for an incomplete
dependent-attribution result, a complexity warning, or a headroom concern
(#978).

`isTrivial` and `belowRiskFloor` (`annotate-cmd.ts`) both already guarantee
those signals are never silenced, but a THIRD gate — `annotate-read.sh`'s
per-session dedup — ran *before* `lien annotate` on a file's second Read this
session and exited unconditionally once its touchfile existed, with no way to
know whether the annotation it was suppressing carried one of those signals.
`lien annotate` now exits `2` (instead of the default `0`) whenever the
annotation it just printed carries a never-suppress signal
(`hasNeverSuppressSignal`, the single predicate `isTrivial`/`belowRiskFloor`
both gate on), and the hook records that in the touchfile's *content* — `1`
means "never dedup-skip this file again this session," so a signal-carrying
file re-invokes `lien annotate` on every read for the rest of the session,
while an ordinary file keeps the existing, cheap existence-only dedup.

`annotateCommand` now returns whether the printed annotation carried that
signal (previously `void`); the CLI's `process.exit` wiring moved to a new
`annotateCli` wrapper so tests can keep calling `annotateCommand` directly.
