import { describe, it, expect } from 'vitest';
import { tools } from './tools.js';
import { 
  SemanticSearchSchema, 
  FindSimilarSchema, 
  GetFilesContextSchema, 
  ListFunctionsSchema,
  GetDependentsSchema
} from './schemas/index.js';

describe('MCP Tools Schema', () => {
  describe('tools array', () => {
    it('should export an array of tools', () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });
    
  it('should have exactly 5 tools', () => {
    expect(tools.length).toBe(5);
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
      const schema = tool!.inputSchema as any;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('query');
      expect(schema.properties).toHaveProperty('limit');
      expect(schema.required).toEqual(['query']);
    });
    
    it('should mention relevance categories in description', () => {
      const tool = tools.find(t => t.name === 'semantic_search');
      expect(tool!.description).toContain('relevance category');
      expect(tool!.description).toContain('highly_relevant');
    });
    
    it('should have query as required field', () => {
      const tool = tools.find(t => t.name === 'semantic_search');
      const schema = tool?.inputSchema as any;
      expect(schema.required).toContain('query');
    });
    
    it('should have limit with default value', () => {
      const tool = tools.find(t => t.name === 'semantic_search');
      const schema = tool?.inputSchema as any;
      expect(schema.properties.limit?.default).toBe(5);
    });
  });
  
  describe('find_similar tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('find_similar');
      expect(tool!.description).toContain('similar');
      const schema = tool!.inputSchema as any;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('code');
      expect(schema.properties).toHaveProperty('limit');
      expect(schema.required).toEqual(['code']);
    });
    
    it('should mention relevance categories in description', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      expect(tool!.description).toContain('relevance category');
    });
    
    it('should have code as required field', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      const schema = tool?.inputSchema as any;
      expect(schema.required).toContain('code');
    });
    
    it('should have limit with default value', () => {
      const tool = tools.find(t => t.name === 'find_similar');
      const schema = tool?.inputSchema as any;
      expect(schema.properties.limit?.default).toBe(5);
    });
  });
  
  describe('get_files_context tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'get_files_context');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_files_context');
      expect(tool!.description).toContain('file');
      const schema = tool!.inputSchema as any;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('filepaths');
      expect(schema.properties).toHaveProperty('includeRelated');
      expect(schema.required).toEqual(['filepaths']);
    });
    
    it('should mention relevance categories in description', () => {
      const tool = tools.find(t => t.name === 'get_files_context');
      expect(tool!.description.toLowerCase()).toContain('relevance');
    });
    
    it('should have filepaths as required field', () => {
      const tool = tools.find(t => t.name === 'get_files_context');
      const schema = tool?.inputSchema as any;
      expect(schema.required).toContain('filepaths');
    });
    
    it('should have includeRelated with default value', () => {
      const tool = tools.find(t => t.name === 'get_files_context');
      const schema = tool?.inputSchema as any;
      expect(schema.properties.includeRelated?.default).toBe(true);
    });
  });
  
  describe('list_functions tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'list_functions');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('list_functions');
      expect(tool!.description.toLowerCase()).toMatch(/function|class|interface/);
      const schema = tool!.inputSchema as any;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('pattern');
      expect(schema.properties).toHaveProperty('language');
    });
    
    it('should have optional parameters', () => {
      const tool = tools.find(t => t.name === 'list_functions');
      const schema = tool!.inputSchema as any;
      // No required fields for this tool
      expect(schema.required).toBeUndefined();
    });
    
    it('should have pattern and language as optional strings', () => {
      const tool = tools.find(t => t.name === 'list_functions');
      const schema = tool?.inputSchema as any;
      expect(schema.properties.pattern?.type).toBe('string');
      expect(schema.properties.language?.type).toBe('string');
    });
  });
  
  describe('get_dependents tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'get_dependents');
      
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('get_dependents');
      expect(tool!.description.toLowerCase()).toMatch(/depend|impact/);
      const schema = tool!.inputSchema as any;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('filepath');
      expect(schema.properties).toHaveProperty('depth');
      expect(schema.required).toEqual(['filepath']);
    });
    
    it('should mention risk levels in description', () => {
      const tool = tools.find(t => t.name === 'get_dependents');
      expect(tool!.description.toLowerCase()).toMatch(/risk|impact/);
    });
    
    it('should have filepath as required field', () => {
      const tool = tools.find(t => t.name === 'get_dependents');
      const schema = tool?.inputSchema as any;
      expect(schema.required).toContain('filepath');
    });
    
    it('should have depth with default value', () => {
      const tool = tools.find(t => t.name === 'get_dependents');
      const schema = tool?.inputSchema as any;
      expect(schema.properties.depth?.default).toBe(1);
    });
    
    it('should have depth constraints', () => {
      const tool = tools.find(t => t.name === 'get_dependents');
      const schema = tool?.inputSchema as any;
      expect(schema.properties.depth?.minimum).toBe(1);
      expect(schema.properties.depth?.maximum).toBe(1);
    });
  });
  
  describe('schema validation', () => {
    it('should have valid JSON Schema format', () => {
      tools.forEach(tool => {
        const schema = tool.inputSchema as any;
        expect(schema).toHaveProperty('type');
        expect(schema.type).toBe('object');
        expect(schema).toHaveProperty('properties');
        expect(typeof schema.properties).toBe('object');
      });
    });
    
    it('should have descriptions for all properties', () => {
      tools.forEach(tool => {
        const schema = tool.inputSchema as any;
        Object.values(schema.properties).forEach((prop: any) => {
          expect(prop).toHaveProperty('description');
          expect(typeof prop.description).toBe('string');
          expect(prop.description.length).toBeGreaterThan(0);
        });
      });
    });
    
    it('should have valid types for all properties', () => {
      const validTypes = ['string', 'number', 'boolean', 'object', 'array', 'integer'];
      
      tools.forEach(tool => {
        const schema = tool.inputSchema as any;
        Object.values(schema.properties).forEach((prop: any) => {
          // Handle both simple types and union types (anyOf)
          if (prop.type) {
            expect(validTypes).toContain(prop.type);
          } else if (prop.anyOf) {
            // Union type - check that at least one option has a valid type
            const hasValidType = prop.anyOf.some((option: any) => 
              option.type && validTypes.includes(option.type)
            );
            expect(hasValidType).toBe(true);
          } else {
            throw new Error(`Property has neither type nor anyOf: ${JSON.stringify(prop)}`);
          }
        });
      });
    });
  });
  
  describe('Zod schema validation integration', () => {
    describe('semantic_search validation', () => {
      it('should accept valid input', () => {
        const valid = SemanticSearchSchema.safeParse({
          query: 'test query',
          limit: 10
        });
        expect(valid.success).toBe(true);
      });
      
      it('should reject invalid input', () => {
        const invalid = SemanticSearchSchema.safeParse({
          query: 'ab', // too short
          limit: 10
        });
        expect(invalid.success).toBe(false);
      });
      
      it('should apply defaults', () => {
        const result = SemanticSearchSchema.parse({ query: 'test' });
        expect(result.limit).toBe(5);
      });
    });
    
    describe('find_similar validation', () => {
      it('should accept valid input', () => {
        const valid = FindSimilarSchema.safeParse({
          code: 'const x = 1;',
          limit: 10
        });
        expect(valid.success).toBe(true);
      });
      
      it('should reject short code', () => {
        const invalid = FindSimilarSchema.safeParse({
          code: 'short'
        });
        expect(invalid.success).toBe(false);
      });
      
      it('should apply defaults', () => {
        const result = FindSimilarSchema.parse({ code: 'const x = 1;' });
        expect(result.limit).toBe(5);
      });
    });
    
    describe('get_files_context validation', () => {
      it('should accept valid input with single filepath', () => {
        const valid = GetFilesContextSchema.safeParse({
          filepaths: 'src/index.ts',
          includeRelated: false
        });
        expect(valid.success).toBe(true);
      });
      
      it('should accept single string', () => {
        const valid = GetFilesContextSchema.safeParse({ filepaths: 'src/index.ts' });
        expect(valid.success).toBe(true);
      });
      
      it('should accept array of strings', () => {
        const valid = GetFilesContextSchema.safeParse({ 
          filepaths: ['src/a.ts', 'src/b.ts'] 
        });
        expect(valid.success).toBe(true);
      });
      
      it('should reject empty array', () => {
        const invalid = GetFilesContextSchema.safeParse({ filepaths: [] });
        expect(invalid.success).toBe(false);
      });
      
      it('should reject array with >50 files', () => {
        const tooMany = Array(51).fill('file.ts');
        const invalid = GetFilesContextSchema.safeParse({ filepaths: tooMany });
        expect(invalid.success).toBe(false);
      });
      
      it('should reject empty filepath', () => {
        const invalid = GetFilesContextSchema.safeParse({
          filepaths: ''
        });
        expect(invalid.success).toBe(false);
      });
      
      it('should apply defaults', () => {
        const result = GetFilesContextSchema.parse({ filepaths: 'test.ts' });
        expect(result.includeRelated).toBe(true);
      });
    });
    
    describe('list_functions validation', () => {
      it('should accept all optional parameters', () => {
        const valid = ListFunctionsSchema.safeParse({});
        expect(valid.success).toBe(true);
      });
      
      it('should accept pattern only', () => {
        const valid = ListFunctionsSchema.safeParse({
          pattern: '.*Controller.*'
        });
        expect(valid.success).toBe(true);
      });
      
      it('should accept language only', () => {
        const valid = ListFunctionsSchema.safeParse({
          language: 'typescript'
        });
        expect(valid.success).toBe(true);
      });
      
      it('should accept both parameters', () => {
        const valid = ListFunctionsSchema.safeParse({
          pattern: '.*Service$',
          language: 'python'
        });
        expect(valid.success).toBe(true);
      });
    });
    
    describe('get_dependents validation', () => {
      it('should accept valid input', () => {
        const valid = GetDependentsSchema.safeParse({
          filepath: 'src/utils/validate.ts',
          depth: 1
        });
        expect(valid.success).toBe(true);
      });
      
      it('should apply defaults', () => {
        const result = GetDependentsSchema.parse({ filepath: 'src/index.ts' });
        expect(result.depth).toBe(1);
      });
      
      it('should reject empty filepath', () => {
        const invalid = GetDependentsSchema.safeParse({
          filepath: ''
        });
        expect(invalid.success).toBe(false);
      });
      
      it('should reject depth < 1', () => {
        const invalid = GetDependentsSchema.safeParse({
          filepath: 'src/test.ts',
          depth: 0
        });
        expect(invalid.success).toBe(false);
      });
      
      it('should reject depth > 1', () => {
        const invalid = GetDependentsSchema.safeParse({
          filepath: 'src/test.ts',
          depth: 2
        });
        expect(invalid.success).toBe(false);
        if (!invalid.success) {
          expect(invalid.error.issues[0].message).toContain('less than or equal to 1');
        }
      });
      
      it('should reject non-integer depth', () => {
        const invalid = GetDependentsSchema.safeParse({
          filepath: 'src/test.ts',
          depth: 1.5
        });
        expect(invalid.success).toBe(false);
      });
    });
  });
});

