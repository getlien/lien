/**
 * Shared types and constants for the Bug Finder plugin.
 */

import type { CodeChunk } from '@liendev/parser';
import type { CallerEdge } from '../../dependency-graph.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_PROMPT_CHARS = 60_000;
export const MAX_CALLERS_PER_FUNCTION = 5;
export const MAX_CHANGED_FUNCTIONS_PER_BATCH = 8;
export const MAX_CALLER_SNIPPET_CHARS = 2_000;
export const BUG_REVIEW_MARKER = '<!-- lien-plugin:bugs-review -->';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangedFunction {
  filepath: string;
  symbolName: string;
  chunk: CodeChunk;
}

/** What the LLM returns -- caller-focused. */
export interface BugReport {
  changedFunction: string;
  callerFilepath: string;
  callerLine: number;
  callerSymbol: string;
  severity: 'error' | 'warning';
  category: string;
  description: string;
  suggestion: string;
}

export interface PromptBatch {
  functions: ChangedFunction[];
  callerMap: Map<string, CallerEdge[]>;
}
