---
'@liendev/lien': minor
---

Add local `lien delta` event recording + `lien stats` — the first move of measuring whether the nudge loop actually works.

Every `lien delta` invocation (manual, the plugin's write-time hook, or a CI `--base` run) now appends one line to a local, append-only `delta-events.jsonl` next to your project's index (`~/.lien/indices/<repoId>/`). This is instrumented in the `lien delta` command itself, not the shell hook, so every invocation path counts the same way. Strictly local: no network call, no telemetry, nothing leaves your machine. The log is capped (trimmed from the front past 2 MB) so it never grows unbounded. Disable recording entirely with `LIEN_DELTA_EVENTS=off`.

- **`lien stats`** — a new command reporting 7/30-day windows: total `lien delta` runs, runs with new crossings, distinct functions flagged, and functions later seen clean after being flagged (`resolvedAfterFlag` — an honest presence/absence signal, not a causal claim that the warning caused the fix), plus the share of flagged runs that were `--soft`.
- Kept as a separate command rather than folded into `lien status`: `status` is a point-in-time index-health snapshot: `stats` aggregates a growing historical log over time windows — different data shape, different concern.
