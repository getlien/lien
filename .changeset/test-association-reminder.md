---
'@liendev/lien': minor
---

Add the post-edit test-association reminder — closing the read → write → verify loop the way the plan-time nudge closed read → write.

- `lien annotate` gains a `--tests-only` flag: prints one compact line naming the tests associated with the file ("Lien: you changed \<file\> — associated tests: \<tests\>. Run them before completing."), or nothing when the file has no associated tests. It's the cheap path — a single index scan for test associations, skipping the full annotation's dependency-graph BFS and complexity analysis entirely.
- The Claude Code plugin gains a `test-reminder.sh` hook on `PostToolUse:Edit|Write|MultiEdit` (a sibling of `delta-write.sh`, each script stays single-purpose) that surfaces that line via `additionalContext` after an edit. Silent when there are no associations or the repo has no index; TTL-suppressed per file per session (same touchfile pattern as `annotate-read.sh`, namespaced so the two never collide); fail-open throughout — hook errors never block the edit. Kill switch: `LIEN_TEST_REMINDER=off`.
