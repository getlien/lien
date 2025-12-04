/**
 * MCP Tool Handler Registry
 *
 * This module exports all tool handlers and a registry mapping tool names to handlers.
 * The registry is used by the MCP server to dispatch tool calls.
 */

import { handleSemanticSearch } from './semantic-search.js';
import { handleFindSimilar } from './find-similar.js';
import { handleGetFilesContext } from './get-files-context.js';
import { handleListFunctions } from './list-functions.js';
import { handleGetDependents } from './get-dependents.js';
import { handleGetComplexity } from './get-complexity.js';
import type { ToolHandler } from '../types.js';

// Re-export individual handlers for direct use if needed
export {
  handleSemanticSearch,
  handleFindSimilar,
  handleGetFilesContext,
  handleListFunctions,
  handleGetDependents,
  handleGetComplexity,
};

/**
 * Registry mapping MCP tool names to their handler functions.
 * Used by the MCP server to dispatch tool calls.
 */
export const toolHandlers: Record<string, ToolHandler> = {
  'semantic_search': handleSemanticSearch,
  'find_similar': handleFindSimilar,
  'get_files_context': handleGetFilesContext,
  'list_functions': handleListFunctions,
  'get_dependents': handleGetDependents,
  'get_complexity': handleGetComplexity,
};


