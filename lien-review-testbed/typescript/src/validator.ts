/**
 * Input validation and sanitization utilities.
 * Used across the API to validate request bodies and sanitize user input.
 */

import type { ValidationResult, ValidationRule } from './types.js';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const HTML_TAG_REGEX = /<\/?[^>]+(>|$)/g;
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const EVENT_HANDLER_REGEX = /\s*on\w+\s*=\s*"[^"]*"/gi;

/**
 * Validates an email address against RFC 5322 simplified pattern.
 * Checks for basic format: local-part@domain.tld with reasonable
 * character constraints. Does not perform DNS or MX record validation.
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const trimmed = email.trim();

  if (trimmed.length === 0 || trimmed.length > 254) {
    return false;
  }

  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return false;

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  if (localPart.length === 0 || localPart.length > 64) {
    return false;
  }

  if (domainPart.length === 0 || domainPart.length > 253) {
    return false;
  }

  return EMAIL_REGEX.test(trimmed);
}

export class ValidationError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Validates a data object against a set of validation rules.
 * Returns a ValidationResult with `valid: true` if all rules pass,
 * or throws a ValidationError if any rules fail.
 *
 * Supports required checks, type checks, and string length constraints.
 */
export function validateInput(
  data: Record<string, unknown>,
  rules: ValidationRule[],
): ValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`Field "${rule.field}" is required`);
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (rule.type === 'email') {
      if (typeof value !== 'string' || !validateEmail(value)) {
        errors.push(`Field "${rule.field}" must be a valid email address`);
      }
      continue;
    }

    if (rule.type && typeof value !== rule.type) {
      errors.push(`Field "${rule.field}" must be of type ${rule.type}`);
      continue;
    }

    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(`Field "${rule.field}" must be at least ${rule.minLength} characters`);
      }

      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(`Field "${rule.field}" must be at most ${rule.maxLength} characters`);
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return {
    valid: true,
    errors: [],
  };
}

/**
 * Sanitizes a string by removing HTML tags, script blocks,
 * and inline event handlers. Trims whitespace and collapses
 * multiple consecutive spaces into a single space.
 *
 * Use this on any user-provided text before storing or rendering.
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input;

  sanitized = sanitized.replace(SCRIPT_REGEX, '');
  sanitized = sanitized.replace(EVENT_HANDLER_REGEX, '');
  sanitized = sanitized.replace(HTML_TAG_REGEX, '');

  sanitized = sanitized.replace(/&lt;/g, '<');
  sanitized = sanitized.replace(/&gt;/g, '>');
  sanitized = sanitized.replace(/&amp;/g, '&');
  sanitized = sanitized.replace(/&quot;/g, '"');
  sanitized = sanitized.replace(/&#x27;/g, "'");

  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}
