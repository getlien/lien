# ADR-015: Make Per-Language Matching Policy Mandatory and Declarative

**Status**: Accepted
**Date**: 2026-08-01
**Deciders**: Core Team
**Related**: #1038 (proposal, adversarial critique, and revised decision),
PR #1045 (implementation) · #883, #884, #887, #928, #929, #1005, #1017,
#1021, #1024, #1028, #1029, #1032

## Context and Problem Statement

`matchesFile` (`packages/parser/src/utils/path-matching.ts`) resolves
imports for 11 languages via five strategies. Per-language behaviour is
configured through optional flags on `LanguageDefinition`
(`packages/parser/src/ast/languages/types.ts`) that the matcher reads via
`=== true`. Because the flags are optional, a language declaring nothing
silently inherits the shared matcher's permissive defaults — measured on
`main` before this ADR, only 3 of 11 languages (PHP, Ruby, Swift) declared
any of the three matcher-path fields (`wholeModuleImports`,
`singleFileImports`, `namespaceStyleImports`); the other 8, including Rust
and Go, whose module semantics are anything but default, declared none.

At runtime, `unset` and `false` are identical — `hasWholeModuleImports` and
its siblings compare with `=== true`. The gap is purely epistemic: nobody
had ever had to state whether the permissive default was correct-by-design
or correct-by-accident for the 8 silent languages. This is the mechanism
behind #1028: a leniency added for Swift/Go/Ruby's real conventions (#883)
silently applied to Rust too, which had never opted into anything, and
fabricated self-edges on a real `dtolnay/anyhow` clone before #1032 fixed
it reactively.

An earlier version of this issue proposed migrating matching *policy*
itself into per-language matcher objects, arguing this had decayed over
months. An adversarial critique found the timeline claim was wrong by a
factor of ~34 (the five escape hatches in question landed over eight days
during an intensive measurement campaign, not months of silent drift), and
that the migration's stated benefit — structural impossibility of
cross-language leakage — was not delivered by the option chosen: the
shared matching primitives (`matchesAtBoundaryPrecise` et al.) would stay
shared either way, and several of the cited incidents lived *inside* those
primitives, not at the per-language dispatch layer. That proposal was
rejected; this ADR records the revised decision instead. The critique and
the concession are preserved verbatim in #1038's comment history.

## Decision Drivers

- New languages must not silently inherit permissive defaults nobody
  examined.
- The fix must not require restructuring the hottest matching function in
  the repo for a behaviourally-neutral migration.
- Every declared value must be verifiable against real code, not asserted
  from theory.
- Runtime behaviour must not change as a side effect of closing the gap —
  a wrong declared value is a regression, not a refactor.

## Considered Options

1. **Status quo** — cheapest per individual incident, and the 8-day #883→
   #1032 record shows the reactive loop converging quickly. Rejected only
   because the 8 silent languages remain undiagnosed and language #12 would
   inherit the same defaults with nobody deciding so.
2. **Migrate matching policy into per-language matcher objects** (the
   original proposal) — rejected. Does not deliver structural leak-proofing
   (see Context); converges on today's architecture, restructured, for a
   byte-identical behavioural no-op.
3. **Make the matcher-path fields on `LanguageDefinition` required, keep
   the shared matching engine, add a cross-language policy table.**
   Selected.

## Decision Outcome

Chosen option: **3 — required fields, shared engine, no migration**,
because it delivers the one benefit that survives scrutiny (new languages
get opt-in semantics instead of inherited defaults) at day-scale effort
with zero behavioural change, while leaving `matchesFile`'s battle-tested
shared primitives untouched.

Scope is exactly the three fields that sit on `importMatchesTarget`'s
matcher path: `wholeModuleImports` (`registry.ts`'s
`hasWholeModuleImports`), `singleFileImports`
(`hasSingleFileImportSemantics`), and `namespaceStyleImports`
(`hasNamespaceMatchingSemantics`). `enclosingNamespaceAccess`,
`sameDirectoryTestConvention`, `samePackageTestConvention`, and
`sameUnitAccessWithoutImport` are a different mechanism (test-association
and `get_dependents` honesty-caveat policy, consulted outside
`path-matching.ts` entirely) and are out of scope — changing `?:` to `:`
for those is a separate decision this ADR does not make.

1. **Required fields.** `?: boolean` → `: boolean` for the three fields, so
   a 12th language definition omitting any of them is a compile error
   (`TS2739`), and all 11 existing languages had to state intent
   explicitly.
