# ADR-013: Prebuilt Native Parser via napi-rs (`@liendev/parser-native`)

**Status**: Accepted
**Date**: 2026-07-08
**Deciders**: Core Team
**Related**: ADR-009 (extracted `@liendev/parser`, the package boundary this migration stays entirely inside), ADR-011 (established the spike-first, benchmark-verified-before-commit pattern this decision follows), [Native Parser Wire Format & Compat Contract](../native-parser.md) (the frozen engineering spec Phase 1 implements)

## Context and Problem Statement

`@liendev/parser` parses source with `node-tree-sitter` plus 11 npm grammar packages (`tree-sitter-typescript`, `-javascript`, `-python`, `-php`, `-ruby`, `-kotlin`, `-swift`, `-c-sharp`, `-go`, `-java`, `-rust`). This has three compounding problems:

- **Native compilation at install time.** `node-tree-sitter`'s binding is compiled via `node-gyp` on `npm install`. This breaks outright against stock Apple developer toolchains and is the entire reason [`docs/development/worktree-development.md`](../../development/worktree-development.md) exists: a fresh `npm install`/`npm ci` fails to compile in a linked git worktree, forcing contributors to symlink a main checkout's already-compiled `node_modules` instead of installing normally.
- **A landmine already sitting in the lockfile.** `package-lock.json` currently resolves **two different `tree-sitter` core versions**: the workspace root pins `0.21.1` while `packages/parser` pins `0.25.0`. Pairing a grammar built against one core with the other throws `initializeLanguageNodeClasses ... reading 'length'` at runtime; this has not yet caused a production incident only because npm's hoisting has kept the two trees separated by luck of resolution order, not by any structural guarantee.
- **`tree-sitter-kotlin` ships no prebuilt binaries on npm.** It works today only because a contributor's machine happens to have a locally-compiled binary left over from a previous install; the moment that cache is cleared, Kotlin parsing breaks with no clean recovery path.

A spike (2026-07-07, 4 Sonnet agents plus an adversarial verifier, every claim independently reproduced within 9%) investigated replacing this stack with a prebuilt Rust binary before any of this was scoped as real work. Its headline finding: parsing itself is not the expensive part. **Traversal dominates parse cost by 3.6-6.9x**: every `.namedChild()`, `.childForFieldName()`, and `.type` access under `node-tree-sitter` is a synchronous N-API call across the JS/native FFI boundary, and lien's traversers/extractors/complexity analyzers make many thousands of such calls per file. The spike's verdict was to build a napi-rs crate that returns one serialized tree per parse instead of a live native object graph, eliminating per-node FFI chatter entirely. This ADR records the Phase 0 feasibility audit that followed the spike (an 11-language crate-availability audit, a memory-safety measurement, and a frozen wire/compat shape) and the resulting build decision.

## Decision

Build **`@liendev/parser-native`**: a napi-rs Rust crate that statically links `tree-sitter` core 0.25.x plus all 11 grammar crates and exposes one export, `parseTree(lang, source)`, returning a single JSON-serialized tree via a hand-rolled manual string serializer (measured 8-15x faster than routing the same tree through `serde_json::Value`). The wire format carries no node text, only byte offsets, and the JS side slices text out of the original source lazily. A compat deserializer inside `@liendev/parser` reconstructs `Parser.SyntaxNode`-shaped plain objects from that JSON in one eager recursive pass, so every traverser, extractor, and complexity analyzer under `packages/parser/src/ast/**` runs **unmodified** against the reconstructed tree; only the adapter (`ast/parser.ts`) changes. The full wire shape, the compat contract, and the byte-offset→UTF-16 conversion this relies on are frozen in [`docs/architecture/native-parser.md`](../native-parser.md).

Distribution follows the esbuild pattern: prebuilt per-platform npm packages wired in via `optionalDependencies`, with **no runtime or build-time dependency on `@napi-rs/cli`**: a hand-rolled loader and build pipeline, per the spike's precedent, keeps the dependency tree in this package as small as the problem it replaces.

Rollout is staged behind an environment flag, `LIEN_PARSER=native|legacy`, which defaulted to `legacy` through Phase 3 and now defaults to `native` as of Phase 4-A:

