import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { readInputs } from '../src/inputs.js';

// readInputs() reads INPUT_* from process.env (the way GitHub injects `with:`).
// Snapshot and clear those keys around each test so cases don't leak into each other.
const INPUT_KEYS = [
  'INPUT_GITHUB-TOKEN',
  'INPUT_THRESHOLD',
  'INPUT_REVIEW-TYPES',
  'INPUT_FAIL-ON',
  'INPUT_BLOCK-ON-NEW-ERRORS',
  'INPUT_OPENROUTER-API-KEY',
  'INPUT_ANTHROPIC-API-KEY',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of INPUT_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // A token is always required; default it so individual tests can focus elsewhere.
  process.env['INPUT_GITHUB-TOKEN'] = 'ghs_token';
});

afterEach(() => {
  for (const k of INPUT_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('readInputs — defaults', () => {
  it('applies sensible defaults when only the token is set', () => {
    const inputs = readInputs();
    expect(inputs.threshold).toBe('15');
    expect(inputs.failOn).toBe('error');
    expect(inputs.blockOnNewErrors).toBe(false);
    expect(inputs.reviewTypes).toEqual({
      complexity: true,
      bugs: true,
      summary: true,
      architectural: false,
    });
    expect(inputs.llm).toBeNull();
  });

  it('requires a github-token', () => {
    delete process.env['INPUT_GITHUB-TOKEN'];
    expect(() => readInputs()).toThrow(/github-token/);
  });
});

describe('readInputs — threshold validation (#2)', () => {
  it('accepts a positive integer', () => {
    process.env['INPUT_THRESHOLD'] = '25';
    expect(readInputs().threshold).toBe('25');
  });

  it('rejects a non-numeric threshold', () => {
    process.env['INPUT_THRESHOLD'] = 'high';
    expect(() => readInputs()).toThrow(/threshold/);
  });

  it('rejects zero and negative thresholds', () => {
    process.env['INPUT_THRESHOLD'] = '0';
    expect(() => readInputs()).toThrow(/threshold/);
    process.env['INPUT_THRESHOLD'] = '-5';
    expect(() => readInputs()).toThrow(/threshold/);
  });
});

describe('readInputs — review-types validation (#1)', () => {
  it('parses a valid subset', () => {
    process.env['INPUT_REVIEW-TYPES'] = 'complexity, summary';
    expect(readInputs().reviewTypes).toEqual({
      complexity: true,
      bugs: false,
      summary: true,
      architectural: false,
    });
  });

  it('rejects an unknown type (e.g. a typo) instead of silently running nothing', () => {
    process.env['INPUT_REVIEW-TYPES'] = 'summmary';
    expect(() => readInputs()).toThrow(/review-types/);
  });

  it('rejects an effectively-empty value', () => {
    process.env['INPUT_REVIEW-TYPES'] = ',';
    expect(() => readInputs()).toThrow(/review-types/);
  });
});

describe('readInputs — LLM resolution', () => {
  it('prefers OpenRouter when its key is present', () => {
    process.env['INPUT_OPENROUTER-API-KEY'] = 'or_key';
    const llm = readInputs().llm;
    expect(llm?.provider).toBe('openai');
    expect(llm && 'baseUrl' in llm ? llm.baseUrl : '').toContain('openrouter.ai');
  });

  it('falls back to Anthropic when only its key is present', () => {
    process.env['INPUT_ANTHROPIC-API-KEY'] = 'sk_key';
    expect(readInputs().llm?.provider).toBe('anthropic');
  });
});
