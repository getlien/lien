---
'@liendev/lien': patch
---

Fix the session-recap `blocked` loop-prevention marker so its write obeys one consistent switch, `LIEN_RECAP`, everywhere. `recordBlocked` is exempt from `LIEN_TEST_VERIFY=off` by design (it's the recap's loop-prevention, not test-verify recording), but the legacy `lien verify-tests report` path (`runReport`) previously gated it by neither switch — so a user with the recap disabled still wrote a suppressing marker. `runReport` now gates the write on `recapEnabled()`, matching the recap hook path, via a single shared `recapEnabled()` helper in `test-ledger.ts`.