2. **Declare all 11 languages' real value for all three fields**, each
   verified against a real corpus (PR #1045's evidence table). Net result:
   exactly 3 of 33 cells are `true` (Swift/`wholeModuleImports`,
   Ruby/`singleFileImports`, PHP/`namespaceStyleImports` — all pre-existing
   and re-verified, not newly introduced); every other cell, including all
   21 for the 8 previously-silent languages, is an evidence-backed `false`
   matching the pre-existing effective default.
3. **Cross-language policy table** (`registry.test.ts`) asserting what's
   genuinely establishable as universal across languages: every language
   declares a real boolean (never `undefined`) for all three fields; at
   most one of the three flags is `true` per language (they are
   alternative, largely mutually-exclusive bare-specifier resolution
   strategies); and the three escape hatches stay sparse (at most one
   language sets each field `true` — a tripwire that forces a conscious
   decision before a third or fourth escape hatch accumulates unnoticed,
   rather than a hard architectural ceiling).
4. **Keep extraction-time form-tagging (`rust-mod-marker.ts`) as the
   established pattern** for per-import-form dispatch within a single
   language — it already works inside the current architecture and this
   ADR does not change it. Rust's `singleFileImports` stays `false`
   precisely because of this: `mod`-derived specifiers bypass these flags
   entirely via the marker, so the flag continues to govern only `use`/
   `self::`/`super::` specifiers, exactly as before #1021/#1024.

## Consequences

### Positive

- Opt-in rather than inherited semantics: a 13th language cannot be added
  without a compiler-enforced decision on all three fields.
- The 8 previously-silent languages were examined once, each against real
  code, closing a real diagnostic gap (#1028's root cause) without waiting
  for another reactive incident.
- Zero behavioural migration: PR #1045's full before/after per-file
  dependency-edge dump across all 11 real-project corpora is byte-identical
  in 10 of 11 (the eleventh's one file-pair diff was tracked to a
  pre-existing, code-independent non-determinism in re-export resolution,
  filed separately as #1044 — not caused by this change).
- One factual error surfaced and was corrected during verification: C# was
  believed (per #1038's own "current state" table) to already set
  `wholeModuleImports`. It did not — only the separate,
  out-of-scope `enclosingNamespaceAccess` — confirmed by a pre-existing
  passing test assertion and the field's own prior comment arguing against
  setting it.

### Negative / Risks

- The cross-language policy table's "sparse" assertion is a tripwire, not a
  proof of correctness: a future PR can still set a flag `true` for a wrong
  reason, it will just have to do so consciously (bump the count) rather
  than by accident.
- Two of the four previously-partial languages (PHP, Ruby) had their other
  two fields newly declared `false` on the basis of "no confirmed
  regression case today" rather than an exhaustive proof of every possible
  input shape — an honest, deliberately conservative call documented per
  language in PR #1045, not a claim of completeness.

### Neutral

- No published API change: `matchesFile` stays exported from
  `@liendev/parser` and re-exported by `@liendev/core`, unaffected by this
  ADR (the published-API question raised in #1038's discussion is a
  separate, still-open concern this ADR does not resolve).
- `LanguageDefinition`'s other optional fields
  (`enclosingNamespaceAccess`, `sameDirectoryTestConvention`,
  `samePackageTestConvention`, `sameUnitAccessWithoutImport`,
  `importExtractor`, `symbolExtractor`) are untouched.

## Validation

Per #1038's own validation criteria, all satisfied by PR #1045:

1. **Behaviour-preserving**: full before/after per-file dependency-edge
   dumps across all 11 corpora (requests, zod, express, monolog, anyhow,
   chi, javapoet, mediatr, sinatra, klaxon, swiftyjson), isolated by
   reverting only the touched files and rebuilding. 10/11 byte-identical;
   the zod exception is a pre-existing non-determinism unrelated to this
   change (#1044).
2. Every language's declared value that differs from a pre-existing value
   (there were none — see Consequences/Positive) would have been filed as
   a finding rather than silently shipped; none was needed.
3. The cross-language policy table (`registry.test.ts`) fails if a
   universal rule is violated, and passes today.
4. A temporary 12th language definition omitting all three fields produced
   a `TS2739` compile error citing all three missing properties; removed
   after capturing the proof.

## Alternatives Considered

See Considered Options above; the rejected per-language-matcher migration
and its critique are preserved verbatim in #1038's comment history rather
than summarized lossily here.

## References

- `packages/parser/src/utils/path-matching.ts`: `matchesFile`,
  `importMatchesTarget`, and the three per-language guards
- `packages/parser/src/ast/languages/types.ts`: `LanguageDefinition`'s
  three required fields, each with a per-language rationale in its own doc
  comment
- `packages/parser/src/ast/languages/registry.ts`: `hasWholeModuleImports`,
  `hasSingleFileImports`, `hasNamespaceStyleImports`
- `packages/parser/src/utils/rust-mod-marker.ts`: the established
  per-import-form tagging pattern this ADR keeps rather than migrates away
  from
- #1038: the original proposal, the adversarial critique that killed it,
  and the revised decision this ADR records
- #1044: the pre-existing zod re-export non-determinism found during this
  ADR's own verification, filed separately as out of scope
- PR #1045: the implementation, full per-language evidence table, and
  before/after corpus diffs