1. **Audit** (Phase 0, this ADR): prove every grammar resolves against one core and the wire/compat shape can represent everything lien's AST layer needs.
2. **Foundation** (Phase 1): build the crate, the compat deserializer, and the CI prebuild matrix.
3. **Parity gate** (Phase 2): diff lien-level output (chunks, symbols, complexity scores) between the legacy and native backends across all 11 languages.
4. **Flagged swap** (Phase 3): ship `LIEN_PARSER=native` as an opt-in flag, default still `legacy`, CI running both modes.
5. **Flip** (Phase 4-A, executed 2026-07-09): flip the default to `native`; `legacy` remains installed and reachable as a transitional, explicit opt-out with an automatic fallback-with-warning if the native binding can't load. CI's second mode job and `e2e.yml`'s representative rerun invert to cover `legacy` instead of `native`.
6. **Retire** (Phase 4-B, executed 2026-07-09): deleted `legacy`, `node-tree-sitter`, and all 11 grammar npm packages from `@liendev/parser` (`resolveParserBackend()` now only accepts `native`/unset; `LIEN_PARSER=legacy` throws a specific "has been removed (see ADR-013)" error). Empirically confirmed a plain `npm ci` now succeeds in a linked git worktree with no symlink farm (`better-sqlite3` resolves a prebuilt binary; no native compile step remains): `docs/development/worktree-development.md` is rewritten to a short note plus a historical pointer, retiring the dual-core-lockfile and Kotlin-no-prebuilds landmines outright along with the workaround itself. CI's `test-legacy` job and `e2e.yml`'s legacy rerun for TypeScript/Kotlin are removed; every trigger now runs the full suite under native only.

A release/validation pass (changesets, the existing post-publish registry smoke test, and a fresh install on a stock Apple toolchain) follows the flip before general availability. Implementation work lands on `feat/parser-native` starting at Phase 1.

### Measured evidence

- **1.82-2.21x faster end-to-end** than `node-tree-sitter` across the benchmarked languages.
- The parse phase itself is **2.5-4x slower** due to the JSON round-trip, but **traversal is 66-147x faster**, and since traversal is the dominant cost (see Context), the net effect is a large win.
- **Parity**: 100% on TypeScript and Python fixtures, 96.7% on Kotlin. Every Kotlin divergence traced back to files that already had pre-existing parse errors under the legacy backend too, not a new correctness gap.
- A napi object-graph return (handing back live native objects instead of one JSON string) was measured at **2x slower** than the JSON-string round-trip: the FFI-call tax that motivated this whole migration reappears the moment individual fields cross the boundary one at a time instead of in one batch.
- Grammar crates compile as plain C11 via `cc`: the Apple-toolchain failure is a `node-gyp`-specific problem, not a `tree-sitter` one; `cargo build` has no equivalent failure mode on the same machine.

### Per-language crate pins (Phase 0 audit, 2026-07-08)

All 11 crates were independently resolved against `tree-sitter` core 0.25.x, compiled, and runtime-verified (`has_error()` asserted `true` on a deliberately broken snippet and `false` on a valid one) in isolated scratch Cargo projects. All 11 resolve to a single core, **v0.25.10**.

| Language | crates.io crate | Pinned version | Core constraint | Vendored? | Drift risk |
|---|---|---|---|---|---|
| TypeScript | `tree-sitter-typescript` | 0.23.2 | `tree-sitter-language ^0.1` (ABI shim; `tree-sitter ^0.24` dev-only, non-propagating) | No | LOW: exact npm-pin match; both `LANGUAGE_TYPESCRIPT` and `LANGUAGE_TSX` runtime-verified |
| JavaScript | `tree-sitter-javascript` | 0.23.1 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.24`) | No | LOW: exact npm-pin match |
| Python | `tree-sitter-python` | 0.25.0 | `tree-sitter "0.25"`: **direct normal dependency on core**, unlike the other 10 | No | LOW today (resolves 0.25.10); **the crate most sensitive to a future core major bump** |
| PHP | `tree-sitter-php` | 0.24.2 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.25`) | No | LOW: exact npm-pin match; both `LANGUAGE_PHP` and `LANGUAGE_PHP_ONLY` runtime-verified |
| Ruby | `tree-sitter-ruby` | 0.23.1 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.24`) | No | LOW: exact npm-pin match |
| Kotlin | `tree-sitter-kotlin` | 0.3.8 (vendored, patched) | Upstream declares `tree-sitter >=0.21,<0.23`, which conflicts with core 0.25 under Cargo's `links="tree-sitter"` singleton rule | **Yes**: the unmodified 0.3.8 tarball, with only the `tree-sitter` version line in its `Cargo.toml` widened to `>=0.21` | LOW: same upstream repo and version as the npm pin, runtime-verified against core 0.25.10; **the one genuine dependency-resolution conflict in the fleet, and it is handled** |
| Swift | `tree-sitter-swift` | 0.7.1 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.23`) | No | LOW: intentional parity pin; crates.io max is 0.7.3 |
| C# | `tree-sitter-c-sharp` | 0.23.1 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.24`) | No | LOW: exact npm-pin match |
| Go | `tree-sitter-go` | 0.23.4 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.24`) | No | LOW: exact npm-pin match |
| Java | `tree-sitter-java` | 0.23.5 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.24`) | No | LOW: exact npm-pin match |
| Rust | `tree-sitter-rust` | 0.24.0 | `tree-sitter-language ^0.1` (dev-only `tree-sitter ^0.24`/`^0.25`) | No | LOW: intentional parity pin; crates.io max is 0.24.2 |

