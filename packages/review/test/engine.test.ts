import { describe, it, expect, vi } from 'vitest';
import { ReviewEngine } from '../src/engine.js';
import { createTestContext } from '../src/test-helpers.js';
import type { ReviewPlugin, ReviewContext, ReviewFinding } from '../src/plugin-types.js';

function createTestPlugin(overrides?: Partial<ReviewPlugin>): ReviewPlugin {
  return {
    id: 'test',
    name: 'Test Plugin',
    description: 'A test plugin',
    shouldActivate: () => true,
    analyze: () => [],
    ...overrides,
  };
}

describe('ReviewEngine', () => {
  it('registers and runs a plugin', async () => {
    const engine = new ReviewEngine();
    const finding: ReviewFinding = {
      pluginId: 'test',
      filepath: 'test.ts',
      line: 1,
      severity: 'warning',
      category: 'test',
      message: 'Test finding',
    };

    engine.register(
      createTestPlugin({
        analyze: () => [finding],
      }),
    );

    const results = await engine.run(createTestContext());
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(finding);
  });

  it('rejects duplicate plugin IDs', () => {
    const engine = new ReviewEngine();
    engine.register(createTestPlugin({ id: 'a' }));
    expect(() => engine.register(createTestPlugin({ id: 'a' }))).toThrow(
      'Plugin "a" is already registered',
    );
  });

  it('skips plugins where shouldActivate returns false', async () => {
    const engine = new ReviewEngine();
    const analyze = vi.fn().mockReturnValue([]);
    engine.register(createTestPlugin({ shouldActivate: () => false, analyze }));

    const results = await engine.run(createTestContext());
    expect(results).toHaveLength(0);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('skips plugins that require LLM when no LLM is available', async () => {
    const engine = new ReviewEngine({ verbose: true });
    const analyze = vi.fn().mockReturnValue([]);
    engine.register(createTestPlugin({ requiresLLM: true, analyze }));

    const results = await engine.run(createTestContext());
    expect(results).toHaveLength(0);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('continues when a plugin throws', async () => {
    const engine = new ReviewEngine();
    const finding: ReviewFinding = {
      pluginId: 'good',
      filepath: 'test.ts',
      line: 1,
      severity: 'info',
      category: 'test',
      message: 'Good finding',
    };

    engine.register(
      createTestPlugin({
        id: 'bad',
        analyze: () => {
          throw new Error('plugin exploded');
        },
      }),
    );
    engine.register(
      createTestPlugin({
        id: 'good',
        analyze: () => [finding],
      }),
    );

    const results = await engine.run(createTestContext());
    expect(results).toHaveLength(1);
    expect(results[0].pluginId).toBe('good');
  });

  it('filters by plugin ID when pluginFilter is set', async () => {
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        id: 'alpha',
        analyze: () => [
          {
            pluginId: 'alpha',
            filepath: 'a.ts',
            line: 1,
            severity: 'info',
            category: 'a',
            message: 'A',
          },
        ],
      }),
    );
    engine.register(
      createTestPlugin({
        id: 'beta',
        analyze: () => [
          {
            pluginId: 'beta',
            filepath: 'b.ts',
            line: 1,
            severity: 'info',
            category: 'b',
            message: 'B',
          },
        ],
      }),
    );

    const results = await engine.run(createTestContext(), 'alpha');
    expect(results).toHaveLength(1);
    expect(results[0].pluginId).toBe('alpha');
  });

  it('returns empty for unknown plugin filter', async () => {
    const engine = new ReviewEngine();
    engine.register(createTestPlugin({ id: 'alpha' }));

    const results = await engine.run(createTestContext(), 'unknown');
    expect(results).toHaveLength(0);
  });

  it('returns all registered plugin IDs', () => {
    const engine = new ReviewEngine();
    engine.register(createTestPlugin({ id: 'a' }));
    engine.register(createTestPlugin({ id: 'b' }));
    expect(engine.getPluginIds()).toEqual(['a', 'b']);
  });

  it('collects findings from multiple plugins', async () => {
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        id: 'one',
        analyze: () => [
          {
            pluginId: 'one',
            filepath: 'a.ts',
            line: 1,
            severity: 'warning',
            category: 'c1',
            message: 'F1',
          },
        ],
      }),
    );
    engine.register(
      createTestPlugin({
        id: 'two',
        analyze: () => [
          {
            pluginId: 'two',
            filepath: 'b.ts',
            line: 2,
            severity: 'error',
            category: 'c2',
            message: 'F2',
          },
          {
            pluginId: 'two',
            filepath: 'b.ts',
            line: 3,
            severity: 'info',
            category: 'c3',
            message: 'F3',
          },
        ],
      }),
    );

    const results = await engine.run(createTestContext());
    expect(results).toHaveLength(3);
  });
});
