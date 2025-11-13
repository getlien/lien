import { describe, it, expect } from 'vitest';
import { isTestFile, findTestFiles, findSourceFiles, detectTestFramework } from './test-patterns.js';

describe('isTestFile', () => {
  describe('TypeScript/JavaScript', () => {
    it('should detect .test.ts files', () => {
      expect(isTestFile('Button.test.ts', 'typescript')).toBe(true);
      expect(isTestFile('utils.test.tsx', 'typescript')).toBe(true);
    });

    it('should detect .spec.ts files', () => {
      expect(isTestFile('Button.spec.ts', 'typescript')).toBe(true);
      expect(isTestFile('utils.spec.tsx', 'typescript')).toBe(true);
    });

    it('should detect files in test directories', () => {
      expect(isTestFile('tests/Button.ts', 'typescript')).toBe(true);
      expect(isTestFile('__tests__/utils.tsx', 'typescript')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('Button.ts', 'typescript')).toBe(false);
      expect(isTestFile('utils.tsx', 'typescript')).toBe(false);
    });
  });

  describe('Python', () => {
    it('should detect test_ prefix files', () => {
      expect(isTestFile('test_calculator.py', 'python')).toBe(true);
    });

    it('should detect _test suffix files', () => {
      expect(isTestFile('calculator_test.py', 'python')).toBe(true);
    });

    it('should detect files in test directories', () => {
      expect(isTestFile('tests/calculator.py', 'python')).toBe(true);
      expect(isTestFile('test/math.py', 'python')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('calculator.py', 'python')).toBe(false);
      expect(isTestFile('math_utils.py', 'python')).toBe(false);
    });
  });

  describe('Go', () => {
    it('should detect _test.go files', () => {
      expect(isTestFile('calculator_test.go', 'go')).toBe(true);
      expect(isTestFile('math_test.go', 'go')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('calculator.go', 'go')).toBe(false);
      expect(isTestFile('math.go', 'go')).toBe(false);
    });
  });

  describe('PHP', () => {
    it('should detect Test.php suffix files', () => {
      expect(isTestFile('CalculatorTest.php', 'php')).toBe(true);
      expect(isTestFile('MathTest.php', 'php')).toBe(true);
    });

    it('should detect files in test directories', () => {
      expect(isTestFile('tests/Calculator.php', 'php')).toBe(true);
      expect(isTestFile('Tests/Math.php', 'php')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('Calculator.php', 'php')).toBe(false);
      expect(isTestFile('Math.php', 'php')).toBe(false);
    });
  });

  describe('Java', () => {
    it('should detect Test.java suffix files', () => {
      expect(isTestFile('CalculatorTest.java', 'java')).toBe(true);
      expect(isTestFile('MathTests.java', 'java')).toBe(true);
    });

    it('should detect files in test directories', () => {
      expect(isTestFile('src/test/Calculator.java', 'java')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('Calculator.java', 'java')).toBe(false);
      expect(isTestFile('src/main/Calculator.java', 'java')).toBe(false);
    });
  });

  describe('Ruby', () => {
    it('should detect _test.rb files', () => {
      expect(isTestFile('calculator_test.rb', 'ruby')).toBe(true);
    });

    it('should detect _spec.rb files', () => {
      expect(isTestFile('calculator_spec.rb', 'ruby')).toBe(true);
    });

    it('should detect test_ prefix files', () => {
      expect(isTestFile('test_calculator.rb', 'ruby')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('calculator.rb', 'ruby')).toBe(false);
    });
  });

  describe('C/C++', () => {
    it('should detect _test.cpp files', () => {
      expect(isTestFile('math_test.cpp', 'cpp')).toBe(true);
    });

    it('should detect Test.cpp suffix files', () => {
      expect(isTestFile('MathTest.cpp', 'cpp')).toBe(true);
    });

    it('should not detect regular source files', () => {
      expect(isTestFile('math.cpp', 'cpp')).toBe(false);
      expect(isTestFile('utils.h', 'cpp')).toBe(false);
    });
  });
});

