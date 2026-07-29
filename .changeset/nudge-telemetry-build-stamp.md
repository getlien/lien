---
"@liendev/lien": patch
---

#916: an empty `nudge-events.jsonl` window in `lien stats` used to render
identically whether nobody ever qualified for a nudge, a nudge fired and got
ignored every time, or the deployed plugin hooks predated this
instrumentation entirely and recording was never possible. That third case
actually happened on a real machine: a directory-source plugin install
pinned to a stale branch produced a silently empty ledger, and the resulting
telemetry read had to be forensically reconstructed before a product
decision could be made.

Every recorded `shown`/`signal` event now carries a `build` stamp
(`{ cliVersion, hooksHash? }`) — the running CLI's version plus a content
hash of the plugin hooks directory the recording hook script lives in. CLI
version alone isn't enough: the failure mode is stale *hooks* running
alongside an otherwise-current CLI install. The hash is computed once per
session and cached (`nudge-build/<sessionId>.json` next to the other
per-session state, GC'd the same way), so the hooks directory is never
re-hashed per event.

`lien stats` now tells the three cases apart: a non-empty window reports the
build that recorded it (`Recorded by: ...`); a window with zero events but a
capable build seen elsewhere in the ledger says so and reports when
(`Zero events in this window, but a recording-capable build was last seen
...`); a ledger that has never once seen a build-stamped event says
recording may never have been possible, rather than implying disengagement.
Existing (pre-#916) ledger entries have no `build` field — they're read as
"build unknown", never as a known-good build.

New `lien nudge doctor [--hooks-dir <path>]` command: a manual drift check
that flags the exact fingerprint of the incident above (the telemetry
instrumentation's signal-recording hook missing from a live plugin hooks
directory entirely), plus CLI-version/hooks-hash drift against the ledger's
own history.
