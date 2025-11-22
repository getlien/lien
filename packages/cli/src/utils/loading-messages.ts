/**
 * Witty loading messages to keep users entertained during long operations.
 * Inspired by tools like npm, yarn, and other personality-driven CLIs.
 */

const INDEXING_MESSAGES = [
  'Teaching AI to read your spaghetti code...',
  'Convincing the LLM that your variable names make sense...',
  'Indexing your TODO comments (so many TODOs)...',
  'Building semantic links faster than you can say "grep"...',
  'Making your codebase searchable (the good, the bad, and the ugly)...',
  'Chunking code like a boss...',
  "Feeding your code to the neural network (it's hungry)...",
  "Creating embeddings (it's like compression, but fancier)...",
  'Teaching machines to understand your midnight commits...',
  'Vectorizing your technical debt...',
  "Indexing... because Ctrl+F wasn't cutting it anymore...",
  'Making semantic connections (unlike your last refactor)...',
  'Processing files faster than your CI pipeline...',
  'Embedding wisdom from your comments (all 3 of them)...',
  'Analyzing code semantics (yes, even that one function)...',
  'Building search index (now with 100% more AI)...',
  "Crunching vectors like it's nobody's business...",
  'Linking code fragments across the spacetime continuum...',
  'Teaching transformers about your coding style...',
  'Preparing for semantic search domination...',
  'Indexing your genius (and that hacky workaround from 2019)...',
  "Making your codebase AI-readable (you're welcome, future you)...",
  'Converting code to math (engineers love this trick)...',
  "Building the neural net's mental model of your app...",
  'Chunking files like a lumberjack, but for code...',
];

const EMBEDDING_MESSAGES = [
  'Generating embeddings (math is happening)...',
  'Teaching transformers about your forEach loops...',
  'Converting code to 384-dimensional space (wild, right?)...',
  'Running the neural network (the Matrix, but for code)...',
  'Creating semantic vectors (fancy word for AI magic)...',
  'Embedding your code into hyperspace...',
  'Teaching the model what "clean code" means in your codebase...',
  'Generating vectors faster than you can say "AI"...',
  'Making math from your methods...',
  'Transforming code into numbers (the AI way)...',
  'Processing with transformers.js (yes, it runs locally!)...',
  "Embedding semantics (your code's hidden meaning)...",
  'Vectorizing variables (alliteration achieved)...',
  'Teaching AI the difference between foo and bar...',
  'Creating embeddings (384 dimensions of awesome)...',
];

const MODEL_LOADING_MESSAGES = [
  'Waking up the neural network...',
  'Loading transformer model (patience, young padawan)...',
  'Downloading AI brain (first run only, promise!)...',
  'Initializing the semantic search engine...',
  'Booting up the language model (coffee break recommended)...',
  'Loading 100MB of pure AI goodness...',
  'Preparing the transformer for action...',
  'Model loading (this is why we run locally)...',
  'Spinning up the embedding generator...',
  'Getting the AI ready for your codebase...',
];

let currentIndexingIndex = 0;
let currentEmbeddingIndex = 0;
let currentModelIndex = 0;

/**
 * Get a random witty message for the indexing process
 */
export function getIndexingMessage(): string {
  const message = INDEXING_MESSAGES[currentIndexingIndex % INDEXING_MESSAGES.length];
  currentIndexingIndex++;
  return message;
}

/**
 * Get a random witty message for the embedding generation process
 */
export function getEmbeddingMessage(): string {
  const message = EMBEDDING_MESSAGES[currentEmbeddingIndex % EMBEDDING_MESSAGES.length];
  currentEmbeddingIndex++;
  return message;
}

/**
 * Get a random witty message for the model loading process
 */
export function getModelLoadingMessage(): string {
  const message = MODEL_LOADING_MESSAGES[currentModelIndex % MODEL_LOADING_MESSAGES.length];
  currentModelIndex++;
  return message;
}

/**
 * Reset all message counters (useful for testing)
 */
export function resetMessageCounters(): void {
  currentIndexingIndex = 0;
  currentEmbeddingIndex = 0;
  currentModelIndex = 0;
}

