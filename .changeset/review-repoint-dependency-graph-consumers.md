---
'@liendev/review': patch
---

Repoint review's internal consumers of the dependency graph at `@liendev/parser` now that `dependency-graph.ts` has moved there.

`blast-radius.ts`, `blast-radius-render.ts`, and the agent plugin's
`agent-tools.ts`/`types.ts`/`index.ts` now import `buildDependencyGraph`,
`isPreciseProvenance`, `DependencyGraph`, `CallerEdge`, and `EdgeProvenance`
from `@liendev/parser` instead of a local module. Review's own public export
of these symbols is removed (nothing outside `review` consumed it — consume
them from `@liendev/parser` directly going forward). Internal refactor only;
no behavior change.
