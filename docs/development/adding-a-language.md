# Adding AST Support for a New Language

Playbook validated three times: Ruby (0.46.0), Kotlin (0.47.0), Swift (0.48.0,
PR #606). Ships as **3 sequential PRs**: (1) AST support, (2) e2e + docs +
changeset, (3) the changeset bot's auto-opened "Version Packages" PR
(publishes to npm). Steps 2+3 can be one PR — the changeset triggers the full
e2e suite.

## Gate first — verify the grammar before writing any code

1. Add `tree-sitter-<lang>` to `packages/parser/package.json`.
2. Install it **from the main checkout** — a worktree can't compile native
   tree-sitter bindings; see [worktree-development.md](./worktree-development.md).
3. Load it against the repo's `tree-sitter@0.25.0` core and dump a real parse
   tree (`new Parser(); setLanguage(...); parse(sample); rootNode.toString()`).
   Pin exact node-type strings from this dump — don't hardcode from memory or
   another grammar's docs.

If the binding won't load or compile, stop and re-plan before touching the
language definition.

## PR 1 — the language definition

New `packages/parser/src/ast/languages/<lang>.ts`, modeled on the closest
analog (`java.ts` for JVM/typed/brace languages, `python.ts`/`ruby.ts` for
dynamic ones). Implements `LanguageDefinition` (`languages/types.ts`):
`Traverser`, `ExportExtractor`, `ImportExtractor`, `SymbolExtractor`, plus
`complexity` (decision-point/nesting/lambda/Halstead node lists) and
`symbols.callExpressionTypes`.

Wire it up:
- `packages/parser/src/ast/languages/registry.ts` — import + add to
  `definitions[]` and `LANGUAGE_IDS`
- `packages/parser/src/ast/languages/registry.test.ts` — bump the count,
  `toContain('<lang>')`
- `packages/parser/src/symbol-extractor.ts` — regex fallback (rarely hit once
  AST works, but add for parity)
- `packages/parser/README.md` — AST support table row
- New `<lang>.test.ts` modeled on `java.test.ts`/`rust.test.ts`: traverser,
  exports, imports, symbols + call sites, AST-chunking integration

**Usually already wired — check, don't assume:**
`packages/parser/src/scanner.ts` (extension → language map),
`packages/parser/src/ecosystem-presets.ts`,
`packages/parser/src/utils/path-matching.ts` (`isTestFile`),
`packages/review/src/prompt.ts` (display names),
`packages/parser/src/chunk-only-index.ts` (glob). `extractSignature` is
already body-node-bounded — no shared-helper change needed.

### Re-export / barrel file support

The dependency analyzer tracks transitive dependents through barrel/index
files by reading `imports`, `importedSymbols`, and `exports` from chunk
metadata. If the new language has a re-export pattern, the export extractor
must include re-exported symbols in `exports`. See `languages/javascript.ts`,
`languages/python.ts`, `languages/rust.ts` for the three shapes handled so
far.

## PR 2 — e2e + docs + changeset

Dogfood a real repo first: build the CLI in main, `lien index`, sanity-check
the output.

**Pick the e2e project by index time (≤60s), which scales with chunk count,
not file count** — dense languages produce far more chunks per file, so file
count alone misleads. `packages/cli/test/e2e/real-projects.test.ts` gives each
project a 180s timeout; a project that takes close to that risks a CI-timeout
flake. Prefer a small, dense-enough repo (~300+ chunks proves AST parsing) over
an iconic-but-heavy one. Past picks: Klaxon (Kotlin, 101 files) ~15s,
SwiftyJSON (Swift, 26 files / 356 chunks) ~11-21s — both safe; Alamofire
(113 files / 3455 chunks) was rejected as too close to the timeout.

Add the new project to:
- `packages/cli/test/e2e/real-projects.test.ts` `TEST_PROJECTS`
- `.github/workflows/e2e.yml` matrix (hardcoded — CI never runs the job
  without a matrix entry)
- `packages/cli/package.json` — new `test:e2e:<lang>` script
- `packages/cli/test/e2e/README.md`

Docs: move the language from the "plus lexical search" line into "Full AST
Support" in `packages/site/docs/how-it-works.md` and
`packages/site/docs/guide/index.md`.

Changeset: `minor` for `@liendev/parser` and `@liendev/lien`. `@liendev/core`
is in the same `linked` group in `.changeset/config.json` and versions
alongside them even though it has no code change — it resolves the new
parser via its `^` dependency range at runtime, which is fine.

Merging PR 2 makes the changeset bot open the "Version Packages" PR. Merging
**that** publishes to npm — irreversible, leave it for the maintainer.

## Gotchas

- **Worktree native build**: install the grammar from main; for build/test in
  a worktree, symlink `node_modules` from main per
  [worktree-development.md](./worktree-development.md) — the grammar's
  `tree-sitter` core binding must resolve to the same `0.25.0` the rest of
  the parser uses, or parsing silently breaks.
- **macOS local native compile**: Apple clang may fail on some grammars'
  build scripts. If `npm install <grammar>` fails to compile locally, retry
  with Homebrew's clang: `CC=/opt/homebrew/opt/llvm/bin/clang CXX=/opt/homebrew/opt/llvm/bin/clang++ npm install <grammar> --no-save`.
- **Lockfile dual-`tree-sitter` topology**: the grammar's peer dependency
  (often `tree-sitter ^0.21`/`^0.22`) conflicts with the repo's `0.25.0`.
  `npm install --package-lock-only --legacy-peer-deps` can collapse the dual
  0.21/0.25 topology and break other grammars. Run it on a scratch copy to
  let npm compute the new package's `resolved`/`integrity` entries, then
  splice only those new entries into the real lockfile by hand — don't let
  npm rewrite the whole tree. Validate with
  `npm ci --dry-run --ignore-scripts` before trusting it; CI's `npm ci` is
  the final word.
- **Grammar dragging in `tree-sitter-cli`**: some grammar packages (Swift's
  did) declare `tree-sitter-cli` as a hard runtime dependency, whose install
  script downloads a large platform binary unused at runtime (prebuilds load
  the parser directly). `overrides`/`patch-package` only shield this repo's
  own install, not downstream consumers' `npm install @liendev/lien`. Flag
  this at the grammar gate — it's a published-footprint tradeoff, not a
  blocker, but the maintainer should decide knowingly rather than discover it
  later.
- **No-field-name grammars**: some grammars (e.g. Kotlin's) expose no field
  names, so locate children by node `type`, not `childForFieldName`. Some
  wrap imports in a container node (Kotlin's `import_list`) that the import
  collector must descend into. Others share one node type across multiple
  constructs (Swift's `class_declaration` covers class/struct/actor/enum/
  extension) — read a discriminator field (Swift: `declaration_kind`) rather
  than assuming the node type maps 1:1 to a language construct.
- **Abstract/interface members can be a distinct node type** the extractors
  miss (Swift protocol method requirements are `protocol_function_declaration`,
  not `function_declaration`). They must be added to both the traverser's
  target node types and the symbol extractor, not just the export extractor —
  otherwise they're traversed but silently dropped from chunking.
- `SymbolInfo.type` (`packages/parser/src/ast/types.ts`) only supports
  `function | method | class | interface` — map `object`/`enum`/`struct` etc.
  to `class` and keep the real keyword in the signature string.
- Run e2e locally with `FORCE_COLOR=0` — the status-output regex some e2e
  tests assert on breaks under a shell that forces ANSI color codes. CI runs
  plain, so this only bites local repros.
