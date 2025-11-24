import { describe, it, expect } from 'vitest';
import { chunkFile, chunkText } from './chunker.js';

describe('chunkFile', () => {
  it('should split code into chunks of specified size', () => {
    const code = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkFile('test.ts', code, { chunkSize: 3, chunkOverlap: 1, useAST: false });

    // With 10 lines, chunkSize=3, overlap=1:
    // Chunk 1: lines 1-3, Chunk 2: lines 3-5, Chunk 3: lines 5-7, 
    // Chunk 4: lines 7-9, Chunk 5: lines 9-10 = 5 chunks
    expect(chunks).toHaveLength(5);
    expect(chunks[0].content).toContain('line 1');
    expect(chunks[0].content).toContain('line 3');
  });

  it('should handle overlap correctly', () => {
    const code = 'line1\nline2\nline3\nline4\nline5';
    const chunks = chunkFile('test.ts', code, { chunkSize: 3, chunkOverlap: 1, useAST: false });

    expect(chunks).toHaveLength(2);
    // First chunk: lines 1-3
    expect(chunks[0].content).toContain('line1');
    expect(chunks[0].content).toContain('line3');
    // Second chunk starts at line 3 (overlap of 1)
    expect(chunks[1].content).toContain('line3');
    expect(chunks[1].content).toContain('line5');
  });

  it('should generate correct metadata for each chunk', () => {
    const code = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkFile('test.ts', code, { chunkSize: 5, chunkOverlap: 0, useAST: false });

    expect(chunks[0].metadata.file).toBe('test.ts');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(5);
    expect(chunks[0].metadata.language).toBe('typescript');
    expect(chunks[0].metadata.type).toBe('block');

    expect(chunks[1].metadata.startLine).toBe(6);
    expect(chunks[1].metadata.endLine).toBe(10);
  });

  it('should handle empty files', () => {
    const chunks = chunkFile('test.ts', '', { chunkSize: 10, chunkOverlap: 2 });
    expect(chunks).toHaveLength(0);
  });

  it('should handle files with single line', () => {
    const chunks = chunkFile('test.ts', 'const x = 1;', { chunkSize: 10, chunkOverlap: 2 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('const x = 1;');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(1);
  });

  it('should skip whitespace-only chunks', () => {
    const code = 'line1\n\n\n\nline2';
    const chunks = chunkFile('test.ts', code, { chunkSize: 2, chunkOverlap: 0 });

    // Should have chunks for non-empty sections
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach(chunk => {
      expect(chunk.content.trim()).not.toBe('');
    });
  });

  it('should detect language from file extension', () => {
    const code = 'const x = 1;';
    const tsChunks = chunkFile('test.ts', code);
    const jsChunks = chunkFile('test.js', code);
    const pyChunks = chunkFile('test.py', code);

    expect(tsChunks[0].metadata.language).toBe('typescript');
    expect(jsChunks[0].metadata.language).toBe('javascript');
    expect(pyChunks[0].metadata.language).toBe('python');
  });

  it('should use default chunk size and overlap', () => {
    const code = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkFile('test.ts', code, { useAST: false });

    // Default chunkSize is 75, chunkOverlap is 10
    expect(chunks[0].metadata.endLine).toBe(75);
    expect(chunks[1].metadata.startLine).toBe(66); // 75 - 10 + 1
  });

  it('should handle files smaller than chunk size', () => {
    const code = 'line1\nline2\nline3';
    const chunks = chunkFile('test.ts', code, { chunkSize: 100, chunkOverlap: 10, useAST: false });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(code);
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(3);
  });
});

describe('chunkText', () => {
  it('should split text into chunks of specified size', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkText(text, { chunkSize: 3, chunkOverlap: 1 });

    // With 10 lines, chunkSize=3, overlap=1:
    // Chunk 1: lines 1-3, Chunk 2: lines 3-5, Chunk 3: lines 5-7, 
    // Chunk 4: lines 7-9, Chunk 5: lines 9-10 = 5 chunks
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toContain('line 1');
    expect(chunks[0]).toContain('line 3');
  });

  it('should handle overlap in text chunks', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const chunks = chunkText(text, { chunkSize: 3, chunkOverlap: 1 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('line3');
    expect(chunks[1]).toContain('line3'); // Overlap
  });

  it('should handle empty text', () => {
    const chunks = chunkText('');
    expect(chunks).toHaveLength(0);
  });

  it('should skip whitespace-only chunks in text', () => {
    const text = 'line1\n\n\n\nline2';
    const chunks = chunkText(text, { chunkSize: 2, chunkOverlap: 0 });

    chunks.forEach(chunk => {
      expect(chunk.trim()).not.toBe('');
    });
  });

  it('should use default options', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkText(text);

    // Default chunkSize is 75, should have at least 2 chunks
    expect(chunks.length).toBeGreaterThan(1);
  });
});

