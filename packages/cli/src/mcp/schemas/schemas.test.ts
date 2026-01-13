import { describe, it, expect } from 'vitest';
import {
  SemanticSearchSchema,
  FindSimilarSchema,
  GetFilesContextSchema,
  ListFunctionsSchema,
  GetDependentsSchema,
  GetComplexitySchema,
} from './index.js';

describe('SemanticSearchSchema', () => {
  it('should validate correct input', () => {
    const result = SemanticSearchSchema.parse({
      query: 'user authentication',
      limit: 10,
    });
    expect(result.query).toBe('user authentication');
    expect(result.limit).toBe(10);
  });
  
  it('should apply default limit', () => {
    const result = SemanticSearchSchema.parse({
      query: 'user authentication',
    });
    expect(result.limit).toBe(5);
  });
  
  it('should reject short query', () => {
    expect(() => SemanticSearchSchema.parse({ query: 'ab' }))
      .toThrow('Query must be at least 3 characters');
  });
  
  it('should reject empty query', () => {
    expect(() => SemanticSearchSchema.parse({ query: '' }))
      .toThrow('Query must be at least 3 characters');
  });
  
  it('should reject long query', () => {
    const longQuery = 'a'.repeat(501);
    expect(() => SemanticSearchSchema.parse({ query: longQuery }))
      .toThrow('Query too long');
  });
  
  it('should reject invalid limit (too low)', () => {
    expect(() => SemanticSearchSchema.parse({ query: 'test', limit: 0 }))
      .toThrow('Limit must be at least 1');
  });
  
  it('should reject invalid limit (too high)', () => {
    expect(() => SemanticSearchSchema.parse({ query: 'test', limit: 100 }))
      .toThrow('Limit cannot exceed 50');
  });
  
  it('should reject non-integer limit', () => {
    expect(() => SemanticSearchSchema.parse({ query: 'test', limit: 5.5 }))
      .toThrow();
  });
  
  it('should accept minimum valid query', () => {
    const result = SemanticSearchSchema.parse({ query: 'abc' });
    expect(result.query).toBe('abc');
    expect(result.limit).toBe(5);
  });
  
  it('should accept maximum valid limit', () => {
    const result = SemanticSearchSchema.parse({ query: 'test', limit: 50 });
    expect(result.limit).toBe(50);
  });
});

describe('FindSimilarSchema', () => {
  it('should validate correct input', () => {
    const code = 'function test() { return true; }';
    const result = FindSimilarSchema.parse({
      code,
      limit: 10,
    });
    expect(result.code).toBe(code);
    expect(result.limit).toBe(10);
  });
  
  it('should apply default limit', () => {
    const result = FindSimilarSchema.parse({
      code: 'const x = 1; return x + 2;',
    });
    expect(result.limit).toBe(5);
  });
  
  it('should reject short code snippet', () => {
    expect(() => FindSimilarSchema.parse({ code: 'short' }))
      .toThrow('Code snippet must be at least 24 characters');
  });
  
  it('should reject invalid limit (too low)', () => {
    expect(() => FindSimilarSchema.parse({ code: 'const x = 1; return x + 2;', limit: 0 }))
      .toThrow('Limit must be at least 1');
  });
  
  it('should reject invalid limit (too high)', () => {
    expect(() => FindSimilarSchema.parse({ code: 'const x = 1; return x + 2;', limit: 25 }))
      .toThrow('Limit cannot exceed 20');
  });
  
  it('should accept minimum valid code', () => {
    const result = FindSimilarSchema.parse({ code: '012345678901234567890123' });
    expect(result.code).toBe('012345678901234567890123');
  });
  
  it('should accept maximum valid limit', () => {
    const result = FindSimilarSchema.parse({ code: 'const x = 1; return x + 2;', limit: 20 });
    expect(result.limit).toBe(20);
  });

  it('should accept optional language filter', () => {
    const result = FindSimilarSchema.parse({
      code: 'const x = 1; return x + 2;',
      language: 'typescript',
    });
    expect(result.language).toBe('typescript');
  });

  it('should accept optional pathHint filter', () => {
    const result = FindSimilarSchema.parse({
      code: 'const x = 1; return x + 2;',
      pathHint: 'src/api',
    });
    expect(result.pathHint).toBe('src/api');
  });

  it('should accept both filters together', () => {
    const result = FindSimilarSchema.parse({
      code: 'const x = 1; return x + 2;',
      language: 'typescript',
      pathHint: 'src/api',
    });
    expect(result.language).toBe('typescript');
    expect(result.pathHint).toBe('src/api');
  });
});

