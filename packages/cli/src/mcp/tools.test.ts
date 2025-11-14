import { describe, it, expect } from 'vitest';
import { tools } from './tools.js';

describe('MCP Tools Schema', () => {
  describe('tools array', () => {
    it('should export an array of tools', () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });
    
    it('should have exactly 4 tools', () => {
      expect(tools.length).toBe(4);
    });
    
    it('should have all required properties for each tool', () => {
      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });
  
  describe('semantic_search tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'semantic_search');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('semantic_search');
      expect(tool!.description).toContain('semantic');
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.inputSchema.properties).toHaveProperty('query');
      expect(tool!.inputSchema.properties).toHaveProperty('limit');
      expect(tool!.inputSchema.required).toEqual(['query']);
    });
    
    it('should have query as required field', () => {
      const tool = tools.find(t => t.name === 'semantic_search');
      expect(tool!.inputSchema.required).toContain('query');
    });
    
    it('should have limit with default value', () => {
      const tool = tools.find(t => t.name === 'semantic_search');
      expect(tool!.inputSchema.properties.limit.default).toBe(5);
    });
  });
  
  describe('find_similar tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('find_similar');
      expect(tool!.description).toContain('similar');
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.inputSchema.properties).toHaveProperty('code');
      expect(tool!.inputSchema.properties).toHaveProperty('limit');
      expect(tool!.inputSchema.required).toEqual(['code']);
    });
    
    it('should have code as required field', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      expect(tool!.inputSchema.required).toContain('code');
    });
    
    it('should have limit with default value', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      expect(tool!.inputSchema.properties.limit.default).toBe(5);
    });
  });
  
  describe('get_file_context tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'get_file_context');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_file_context');
      expect(tool!.description).toContain('file');
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.inputSchema.properties).toHaveProperty('filepath');
      expect(tool!.inputSchema.properties).toHaveProperty('includeRelated');
      expect(tool!.inputSchema.required).toEqual(['filepath']);
    });
    
    it('should have filepath as required field', () => {
      const tool = tools.find(t => t.name === 'get_file_context');
      expect(tool!.inputSchema.required).toContain('filepath');
    });
    
    it('should have includeRelated with default value', () => {
      const tool = tools.find(t => t.name === 'get_file_context');
      expect(tool!.inputSchema.properties.includeRelated.default).toBe(true);
    });
  });
  
  describe('list_functions tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'list_functions');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_functions');
      expect(tool!.description.toLowerCase()).toMatch(/function|class|interface/);
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.inputSchema.properties).toHaveProperty('pattern');
      expect(tool!.inputSchema.properties).toHaveProperty('language');
    });
    
    it('should have optional parameters', () => {
      const tool = tools.find(t => t.name === 'list_functions');
      // No required fields for this tool
      expect(tool!.inputSchema.required).toBeUndefined();
    });
    
    it('should have pattern and language as optional strings', () => {
      const tool = tools.find(t => t.name === 'list_functions');
      expect(tool!.inputSchema.properties.pattern.type).toBe('string');
      expect(tool!.inputSchema.properties.language.type).toBe('string');
    });
  });
  
  describe('schema validation', () => {
    it('should have valid JSON Schema format', () => {
      tools.forEach(tool => {
        expect(tool.inputSchema).toHaveProperty('type');
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema).toHaveProperty('properties');
        expect(typeof tool.inputSchema.properties).toBe('object');
      });
    });
    
    it('should have descriptions for all properties', () => {
      tools.forEach(tool => {
        Object.values(tool.inputSchema.properties).forEach((prop: any) => {
          expect(prop).toHaveProperty('description');
          expect(typeof prop.description).toBe('string');
          expect(prop.description.length).toBeGreaterThan(0);
        });
      });
    });
    
    it('should have valid types for all properties', () => {
      const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
      
      tools.forEach(tool => {
        Object.values(tool.inputSchema.properties).forEach((prop: any) => {
          expect(prop).toHaveProperty('type');
          expect(validTypes).toContain(prop.type);
        });
      });
    });
  });
});

