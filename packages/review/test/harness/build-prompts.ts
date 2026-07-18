#!/usr/bin/env tsx
/**
 * CLI helper: load a fixture, build the same system+initial prompts the
 * agent plugin would use in production, emit them as JSON on stdout.
 *
 * Used by the CC iteration Skill to feed the exact prompt to a Claude
 * subagent, and by run.ts (OpenRouter mode) to keep one source of truth
 * for prompt assembly.
 *
 * Also emits the dedicated doc-truth SECOND pass's prompts (`docTruthPass`)
 * when `shouldRunDocTruthPass` gates it on for the fixture — `runner.ts`
 * exercises that pass for real (via `AgentReviewPlugin.analyze`), but CC
 * iteration mode and any offline byte-diff of prompt assembly need it
 * surfaced here too, since it is built by a separate function
 * (`buildDocTruthPassPrompts`) from the main pass's `buildInitialMessage`.
 *
 * Same for the stale-duplicate candidate-loop PILOT (`staleDuplicatePass`,
 * per-rule-loops design doc §4), the incomplete-handling candidate loop
 * (`incompleteHandlingPass`, design doc §7 item 5), and the removed-exports
 * candidate loop (`removedExportsPass`, ADR-014's gating matrix —
 * structural-analysis is hybrid) — all dark by default, so `fires` is false
 * unless the fixture's captured config (or the relevant env flag in the
 * environment this script runs in) opts in AND that loop's own eligibility
 * gate is met.
 *
 * Usage: tsx build-prompts.ts <fixture.json>
 */

import { resolve } from 'node:path';

import { BUILTIN_RULES, buildTriggerContext, selectRules } from '../../src/plugins/agent/rules.js';
import { buildSystemPrompt, buildInitialMessage } from '../../src/plugins/agent/system-prompt.js';
import {
  shouldRunDocTruthPass,
  buildDocTruthPassPrompts,
} from '../../src/plugins/agent/doc-truth-pass.js';
import {
  shouldRunStaleDuplicatePass,
  buildStaleDuplicatePassPrompts,
  applyStaleDuplicateMainOverride,
} from '../../src/plugins/agent/stale-duplicate-pass.js';
import {
  shouldRunIncompleteHandlingPass,
  buildIncompleteHandlingPassPrompts,
  applyIncompleteHandlingMainOverride,
} from '../../src/plugins/agent/incomplete-handling-pass.js';
import {
  shouldRunRemovedExportsPass,
  buildRemovedExportsPassPrompts,
} from '../../src/plugins/agent/removed-exports-pass.js';
import type { AgentConfig } from '../../src/plugins/agent/types.js';

import { loadFixture } from './fixture-loader.js';

async function main(): Promise<void> {
  const fixtureArg = process.argv[2];
  if (!fixtureArg) {
    console.error('Usage: tsx build-prompts.ts <fixture.json>');
    process.exit(2);
  }
  const fixturePath = resolve(fixtureArg);
  const ctx = await loadFixture(fixturePath);
  const config = ctx.config as unknown as AgentConfig | undefined;

  const triggerCtx = buildTriggerContext(ctx);
  const rules = applyIncompleteHandlingMainOverride(
    applyStaleDuplicateMainOverride(selectRules(BUILTIN_RULES, triggerCtx)),
  );

  const systemPrompt = buildSystemPrompt(rules);
  const initialMessage = buildInitialMessage(ctx, { blastRadius: null, rules });

  const docTruthFires = shouldRunDocTruthPass(ctx, config);
  const docTruthPass = docTruthFires
    ? { fires: true as const, ...buildDocTruthPassPrompts(ctx) }
    : { fires: false as const };

  const staleDuplicateFires = shouldRunStaleDuplicatePass(ctx, config);
  const staleDuplicatePass = staleDuplicateFires
    ? { fires: true as const, ...buildStaleDuplicatePassPrompts(ctx) }
    : { fires: false as const };

  const incompleteHandlingFires = shouldRunIncompleteHandlingPass(ctx, config);
  const incompleteHandlingPass = incompleteHandlingFires
    ? { fires: true as const, ...buildIncompleteHandlingPassPrompts(ctx) }
    : { fires: false as const };

  const removedExportsFires = shouldRunRemovedExportsPass(ctx, config);
  const removedExportsPass = removedExportsFires
    ? { fires: true as const, ...buildRemovedExportsPassPrompts(ctx) }
    : { fires: false as const };

  const output = {
    fixturePath,
    ruleIds: rules.active.map(r => r.id),
    skippedRules: rules.skipped,
    systemPrompt,
    initialMessage,
    docTruthPass,
    staleDuplicatePass,
    incompleteHandlingPass,
    removedExportsPass,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