describe('findTestFiles', () => {
  describe('TypeScript/JavaScript', () => {
    it('should find co-located test files', () => {
      const allFiles = [
        'src/Button.tsx',
        'src/Button.test.tsx',
        'src/utils.ts',
      ];
      const tests = findTestFiles('src/Button.tsx', 'typescript', allFiles);
      expect(tests).toContain('src/Button.test.tsx');
    });

    it('should find tests in parallel test directory', () => {
      const allFiles = [
        'src/components/Button.tsx',
        'tests/components/Button.test.tsx',
        'src/utils.ts',
      ];
      const tests = findTestFiles('src/components/Button.tsx', 'typescript', allFiles);
      expect(tests).toContain('tests/components/Button.test.tsx');
    });

    it('should find tests in flat test directory', () => {
      const allFiles = [
        'src/components/Button.tsx',
        'tests/Button.test.tsx',
        'src/utils.ts',
      ];
      const tests = findTestFiles('src/components/Button.tsx', 'typescript', allFiles);
      expect(tests).toContain('tests/Button.test.tsx');
    });

    it('should handle multiple test files', () => {
      const allFiles = [
        'src/Button.tsx',
        'src/Button.test.tsx',
        'src/Button.spec.tsx',
        '__tests__/Button.test.tsx',
      ];
      const tests = findTestFiles('src/Button.tsx', 'typescript', allFiles);
      expect(tests.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Python', () => {
    it('should find test files with test_ prefix', () => {
      const allFiles = [
        'src/calculator.py',
        'test_calculator.py',
        'src/math.py',
      ];
      const tests = findTestFiles('src/calculator.py', 'python', allFiles);
      expect(tests.length).toBeGreaterThan(0);
    });

    it('should find tests in test directory', () => {
      const allFiles = [
        'src/calculator.py',
        'tests/test_calculator.py',
        'src/math.py',
      ];
      const tests = findTestFiles('src/calculator.py', 'python', allFiles);
      expect(tests).toContain('tests/test_calculator.py');
    });
  });

  describe('Go', () => {
    it('should find _test.go files', () => {
      const allFiles = [
        'calculator.go',
        'calculator_test.go',
        'math.go',
      ];
      const tests = findTestFiles('calculator.go', 'go', allFiles);
      expect(tests).toContain('calculator_test.go');
    });
  });

  describe('PHP', () => {
    it('should find Test.php suffix files', () => {
      const allFiles = [
        'src/Calculator.php',
        'tests/CalculatorTest.php',
        'src/Math.php',
      ];
      const tests = findTestFiles('src/Calculator.php', 'php', allFiles);
      expect(tests).toContain('tests/CalculatorTest.php');
    });

    it('should find Laravel-style tests organized by type', () => {
      const allFiles = [
        'app/Http/Controllers/AuthController.php',
        'tests/Feature/AuthControllerTest.php',
        'tests/Unit/HelperTest.php',
      ];
      const tests = findTestFiles('app/Http/Controllers/AuthController.php', 'php', allFiles);
      expect(tests).toContain('tests/Feature/AuthControllerTest.php');
    });
  });
});

describe('findSourceFiles', () => {
  describe('TypeScript/JavaScript', () => {
    it('should find source file from co-located test', () => {
      const allFiles = [
        'src/Button.tsx',
        'src/Button.test.tsx',
        'src/utils.ts',
      ];
      const sources = findSourceFiles('src/Button.test.tsx', 'typescript', allFiles);
      expect(sources).toContain('src/Button.tsx');
    });

    it('should find source file from test directory', () => {
      const allFiles = [
        'src/components/Button.tsx',
        'tests/components/Button.test.tsx',
        'src/utils.ts',
      ];
      const sources = findSourceFiles('tests/components/Button.test.tsx', 'typescript', allFiles);
      expect(sources).toContain('src/components/Button.tsx');
    });

    it('should find source file from flat test directory', () => {
      const allFiles = [
        'src/components/Button.tsx',
        'tests/Button.test.tsx',
      ];
      const sources = findSourceFiles('tests/Button.test.tsx', 'typescript', allFiles);
      expect(sources).toContain('src/components/Button.tsx');
    });
  });

  describe('Python', () => {
    it('should find source file from test_ prefix', () => {
      const allFiles = [
        'src/calculator.py',
        'tests/test_calculator.py',
        'src/math.py',
      ];
      const sources = findSourceFiles('tests/test_calculator.py', 'python', allFiles);
      expect(sources).toContain('src/calculator.py');
    });

    it('should find source file from _test suffix', () => {
      const allFiles = [
        'src/calculator.py',
        'tests/calculator_test.py',
      ];
      const sources = findSourceFiles('tests/calculator_test.py', 'python', allFiles);
      expect(sources).toContain('src/calculator.py');
    });
  });

  describe('Go', () => {
    it('should find source file from _test.go', () => {
      const allFiles = [
        'calculator.go',
        'calculator_test.go',
        'math.go',
      ];
      const sources = findSourceFiles('calculator_test.go', 'go', allFiles);
      expect(sources).toContain('calculator.go');
    });
  });

  describe('PHP', () => {
    it('should find source file from Test.php suffix', () => {
      const allFiles = [
        'src/Calculator.php',
        'tests/CalculatorTest.php',
      ];
      const sources = findSourceFiles('tests/CalculatorTest.php', 'php', allFiles);
      expect(sources).toContain('src/Calculator.php');
    });

    it('should find source file from Laravel-style Feature test', () => {
      const allFiles = [
        'app/Http/Controllers/AuthController.php',
        'tests/Feature/AuthControllerTest.php',
      ];
      const sources = findSourceFiles('tests/Feature/AuthControllerTest.php', 'php', allFiles);
      expect(sources).toContain('app/Http/Controllers/AuthController.php');
    });
  });
});

describe('detectTestFramework', () => {
  it('should detect Jest for TypeScript', () => {
    const content = `
      import { jest } from '@jest/globals';
      describe('test', () => {});
    `;
    expect(detectTestFramework(content, 'typescript')).toBe('jest');
  });

  it('should detect Vitest for TypeScript', () => {
    const content = `
      import { describe, it, expect } from 'vitest';
      describe('test', () => {});
    `;
    expect(detectTestFramework(content, 'typescript')).toBe('vitest');
  });

  it('should detect pytest for Python', () => {
    const content = `
      import pytest
      def test_example():
          pass
    `;
    expect(detectTestFramework(content, 'python')).toBe('pytest');
  });

  it('should detect PHPUnit for PHP', () => {
    const content = `
      use PHPUnit\\Framework\\TestCase;
      class CalculatorTest extends TestCase {}
    `;
    expect(detectTestFramework(content, 'php')).toBe('phpunit');
  });

  it('should detect Go testing package', () => {
    const content = `
      import "testing"
      func TestCalculator(t *testing.T) {}
    `;
    expect(detectTestFramework(content, 'go')).toBe('testing');
  });

  it('should return undefined for unknown framework', () => {
    const content = `
      const x = 1;
    `;
    expect(detectTestFramework(content, 'typescript')).toBeUndefined();
  });
});

