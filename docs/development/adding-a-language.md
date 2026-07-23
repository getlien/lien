# Adding AST support for a new language

Playbook validated three times pre-ADR-013 (Ruby 0.46.0, Kotlin 0.47.0,
Swift 0.48.0, PR #606) against the `node-tree-sitter` backend. As of
ADR-013 Phase 4-B, parsing runs entirely through `@liendev/parser-native` (a
napi-rs Rust crate); there is no npm grammar package, no `node-gyp`, and no
lockfile to hand-splice. The AST-definition layer (`LanguageDefinition`,
traverser/extractor classes) is **unchanged**; only how the grammar itself
gets into the binary is different. Ships as **3 sequential PRs**: (1) grammar
crate + AST support, (2) e2e + docs + changeset, (3) the changeset bot's
auto-opened "Version Packages" PR (publishes to npm). Steps 2+3 can be one
PR: the changeset triggers the full e2e suite.

## Step 1: grammar crate audit (before writing any code)

Find the grammar on crates.io (`tree-sitter-<lang>`) and audit it the same
way ADR-013's Phase 0 fleet did for the current 11:

1. **Core-constraint check.** Does the crate depend on the version-agnostic
   `tree-sitter-language` ABI shim (10 of the current 11 do), or does it
   pin `tree-sitter` core directly (Python is the one outlier)? Either way,
   confirm it resolves against this repo's core version
   (`packages/parser-native/Cargo.toml`'s `tree-sitter = "0.25"`) in a
   scratch Cargo project (`cargo new /tmp/scratch && cd /tmp/scratch &&
   cargo add tree-sitter-<lang>`). If Cargo reports a conflict, see "Links
   conflict" below before assuming the crate is unusable.
2. **Exact-version parity pin.** Pin the crate to an **exact** version
   (`tree-sitter-<lang> = "=X.Y.Z"`, not a caret range) in
   `packages/parser-native/Cargo.toml`, matching whatever grammar version
   the AST-definition layer is being written/tested against. Loosening past
   that pin is a deliberate later decision (see the ADR's per-language table
   for the current fleet's rationale), not a default.
3. **Runtime-verify `has_error`, not just that it compiles.** Cargo resolving
   the crate proves nothing about correctness: write a throwaway Rust test
   in the scratch project that parses one valid and one deliberately broken
   snippet and asserts `tree.root_node().has_error()` is `false` then `true`.
   `parseAST()`'s line-based-chunking fallback depends on this signal
   round-tripping correctly; a grammar that can't distinguish valid from
   broken source is a dealbreaker (this is exactly why `@ast-grep/napi` was
   rejected in ADR-013's Alternatives Considered).
4. **Links conflict: vendor, don't skip.** If the crate declares an
   incompatible `tree-sitter` version bound (e.g. `>= 0.21, < 0.23`),
   Cargo's `links = "tree-sitter"` singleton rule means it cannot coexist
   with the other grammars' 0.25.x requirement as a plain crates.io
   dependency. This is not automatically a rejection: `tree-sitter-kotlin`
   hit exactly this and was vendored. Download the crate tarball, patch
   **only** the `tree-sitter` version line in its `Cargo.toml` to widen the
   bound, and runtime-verify (step 3) that the compiled grammar still works
   against the newer core (the ABI is a runtime-checked integer, not a
   compile-time struct layout, so this is safe in practice). Follow
   `packages/parser-native/scripts/fetch-vendor.mjs`'s pattern exactly: pin
   the source tarball's sha256, fail loudly on a mismatch, and don't commit
   the vendored tree to git (it's re-derived deterministically on
   `build:native`).

If the crate won't compile, won't resolve against 0.25.x even after
vendoring, or fails the `has_error` proof, stop and re-plan before touching
the language definition.

## Step 2: Cargo.toml + lib.rs registration

In `packages/parser-native/`:

- `Cargo.toml`: add the pinned dependency (`dependencies` section, or a
  vendored `path =` entry per step 1.4).
- `src/lib.rs`: add the language id to `SUPPORTED_LANGUAGES` and a match arm
  in `language_for()` mapping it to the crate's language export (most
  crates expose a single `LANGUAGE` const; check the crate's docs for the
  exact export name: it varies, e.g. `LANGUAGE_TYPESCRIPT` vs `LANGUAGE_PHP`
  vs a plain `LANGUAGE`).
- **The language id must match `LANGUAGE_IDS` in
  `packages/parser/src/ast/languages/registry.ts` exactly.** This is the
  single string that flows from the TS `LanguageDefinition` through
  `parseAST()`'s `parseTree(lang, source)` call into Rust's `language_for()`
  match. A mismatch fails at the Rust boundary with an "unsupported
  language" error, not a TypeScript compile error.
- Run `npm run build:native -w @liendev/parser-native` to compile
  (`cargo build --release`) and copy the resulting binary to
  `./parser-native.node`.

## Step 3: the TS language definition (unchanged from pre-4-B)

New `packages/parser/src/ast/languages/<lang>.ts`, modeled on the closest
analog (`java.ts` for JVM/typed/brace languages, `python.ts`/`ruby.ts` for
dynamic ones). Implements `LanguageDefinition` (`languages/types.ts`):
`Traverser`, `ExportExtractor`, `ImportExtractor`, `SymbolExtractor`, plus
`complexity` (decision-point/nesting/lambda/Halstead node lists) and
`symbols.callExpressionTypes`. There is no `grammar` field to wire up
anymore: the Rust side owns the actual grammar, and the TS side only ever
sees `SyntaxNode`/`Tree` reconstructed from the wire format.

Wire it up:
- `packages/parser/src/ast/languages/registry.ts`: import + add to
  `definitions[]` and `LANGUAGE_IDS` (same string as step 2's Rust id)
- `packages/parser/src/ast/languages/registry.test.ts`: bump the count,
  `toContain('<lang>')`
- `packages/parser/src/symbol-extractor.ts`: regex fallback (rarely hit once
  AST works, but add for parity)
- `packages/parser/README.md`: AST support table row
- New `<lang>.test.ts` modeled on `java.test.ts`/`rust.test.ts`: traverser,
  exports, imports, symbols + call sites, AST-chunking integration

**Usually already wired (check, don't assume):**
`packages/parser/src/scanner.ts` (extension → language map),
`packages/parser/src/ecosystem-presets.ts`,
`packages/parser/src/utils/path-matching.ts` (`isTestFile`),
`packages/review/src/prompt.ts` (display names),
`packages/parser/src/chunk-only-index.ts` (glob). `extractSignature` is
already body-node-bounded, so no shared-helper change is needed.

### Re-export / barrel file support

The dependency analyzer tracks transitive dependents through barrel/index
files by reading `imports`, `importedSymbols`, and `exports` from chunk
metadata. If the new language has a re-export pattern, the export extractor
must include re-exported symbols in `exports`. See `languages/javascript.ts`,
`languages/python.ts`, `languages/rust.ts` for the three shapes handled so
far.

## Step 4: tests

Three layers, all exercising the native path: there is no legacy backend
left to test against.

1. **`parser-native` wire test.** Add a case to `LANGUAGE_CASES` in
   `packages/parser-native/test/parse.test.ts`: the language id (matching
   step 2), the expected root node type, one valid snippet, and one
   deliberately broken snippet. This is the automated form of step 1.3's
   `has_error` proof: it must pass before moving on.
2. **`<lang>.test.ts` via the native path.** Language test files build trees
   via `mustParse(code, language)` (`packages/parser/src/ast/test/helpers/parse-fixture.ts`),
   which calls the package's own public `parseAST()`, the same code path
   production uses, not a hand-rolled `Parser`/grammar construction. Model
   the new file on an existing one (`java.test.ts`, `rust.test.ts`).
3. **e2e project wiring**: see step 5 below.

## Step 5: e2e + docs + changeset

Dogfood a real repo first: build the CLI in main, `lien index`, sanity-check
the output.

**Pick the e2e project by index time (≤60s), which scales with chunk count,
not file count.** Dense languages produce far more chunks per file, so file
count alone misleads. `packages/cli/test/e2e/real-projects.test.ts` gives each
project a 180s timeout; a project that takes close to that risks a CI-timeout
flake. Prefer a small, dense-enough repo (~300+ chunks proves AST parsing) over
an iconic-but-heavy one. Past picks: Klaxon (Kotlin, 101 files) ~15s,
SwiftyJSON (Swift, 26 files / 356 chunks) ~11-21s, both safe. Alamofire
(113 files / 3455 chunks) was rejected as too close to the timeout.

Add the new project to:
- `packages/cli/test/e2e/real-projects.test.ts` `TEST_PROJECTS`
- `.github/workflows/e2e.yml` matrix: via `.github/scripts/plan-e2e-matrix.mjs`'s
  `PROJECTS` list (hardcoded; CI never runs the job without an entry there)
- `packages/cli/package.json`: new `test:e2e:<lang>` script
- `packages/cli/test/e2e/README.md`

Docs: move the language from the "plus lexical search" line into "Full AST
Support" under "## Supported Languages" in `packages/site/docs/how-it-works.md`.
That's the only place the site's language list lives now: `packages/site/docs/guide/index.md`
just links to it (`/how-it-works#supported-languages`) and needs no edit.

Changeset: `minor` for `@liendev/parser`, `@liendev/parser-native`, and
`@liendev/lien`. `@liendev/core` is in the same `linked` group in
`.changeset/config.json` and versions alongside them even though it has no
code change: it resolves the new parser via its `^` dependency range at
runtime, which is fine.

Merging this PR makes the changeset bot open the "Version Packages" PR.
Merging **that** publishes to npm. That step is irreversible, so leave it
for the maintainer.

## Prebuild matrix implications: none

`packages/parser-native/scripts/platforms.json` (the manifest CI's
per-platform prebuild matrix, `build-native.yml`, computed by
`plan-native-build-matrix.mjs`, reads) is keyed by **OS/arch platform
target** (e.g. `linux-x64-gnu`, `darwin-arm64`), not by language. Every
grammar is statically linked into the single `parser-native.node` cdylib
per platform, so adding a language never touches this file or adds a new
prebuild job. It only changes what that one binary can parse.

## Gotchas (Rust flow, replaces the pre-4-B npm-grammar gotchas)

- **Links conflict**: see step 1.4. This is the Rust-side equivalent of the
  old "lockfile dual-`tree-sitter` topology" problem, and it's handled the
  same way in spirit (isolate and pin exactly) but mechanically different
  (vendor-and-patch via a checked-in script, not a hand-spliced
  `package-lock.json`).
- **ABI runtime check, not a compile-time guarantee**: a grammar crate that
  resolves and compiles against core 0.25.x is not automatically correct:
  always run the `has_error` proof (step 1.3) before trusting it. The
  Kotlin precedent shows a grammar can compile clean against a widened
  version bound and still need empirical confirmation it behaves correctly.
- **Language id string must match in three places**: Rust's
  `SUPPORTED_LANGUAGES`/`language_for()` (step 2), TS's `LANGUAGE_IDS`
  (step 3), and the wire test's `LANGUAGE_CASES` (step 4.1). These are
  plain string literals, not a shared enum, so a typo in any one is a
  runtime "unsupported language" error, not a compile error. Grep for the
  new id across all three after adding it.
- **No-field-name grammars**: some grammars (e.g. Kotlin's) expose no field
  names, so locate children by node `type`, not `childForFieldName`. Some
  wrap imports in a container node (Kotlin's `import_list`) that the import
  collector must descend into. Others share one node type across multiple
  constructs (Swift's `class_declaration` covers class/struct/actor/enum/
  extension); read a discriminator field (Swift: `declaration_kind`) rather
  than assuming the node type maps 1:1 to a language construct.
- **Abstract/interface members can be a distinct node type** the extractors
  miss (Swift protocol method requirements are `protocol_function_declaration`,
  not `function_declaration`). They must be added to both the traverser's
  target node types and the symbol extractor, not just the export extractor,
  otherwise they're traversed but silently dropped from chunking.
- **Field-doubling on shared hidden rules** (Swift-specific so far): a
  grammar can nest `field()` calls around a shared hidden rule so one child
  carries two field names at once (e.g. both `return_type` and `name`). The
  compat layer's `field2` wire key exists for exactly this. See
  `docs/architecture/native-parser.md` §1.1 if a new grammar exhibits the
  same pattern.
- `SymbolInfo.type` (`packages/parser/src/ast/types.ts`) only supports
  `function | method | class | interface`. Map `object`/`enum`/`struct` etc.
  to `class` and keep the real keyword in the signature string.
- Run e2e locally with `FORCE_COLOR=0`: the status-output regex some e2e
  tests assert on breaks under a shell that forces ANSI color codes. CI runs
  plain, so this only bites local repros.
- **Rust toolchain required locally** for `packages/parser-native` work
  specifically (CI runners have it preinstalled); see that package's
  README. This does not affect the rest of the monorepo; a worktree's plain
  `npm ci`/`npm run build` works without touching Rust at all unless you're
  editing the crate itself.
