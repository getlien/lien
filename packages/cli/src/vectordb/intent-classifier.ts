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
 * Classifies a search query into one of three intent categories.
 * 
 * Uses pattern matching to detect query intent:
 * - LOCATION: Queries about finding/locating code
 * - CONCEPTUAL: Queries about understanding processes/concepts
 * - IMPLEMENTATION: Queries about code implementation details
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
  
  // LOCATION queries - user wants to find specific files
  // Patterns: "where is/are", "find the", "locate"
  if (
    lower.match(/where\s+(is|are|does|can\s+i\s+find)/) ||
    lower.match(/find\s+the\s+/) ||
    lower.match(/locate\s+/)
  ) {
    return QueryIntent.LOCATION;
  }
  
  // CONCEPTUAL queries - user wants to understand how things work
  // Patterns: "how does X work", "what is/are", "explain", "understand", etc.
  if (
    lower.match(/how\s+does\s+.*\s+work/) ||
    lower.match(/what\s+(is|are|does)/) ||
    lower.match(/explain\s+/) ||
    lower.match(/understand\s+/) ||
    lower.match(/\b(process|workflow|architecture)\b/)
  ) {
    return QueryIntent.CONCEPTUAL;
  }
  
  // IMPLEMENTATION queries - user wants code implementation details
  // Patterns: "how is/are X implemented/built/coded", "implementation of", "source code for"
  if (
    lower.match(/how\s+(is|are)\s+.*\s+(implemented|built|coded)/) ||
    lower.match(/implementation\s+of/) ||
    lower.match(/source\s+code\s+for/)
  ) {
    return QueryIntent.IMPLEMENTATION;
  }
  
  // Default to IMPLEMENTATION for ambiguous queries
  // This is the most common use case for code search
  return QueryIntent.IMPLEMENTATION;
}

