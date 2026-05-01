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
 * Schema for fixtures. Covers every replay field the agent plugin reads,
 * so a malformed fixture fails fast with a clear error here instead of
 * crashing deeper inside AgentReviewPlugin.analyze() or its tools.
 *
 * Inner shapes use `z.unknown()` because the corresponding TS interfaces
 * (CodeChunk, ComplexityReport, PRContext, ComplexityDelta) are large and
 * captured by capture-pr.ts / engine.ts — we trust the shape produced by
 * those code paths and only enforce the top-level keys + their primitive
 * types here.
 */
const FixtureShape = z.object({
  chunks: z.array(z.unknown()),
  changedFiles: z.array(z.string()),
  allChangedFiles: z.array(z.string()).optional(),
  // capture-pr.ts and engine.ts both populate complexityReport — even if the
  // changed files have no violations, the summary object is required.
  complexityReport: z.object({
    summary: z.object({
      filesAnalyzed: z.number(),
      totalViolations: z.number(),
      bySeverity: z.object({ error: z.number(), warning: z.number() }),
      avgComplexity: z.number(),
      maxComplexity: z.number(),
    }),
    files: z.record(z.unknown()),
  }),
  // baselineReport / deltas come from the runner's two-checkout analysis;
  // capture-pr.ts can't reproduce that locally so they're allowed to be null.
  baselineReport: z.unknown().nullable(),
  deltas: z.array(z.unknown()).nullable(),
  pluginConfigs: z.record(z.unknown()),
  config: z.record(z.unknown()),
  // pr is optional but most rules trigger via diff content, so a fixture
  // without a pr usually has no triggers firing — warn at the runner if so.
  pr: z.unknown().optional(),
  // The agent plugin sets requiresRepoChunks=true, so this should be present
  // for any fixture that drives the agent. The engine populates it lazily,
  // so we accept undefined and fail later in the runner if missing.
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
