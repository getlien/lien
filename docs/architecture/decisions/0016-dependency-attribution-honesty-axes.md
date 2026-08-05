# ADR-016: Dependency-Attribution Honesty Has Two Axes and Three Scopes — Route, Don't Merge

**Status**: Accepted
**Date**: 2026-08-05
**Deciders**: Core Team
**Related**: #1018 (proposal and the refusal recorded here), PR for #1018
(implementation) · #930, #940, #951, #980, #984, #994, #1005, #1011, #1013,
#1014, #1015, #1026, #1030, #1039, #1064, #1067, #1072, #1078

## Context and Problem Statement

#1018 observed that three vocabularies answer what looks like one question —
*how much should a consumer trust this dependency answer?* — and proposed
consolidating them into a single canonical type owned by `parser`, which
`core`, `cli` and `review` would consume instead of maintaining parallel
dialects:

| vocabulary | home | shape |
|---|---|---|
| `confidence?: 'inferred'` | `packages/parser/src/dependency-analyzer.ts` | single-valued, per dependent |
| `EdgeProvenance` | `packages/parser/src/graph/dependency-graph.ts` | 7 ranked tiers, per caller edge |
| `AttributionCaveatReason` | `packages/cli/src/mcp/attribution-caveat-reasons.ts` | 5 reasons, per response |

The pressure was real. Four consumers had been blocked or had bent around
the gap: #1072 needed to express whole-store and whole-language properties
and fell back to the `note` channel plus omission; #1067's declaration-index
tier named a missing caveat reason as an explicit prerequisite, its concept
currently living as prose in four separate signal-module doc comments; #1015
wants to say a count is a floor distinctly from the existing caveat; and an
evaluation of coverage-derived test associations found `testAssociations:
string[]` carries no provenance at all.

The decision needed was not "merge or don't" but *what is actually one
decision here, and what is several*.

## Decision Drivers

- A consumer-facing honesty signal must get **more** specific under
  consolidation, never vaguer. #1014 is the cost of a signal that fires
  wrongly; a signal that fires vaguely is the same failure with extra steps.
- Whatever replaces or extends an existing vocabulary must keep its
  build-breaking forcing function (#984's `Record<>` pattern). Prose that can
  drift silently is the defect class this repo bleeds.
- `review` depends on `parser` only, never `core` (ADR-012). `parser` is the
  one package all three consumers already import.
- Preserve shipped behaviour: #1026's caveat reasons, #1030's
  verified/inferred bucketing, #1072's note-and-omission.

## Decision Outcome

**The three vocabularies were NOT merged.** They sit on two different axes,
and one of the three is already downstream of the other's canonical facts.
What *was* consolidated is the one thing genuinely decided in more than one
place and demonstrably wrong in production: **the identity of the recovery
mechanism behind an inferred dependent.**

### The model: two axes, three scopes

**Axis A — how was this edge resolved?** A property of an individual edge
that is present. `parser`'s `confidence` and `review`'s `EdgeProvenance` both
live here.

**Axis B — why can't this answer be trusted as a verified clear?** A property
of an answer, usually about what is *absent*. `cli`'s
`AttributionCaveatReason` lives here, and nothing else does.

Orthogonal to both, a signal has one of three **scopes**: per-edge,
per-answer (about a caller-supplied `filepath`), or per-store/per-language
(a capability of the index or the language, independent of any query).

### Why Axis A's two members must stay separate

They are the same axis at **different granularities**, and each is correct
for its own.

`require-only` is the proof. A Ruby `require_relative` verifiably resolves
the target *file*, so `parser`'s file-level `findDependents` correctly treats
that dependent as import-verified and attaches no `confidence` marker. The
same statement names no *symbol* at all, so `review`'s symbol-level graph
correctly ranks it imprecise — the boundary #1030 argued from evidence. One
shared bucketing predicate would have to make one of those two answers
wrong.

Independently: four of `EdgeProvenance`'s seven tiers (`import-only`,
`require-only`, `symbol-name-match`, `oop-method-import`) are distinctions
that only arise *in* a symbol-level analysis — each records something
different about what could be established for the specific symbol, which is a
question `parser`'s file-level `findDependents` never asks. Note this is not a
claim that those four tiers all verify a symbol: `require-only` and
`symbol-name-match` explicitly do not, which is why
`SYMBOL_VERIFIED_BY_PROVENANCE` marks them `false`. The point is that a
file-level pipeline has no way to *draw* the distinction at all, in either
direction. Hoisting the enum into `parser` would therefore publish tiers
nothing in `parser` emits — a vocabulary with dead members, which is worse
than two honest ones. So `EdgeProvenance` stays `review`'s internal ranking
detail.

