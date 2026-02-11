/**
 * Query Intent Classification
 *
 * Classifies user search queries into three categories to apply
 * appropriate relevance boosting strategies:
 *
 * - LOCATION: "Where is X?" - User wants to find specific files/code
 * - CONCEPTUAL: "How does X work?" - User wants to understand concepts
 * - IMPLEMENTATION: "How is X implemented?" - User wants implementation details
 *
 * Examples:
 * - "where is the auth handler" → LOCATION
 * - "how does authentication work" → CONCEPTUAL
 * - "how is authentication implemented" → IMPLEMENTATION
 */

/**
 * Query intent types for semantic search
 */
export enum QueryIntent {
  /** User wants to locate specific files or code (e.g., "where is X") */
  LOCATION = 'location',

  /** User wants to understand concepts/processes (e.g., "how does X work") */
  CONCEPTUAL = 'conceptual',

  /** User wants implementation details (e.g., "how is X implemented") */
  IMPLEMENTATION = 'implementation',
}

/**
 * Intent classification rule with patterns and priority
 */
export interface IntentRule {
  intent: QueryIntent;
  patterns: RegExp[];
  priority: number;
}

/**
 * Intent classification rules.
 * Rules are checked in priority order (higher priority first).
 */
const INTENT_RULES: IntentRule[] = [
  // LOCATION intent (highest priority - most specific)
  {
    intent: QueryIntent.LOCATION,
    priority: 3,
    patterns: [/where\s+(is|are|does|can\s+i\s+find)/, /find\s+the\s+/, /locate\s+/],
  },

  // CONCEPTUAL intent (medium priority)
  {
    intent: QueryIntent.CONCEPTUAL,
    priority: 2,
    patterns: [
      /how\s+does\s+.*\s+work/,
      /what\s+(is|are|does)/,
      /explain\s+/,
      /understand\s+/,
      /\b(process|workflow|architecture)\b/,
    ],
  },

  // IMPLEMENTATION intent (low priority - catches "how is X implemented")
  {
    intent: QueryIntent.IMPLEMENTATION,
    priority: 1,
    patterns: [
      /how\s+(is|are)\s+.*\s+(implemented|built|coded)/,
      /implementation\s+of/,
      /source\s+code\s+for/,
    ],
  },
];

/**
 * Capture the initial number of built-in rules.
 * This is used by resetIntentRules() to distinguish built-in rules from custom rules.
 */
const INITIAL_RULE_COUNT = INTENT_RULES.length;

/**
 * Cached sorted rules to avoid re-sorting on every query.
 * Invalidated when rules are modified via addIntentRule() or resetIntentRules().
 */
let cachedSortedRules: IntentRule[] | null = null;

/**
 * Get sorted rules (cached).
 * Lazy-computes and caches the sorted array on first access.
 */
function getSortedRules(): IntentRule[] {
  if (cachedSortedRules === null) {
    cachedSortedRules = [...INTENT_RULES].sort((a, b) => b.priority - a.priority);
  }
  return cachedSortedRules;
}

/**
 * Invalidate the sorted rules cache.
 * Called when rules are modified.
 */
function invalidateSortedRulesCache(): void {
  cachedSortedRules = null;
}

/**
 * Classifies a search query into one of three intent categories.
 *
 * Uses data-driven pattern matching to detect query intent.
 * Rules are checked in priority order, with the first match winning.
 *
 * @param query - The search query string
 * @returns The detected query intent (defaults to IMPLEMENTATION)
 *
 * @example
 * classifyQueryIntent("where is the user controller") // → LOCATION
 * classifyQueryIntent("how does authentication work") // → CONCEPTUAL
 * classifyQueryIntent("how is the API implemented") // → IMPLEMENTATION
 */
export function classifyQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase().trim();

  // Use cached sorted rules to avoid re-sorting on every query
  const sortedRules = getSortedRules();

  for (const rule of sortedRules) {
    if (rule.patterns.some(pattern => pattern.test(lower))) {
      return rule.intent;
    }
  }

  // Default to IMPLEMENTATION for ambiguous queries
  // This is the most common use case for code search
  return QueryIntent.IMPLEMENTATION;
}

/**
 * Add a custom intent rule (useful for testing or extensions).
 *
 * Returns a cleanup function that removes the added rule.
 * This prevents test pollution and allows proper cleanup.
 *
 * @param rule - The intent rule to add
 * @returns A cleanup function that removes the added rule
 *
 * @example
 * const cleanup = addIntentRule({
 *   intent: QueryIntent.LOCATION,
 *   priority: 4,
 *   patterns: [/custom pattern/]
 * });
 * // ... use the rule ...
 * cleanup(); // removes the rule
 */
export function addIntentRule(rule: IntentRule): () => void {
  INTENT_RULES.push(rule);

  // Invalidate cache since rules have changed
  invalidateSortedRulesCache();

  // Return cleanup function to remove the rule
  return () => {
    const idx = INTENT_RULES.indexOf(rule);
    if (idx !== -1) {
      INTENT_RULES.splice(idx, 1);
      // Invalidate cache since rules have changed
      invalidateSortedRulesCache();
    }
  };
}

/**
 * Get all patterns for a specific intent (useful for debugging).
 *
 * @param intent - The intent to get patterns for
 * @returns Array of regex patterns for the intent
 *
 * @example
 * const locationPatterns = getPatternsForIntent(QueryIntent.LOCATION);
 */
export function getPatternsForIntent(intent: QueryIntent): RegExp[] {
  return INTENT_RULES.filter(rule => rule.intent === intent).flatMap(rule => rule.patterns);
}

/**
 * Get all intent rules (useful for testing/debugging).
 *
 * @returns A copy of the current intent rules
 */
export function getIntentRules(): IntentRule[] {
  return [...INTENT_RULES];
}

/**
 * Reset intent rules to initial state.
 *
 * WARNING: This function is intended for testing only.
 * It removes all custom rules added via addIntentRule().
 * The original built-in rules are preserved.
 *
 * @example
 * // In test cleanup
 * afterEach(() => {
 *   resetIntentRules();
 * });
 */
export function resetIntentRules(): void {
  // Remove all custom rules, preserving only the original built-in rules
  INTENT_RULES.splice(INITIAL_RULE_COUNT);

  // Invalidate cache since rules have changed
  invalidateSortedRulesCache();
}