describe('GetFilesContextSchema', () => {
  it('should validate correct input', () => {
    const result = GetFilesContextSchema.parse({
      filepaths: 'src/index.ts',
      includeRelated: false,
    });
    expect(result.filepaths).toBe('src/index.ts');
    expect(result.includeRelated).toBe(false);
  });
  
  it('should apply default includeRelated', () => {
    const result = GetFilesContextSchema.parse({
      filepaths: 'src/index.ts',
    });
    expect(result.includeRelated).toBe(true);
  });
  
  it('should reject empty filepath', () => {
    expect(() => GetFilesContextSchema.parse({ filepaths: '' }))
      .toThrow('Filepath cannot be empty');
  });
  
  it('should accept various filepath formats', () => {
    const paths = [
      'src/index.ts',
      './src/index.ts',
      'packages/cli/src/index.ts',
      'index.ts',
    ];
    
    paths.forEach(path => {
      const result = GetFilesContextSchema.parse({ filepaths: path });
      expect(result.filepaths).toBe(path);
    });
  });
  
  it('should accept explicit includeRelated values', () => {
    const resultTrue = GetFilesContextSchema.parse({
      filepaths: 'test.ts',
      includeRelated: true,
    });
    expect(resultTrue.includeRelated).toBe(true);
    
    const resultFalse = GetFilesContextSchema.parse({
      filepaths: 'test.ts',
      includeRelated: false,
    });
    expect(resultFalse.includeRelated).toBe(false);
  });
  
  it('should reject array with empty strings', () => {
    const invalid = GetFilesContextSchema.safeParse({ 
      filepaths: ['', 'src/auth.ts'] 
    });
    expect(invalid.success).toBe(false);
  });
  
  it('should reject array with all empty strings', () => {
    const invalid = GetFilesContextSchema.safeParse({ 
      filepaths: ['', ''] 
    });
    expect(invalid.success).toBe(false);
  });
});

describe('ListFunctionsSchema', () => {
  it('should validate correct input with both fields', () => {
    const result = ListFunctionsSchema.parse({
      pattern: '.*Controller.*',
      language: 'typescript',
    });
    expect(result.pattern).toBe('.*Controller.*');
    expect(result.language).toBe('typescript');
  });
  
  it('should accept no parameters', () => {
    const result = ListFunctionsSchema.parse({});
    expect(result.pattern).toBeUndefined();
    expect(result.language).toBeUndefined();
  });
  
  it('should accept only pattern', () => {
    const result = ListFunctionsSchema.parse({
      pattern: 'handle.*',
    });
    expect(result.pattern).toBe('handle.*');
    expect(result.language).toBeUndefined();
  });
  
  it('should accept only language', () => {
    const result = ListFunctionsSchema.parse({
      language: 'python',
    });
    expect(result.pattern).toBeUndefined();
    expect(result.language).toBe('python');
  });
  
  it('should accept various pattern formats', () => {
    const patterns = [
      '.*Service$',
      'handle.*',
      '.*Controller.*',
      '^get',
      'test',
    ];
    
    patterns.forEach(pattern => {
      const result = ListFunctionsSchema.parse({ pattern });
      expect(result.pattern).toBe(pattern);
    });
  });
  
  it('should accept various language values', () => {
    const languages = ['typescript', 'javascript', 'python', 'php', 'java'];
    
    languages.forEach(language => {
      const result = ListFunctionsSchema.parse({ language });
      expect(result.language).toBe(language);
    });
  });
});

