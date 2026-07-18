/**
 * Constants used by the parser/chunking layer.
 * These will move to @liendev/parser during extraction.
 */

// Chunking settings
export const DEFAULT_CHUNK_SIZE = 75;
export const DEFAULT_CHUNK_OVERLAP = 10;

/**
 * Default glob include patterns for a full-repo index scan: source languages,
 * prose docs, and YAML config. Shared by `@liendev/core`'s `scanFilesToIndex`
 * (real CLI/MCP indexing path) and `@liendev/parser`'s `chunk-only-index.ts`
 * (review's repoChunks path) so the two stay byte-identical.
 *
 * The scanner globs with glob's default `dot:false`, so a bare `**\/*.yml`
 * never descends into a dot-directory like `.github/`. The explicit
 * `.github/**` entries below are required for CI workflow YAML (e.g.
 * `.github/workflows/*.yml`) to be indexed at all -- a literal path segment
 * (unlike a `**` wildcard) matches under `dot:false`. Other dot-dir CI
 * configs (`.circleci/`, root `.gitlab-ci.yml`) are a known, YAGNI'd gap.
 */
export const DEFAULT_INDEX_INCLUDE_PATTERNS = [
  '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,php,go,rs,java,kt,swift,rb,cs,liquid,scala,c,cpp,cc,cxx,h,hpp}',
  '**/*.md',
  '**/*.mdx',
  '**/*.markdown',
  '**/*.yml',
  '**/*.yaml',
  '.github/**/*.yml',
  '.github/**/*.yaml',
];

// File query estimation
// Maximum chunks expected per file when sizing scan queries.
export const MAX_CHUNKS_PER_FILE = 100;

// Parse-stage concurrency ceiling
//
// Hard cap on concurrent CPU-bound parse/chunk operations, independent of
// whatever concurrency the caller has configured for I/O-bound work (stat/hash
// walks, which can safely run much wider). This exists because of the native
// parser backend's memory profile (see ADR-013,
// docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md): each
// parse holds a transient JSON-serialized tree up to ~38x source size in
// memory until the chunking pass finishes with it. The Phase 0 measurement in
// that ADR found concurrency=4 peaks at a safe ~630MB worst-case RSS, while
// concurrency=16 peaked at ~1.55GB on megabyte-scale files. Parsing is
// synchronous on the JS thread regardless of concurrency, so capping this
// stage costs negligible wall-clock time — it only bounds how many source
// buffers + parsed trees are alive at once.
//
// Note: this used to be reachable above 4 via a per-project
// `indexing.concurrency`/`core.concurrency` config knob, but that knob was
// validated (range 1-16) and never actually read by any indexing pipeline —
// every real call site was hardcoded to DEFAULT_CONCURRENCY (4) regardless of
// what a user configured. Rather than wire it through, the dead keys were
// removed entirely (see ADR-013's Consequences for the resolution); this
// ceiling is now the only concurrency lever for the parse stage.
export const PARSE_STAGE_MAX_CONCURRENCY = 4;

/**
 * Effective concurrency for the parse/chunk stage: never exceeds
 * {@link PARSE_STAGE_MAX_CONCURRENCY}, regardless of the caller's configured
 * concurrency. Use this only for the stage that calls `chunkFile`/`parseAST`;
 * I/O-bound stages (file stat/hash walks) should keep using the configured
 * value directly.
 */
export function getParseStageConcurrency(configuredConcurrency: number): number {
  return Math.min(configuredConcurrency, PARSE_STAGE_MAX_CONCURRENCY);
}
