/**
 * Witty loading messages to keep users entertained during long operations.
 * Inspired by tools like npm, yarn, and other personality-driven CLIs.
 */

const INDEXING_MESSAGES = [
  'Teaching AI to read your spaghetti code...',
  'Indexing your TODO comments (so many TODOs)...',
  'Making your codebase searchable (the good, the bad, and the ugly)...',
  'Chunking code like a boss...',
  "Indexing... because Ctrl+F wasn't cutting it anymore...",
  'Processing files faster than your CI pipeline...',
  'Parsing syntax trees (every branch, no leaf unturned)...',
  'Mapping your dependency graph (it goes deeper than you think)...',
  'Counting cyclomatic complexity (someone has to)...',
  'Splitting camelCase identifiers into searchable pieces...',
  'Building the full-text index (BM25, zero GPUs harmed)...',
  'Tracing call sites across the spacetime continuum...',
  'Indexing your genius (and that hacky workaround from 2019)...',
  'Chunking files like a lumberjack, but for code...',
  'Finding out which functions nobody dares to touch...',
  'Indexing symbols (yes, even that one function)...',
];

let currentIndexingIndex = 0;

/**
 * Get the next witty message for the indexing process.
 * Messages are returned sequentially in a round-robin fashion.
 */
export function getIndexingMessage(): string {
  const message = INDEXING_MESSAGES[currentIndexingIndex % INDEXING_MESSAGES.length];
  currentIndexingIndex++;
  return message;
}

/**
 * Reset all message counters (useful for testing)
 */
export function resetMessageCounters(): void {
  currentIndexingIndex = 0;
}
