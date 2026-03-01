import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadConfig,
  loadPlugin,
  loadPlugins,
  resolveLLMApiKey,
  getPluginConfig,
} from '../src/config.js';
import type { ReviewYamlConfig } from '../src/config.js';

// Mock fs for loadConfig tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

describe('loadConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('');
  });

  it('returns defaults when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig('/fake/root');
    expect(config.plugins).toEqual(['complexity', 'architectural', 'summary']);
    expect(config.llm.provider).toBe('openrouter');
    expect(config.llm.model).toBe('minimax/minimax-m2.5');
    expect(config.settings).toEqual({});
  });

  it('returns defaults when config file contains empty/non-object YAML', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('null');
    const config = loadConfig('/fake/root');
    expect(config.plugins).toEqual(['complexity', 'architectural', 'summary']);
  });

  it('parses valid YAML config with string plugin list', () => {
    const yaml = `
plugins:
  - complexity
  - architectural
llm:
  provider: openrouter
  model: test-model
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(yaml);

    const config = loadConfig('/fake/root');
    expect(config.plugins).toEqual(['complexity', 'architectural']);
    expect(config.llm.model).toBe('test-model');
  });

  it('normalizes object plugin entries with config', () => {
    const yaml = `
plugins:
  - complexity:
      threshold: 20
  - architectural
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(yaml);

    const config = loadConfig('/fake/root');
    expect(config.plugins).toEqual(['complexity', 'architectural']);
    expect(config.settings.complexity).toEqual({ threshold: 20 });
  });

  it('extracts per-plugin settings from object entries', () => {
    const yaml = `
plugins:
  - complexity:
      threshold: 25
      blockOnNewErrors: true
  - architectural:
      mode: always
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(yaml);

    const config = loadConfig('/fake/root');
    expect(config.settings.complexity).toEqual({ threshold: 25, blockOnNewErrors: true });
    expect(config.settings.architectural).toEqual({ mode: 'always' });
  });

  it('interpolates ${VAR} from environment variables', () => {
    const original = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = 'secret-key-123';

    try {
      const yaml = `
plugins:
  - complexity
llm:
  provider: openrouter
  model: test-model
  apiKey: \${TEST_API_KEY}
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml);

      const config = loadConfig('/fake/root');
      expect(config.llm.apiKey).toBe('secret-key-123');
    } finally {
      if (original === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = original;
      }
    }
  });

  it('replaces unset env vars with empty string', () => {
    const original = process.env.NONEXISTENT_VAR_XYZ;
    delete process.env.NONEXISTENT_VAR_XYZ;

    try {
      const yaml = `
plugins:
  - complexity
llm:
  apiKey: \${NONEXISTENT_VAR_XYZ}
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml);

      const config = loadConfig('/fake/root');
      expect(config.llm.apiKey).toBe('');
    } finally {
      if (original !== undefined) {
        process.env.NONEXISTENT_VAR_XYZ = original;
      }
    }
  });

  it('deep-interpolates nested config objects', () => {
    const original = process.env.NESTED_VAR;
    process.env.NESTED_VAR = 'nested-value';

    try {
      const yaml = `
plugins:
  - complexity:
      customKey: \${NESTED_VAR}
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml);

      const config = loadConfig('/fake/root');
      expect(config.settings.complexity?.customKey).toBe('nested-value');
    } finally {
      if (original === undefined) {
        delete process.env.NESTED_VAR;
      } else {
        process.env.NESTED_VAR = original;
      }
    }
  });

  it('throws on invalid config with detailed error', () => {
    const yaml = `
plugins: "not-an-array"
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(yaml);

    expect(() => loadConfig('/fake/root')).toThrow('Invalid config');
  });

  it('throws on unparseable YAML', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => loadConfig('/fake/root')).toThrow('Failed to parse');
  });

  it('resolves config path correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    loadConfig('/my/project');

    expect(fs.existsSync).toHaveBeenCalledWith(path.join('/my/project', '.lien', 'review.yml'));
  });

  it('handles string plugin entries alongside object entries', () => {
    const yaml = `
plugins:
  - complexity
  - architectural:
      mode: always
`;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(yaml);

    const config = loadConfig('/fake/root');
    expect(config.plugins).toEqual(['complexity', 'architectural']);
    expect(config.settings.architectural).toEqual({ mode: 'always' });
    expect(config.settings.complexity).toBeUndefined();
  });
});

describe('loadPlugin', () => {
  it('loads built-in "complexity" plugin', async () => {
    const plugin = await loadPlugin('complexity');
    expect(plugin.id).toBe('complexity');
    expect(typeof plugin.analyze).toBe('function');
    expect(typeof plugin.shouldActivate).toBe('function');
  });

  it('loads built-in "architectural" plugin', async () => {
    const plugin = await loadPlugin('architectural');
    expect(plugin.id).toBe('architectural');
    expect(typeof plugin.analyze).toBe('function');
  });

  it('throws for unknown npm plugin', async () => {
    await expect(loadPlugin('@nonexistent/lien-plugin-xyz')).rejects.toThrow(
      'Failed to load plugin "@nonexistent/lien-plugin-xyz"',
    );
  });
});

describe('loadPlugins', () => {
  it('loads multiple built-in plugins', async () => {
    const config: ReviewYamlConfig = {
      plugins: ['complexity', 'architectural'],
      llm: { provider: 'openrouter', model: 'test' },
      settings: {},
    };
    const plugins = await loadPlugins(config);
    expect(plugins).toHaveLength(2);
    expect(plugins[0].id).toBe('complexity');
    expect(plugins[1].id).toBe('architectural');
  });

  it('rejects duplicate plugin IDs', async () => {
    const config: ReviewYamlConfig = {
      plugins: ['complexity', 'complexity'],
      llm: { provider: 'openrouter', model: 'test' },
      settings: {},
    };
    await expect(loadPlugins(config)).rejects.toThrow('Duplicate plugin ID "complexity"');
  });
});

describe('resolveLLMApiKey', () => {
  it('returns config apiKey when present', () => {
    const config: ReviewYamlConfig = {
      plugins: [],
      llm: { provider: 'openrouter', model: 'test', apiKey: 'from-config' },
      settings: {},
    };
    expect(resolveLLMApiKey(config)).toBe('from-config');
  });

  it('falls back to OPENROUTER_API_KEY env var', () => {
    const original = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'from-env';

    try {
      const config: ReviewYamlConfig = {
        plugins: [],
        llm: { provider: 'openrouter', model: 'test' },
        settings: {},
      };
      expect(resolveLLMApiKey(config)).toBe('from-env');
    } finally {
      if (original === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = original;
      }
    }
  });

  it('returns undefined when no key available', () => {
    const original = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const config: ReviewYamlConfig = {
        plugins: [],
        llm: { provider: 'openrouter', model: 'test' },
        settings: {},
      };
      expect(resolveLLMApiKey(config)).toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.OPENROUTER_API_KEY = original;
      }
    }
  });
});

describe('getPluginConfig', () => {
  it('returns settings for known plugin', () => {
    const config: ReviewYamlConfig = {
      plugins: ['complexity'],
      llm: { provider: 'openrouter', model: 'test' },
      settings: { complexity: { threshold: 20 } },
    };
    expect(getPluginConfig(config, 'complexity')).toEqual({ threshold: 20 });
  });

  it('returns empty object for unknown plugin', () => {
    const config: ReviewYamlConfig = {
      plugins: [],
      llm: { provider: 'openrouter', model: 'test' },
      settings: {},
    };
    expect(getPluginConfig(config, 'nonexistent')).toEqual({});
  });
});
