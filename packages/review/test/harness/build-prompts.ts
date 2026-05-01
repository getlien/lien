#!/usr/bin/env tsx
/**
 * CLI helper: load a fixture, build the same system+initial prompts the
 * agent plugin would use in production, emit them as JSON on stdout.
 *
 * Used by the CC iteration Skill to feed the exact prompt to a Claude
 * subagent, and by run.ts (OpenRouter mode) to keep one source of truth
 * for prompt assembly.
 *
 * Usage: tsx build-prompts.ts <fixture.json>
 */

import { resolve } from 'node:path';

import { BUILTIN_RULES, buildTriggerContext, selectRules } from '../../src/plugins/agent/rules.js';
import { buildSystemPrompt, buildInitialMessage } from '../../src/plugins/agent/system-prompt.js';

import { loadFixture } from './fixture-loader.js';

async function main(): Promise<void> {
  const fixtureArg = process.argv[2];
  if (!fixtureArg) {
    console.error('Usage: tsx build-prompts.ts <fixture.json>');
    process.exit(2);
  }
  const fixturePath = resolve(fixtureArg);
  const ctx = await loadFixture(fixturePath);

  const triggerCtx = buildTriggerContext(ctx);
  const rules = selectRules(BUILTIN_RULES, triggerCtx);

  const systemPrompt = buildSystemPrompt(rules);
  const initialMessage = buildInitialMessage(ctx, { blastRadius: null });

  const output = {
    fixturePath,
    ruleIds: rules.active.map(r => r.id),
    skippedRules: rules.skipped,
    systemPrompt,
    initialMessage,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
