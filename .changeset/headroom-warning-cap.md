---
'@liendev/lien': patch
---

Cap the complexity headroom warning line at the 3 worst entries. A dogfood run of PR #772 surfaced a real 5-entry file rendering as a ~250-char single line — past 3-4 entries the warning became hard to read. The line now shows the 3 worst entries (over-threshold first, by highest overage ratio, then nearest-to-threshold) and folds anything beyond that into an explicit "… and N more at/near budget" remainder — never a silent truncation. The full, uncapped list is unaffected: `get_files_context`'s `complexityHeadroom` array still carries every near/over-budget entry; only the human-readable warning string is capped. Shared by both consumers (`get_files_context`'s `complexityHeadroomWarning` field and `lien annotate`'s printed nudge line) since both call the one formatter.
