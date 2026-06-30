import { describe, it, expect } from 'vitest';
import { formatChatTimeout } from '../src/plugins/agent/openai-client.js';

describe('formatChatTimeout', () => {
  it('reports elapsed vs limit, phase, byte/token size, and message count', () => {
    const msg = formatChatTimeout({
      elapsedMs: 120013,
      limitMs: 120000,
      phase: 'body read',
      bodyBytes: 84232,
      messageCount: 9,
    });
    expect(msg).toContain('timed out after 120013ms');
    expect(msg).toContain('limit 120000ms');
    expect(msg).toContain('during body read');
    expect(msg).toContain('84232 bytes');
    expect(msg).toContain('~21058 input tokens'); // 84232 / 4
    expect(msg).toContain('across 9 message(s)');
  });

  it('distinguishes a hang before the response headers from a body-stream hang', () => {
    const msg = formatChatTimeout({
      elapsedMs: 4200,
      limitMs: 120000,
      phase: 'connection/headers',
      bodyBytes: 400,
      messageCount: 2,
    });
    expect(msg).toContain('during connection/headers');
    expect(msg).toContain('~100 input tokens'); // 400 / 4
  });

  it('does not emit NaN/Infinity token counts for a non-finite body size', () => {
    const msg = formatChatTimeout({
      elapsedMs: 1,
      limitMs: 2,
      phase: 'body read',
      bodyBytes: Number.NaN,
      messageCount: 1,
    });
    expect(msg).toContain('~0 input tokens');
  });
});