### Why Axis B was already consolidated

`AttributionCaveatReason` is not an independent taxonomy. `buildAttributionCaveat`
derives all five reasons from fields `parser` already owns on
`FindDependentsResult`: `targetIndexed`, `symbolAttributionDegraded`,
`symbolFoundInFile`, `typeSymbolAttributionIncomplete`,
`dependentAttributionPartial`, `dependentAttributionIncomplete`. The
structural facts are in `parser`; `attribution-caveat-reasons.ts` is the
prose and mutual-exclusion layer over them. Moving model-facing prose into
the AST package would gain nothing and cost the #984 forcing function its
natural home.

### What was actually broken, and fixed

`confidence: 'inferred'` was single-valued, so the mechanism identity was
discarded at `parser`'s boundary and every prose surface had to name a
mechanism from memory. When #930 shipped there was one (C#), so all six
surfaces described C#'s mechanism specifically — four of them naming C# by
name (the runtime caveat note, the `AttributionCaveatReason` doc comment, the
tool description, the docs page), the other two saying "text-matching
fallback" (`ATTRIBUTION_CAVEAT_REASON_TEXT` and, by interpolation, the server
instructions), which is equally wrong for Go. #1039/#1064 then added Go's
root-package export lookup — same marker, same caveat reason — and updated
none of them, because nothing forced it:
`Record<AttributionCaveatReason, string>` guards the set of *reasons*, and no
reason was added. Only an existing reason's mechanism coverage widened.

Measured on a real `go-chi/chi` clone against `origin/main`, every recovered
Go root file was told *"its language, C#, lets real callers use its exports
with no per-file import naming it at all"* and that its dependents were
*"recovered by matching a uniquely-declared type name against other files'
source text"* — both false, on 24 of 24 recovered edges across
`context.go`/`mux.go`/`chain.go`.

So `parser` now owns `INFERRED_DEPENDENT_MECHANISMS`
(`inferred-dependent-mechanisms.ts`): a `Record`-guarded table of the
non-import fallbacks and their canonical prose, with `DependentInfo.inferredVia`
naming the mechanism per dependent. Every consumer-facing surface derives
from the table instead of restating it. The two forcing functions compose —
one guards the set of reasons, the other the set of mechanisms.

### The routing rule for a new honesty signal

1. Is it about **an edge that is present**? Axis A. A new non-import recovery
   mechanism is a new entry in `INFERRED_DEPENDENT_MECHANISMS`; a new
   symbol-level resolution tier is a new `EdgeProvenance` member (and a new
   row in `SYMBOL_VERIFIED_BY_PROVENANCE`).
2. Is it about **why an answer about a caller-supplied `filepath`** isn't a
   verified clear? Axis B — a new `AttributionCaveatReason`.
3. Is it a property of **the store or the language**, true independently of
   any query? Neither axis. Use the response-level `note` channel and the
   existing predicates (`hasDependentAttributionBlindSpot`,
   `hasDependentCounts`, `classifyIndexState`). #1078 got this right and its
   reasoning holds.

Under this rule #1067's prerequisite — a first-class home for *"unique among
indexed declarations in this scope; a reference may still resolve to an
unindexed stdlib/third-party declaration of the same name"* — is a new entry
in `INFERRED_DEPENDENT_MECHANISMS`, not a fifth doc comment and not a sixth
caveat reason. Adding it makes all six prose surfaces correct with no
further edits.

## Considered Options

1. **One canonical enum in `parser`, consumed by all three** (#1018's
   proposal). Rejected: forces one of Axis A's two granularities to be
   wrong, publishes dead tiers from `parser`, and would widen
   `AttributionCaveatReason`'s documented meaning across the five prose
   surfaces #980 had to reconcile — for a category it isn't about.
2. **Close #1018 as won't-fix**, with each blocked consumer getting a
   narrow targeted fix. Rejected: the axis model would stay undocumented and
   get relitigated a fifth time, and the shipped Go/C# prose defect would
   stay shipped.
3. **Record the axis model; consolidate only the recovery-mechanism
   identity; keep the per-axis forcing functions.** Selected.

## Consequences

### Positive

- The Go prose defect is fixed, and its recurrence is a compile error.
- #1067 is unblocked without a new vocabulary: one table entry, six surfaces
  correct.
- `isPreciseProvenance` no longer defaults a new tier silently to "not
  precise" — `Record<EdgeProvenance, boolean>` forces the decision, the same
  move ADR-015 made for `LanguageDefinition`'s matcher-path fields.
