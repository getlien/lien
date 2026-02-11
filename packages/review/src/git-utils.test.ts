import { describe, it, expect } from 'vitest';
import { assertValidSha } from './git-utils.js';

describe('assertValidSha', () => {
  it('accepts a valid 40-char SHA', () => {
    expect(() => assertValidSha('a'.repeat(40), 'test')).not.toThrow();
    expect(() =>
      assertValidSha('abc123def456abc123def456abc123def456abc1', 'test'),
    ).not.toThrow();
  });

  it('accepts a valid 7-char short SHA', () => {
    expect(() => assertValidSha('abc1234', 'test')).not.toThrow();
  });

  it('accepts uppercase hex', () => {
    expect(() => assertValidSha('ABCDEF1234567', 'test')).not.toThrow();
    expect(() => assertValidSha('A'.repeat(40), 'test')).not.toThrow();
  });

  it('rejects shell metacharacters', () => {
    expect(() => assertValidSha('abc123; rm -rf /', 'baseSha')).toThrow(
      'Invalid baseSha',
    );
  });

  it('rejects backticks', () => {
    expect(() => assertValidSha('abc123`whoami`', 'baseSha')).toThrow(
      'Invalid baseSha',
    );
  });

  it('rejects pipes', () => {
    expect(() => assertValidSha('abc123|cat /etc/passwd', 'baseSha')).toThrow(
      'Invalid baseSha',
    );
  });

  it('rejects $() patterns', () => {
    expect(() => assertValidSha('$(malicious)', 'baseSha')).toThrow(
      'Invalid baseSha',
    );
  });

  it('rejects empty string', () => {
    expect(() => assertValidSha('', 'baseSha')).toThrow('Invalid baseSha');
  });

  it('rejects too-short input (<7 chars)', () => {
    expect(() => assertValidSha('abc12', 'baseSha')).toThrow(
      'Invalid baseSha',
    );
    expect(() => assertValidSha('abcdef', 'baseSha')).toThrow(
      'Invalid baseSha',
    );
  });

  it('rejects too-long input (>40 chars)', () => {
    expect(() => assertValidSha('a'.repeat(41), 'baseSha')).toThrow(
      'Invalid baseSha',
    );
  });

  it('includes the label in error message', () => {
    expect(() => assertValidSha('bad!', 'myLabel')).toThrow(
      'Invalid myLabel: must be a 7-40 character hex string, got "bad!"',
    );
  });
});
