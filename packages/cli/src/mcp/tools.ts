import { toMCPToolSchema } from './utils/zod-to-json-schema.js';
import {
  SearchCodeSchema,
  FindSimilarSchema,
  GetFilesContextSchema,
  ListFunctionsSchema,
  GetDependentsSchema,
  GetComplexitySchema,
} from './schemas/index.js';
import { ATTRIBUTION_CAVEAT_REASON_TEXT } from './attribution-caveat-reasons.js';

/**
 * MCP tool definitions with Zod-generated schemas.
 *
 * All schemas are automatically generated from Zod definitions,
 * providing type safety and rich validation at runtime.
 */
export const tools = [
  toMCPToolSchema(
    SearchCodeSchema,
    'search_code',
    `Full-text keyword search over the codebase (BM25 over code, docstrings, and camelCase-split identifiers). Complements grep - use this for discovery, grep for exact literal strings.

Examples:
- "Where is authentication handled?" → search_code({ query: "authenticate user session token" })
- "How does payment work?" → search_code({ query: "payment transaction charge refund" })

IMPORTANT: Query with concrete KEYWORDS, identifiers, and domain terms that actually appear in the code — NOT natural-language questions. There are no embeddings: a meaning-only paraphrase that shares no words with the code will not match. For an exact symbol name, use list_functions.

Ranking: results are ordered by BM25, then nudged by structural importance — files more other files depend on rank slightly higher among similarly-relevant matches — and nudged down slightly for test files (a fixed 20% demotion, never exclusion — a query naming a test file directly still finds it). Both nudges are capped/small and usually just break ties, but a very well-connected hub file can still outrank a marginally-better lexical match elsewhere. Each result's own score/relevance always describe its PURE lexical match quality (never recomputed from either nudge), so list order and an individual result's relevance label can legitimately disagree — trust the order for "what to look at first", trust relevance for "how good is this specific match". Set LIEN_STRUCTURAL_RANKING=off or LIEN_TEST_FILE_RANKING=off to disable either nudge independently and fall back toward pure BM25 order.

Returns:
- results[]: { content, score, relevance, metadata: { file, startLine, endLine, language?, symbolName?, symbolType?, signature?, enclosingSymbol?, dependentCount? } }
- dependentCount: how many other indexed files import this file, resolved with the same import-matching rules get_dependents uses. Still a FLOOR, not get_dependents' authoritative count: it is file-level only, and it does not follow re-export/barrel chains, so a barrel-fronted module can read lower than its real blast radius. Higher means riskier to change carelessly. A present 0 means "resolved, and no other indexed file imports this" — a real answer, though still a floor. ABSENT (the key missing entirely) means the count is not resolvable for this result, so read it as "unknown", NEVER as 0: it is dropped rather than reported as a misleading 0 when this file's language cannot name it in an import at all (C#'s global-using/namespace access, Java/Kotlin same-package visibility, Swift's whole-module \`import Foundation\` style), or when the whole index predates count tracking — that second case also carries an explicit note telling you to run \`lien index\`. Counts are precomputed per full index run, so a value can lag your uncommitted edits by up to one index run; for an authoritative, up-to-date answer call get_dependents, which also caveats its own gaps
- enclosingSymbol: "Class.method" for methods, "functionName" for standalone functions, absent for block chunks
- relevance: "highly_relevant" | "relevant" | "loosely_related" (not_relevant auto-filtered) — pure lexical match quality, independent of ranking order`,
  ),
  toMCPToolSchema(
    FindSimilarSchema,
    'find_similar',
    `Find code similar to a given snippet via lexical full-text (BM25) matching on the snippet's tokens. Use for:
- Ensuring consistency when adding new code
- Finding duplicate implementations
- Refactoring similar patterns together

Provide at least 24 characters of code to match against. Matching is keyword-based (identifiers, keywords), not semantic. Results include a relevance category for each match.

Optional filters:
- language: Filter by programming language (e.g., "typescript", "python")
- pathHint: Filter by file path substring (e.g., "src/api", "components")

Low-relevance results (not_relevant) are automatically pruned.

Returns:
- results[]: { content, score, relevance, metadata: { file, startLine, endLine, language?, symbolName?, signature?, enclosingSymbol? } }
- enclosingSymbol: "Class.method" for methods, "functionName" for standalone functions, absent for block chunks
- relevance: "highly_relevant" | "relevant" | "loosely_related" (not_relevant auto-filtered)
- filtersApplied?: { language?, pathHint?, prunedLowRelevance: number }
- hasMore: boolean — a LOWER BOUND, not a total (this tool doesn't paginate): true means more candidates likely exist beyond what's shown; false means the underlying search was exhausted. Never a fabricated count — raise limit (max 20) or narrow with language/pathHint to see more.`,
  ),
  toMCPToolSchema(
    GetFilesContextSchema,
    'get_files_context',
    `Get context for one or more files including dependencies and test coverage.

MANDATORY: Call this BEFORE editing any file. Accepts single path or array of paths.

Single file:
  get_files_context({ filepaths: "src/auth.ts" })
  
  Returns:
  {
    file: "src/auth.ts",
    chunks: [...],
    testAssociations: ["src/__tests__/auth.test.ts"]
  }

Multiple files (batch):
  get_files_context({ filepaths: ["src/auth.ts", "src/user.ts"] })
  
  Returns:
  {
    files: {
      "src/auth.ts": {
        chunks: [...],
        testAssociations: ["src/__tests__/auth.test.ts"]
      },
      "src/user.ts": {
        chunks: [...],
        testAssociations: ["src/__tests__/user.test.ts"]
      }
    }
  }

Returns for each file:
- All chunks and related code
- testAssociations: Array of test files that import this file (reverse dependency lookup)
- Relevance scoring

ALWAYS check testAssociations before modifying source code.
After changes, remind the user to run the associated tests.

If a filepath isn't in the index at all (typo, wrong directory prefix, wrong case), the response says so via \`note\` — empty chunks/testAssociations by themselves do NOT mean "no dependents, safe to edit"; they can also mean the path was never found. Check \`note\` for this before trusting an empty result.

May include complexityHeadroom: functions already at/near their complexity budget (cyclomatic/cognitive) — steer clear of adding to them. When present, complexityHeadroomWarning is a one-line imperative summary of the same data — read it first.

Batch calls are more efficient than multiple single-file calls.`,
  ),
  toMCPToolSchema(
    ListFunctionsSchema,
    'list_functions',
    `Fast symbol lookup by naming pattern. Use when searching by NAME, not behavior.

Examples:
- "Show all controllers" → list_functions({ pattern: ".*Controller.*" })
- "Find service classes" → list_functions({ pattern: ".*Service$" })
- "List all class methods" → list_functions({ symbolType: "method" })
- "Find standalone functions" → list_functions({ symbolType: "function" })

Filter by symbol type (function, method, class, interface) to narrow results.

10x faster than search_code for structural/architectural queries. Use search_code instead when searching by what code DOES.

\`pattern\` matching is CASE-INSENSITIVE — '^Job$' also matches a lowercase job method. Results are NOT relevance-ranked (declaration order), so a symbol you expect to see can be pushed past the current page by unrelated lowercase matches that simply appear earlier; page with \`offset\` or narrow \`pattern\`/\`symbolType\`/\`language\` if it doesn't appear.

Results are paginated (default: 50, max: 200). Use \`offset\` to page through large result sets.

Returns:
- results[]: { content, metadata: { file, startLine, endLine, language?, symbolName?, symbolType?, signature?, enclosingSymbol? } }
- enclosingSymbol: "Class.method" for methods, "functionName" for standalone functions, absent for block chunks
- method: "symbols" | "content" (query method used)
- hasMore: boolean — true means more results exist beyond this page (never a fabricated total; there is no "total matches" number in this response — only whether more exist and where to find them)
- nextOffset?: number — present whenever results is non-empty, REGARDLESS of hasMore (not only when hasMore=true). Always equals offset + results.length actually shown, even when the response was also trimmed for size. ALWAYS pass this value back verbatim rather than computing your own offset + limit — the response-size cap can shrink a page after the fact, and only this field is corrected for that.
- note?: when hasMore is true, points at nextOffset rather than repeating its value in prose (the same size trimming above can shrink nextOffset after the note text is already written) — trust the nextOffset field, not any number in note`,
  ),
  toMCPToolSchema(
    GetDependentsSchema,
    'get_dependents',
    `Find all code that depends on a file (reverse dependency lookup). Use for impact analysis:
- "What breaks if I change this?"
- "Is this safe to delete?"
- "What imports this module?"

Example: get_dependents({ filepath: "src/utils/validate.ts" })

Returns:
- dependentCount / productionDependentCount / testDependentCount
- riskLevel: "low" | "medium" | "high" | "critical" — a high/critical complexity
  signal among dependents always lifts this above "low", even when every dependent
  is fully tested (testedness lowers the chance of a *silent* break, it does not
  shrink the blast radius). Check riskReasoning for which signal(s) drove it.
- dependents[]: { filepath, isTestFile, usages[]?, confidence?: "inferred" }
  \`confidence: "inferred"\` marks a dependent recovered by text-matching a
  uniquely-declared type name (C#'s global-using gap, see
  dependent-attribution-partial below) rather than a real import edge — absent
  entirely on every ordinary, import-verified dependent.
- complexityMetrics: { averageComplexity, maxComplexity, highComplexityDependents[] }
- totalUsageCount?: number (when symbol parameter provided)
- attributionCaveat?: { reason, note } — present whenever dependentCount/riskLevel
  can't be trusted as a verified clear. ALWAYS check for this field before treating
  a low dependentCount (especially 0) as "safe to edit" or "unused". \`reason\` is
  one of:
  - "unresolved-target": ${ATTRIBUTION_CAVEAT_REASON_TEXT['unresolved-target']}
  - "symbol-attribution-degraded": ${ATTRIBUTION_CAVEAT_REASON_TEXT['symbol-attribution-degraded']}
  - "type-symbol-attribution-incomplete": ${ATTRIBUTION_CAVEAT_REASON_TEXT['type-symbol-attribution-incomplete']}
  - "dependent-attribution-partial": ${ATTRIBUTION_CAVEAT_REASON_TEXT['dependent-attribution-partial']}
  - "dependent-attribution-incomplete": ${ATTRIBUTION_CAVEAT_REASON_TEXT['dependent-attribution-incomplete']}
  At most one reason ever fires per response.`,
  ),
  toMCPToolSchema(
    GetComplexitySchema,
    'get_complexity',
    `Get complexity analysis for files or the entire codebase.

Analyzes multiple complexity metrics:
- **Test paths**: Number of test cases needed for full coverage (cyclomatic)
- **Mental load**: How hard to follow - penalizes nesting (cognitive)
- **Time to understand**: Estimated reading time based on Halstead effort
- **Estimated bugs**: Predicted bug count based on Halstead volume

Use for tech debt analysis and refactoring prioritization:
- "What are the most complex functions?"
- "Show me tech debt hotspots"
- "What should I refactor?"

Examples:
  get_complexity({ top: 10 })
  get_complexity({ files: ["src/auth.ts"], metricType: "cognitive" })
  get_complexity({ threshold: 15 })

Returns:
- summary: { filesAnalyzed, avgComplexity, maxComplexity, violationCount, bySeverity: { error, warning } }
- violations[]: { filepath, symbolName, symbolType, complexity, metricType, threshold, severity, complexityRiskLevel, dependentCount, testAssociations }
- complexityRiskLevel: "low" | "medium" | "high" | "critical" — the file's OWN complexity
  severity (this violation plus any others in the same file), boosted (never downgraded)
  by its dependent count/complexity. This is a DIFFERENT metric from \`get_dependents\`'/
  \`lien annotate\`'s \`riskLevel\` (blast-radius risk): that one weighs dependents' TEST
  COVERAGE and applies a complexity floor; this one has no test-coverage term at all.
  The two can and do disagree for the same file at the same moment — see
  docs/architecture/blast-radius-nudge.md's "Two risk concepts" section before assuming
  they should match.
- metricType: "cyclomatic" | "cognitive" | "halstead_effort" | "halstead_bugs"
- severity: "error" | "warning"
- note?: present and explicit when a requested \`files\` entry has no index entry at all — filesAnalyzed silently excludes it otherwise`,
  ),
];
