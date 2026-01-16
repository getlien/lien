import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import PHP from 'tree-sitter-php';
import Python from 'tree-sitter-python';
import { getExtractor } from './index.js';

describe('Export Extractors', () => {
  describe('JavaScriptExportExtractor', () => {
    const parser = new Parser();
    parser.setLanguage(TypeScript.typescript);
    
    it('should extract named exports', () => {
      const code = 'export { foo, bar };';
      const tree = parser.parse(code);
      const extractor = getExtractor('javascript');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['foo', 'bar']);
    });
    
    it('should extract function exports', () => {
      const code = 'export function validateEmail() {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('typescript');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['validateEmail']);
    });
    
    it('should extract default exports', () => {
      const code = 'export default class App {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('javascript');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['default', 'App']);
    });
  });
  
  describe('PHPExportExtractor', () => {
    const parser = new Parser();
    parser.setLanguage(PHP.php);
    
    it('should extract class exports', () => {
      const code = '<?php\nclass User {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['User']);
    });
    
    it('should extract trait exports', () => {
      const code = '<?php\ntrait HasTimestamps {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['HasTimestamps']);
    });
    
    it('should extract interface exports', () => {
      const code = '<?php\ninterface Repository {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['Repository']);
    });
    
    it('should extract function exports', () => {
      const code = '<?php\nfunction helper() {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['helper']);
    });
    
    it('should extract namespaced exports', () => {
      const code = '<?php\nnamespace App\\Models;\nclass User {}';
      const tree = parser.parse(code);
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['User']);
    });
  });
  
  describe('PythonExportExtractor', () => {
    const parser = new Parser();
    parser.setLanguage(Python);
    
    it('should extract class exports', () => {
      const code = 'class User:\n    pass';
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['User']);
    });
    
    it('should extract function exports', () => {
      const code = 'def helper():\n    pass';
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['helper']);
    });
    
    it('should extract async function exports', () => {
      const code = 'async def fetch_data():\n    pass';
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['fetch_data']);
    });
    
    it('should extract multiple exports', () => {
      const code = `
class User:
    pass

def helper():
    pass

async def fetch():
    pass
`;
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['User', 'helper', 'fetch']);
    });
    
    it('should extract decorated class exports', () => {
      const code = `@dataclass
class User:
    pass`;
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['User']);
    });
    
    it('should extract decorated function exports', () => {
      const code = `@property
def get_name():
    pass`;
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['get_name']);
    });
    
    it('should extract multiple decorators', () => {
      const code = `@staticmethod
@cache
def compute():
    pass`;
      const tree = parser.parse(code);
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(tree.rootNode);
      
      expect(exports).toEqual(['compute']);
    });
  });
});
