import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LienError, LienErrorCode } from '../errors/index.js';

describe('MCP Server Error Handling', () => {
  describe('Unknown tool error', () => {
    it('should create structured error for unknown tool', () => {
      const toolName = 'non_existent_tool';
      const availableTools = ['semantic_search', 'find_similar', 'get_file_context', 'list_functions'];
      
      const error = new LienError(
        `Unknown tool: ${toolName}`,
        LienErrorCode.INVALID_INPUT,
        { requestedTool: toolName, availableTools },
        'medium',
        false,
        false
      );
      
      expect(error.message).toBe(`Unknown tool: ${toolName}`);
      expect(error.code).toBe(LienErrorCode.INVALID_INPUT);
      expect(error.severity).toBe('medium');
      expect(error.recoverable).toBe(false);
      expect(error.retryable).toBe(false);
      expect(error.context).toEqual({
        requestedTool: toolName,
        availableTools,
      });
      
      const json = error.toJSON();
      expect(json).toEqual({
        error: `Unknown tool: ${toolName}`,
        code: 'INVALID_INPUT',
        severity: 'medium',
        recoverable: false,
        context: {
          requestedTool: toolName,
          availableTools,
        },
      });
    });
    
    it('should provide helpful context with available tools', () => {
      const error = new LienError(
        'Unknown tool: typo_search',
        LienErrorCode.INVALID_INPUT,
        { 
          requestedTool: 'typo_search',
          availableTools: ['semantic_search', 'find_similar', 'get_file_context', 'list_functions']
        }
      );
      
      const json = error.toJSON();
      expect(json.context?.availableTools).toHaveLength(4);
      expect(json.context?.availableTools).toContain('semantic_search');
    });
  });
});