10 of 11 crates depend only on the version-agnostic `tree-sitter-language` ABI shim, not on `tree-sitter` core directly, which is why they resolve cleanly regardless of which core version the workspace pins. Python is the outlier with a real semver constraint on core; Kotlin is the outlier that needed vendoring at all.

## Alternatives Considered

**(a) `@ast-grep/napi`**: rejected. It covers all 11 languages with zero compilation (a real advantage), but the spike verified it has **no `hasError`/`isMissing` equivalent**: lien's `parseAST()` relies on `tree.rootNode.hasError` to trigger a line-based chunking fallback on files with unrecoverable syntax errors, and `ast-grep` cannot detect MISSING-token recovery at all. That is a correctness dealbreaker, not a preference. It was also only 1.08-1.68x faster (well short of the 1.82-2.21x the custom crate delivers), would require rewriting roughly 200 `namedChild`-style call sites across `packages/parser/src`, and adds 265MB to `node_modules`. Its MIT license was evaluated and was **not** a factor in the rejection.

**(b) Keep `node-tree-sitter`, fix the toolchain instead**: rejected. The install-time compile failure traces to an upstream `node-gyp`/Apple-SDK incompatibility with no available fix on lien's side, and even a fixed toolchain would leave the per-node FFI traversal tax (the larger of the two costs) completely unaddressed.

**(c) A napi object-graph return instead of a JSON string**: rejected. Measured at 2x slower than the JSON round-trip (see Measured evidence); returning individual fields across the FFI boundary one call at a time reintroduces the exact per-node chatter this migration exists to eliminate.

**(d) WASM-first**: demoted to a fallback target, not the primary path. napi-rs supports a `wasm32` target if a future platform can't get a native prebuilt, but there was no evidence the native path fails to cover lien's supported platforms today.

## Consequences

### Positive

- 1.82-2.21x faster end-to-end, and the *reason* is structural (traversal moves from per-node FFI calls to native array/object access on a plain JS tree), not a one-time tuning win.
- No native compilation at install time, now that Phase 4-B has shipped: prebuilt per-platform packages fix the exact failure `docs/development/worktree-development.md` used to document, and retire the dual-tree-sitter-core lockfile hazard and the Kotlin-no-prebuilds gap outright, rather than working around either.
- Parity was proven empirically (100% TS/Python, 96.7% Kotlin with all divergences explained) *before* committing to the design, not assumed.
- `SyntaxNode`-typed values already never cross the `@liendev/parser` package boundary (verified by grep across `core`/`cli`/`review`/`action`); this migration changes an internal implementation detail, not any package's public API.

### Negative / Risks

Six non-blocking issues surfaced by adversarial verification, all of which must be tracked into later phases:

