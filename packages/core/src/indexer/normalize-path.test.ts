import { describe, it, expect } from 'vitest';
import { normalizeToRelativePath } from './incremental.js';

describe('normalizeToRelativePath', () => {
  it('strips the root prefix when filepath is under root', () => {
    expect(normalizeToRelativePath('/app/src/main.ts', '/app')).toBe('src/main.ts');
  });

  it('returns the input when filepath is already relative', () => {
    expect(normalizeToRelativePath('src/main.ts', '/app')).toBe('src/main.ts');
  });

  it('handles trailing slash on root', () => {
    expect(normalizeToRelativePath('/app/src/main.ts', '/app/')).toBe('src/main.ts');
  });

  it('does NOT falsely prefix-match a sibling directory', () => {
    // Regression for the Lien Review finding: previously '/apple/main.ts' was
    // sliced as 'le/main.ts' because startsWith('/app') matched without
    // requiring a trailing separator.
    expect(normalizeToRelativePath('/apple/main.ts', '/app')).toBe('../apple/main.ts');
  });

  it('returns a relative-up path when filepath is outside root', () => {
    expect(normalizeToRelativePath('/elsewhere/file.ts', '/app')).toBe('../elsewhere/file.ts');
  });

  it('normalizes Windows-style separators in input', () => {
    expect(normalizeToRelativePath('/app\\src\\main.ts', '/app')).toBe('src/main.ts');
  });
});
