import { describe, it, expect } from 'vitest';
import { mustParse } from '../test/helpers/parse-fixture.js';
import { getExtractor } from './index.js';

describe('Export Extractors', () => {
  describe('JavaScriptExportExtractor', () => {
    it('should extract named exports', () => {
      const code = 'export { foo, bar };';
      const root = mustParse(code, 'javascript');
      const extractor = getExtractor('javascript');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['foo', 'bar']);
    });

    it('should extract function exports', () => {
      const code = 'export function validateEmail() {}';
      const root = mustParse(code, 'typescript');
      const extractor = getExtractor('typescript');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['validateEmail']);
    });

    it('should extract default exports', () => {
      const code = 'export default class App {}';
      const root = mustParse(code, 'javascript');
      const extractor = getExtractor('javascript');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['default', 'App']);
    });
  });

  describe('PHPExportExtractor', () => {
    it('should extract class exports', () => {
      const code = '<?php\nclass User {}';
      const root = mustParse(code, 'php');
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['User']);
    });

    it('should extract trait exports', () => {
      const code = '<?php\ntrait HasTimestamps {}';
      const root = mustParse(code, 'php');
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['HasTimestamps']);
    });

    it('should extract interface exports', () => {
      const code = '<?php\ninterface Repository {}';
      const root = mustParse(code, 'php');
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['Repository']);
    });

    it('should extract function exports', () => {
      const code = '<?php\nfunction helper() {}';
      const root = mustParse(code, 'php');
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['helper']);
    });

    it('should extract namespaced exports', () => {
      const code = '<?php\nnamespace App\\Models;\nclass User {}';
      const root = mustParse(code, 'php');
      const extractor = getExtractor('php');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['User']);
    });
  });

  describe('PythonExportExtractor', () => {
    it('should extract class exports', () => {
      const code = 'class User:\n    pass';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['User']);
    });

    it('should extract function exports', () => {
      const code = 'def helper():\n    pass';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['helper']);
    });

    it('should extract async function exports', () => {
      const code = 'async def fetch_data():\n    pass';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

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
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['User', 'helper', 'fetch']);
    });

    it('should extract decorated class exports', () => {
      const code = `@dataclass
class User:
    pass`;
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['User']);
    });

    it('should extract decorated function exports', () => {
      const code = `@property
def get_name():
    pass`;
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['get_name']);
    });

    it('should extract multiple decorators', () => {
      const code = `@staticmethod
@cache
def compute():
    pass`;
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['compute']);
    });

    it('should extract re-exports from import_from_statement', () => {
      const code = 'from .auth import AuthService, ValidationError';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['AuthService', 'ValidationError']);
    });

    it('should extract aliased re-exports', () => {
      const code = 'from .auth import AuthService as Auth';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['Auth']);
    });

    it('should combine declarations and re-exports', () => {
      const code = `from .service import AuthService

class UserController:
    pass`;
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['AuthService', 'UserController']);
    });

    it('should NOT treat absolute imports as re-exports', () => {
      const code = 'from utils import helper';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      // Absolute imports are NOT re-exports — only relative imports (from .x import y) are
      expect(exports).toEqual([]);
    });

    it('should extract re-exports from current package import', () => {
      const code = 'from . import symbol';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['symbol']);
    });

    it('should ignore wildcard imports', () => {
      const code = 'from .module import *';
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual([]);
    });

    it('should deduplicate re-exports and declarations', () => {
      const code = `from .base import Helper

class Helper:
    pass`;
      const root = mustParse(code, 'python');
      const extractor = getExtractor('python');
      const exports = extractor.extractExports(root);

      expect(exports).toEqual(['Helper']);
    });
  });
});
