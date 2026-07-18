---
'@liendev/parser': minor
'@liendev/core': minor
'@liendev/lien': minor
---

feat(parser,core): YAML structural chunking for `search_code`

YAML files (`.yml`/`.yaml`) are now chunked by top-level mapping key instead
of the generic fixed-size line window, so `search_code` / `get_files_context`
can retrieve a coherent config section (e.g. a GitHub Actions `jobs.review`
block) rather than an arbitrary 75-line slice.

- **New chunk kind** (`packages/parser/src/yaml-chunker.ts`): YAML chunks are
  tagged `type: 'config'`, `language: 'yaml'`, with `metadata.symbolName`
  carrying a dotted key-path breadcrumb (e.g. `jobs.review.env`) built from an
  indentation ancestor stack, analogous to the markdown chunker's heading
  stack. Multi-document files (`---`/`...` separators) prefix breadcrumbs
  with `doc[N]`. Pure line heuristics — no real YAML parser is invoked — so
  the chunker never throws on malformed, partial, or templated (Helm/Jinja)
  input; a document with zero top-level keys degrades to a single
  whole-document chunk.
- **`type: 'config'` is excluded from symbol-lookup** (`core`'s
  `matchesSymbolFilter` and `review`'s `listFunctions`, mirroring the
  existing `'doc'` exclusion): key-path breadcrumbs aren't code symbols, so
  they never surface via `list_functions`/`querySymbols`, but remain fully
  searchable via `search_code` and retrievable via `get_files_context`.
- **CI workflow coverage**: the default include-pattern list now adds
  `.github/**/*.yml` and `.github/**/*.yaml` alongside the plain `**/*.yml`/
  `**/*.yaml` patterns. This is required, not cosmetic — glob's default
  `dot:false` means a bare `**/*.yml` never descends into a dot-directory
  like `.github/`, so without the explicit `.github/**` entries, CI workflow
  YAML (`.github/workflows/*.yml`) would silently never be indexed. Other
  dot-directory CI configs (`.circleci/`, a root `.gitlab-ci.yml`) remain
  out of scope for now.
- `pnpm-lock.yaml` is added to the always-ignored patterns (this repo uses
  npm and has none, but the exclusion is defensive for consumers who do).

Dogfooded against this repo's own index: previously-unindexable content in
`.github/workflows/*.yml` and `packages/action/action.yml` (e.g. harness
evidence-gate skip logic, review token-budget allocation) is now retrievable
via `search_code`, with `get_files_context` showing `type: 'config'` chunks
and `jobs`/`on`/`permissions`-style breadcrumbs.
