import { describe, it, expect } from 'vitest';
import { Result, Ok, Err, isOk, isErr, unwrap, unwrapOr } from './result.js';

describe('Result Type', () => {
  describe('Ok', () => {
    it('should create a successful Result', () => {
      const result = Ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it('should work with different types', () => {
      const stringResult = Ok('hello');
      const objectResult = Ok({ foo: 'bar' });
      const arrayResult = Ok([1, 2, 3]);

      expect(stringResult.ok).toBe(true);
      expect(objectResult.ok).toBe(true);
      expect(arrayResult.ok).toBe(true);
    });
  });

  describe('Err', () => {
    it('should create a failed Result', () => {
      const result = Err('Something went wrong');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Something went wrong');
      }
    });

    it('should work with Error objects', () => {
      const error = new Error('Test error');
      const result = Err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('isOk', () => {
    it('should return true for Ok results', () => {
      const result = Ok(42);
      expect(isOk(result)).toBe(true);
    });

    it('should return false for Err results', () => {
      const result = Err('error');
      expect(isOk(result)).toBe(false);
    });

    it('should narrow the type correctly', () => {
      const result: Result<number, string> = Ok(42);
      if (isOk(result)) {
        // TypeScript should know result.value is number here
        const value: number = result.value;
        expect(value).toBe(42);
      }
    });
  });

  describe('isErr', () => {
    it('should return false for Ok results', () => {
      const result = Ok(42);
      expect(isErr(result)).toBe(false);
    });

    it('should return true for Err results', () => {
      const result = Err('error');
      expect(isErr(result)).toBe(true);
    });

    it('should narrow the type correctly', () => {
      const result: Result<number, string> = Err('failed');
      if (isErr(result)) {
        // TypeScript should know result.error is string here
        const error: string = result.error;
        expect(error).toBe('failed');
      }
    });
  });

  describe('unwrap', () => {
    it('should return the value for Ok results', () => {
      const result = Ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it('should throw for Err results', () => {
      const result = Err('error');
      expect(() => unwrap(result)).toThrow('error');
    });
  });

  describe('unwrapOr', () => {
    it('should return the value for Ok results', () => {
      const result = Ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('should return the default value for Err results', () => {
      const result = Err('error');
      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('Real-world usage patterns', () => {
    function divide(a: number, b: number): Result<number, string> {
      if (b === 0) {
        return Err('Division by zero');
      }
      return Ok(a / b);
    }

    it('should handle successful operations', () => {
      const result = divide(10, 2);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(5);
      }
    });

    it('should handle failed operations', () => {
      const result = divide(10, 0);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe('Division by zero');
      }
    });

    it('should work with async functions', async () => {
      async function asyncDivide(a: number, b: number): Promise<Result<number, string>> {
        if (b === 0) {
          return Err('Division by zero');
        }
        return Ok(a / b);
      }

      const result = await asyncDivide(10, 2);
      expect(isOk(result)).toBe(true);
    });
  });
});

