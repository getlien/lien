# @liendev/review

## 0.1.23

### Patch Changes

- Updated dependencies [85ef96f]
- Updated dependencies [2d2bb2b]
  - @liendev/parser@0.77.0

## 0.1.22

### Patch Changes

- ab10e5a: Repoint review's internal consumers of the dependency graph at `@liendev/parser` now that `dependency-graph.ts` has moved there.

  `blast-radius.ts`, `blast-radius-render.ts`, and the agent plugin's
  `agent-tools.ts`/`types.ts`/`index.ts` now import `buildDependencyGraph`,
  `isPreciseProvenance`, `DependencyGraph`, `CallerEdge`, and `EdgeProvenance`
  from `@liendev/parser` instead of a local module. Review's own public export
  of these symbols is removed (nothing outside `review` consumed it — consume
  them from `@liendev/parser` directly going forward). Internal refactor only;
  no behavior change.

- Updated dependencies [ab10e5a]
  - @liendev/parser@0.76.0

## 0.1.21

### Patch Changes

- 206127d: fix(parser,cli,review): name the fallback behind an inferred dependent (#1018)

  `get_dependents`' `dependent-attribution-partial` caveat described C#'s
  type-reference fallback in every case, because `confidence: 'inferred'` was
  single-valued and the mechanism identity was discarded at the parser boundary.
  When #1039 added Go's root-package export lookup — same marker, same caveat
  reason — every recovered Go file was told _"its language, C#, lets real callers
  use its exports with no per-file import naming it at all"_ and that its
  dependents came from _"matching a uniquely-declared type name against other
  files' source text"_. Both false; measured on a real `go-chi/chi` clone, 24 of
  24 recovered edges across `context.go`/`mux.go`/`chain.go`.

  `@liendev/parser` now owns `INFERRED_DEPENDENT_MECHANISMS`, a `Record`-guarded
  table of the non-import recovery fallbacks and their canonical prose, and
  `DependentInfo.inferredVia` names the mechanism per dependent. Every
  consumer-facing surface — the caveat note, the caveat-reason text, the server
  instructions, the tool description and the docs page — derives from the table
  instead of restating it, so a third fallback is a compile error until its prose
  exists and then correct everywhere at once.

  `DependentInfo.confidence` is unchanged and still marks exactly what it did;
  `inferredVia` is additive. `review`'s `isPreciseProvenance` returns exactly what
  it returned for all seven tiers, now via a `Record<EdgeProvenance, boolean>` so
  an eighth tier can't default silently.

  Also fixes two doc-truth defects on the MCP tools page found while mapping the
  surfaces: `dependent-attribution-partial` was documented as C#-only, and
  `testAssociations[]` was documented as `{ testFile, confidence, method }` with a
  "Confidence Levels" section — a shape and vocabulary that exist nowhere in the
  code (the real field is `string[]`), attributed to a tool that never emitted the
  field.

  ADR-016 records why the three vocabularies #1018 named were not merged into one,
  and the routing rule for where a new honesty signal belongs.

- 761b3bc: Share one chunk-line lookup between `get_dependents` usage snippets and review's dependent context (#1087)

  Both computed a snippet's position as `callSiteLine - chunk.metadata.startLine`,
  which is only exact when a chunk's content starts on the line `startLine` names.
  A module-level chunk's does not — `createChunkFromRange` trims its range's
  leading blank lines out of the content while `startLine` keeps naming the
  untrimmed start — so the subtraction overshoots: `get_dependents` returned a
  neighbouring statement as the snippet, and review's `extractSnippetWindow`
  either centred its window a line late or, once the overshoot exceeded the
  content, returned `null` and dropped the snippet from the review prompt
  entirely.

  Both now go through `findChunkLineIndex`, which locates the line by finding the
  nearby one that mentions the symbol. `review`'s module-level callers are also
  labelled `(module-level)` rather than `unknown`, matching what parser already
  reports, and the `()` suffix is dropped for them since module-level code is not
  a function.

- Updated dependencies [206127d]
- Updated dependencies [761b3bc]
- Updated dependencies [8b573b2]
- Updated dependencies [761b3bc]
  - @liendev/parser@0.75.6

## 0.1.20

### Patch Changes

- e53a6b3: fix: stop the PR trust badge claiming "delivered" on an attestation of `degraded:budget_starved` (#1077)

  Lien Review's `Trust: **Delivered** — The review ran to completion within
budget.` line could render on a PR whose own delivery attestation, posted
  minutes later in the same body, read `Attested: degraded:budget_starved`
  (#1073, #1078). Both `anthropic-client.ts` and `openai-client.ts` run a
  forced summary-retry after a pass exhausts its token/turn budget — if that
  retry recovers a parseable verdict, the pass's `incomplete` flag clears even
  though its `stopReason` stays `'budget'`/`'max_turns'`. For an EXTRA pass
  (doc-truth, incomplete-handling-loop), that meant the merge into the main
  result's `incomplete` flag never fired, so `derivePresentTimeVerdict`
  (`plugins/agent/index.ts`) — which only read that gated flag — saw nothing
  and defaulted to `'delivered'`. The attestation's `computeVerdict` was never
  fooled: it reads every extra pass's own raw, ungated `stopReason` directly
  off `PassOutcome`.

  `appendSummaryFinding` now stamps each extra pass's raw `stopReason`
  (`extraPassStopReasons`) onto the summary finding unconditionally, and
  `derivePresentTimeVerdict` checks it before falling back to `'delivered'` —
  the same two-tier read (main pass gated on `mainPassIncomplete`, extra passes
  ungated) `computeVerdict` already uses, so the two can no longer disagree on
  this axis. `plugins-agent-trust-badge.test.ts` now enumerates all seven
  `AttestationVerdict` values against the present-time badge, including the
  regression scenario and the three verdicts genuinely not representable at
  present-time (documented as deliberate, not silently dropped).

- Updated dependencies [81bdbd2]
  - @liendev/parser@0.75.5

## 0.1.19

### Patch Changes

- Updated dependencies [1f94a12]
- Updated dependencies [921cd76]
- Updated dependencies [62ad43e]
- Updated dependencies [7db9264]
- Updated dependencies [5947350]
  - @liendev/parser@0.75.0

## 0.1.18

### Patch Changes

- Updated dependencies [231855a]
- Updated dependencies [d7eed3a]
- Updated dependencies [7f3e85d]
- Updated dependencies [de5fef0]
- Updated dependencies [4b5efb6]
- Updated dependencies [14a34a2]
- Updated dependencies [56bcd9c]
  - @liendev/parser@0.74.0

## 0.1.17

### Patch Changes

- Updated dependencies [f2937c9]
- Updated dependencies [10474a9]
- Updated dependencies [48767ca]
  - @liendev/parser@0.73.0

## 0.1.16

### Patch Changes

- Updated dependencies [fe8160c]
- Updated dependencies [988b1d3]
- Updated dependencies [6ef268f]
- Updated dependencies [8c3b2ce]
- Updated dependencies [1195abe]
- Updated dependencies [7a87fac]
- Updated dependencies [ecf89ae]
- Updated dependencies [5a21f45]
  - @liendev/parser@0.72.0

## 0.1.15

### Patch Changes

- Updated dependencies [bbe0692]
- Updated dependencies [6fc55ab]
- Updated dependencies [f65df04]
- Updated dependencies [db565d2]
- Updated dependencies [da1ec69]
- Updated dependencies [99cf7e5]
- Updated dependencies [ac0480f]
- Updated dependencies [4a863f2]
  - @liendev/parser@0.71.0

## 0.1.14

### Patch Changes

- Updated dependencies [0867ea3]
- Updated dependencies [94e7fd2]
- Updated dependencies [6e65321]
- Updated dependencies [a7cf15c]
- Updated dependencies [f730ac1]
- Updated dependencies [4a51d22]
- Updated dependencies [7c9316f]
  - @liendev/parser@0.70.0

## 0.1.13

### Patch Changes

- Updated dependencies [242892d]
- Updated dependencies [cf0d462]
- Updated dependencies [4fd502b]
  - @liendev/parser@0.69.1

## 0.1.12

### Patch Changes

- Updated dependencies [8c87642]
  - @liendev/parser@0.68.0

## 0.1.11

### Patch Changes

- Updated dependencies [ead2bc9]
  - @liendev/parser@0.67.0

## 0.1.10

### Patch Changes

- Updated dependencies [8175bf5]
  - @liendev/parser@0.66.0

## 0.1.9

### Patch Changes

- Updated dependencies [c6abb00]
  - @liendev/parser@0.64.0

## 0.1.8

### Patch Changes

- Updated dependencies [2b2e259]
  - @liendev/parser@0.62.0

## 0.1.7

### Patch Changes

- Updated dependencies [5789e1c]
- Updated dependencies [e6efbb3]
- Updated dependencies [a39644a]
  - @liendev/parser@0.61.0

## 0.1.6

### Patch Changes

- Updated dependencies [68e98ef]
  - @liendev/parser@0.59.0

## 0.1.5

### Patch Changes

- Updated dependencies [6e502dd]
  - @liendev/parser@0.58.0

## 0.1.4

### Patch Changes

- Updated dependencies [d36fb55]
  - @liendev/parser@0.57.0

## 0.1.3

### Patch Changes

- Updated dependencies [297883e]
  - @liendev/parser@0.52.0

## 0.1.2

### Patch Changes

- Updated dependencies [57d1529]
  - @liendev/parser@0.51.2

## 0.1.1

### Patch Changes

- ca61516: Pin `@liendev/*` sibling dependencies to a real semver range instead of `"*"`.

  `packages/cli/package.json` (published as `@liendev/lien`) declared `@liendev/core` and `@liendev/parser` as `"*"`, and `packages/core/package.json` declared `@liendev/parser` as `"*"`. Since `"*"` is never rewritten at publish time, npm installs of `@liendev/lien` could resolve to whatever `@liendev/core`/`@liendev/parser` happens to be latest on npm at install time — not the versions `lien` was actually built and tested against. This is the same `"*"`-in-published-package.json family as the earlier phantom `@liendev/review` dependency bug (#620).

  It worked so far mostly by luck (packages are usually published together in the same release), but the drift is real: `@liendev/parser` is currently stuck at `0.50.0` on npm while `@liendev/core`/`@liendev/lien` are at `0.51.0`.

  Fixed by replacing every `"*"` cross-package reference with the actual current semver range (e.g. `^0.51.0`), for both published packages (`cli`, `core`) and private ones (`review`, `action`) for consistency. `changeset`'s `updateInternalDependencies: "patch"` will now correctly keep these ranges in sync on future releases, since a `"*"` range is never considered "violated" and was silently defeating that mechanism.

  Note: `workspace:*` (the pnpm/yarn workspace protocol) is not usable here — this repo uses plain npm workspaces, and npm has no equivalent rewrite step; `npm install --package-lock-only` fails immediately with `EUNSUPPORTEDPROTOCOL` if you try it. A real pinned range is the correct fix for npm workspaces.
