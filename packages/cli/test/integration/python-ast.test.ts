import { describe, it, expect } from 'vitest';
import { chunkFile } from '@liendev/core';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Python AST Integration', () => {
  it('should chunk real Python file', async () => {
    const filepath = path.join(__dirname, '../fixtures/sample-code/sample.py');
    const content = await fs.readFile(filepath, 'utf-8');

    const chunks = await chunkFile(filepath, content, { useAST: true });

    // Should extract: calculate_sum, fetch_user, __init__, process, process_async
    expect(chunks.length).toBeGreaterThanOrEqual(5);

    // Verify function extraction
    const calcSum = chunks.find(c => c.metadata.symbolName === 'calculate_sum');
    expect(calcSum).toBeDefined();
    expect(calcSum?.metadata.symbolType).toBe('function');
    expect(calcSum?.metadata.parameters).toBeDefined();

    // Verify async function extraction
    const fetchUser = chunks.find(c => c.metadata.symbolName === 'fetch_user');
    expect(fetchUser).toBeDefined();
    expect(fetchUser?.metadata.symbolType).toBe('function');

    // Verify method extraction
    const processMethod = chunks.find(c => c.metadata.symbolName === 'process');
    expect(processMethod).toBeDefined();
    expect(processMethod?.metadata.symbolType).toBe('method');
    expect(processMethod?.metadata.parentClass).toBe('DataProcessor');

    // Verify __init__ method
    const initMethod = chunks.find(c => c.metadata.symbolName === '__init__');
    expect(initMethod).toBeDefined();
    expect(initMethod?.metadata.symbolType).toBe('method');
    expect(initMethod?.metadata.parentClass).toBe('DataProcessor');

    // Verify async method extraction
    const processAsync = chunks.find(c => c.metadata.symbolName === 'process_async');
    expect(processAsync).toBeDefined();
    expect(processAsync?.metadata.symbolType).toBe('method');
    expect(processAsync?.metadata.parentClass).toBe('DataProcessor');
  });

  it('should include imports in Python chunks', async () => {
    const filepath = path.join(__dirname, '../fixtures/sample-code/sample.py');
    const content = await fs.readFile(filepath, 'utf-8');

    const chunks = await chunkFile(filepath, content, { useAST: true });

    // All chunks should have imports
    const calcSum = chunks.find(c => c.metadata.symbolName === 'calculate_sum');
    expect(calcSum?.metadata.imports).toBeDefined();
    expect(calcSum?.metadata.imports?.length).toBeGreaterThan(0);

    // Check that imports include expected modules
    const hasOsImport = calcSum?.metadata.imports?.some(imp => imp.includes('os'));
    const hasTypingImport = calcSum?.metadata.imports?.some(imp => imp.includes('typing'));
    expect(hasOsImport || hasTypingImport).toBe(true);
  });

  it('should calculate complexity for Python functions', async () => {
    const filepath = path.join(__dirname, '../fixtures/sample-code/sample.py');
    const content = await fs.readFile(filepath, 'utf-8');

    const chunks = await chunkFile(filepath, content, { useAST: true });

    // All function chunks should have complexity
    const functionChunks = chunks.filter(
      c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
    );

    expect(functionChunks.length).toBeGreaterThan(0);

    for (const chunk of functionChunks) {
      expect(chunk.metadata.complexity).toBeDefined();
      expect(chunk.metadata.complexity).toBeGreaterThanOrEqual(1);
    }
  });

  it('should preserve line numbers correctly', async () => {
    const filepath = path.join(__dirname, '../fixtures/sample-code/sample.py');
    const content = await fs.readFile(filepath, 'utf-8');

    const chunks = await chunkFile(filepath, content, { useAST: true });

    // Check that line numbers are sequential and non-overlapping
    // Class chunks intentionally encompass their child method chunks, so exclude them
    const nonClassChunks = chunks.filter(c => c.metadata.symbolType !== 'class');
    const sortedChunks = [...nonClassChunks].sort(
      (a, b) => a.metadata.startLine - b.metadata.startLine,
    );

    for (let i = 0; i < sortedChunks.length - 1; i++) {
      const current = sortedChunks[i];
      const next = sortedChunks[i + 1];

      // Single-line functions/methods are valid (e.g., "def add(a, b): return a + b")
      expect(current.metadata.startLine).toBeLessThanOrEqual(current.metadata.endLine);

      // Chunks must not overlap - next chunk must start AFTER current ends
      // Using strict > ensures no two chunks share the same line
      expect(next.metadata.startLine).toBeGreaterThan(current.metadata.endLine);
    }
  });

  it('should extract signatures correctly', async () => {
    const filepath = path.join(__dirname, '../fixtures/sample-code/sample.py');
    const content = await fs.readFile(filepath, 'utf-8');

    const chunks = await chunkFile(filepath, content, { useAST: true });

    const calcSum = chunks.find(c => c.metadata.symbolName === 'calculate_sum');
    expect(calcSum?.metadata.signature).toBeDefined();
    expect(calcSum?.metadata.signature).toContain('calculate_sum');

    const processMethod = chunks.find(c => c.metadata.symbolName === 'process');
    expect(processMethod?.metadata.signature).toBeDefined();
    expect(processMethod?.metadata.signature).toContain('process');
  });
});
