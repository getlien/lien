import { describe, it, expect } from 'vitest';
import { extractJSONFromCodeBlock } from '../src/llm-client.js';

describe('extractJSONFromCodeBlock', () => {
  it('extracts JSON from a simple code block', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(extractJSONFromCodeBlock(input)).toBe('{"key": "value"}');
  });

  it('extracts JSON from a code block without json tag', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(extractJSONFromCodeBlock(input)).toBe('{"key": "value"}');
  });

  it('returns original content when no code block is present', () => {
    const input = '{"key": "value"}';
    expect(extractJSONFromCodeBlock(input)).toBe('{"key": "value"}');
  });

  it('stops at the first closing fence when multiple code blocks exist', () => {
    const input = [
      '```json',
      '{"comments": {"file.ts::10": "bad code"}}',
      '```',
      '',
      'Here is the suggested fix:',
      '```typescript',
      'const x = 1;',
      '```',
    ].join('\n');

    const result = extractJSONFromCodeBlock(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ comments: { 'file.ts::10': 'bad code' } });
  });

  it('trims whitespace from extracted content', () => {
    const input = '```json\n  {"key": "value"}  \n```';
    expect(extractJSONFromCodeBlock(input)).toBe('{"key": "value"}');
  });
});