- **Parse-stage concurrency must be capped before general availability.** At the default `concurrency=4`, worst observed peak RSS is 630.9MB, safely under budget. But `core.concurrency`/`indexing.concurrency` accept up to 16 (validated range, `packages/core/src/config/service.ts`), and there is **no parse-stage file-size gate** (`LARGE_FILE_THRESHOLD` in `content-hash.ts` is change-detection fingerprinting only, not a parse-time guard). Combined with megabyte-scale source files, `concurrency=16` measured a peak RSS of 1,549.9MB, at or over the 1.5GB ceiling. Phase 3 lands the fix as `getParseStageConcurrency()` (`packages/parser/src/constants.ts`), a `min(configured, 4)` clamp applied at every `chunkFile`/`parseAST` call site (full-index, incremental/watcher, overlay, chunk-only review). **Caveat on current reachability:** today only the chunk-only review path (`packages/parser/src/chunk-only-index.ts`) genuinely threads a caller-supplied `concurrency` value through to that clamp end-to-end. The full-index (`packages/core/src/indexer/index.ts`) and incremental (`packages/core/src/indexer/incremental.ts`) pipelines call it with a hardcoded `DEFAULT_CONCURRENCY` (4): `indexing.concurrency`/`core.concurrency` are validated in `config/service.ts` but never read by either pipeline, so a user setting either to 16 has no effect yet and the >4 RSS scenario isn't reachable through those two paths today. The clamp is still correct to land now (forward-safe the moment that wiring is added, and already load-bearing for the review path), but wiring the validated config value through full-index/incremental, or explicitly documenting them as unconfigurable, is tracked as Phase 3/4 follow-up, not done here. **Resolved (2026-07-09):** rather than wiring the two keys through, they were removed entirely: nobody had configured them since they were silently unread, so there was nothing to migrate to a working state. `config/service.ts`'s range validation for both is deleted; an existing config that still carries either key now warns once and drops it instead of throwing. `getParseStageConcurrency()`'s cap remains the only concurrency lever for the parse stage, fed by `DEFAULT_CONCURRENCY` everywhere except the chunk-only review path.
- **`isMissing` is frozen but empirically unproven.** It has zero current call sites in lien (frozen anyway, since it's the exact capability `ast-grep` lacked) and the Phase 0 empirical test (`mb-test.cjs`) could not actually produce a MISSING node: the JS grammar it exercised recovers via ERROR nodes for that particular malformation instead. Phase 1/2 must add a fixture that genuinely triggers `is_missing` (e.g., an unclosed string or paren) to prove the field round-trips end to end.
- **`tree-sitter-python` is uniquely core-sensitive.** It is the only one of the 11 crates with a direct semver constraint on `tree-sitter` core (`"0.25"`) rather than the version-agnostic shim the other 10 use. It resolves fine today; it is the first crate that will need attention if core moves to 0.26.
- **Three crates are pinned below their latest available release, on purpose.** Swift (0.7.1 vs. crates.io max 0.7.3), JavaScript (0.23.1 vs. 0.25.0), and Rust (0.24.0 vs. 0.24.2) are pinned to match lien's current npm grammar version exactly, to keep Phase 2's parity gate a clean comparison. Upgrading past the npm-matching version is a decision for after parity is proven, not before.
- **The byte-offset→UTF-16 conversion assumes well-formed UTF-8.** Behavior on lone/unpaired surrogates versus `node-tree-sitter`'s current behavior is unverified, low priority, flagged for completeness rather than blocking (see [the design doc's open questions](../native-parser.md)).
- **Rust becomes a dev requirement for anyone touching `@liendev/parser-native`.** CI runners have the toolchain preinstalled; this only affects local contributor setup for parser-native work specifically, not the rest of the monorepo. Platform-package publishing must also be integrated with changesets: whether the per-platform packages join `@liendev/lien`'s existing linked changeset group is a decision deferred to Phase 1.

### Neutral

- Kotlin needs a vendored, patched crate (the only one of the 11), which is a permanent, if small, maintenance surface (one `Cargo.toml` line, diffable against the unmodified upstream tarball) rather than a one-time cost.
- No `@napi-rs/cli` dependency: the build and platform-package loader are hand-rolled, consistent with the project's dependency-minimalism, but that logic is now lien's own code to maintain rather than a library's.
- `LIEN_PARSER` defaulted to `legacy` through Phase 3: no user-visible behavior change until Phase 4-A flipped the default (2026-07-09). Phase 4-B (2026-07-09) then removed `node-tree-sitter` and the `legacy` backend entirely: `LIEN_PARSER=legacy` now throws a specific "removed" error instead of falling back, and a native binding that fails to load at all now fails fast with one actionable error rather than silently degrading to line-based chunking (a genuine per-file parse error is a separate, unaffected code path).

## References

- [`docs/architecture/native-parser.md`](../native-parser.md): the frozen wire format, compat-object contract, and language table Phase 1 implements
- ADR-009: extracted `@liendev/parser`; this decision stays entirely inside the boundary that extraction established
- ADR-011: the prior spike-first, benchmark-verified-before-commit pivot this decision follows the same discipline as
- [`docs/development/worktree-development.md`](../../development/worktree-development.md): documents the install-time compile failure this migration retires
- Spike (2026-07-07) and Phase 0 fleet audit (2026-07-08): 4-agent spike plus a 14-agent audit fleet (11 per-language crate audits, one memory measurement, one node-shape freeze), each independently adversarially re-verified. No dedicated spike branch exists for this decision the way ADR-011 has `spike/structural-store-benchmark`: the audits were crate/runtime checks in scratch Cargo projects, not code changes to lien itself, so there is no lien-side diff to point to; `feat/parser-native` is the implementation branch going forward.
