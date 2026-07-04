/**
 * Witty loading messages to keep users entertained during long operations.
 * Inspired by tools like npm, yarn, and other personality-driven CLIs.
 */

const INDEXING_MESSAGES = [
  'Reading your spaghetti code (no judgment)...',
  'Indexing your TODO comments (so many TODOs)...',
  'Building the code index faster than you can say "grep"...',
  'Making your codebase searchable (the good, the bad, and the ugly)...',
  'Chunking code like a boss...',
  'Parsing your midnight commits...',
  "Indexing... because Ctrl+F wasn't cutting it anymore...",
  'Mapping imports and dependents across the codebase...',
  'Processing files faster than your CI pipeline...',
  'Cataloguing every function and class (yes, even that one)...',
  'Building the full-text search index (now with 100% more BM25)...',
  'Splitting camelCase identifiers into searchable tokens...',
  'Tracing who-calls-what across your app...',
  'Analyzing complexity (that one function knows what it did)...',
  'Chunking files like a lumberjack, but for code...',
  'Indexing your genius (and that hacky workaround from 2019)...',
  "Making your codebase searchable (you're welcome, future you)...",
  'Cataloguing symbols and signatures...',
  'Measuring blast radius so refactors stop surprising you...',
  'Building the structural map of your project...',
];

const STARTUP_MESSAGES = [
  'Warming up the search index...',
  'Opening the structural store (no download, promise!)...',
  'Initializing lexical search...',
  'Getting things ready for your codebase...',
  'Spinning up the indexer...',
  'Preparing FTS5 for action...',
  'Booting up (coffee break not required — this is fast)...',
  'Loading local index (yes, it all runs locally)...',
];

let currentIndexingIndex = 0;
let currentModelIndex = 0;

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
 * Get the next witty message for the startup/initializing phase.
 * Messages are returned sequentially in a round-robin fashion.
 */
export function getModelLoadingMessage(): string {
  const message = STARTUP_MESSAGES[currentModelIndex % STARTUP_MESSAGES.length];
  currentModelIndex++;
  return message;
}

/**
 * Reset all message counters (useful for testing)
 */
export function resetMessageCounters(): void {
  currentIndexingIndex = 0;
  currentModelIndex = 0;
}
