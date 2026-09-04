---
'@liendev/lien': patch
---

### Fixes

- `lien review` now reports a missing repository the way `lien delta` already did, instead of leaking the git invocation (#1150). Before, it exited 1 with `Command failed: git ls-files --others --exclude-standard -z` and git's own `fatal: not a git repository`; now both commands print `not a git repository (or git is not installed)` and exit 2. The sentence is shared between them, so they cannot drift apart again.

- `lien health` now says when its list is not in risk order (#1151). Entries are grouped by how expensive a change is and ranked by risk *within* each group, so a higher-risk function can appear below a lower-risk one. On go-chi/chi, `findRoute` scores 306 — 3.8x the top-ranked entry — and displays third with the softest advice tier. The note appears only when the shown entries actually diverge, so a run whose display order already matches its risk order stays quiet.

- `lien review --all-signals` now states that the 13 signals it enables have never had their precision established (#1152). The calibration note was printed only when those signals were *withheld*, so it vanished exactly when a user turned them on and started reading their output.

- `lien health` no longer prints `no index` in its stats line (#1154). There is no index and no alternative mode, so the phrase read as a degraded state and invited a hunt for the flag that would fix it.
