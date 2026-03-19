import { describe, it, expect } from 'vitest';
import { validateEmail, validateInput, sanitizeString } from '../validator.js';

describe('Validator', () => {
  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.org')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('not-an-email')).toBe(false);
      expect(validateEmail('@no-local.com')).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should strip HTML tags', () => {
      expect(sanitizeString('<b>bold</b>')).toBe('bold');
    });

    it('should remove script tags', () => {
      expect(sanitizeString('hello<script>alert(1)</script>world')).toBe('helloworld');
    });

    it('should trim whitespace', () => {
      expect(sanitizeString('  hello  world  ')).toBe('hello world');
    });
  });

  describe('validateInput', () => {
    it('should validate required fields', () => {
      const result = validateInput({}, [{ field: 'name', required: true, type: 'string' }]);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should pass valid input', () => {
      const result = validateInput(
        { name: 'Test' },
        [{ field: 'name', required: true, type: 'string' }],
      );
      expect(result.valid).toBe(true);
    });
  });
});
