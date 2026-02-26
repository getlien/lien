import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ReviewEngine } from '../src/engine.js';
import { createTestContext, silentLogger } from '../src/test-helpers.js';
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

  // ---------------------------------------------------------------------------
  // Config Resolution (resolvePluginConfig tested indirectly via run)
  // ---------------------------------------------------------------------------

  it('merges plugin defaults with user config from pluginConfigs', async () => {
    const engine = new ReviewEngine();
    let receivedConfig: Record<string, unknown> = {};

    engine.register(
      createTestPlugin({
        id: 'cfg',
        defaultConfig: { threshold: 15, mode: 'auto' },
        analyze: (ctx: ReviewContext) => {
          receivedConfig = ctx.config;
          return [];
        },
      }),
    );

    await engine.run(
      createTestContext({
        pluginConfigs: { cfg: { threshold: 25 } },
      }),
    );

    expect(receivedConfig).toEqual({ threshold: 25, mode: 'auto' });
  });

  it('user config overrides plugin defaults', async () => {
    const engine = new ReviewEngine();
    let receivedConfig: Record<string, unknown> = {};

    engine.register(
      createTestPlugin({
        id: 'cfg',
        defaultConfig: { a: 1, b: 2 },
        analyze: (ctx: ReviewContext) => {
          receivedConfig = ctx.config;
          return [];
        },
      }),
    );

    await engine.run(
      createTestContext({
        pluginConfigs: { cfg: { a: 99 } },
      }),
    );

    expect(receivedConfig.a).toBe(99);
    expect(receivedConfig.b).toBe(2);
  });

  it('validates merged config against plugin Zod schema', async () => {
    const engine = new ReviewEngine();
    let receivedConfig: Record<string, unknown> = {};
    const schema = z.object({
      threshold: z.number().min(0).max(100),
      mode: z.enum(['auto', 'always', 'off']).default('auto'),
    });

    engine.register(
      createTestPlugin({
        id: 'cfg',
        configSchema: schema,
        defaultConfig: { threshold: 15, mode: 'auto' },
        analyze: (ctx: ReviewContext) => {
          receivedConfig = ctx.config;
          return [];
        },
      }),
    );

    await engine.run(
      createTestContext({
        pluginConfigs: { cfg: { threshold: 50, mode: 'always' } },
      }),
    );

    expect(receivedConfig).toEqual({ threshold: 50, mode: 'always' });
  });

  it('falls back to defaults when merged config fails Zod validation', async () => {
    const engine = new ReviewEngine();
    let receivedConfig: Record<string, unknown> = {};
    const schema = z.object({
      threshold: z.number().min(0),
    });

    engine.register(
      createTestPlugin({
        id: 'cfg',
        configSchema: schema,
        defaultConfig: { threshold: 15 },
        analyze: (ctx: ReviewContext) => {
          receivedConfig = ctx.config;
          return [];
        },
      }),
    );

    // Invalid: threshold should be a number, not a string
    await engine.run(
      createTestContext({
        pluginConfigs: { cfg: { threshold: 'not-a-number' } },
      }),
    );

    expect(receivedConfig).toEqual({ threshold: 15 });
  });

  it('logs warning when config validation fails', async () => {
    const engine = new ReviewEngine();
    const warnings: string[] = [];
    const logger = { ...silentLogger, warning: (msg: string) => warnings.push(msg) };
    const schema = z.object({ threshold: z.number() });

    engine.register(
      createTestPlugin({
        id: 'cfg',
        configSchema: schema,
        defaultConfig: { threshold: 15 },
        analyze: () => [],
      }),
    );

    await engine.run(
      createTestContext({
        pluginConfigs: { cfg: { threshold: 'invalid' } },
        logger,
      }),
    );

    expect(warnings.some(w => w.includes('Invalid config for plugin "cfg"'))).toBe(true);
  });

  it('passes empty config when no defaults and no user config', async () => {
    const engine = new ReviewEngine();
    let receivedConfig: Record<string, unknown> = {};

    engine.register(
      createTestPlugin({
        id: 'cfg',
        // No defaultConfig, no configSchema
        analyze: (ctx: ReviewContext) => {
          receivedConfig = ctx.config;
          return [];
        },
      }),
    );

    await engine.run(createTestContext());
    expect(receivedConfig).toEqual({});
  });

  it('plugin receives resolved config via context.config', async () => {
    const engine = new ReviewEngine();
    const schema = z.object({
      categories: z.array(z.string()).default(['a', 'b']),
    });
    let receivedConfig: Record<string, unknown> = {};

    engine.register(
      createTestPlugin({
        id: 'cfg',
        configSchema: schema,
        defaultConfig: { categories: ['a', 'b'] },
        analyze: (ctx: ReviewContext) => {
          receivedConfig = ctx.config;
          return [];
        },
      }),
    );

    await engine.run(
      createTestContext({
        pluginConfigs: { cfg: { categories: ['x', 'y', 'z'] } },
      }),
    );

    expect(receivedConfig).toEqual({ categories: ['x', 'y', 'z'] });
  });

  it('supports async shouldActivate', async () => {
    const engine = new ReviewEngine();
    const analyze = vi.fn().mockReturnValue([]);

    engine.register(
      createTestPlugin({
        shouldActivate: async () => {
          return true;
        },
        analyze,
      }),
    );

    await engine.run(createTestContext());
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