- Two live doc-truth defects in the public docs page were found and fixed
  while mapping the surfaces: `dependent-attribution-partial` was documented
  as C#-only, and `testAssociations[]` was documented as
  `{ testFile, confidence, method }` with a "Confidence Levels" section —
  a shape and vocabulary that exist nowhere in the code (the real field is
  `string[]`), on a tool (`search_code`) that never emitted the field at all.

### Negative / Risks

- Three vocabularies still exist. This ADR argues they should, but a reader
  who only counts them will read that as the problem unfixed. The routing
  rule is the mitigation; the ADR is the answer to the fifth relitigation.
- `INFERRED_DEPENDENT_MECHANISMS`' prose is asserted correct per mechanism by
  a test that checks distinctness and a few anchor phrases, not by anything
  that can verify a sentence actually describes the code. A wrong-but-distinct
  description would pass.
- The word "confidence" remains overloaded across unrelated concepts —
  `DependentInfo.confidence`, `review`'s Confidence column, and
  `StaleLiteralCandidate.confidence: 'low'|'medium'|'high'` (an unrelated
  stale-literal score). Not renamed here; noted so the next reader doesn't
  mistake the collision for duplication.

### Neutral

- No semantics change. No caveat starts or stops firing, no dependent's
  `confidence` value changes, `isPreciseProvenance` returns exactly what it
  returned for all seven tiers, and #1072's note-and-omission is untouched.
  `DependentInfo.inferredVia` is additive; a consumer filtering
  `confidence === 'inferred'` is unaffected.

## Deliberately Out of Scope

- **`lien annotate`'s test-coverage tiers.** `formatTests` distinguishes
  four mechanisms in hand-written prose over four parallel arrays
  (`tests`, `packageLevelTests`, `symbolUsageTests`,
  `csharpTypeReferenceTests`) — the same decision as Axis A, at another
  surface, and the next site to consolidate. Left alone because it needs a
  data-shape change to `testAssociations`, not a prose fix, and nothing is
  blocked on it today.
- **Per-association provenance on `testAssociations`.** The consumer that
  motivated it — coverage-derived associations — was evaluated and rejected
  (no coverage artifact in 40 of 40 real checkouts). Building the vocabulary
  for a feature that will not be built is the wrong order.
- **A "stronger than import-verified" direction.** `confidence` can only mark
  something weaker, which was raised as a limitation. No live consumer needs
  "stronger"; the one candidate was coverage-derived associations, above.
- **#1015's "this count is a floor" for real type-reference counting.** When
  that lands, `type-symbol-attribution-incomplete`'s prose needs updating (it
  currently says usages are "often 0"). A prose update at that time, not a
  vocabulary gap now.
- **Renaming the overloaded `confidence`.** A wide mechanical rename with no
  behavioural benefit.

## Validation

1. **Behaviour-preserving on Axis A's bucketing**: `isPreciseProvenance`'s
   existing table-driven test covers all seven tiers and passes unchanged.
2. **The defect is pinned in both directions**: a Go-mechanism response must
   not contain `C#`, `global using` or `source text`, and must contain Go's
   real mechanism; the C# case must still contain C#'s.
3. **The pairing invariant is asserted in both directions**: `confidence ===
   'inferred'` iff `inferredVia !== undefined`, and an import-verified
   dependent carries neither.
4. **Dogfooded through a real `lien serve` over stdio** against a real
   `go-chi/chi` clone, before and after — see the PR body.

## References

- `packages/parser/src/inferred-dependent-mechanisms.ts`: the table, its
  forcing function, and the measured defect it exists to prevent
- `packages/parser/src/dependency-analyzer.ts`: `DependentInfo.confidence` /
  `inferredVia` and `inferredDependent()`, the single constructor for the pair
- `packages/cli/src/mcp/attribution-caveat-reasons.ts`: Axis B's reasons and
  the #984 `Record<>` forcing function, plus why the two guards compose
- `packages/parser/src/graph/dependency-graph.ts`:
  `SYMBOL_VERIFIED_BY_PROVENANCE` and `isPreciseProvenance`
- `docs/architecture/index-state-honesty.md`: the scope-3 policy this ADR
  routes to rather than duplicates
- ADR-012: why `review` cannot depend on `core`, which makes `parser` the
  only shared home
- ADR-015: the precedent for turning a repeatedly-relitigated cross-cutting
  decision into a compiler-forced contract, and for recording a rejected
  proposal alongside the accepted one
