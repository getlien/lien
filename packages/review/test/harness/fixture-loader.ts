/**
 * Fixture loader / saver for the agent-review test harness.
 *
 * A fixture is a JSON serialization of a ReviewContext, captured either
 * by hand or by the runner's LIEN_REVIEW_CAPTURE_CTX env mode (engine.ts).
 * Map and Set are encoded as tagged objects so JSON round-trips preserve them:
 *   Map  -> { __type: 'Map', entries: [[k, v], ...] }
 *   Set  -> { __type: 'Set', values: [...] }
 */

import { promises as fs } from 'node:fs';
import { z } from 'zod';

import type { ReviewContext } from '../../src/plugin-types.js';

const TAG_MAP = '__type' as const;

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { [TAG_MAP]: 'Map', entries: [...value.entries()] };
  }
  if (value instanceof Set) {
    return { [TAG_MAP]: 'Set', values: [...value.values()] };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && TAG_MAP in value) {
    const tagged = value as { [TAG_MAP]: string; entries?: unknown[]; values?: unknown[] };
    if (tagged[TAG_MAP] === 'Map' && Array.isArray(tagged.entries)) {
      return new Map(tagged.entries as [unknown, unknown][]);
    }
    if (tagged[TAG_MAP] === 'Set' && Array.isArray(tagged.values)) {
      return new Set(tagged.values);
    }
  }
  return value;
}

/**
 * Loose schema for fixtures. Not the full ReviewContext — just enough fields
 * to fail fast with a clear error when a fixture is malformed, instead of
 * crashing inside AgentReviewPlugin.analyze().
 */
const FixtureShape = z.object({
  chunks: z.array(z.unknown()),
  changedFiles: z.array(z.string()),
  pluginConfigs: z.record(z.unknown()),
  config: z.record(z.unknown()),
  // pr is optional but recommended — without it the diff text is empty and
  // many rules won't trigger
  pr: z.unknown().optional(),
  // repoChunks is required for the agent plugin (requiresRepoChunks=true)
  repoChunks: z.array(z.unknown()).optional(),
  repoRootDir: z.string().optional(),
});

export type LoadedFixture = ReviewContext;

export async function loadFixture(path: string): Promise<LoadedFixture> {
  const raw = await fs.readFile(path, 'utf8');
  const parsed = JSON.parse(raw, reviver);
  const validation = FixtureShape.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      `Fixture ${path} failed schema validation:\n${validation.error.errors
        .map(e => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return parsed as LoadedFixture;
}

export async function saveFixture(ctx: unknown, path: string): Promise<void> {
  const json = JSON.stringify(ctx, replacer, 2);
  await fs.writeFile(path, json);
}

/** Stable JSON replacer / reviver pair, exported for engine.ts capture mode. */
export { replacer as fixtureReplacer, reviver as fixtureReviver };