describe('GetDependentsSchema', () => {
  it('should validate correct input with depth=1', () => {
    const result = GetDependentsSchema.parse({
      filepath: 'src/utils/validate.ts',
      depth: 1,
    });
    expect(result.filepath).toBe('src/utils/validate.ts');
    expect(result.depth).toBe(1);
  });
  
  it('should apply default depth', () => {
    const result = GetDependentsSchema.parse({
      filepath: 'src/index.ts',
    });
    expect(result.depth).toBe(1);
  });
  
  it('should reject empty filepath', () => {
    expect(() => GetDependentsSchema.parse({ filepath: '' }))
      .toThrow('Filepath cannot be empty');
  });
  
  it('should reject depth less than 1', () => {
    expect(() => GetDependentsSchema.parse({ 
      filepath: 'src/test.ts', 
      depth: 0 
    }))
      .toThrow();
  });
  
  it('should reject depth greater than 1', () => {
    expect(() => GetDependentsSchema.parse({ 
      filepath: 'src/test.ts', 
      depth: 2 
    }))
      .toThrow();
  });
  
  it('should accept only depth=1', () => {
    const result = GetDependentsSchema.parse({
      filepath: 'test.ts',
      depth: 1,
    });
    expect(result.depth).toBe(1);
  });
  
  it('should accept various filepath formats', () => {
    const paths = [
      'src/index.ts',
      './src/index.ts',
      'packages/cli/src/index.ts',
      'index.ts',
      'utils/validate.js',
    ];
    
    paths.forEach(path => {
      const result = GetDependentsSchema.parse({ filepath: path });
      expect(result.filepath).toBe(path);
    });
  });
  
  it('should reject non-integer depth', () => {
    expect(() => GetDependentsSchema.parse({ 
      filepath: 'test.ts', 
      depth: 1.5 
    }))
      .toThrow();
  });
});

describe('GetComplexitySchema', () => {
  it('should accept empty object with defaults', () => {
    const result = GetComplexitySchema.parse({});
    expect(result.top).toBe(10);
    expect(result.files).toBeUndefined();
    expect(result.threshold).toBeUndefined();
  });
  
  it('should accept top parameter', () => {
    const result = GetComplexitySchema.parse({ top: 20 });
    expect(result.top).toBe(20);
  });
  
  it('should accept files array', () => {
    const result = GetComplexitySchema.parse({ files: ['src/auth.ts', 'src/api/user.ts'] });
    expect(result.files).toEqual(['src/auth.ts', 'src/api/user.ts']);
  });
  
  it('should accept threshold parameter', () => {
    const result = GetComplexitySchema.parse({ threshold: 15 });
    expect(result.threshold).toBe(15);
  });
  
  it('should accept all parameters together', () => {
    const result = GetComplexitySchema.parse({ 
      files: ['src/auth.ts'], 
      top: 5, 
      threshold: 20 
    });
    expect(result.files).toEqual(['src/auth.ts']);
    expect(result.top).toBe(5);
    expect(result.threshold).toBe(20);
  });
  
  it('should reject top > 50', () => {
    expect(() => GetComplexitySchema.parse({ top: 100 }))
      .toThrow('Top cannot exceed 50');
  });
  
  it('should reject top < 1', () => {
    expect(() => GetComplexitySchema.parse({ top: 0 }))
      .toThrow('Top must be at least 1');
  });
  
  it('should reject non-integer top', () => {
    expect(() => GetComplexitySchema.parse({ top: 5.5 }))
      .toThrow();
  });
  
  it('should reject threshold < 1', () => {
    expect(() => GetComplexitySchema.parse({ threshold: 0 }))
      .toThrow('Threshold must be at least 1');
  });
  
  it('should reject non-integer threshold', () => {
    expect(() => GetComplexitySchema.parse({ threshold: 10.5 }))
      .toThrow();
  });
  
  it('should reject files array with empty strings', () => {
    expect(() => GetComplexitySchema.parse({ files: ['', 'src/auth.ts'] }))
      .toThrow('Filepath cannot be empty');
  });
  
  it('should accept minimum valid top', () => {
    const result = GetComplexitySchema.parse({ top: 1 });
    expect(result.top).toBe(1);
  });
  
  it('should accept maximum valid top', () => {
    const result = GetComplexitySchema.parse({ top: 50 });
    expect(result.top).toBe(50);
  });
  
  it('should accept minimum valid threshold', () => {
    const result = GetComplexitySchema.parse({ threshold: 1 });
    expect(result.threshold).toBe(1);
  });
});

