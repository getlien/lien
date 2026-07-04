---
'@liendev/lien': patch
---

Fix `get_dependents` reporting complexity metrics for files that aren't actually dependents. For symbol-level queries, `complexityMetrics`/`highComplexityDependents`/`riskReasoning` were computed from the pre-symbol-filter candidate set (every file that imports the target file) instead of the resolved `dependents` list, so an unrelated file that merely imports the target — without using the requested symbol — could inflate the reported risk even when zero real dependents were found. Complexity is now joined against exactly the resolved dependents.
