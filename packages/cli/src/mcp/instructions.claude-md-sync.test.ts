import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_INSTRUCTIONS } from './instructions.js';

/**
 * Guards the hand-sync between CLAUDE.md's "Lien MCP Tools — MANDATORY Usage"
 * section and SERVER_INSTRUCTIONS (the string sent to every connecting MCP
 * client on `initialize`). Today that sync is enforced by nothing but an
 * expectation that whoever edits one remembers the other — this test makes
 * drift fail CI instead.
 *
 * The two texts are DELIBERATELY not verbatim copies: CLAUDE.md is long-form
 * guidance for a coding agent reading the repo, SERVER_INSTRUCTIONS is a
 * token-budget-conscious prompt sent on every connection. So assertions here
 * check for SUBSTANCE — tool names mentioned, mandates present, stable anchor
 * phrases/fragments — never exact sentences. Keyword-brittle assertions rot
 * (see packages/review/test/harness/README.md's Tier-2 note for the same
 * lesson learned the hard way in the review harness).
 */

const SNAKE_CASE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** Walk up from `startDir` looking for a repo-root CLAUDE.md. */
function findClaudeMd(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'CLAUDE.md');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Slice out just the "## Lien MCP Tools" section (up to the next top-level
 * heading) so unrelated CLAUDE.md content can't accidentally satisfy an
 * assertion. Matches on `\n## ` rather than `---` because the section
 * contains a markdown table whose `|---|---|` separator row would otherwise
 * be mistaken for the section's trailing horizontal rule.
 */
function extractMcpSection(claudeMdText: string): string {
  const headingIdx = claudeMdText.indexOf('## Lien MCP Tools');
  if (headingIdx === -1) {
    throw new Error(
      'CLAUDE.md no longer has a "## Lien MCP Tools" section — if it was renamed, update the anchor heading in this test.',
    );
  }
  const rest = claudeMdText.slice(headingIdx + 3);
  const nextHeadingRel = rest.indexOf('\n## ');
  const end = nextHeadingRel === -1 ? claudeMdText.length : headingIdx + 3 + nextHeadingRel;
  return claudeMdText.slice(headingIdx, end);
}

function extractToolNames(text: string): Set<string> {
  return new Set(text.match(SNAKE_CASE_TOKEN) ?? []);
}

/** Case-insensitive, whitespace-collapsing substring check (tolerant of reflow/line-wrap). */
function containsFragment(text: string, fragment: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  return normalize(text).includes(normalize(fragment));
}

/** True if both terms appear within `window` chars of each other, in either order. */
function allIndexesOf(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    indexes.push(i);
  }
  return indexes;
}

// Any occurrence pair within the window counts — first-occurrence-only would
// false-fail when a term also appears earlier in an unrelated context (e.g. a
// tool-selection table above the mandate that actually satisfies the check).
function mentionsNear(text: string, termA: string, termB: string, window = 150): boolean {
  const lower = text.toLowerCase();
  const as = allIndexesOf(lower, termA.toLowerCase());
  const bs = allIndexesOf(lower, termB.toLowerCase());
  return as.some(a => bs.some(b => Math.abs(a - b) <= window));
}

const claudeMdPath = findClaudeMd(dirname(fileURLToPath(import.meta.url)));

describe('CLAUDE.md <-> SERVER_INSTRUCTIONS MCP policy sync', () => {
  if (!claudeMdPath) {
    it.skip('SKIPPED: CLAUDE.md not found by walking up from this file — not running inside a lien repo checkout', () => {});
    return;
  }

  const mcpSection = extractMcpSection(readFileSync(claudeMdPath, 'utf8'));
  const sides = [
    ['CLAUDE.md', mcpSection],
    ['SERVER_INSTRUCTIONS', SERVER_INSTRUCTIONS],
  ] as const;

  it('mentions the same set of Lien tool names as SERVER_INSTRUCTIONS', () => {
    const claudeTools = extractToolNames(mcpSection);
    const instructionTools = extractToolNames(SERVER_INSTRUCTIONS);
    const onlyInClaudeMd = [...claudeTools].filter(t => !instructionTools.has(t)).sort();
    const onlyInInstructions = [...instructionTools].filter(t => !claudeTools.has(t)).sort();

    expect(
      onlyInClaudeMd,
      `Tools mentioned in CLAUDE.md but missing from SERVER_INSTRUCTIONS: ${onlyInClaudeMd.join(', ') || 'none'}`,
    ).toEqual([]);
    expect(
      onlyInInstructions,
      `Tools mentioned in SERVER_INSTRUCTIONS but missing from CLAUDE.md: ${onlyInInstructions.join(', ') || 'none'}`,
    ).toEqual([]);
    // Guard against both sides drifting to zero mentions and vacuously passing.
    expect(claudeTools.size).toBeGreaterThan(0);
  });

  it('requires get_files_context before editing, in both texts', () => {
    for (const [label, text] of sides) {
      expect(
        mentionsNear(text, 'get_files_context', 'edit'),
        `${label} is missing the get_files_context-before-editing mandate`,
      ).toBe(true);
    }
  });

  it('requires get_dependents before renaming/removing/signature changes, in both texts', () => {
    const fragment = 'renaming, removing, or changing the signature';
    for (const [label, text] of sides) {
      expect(
        text.includes('get_dependents') && containsFragment(text, fragment),
        `${label} is missing the get_dependents-before-signature-change mandate`,
      ).toBe(true);
    }
  });

  it('requires search_code before grep/glob for discovery, in both texts', () => {
    for (const [label, text] of sides) {
      expect(text.includes('search_code'), `${label} does not mention search_code`).toBe(true);
      expect(/grep/i.test(text), `${label} does not mention grep as the discovery fallback`).toBe(
        true,
      );
      expect(
        containsFragment(text, 'discovery') || containsFragment(text, 'TODO'),
        `${label} is missing discovery-vs-grep framing (expected "discovery" or "TODO(s)" context)`,
      ).toBe(true);
    }
  });

  it('states the no-embeddings / BM25 / camelCase-split keyword-search caveat, in both texts', () => {
    for (const [label, text] of sides) {
      expect(/BM25/.test(text), `${label} is missing the BM25 caveat`).toBe(true);
      expect(/camelCase/.test(text), `${label} is missing the camelCase-split caveat`).toBe(true);
      expect(/no embeddings/i.test(text), `${label} is missing the no-embeddings caveat`).toBe(
        true,
      );
    }
  });

  it('escalates on high/critical riskLevel before proceeding, in both texts', () => {
    for (const [label, text] of sides) {
      expect(/riskLevel/.test(text), `${label} is missing riskLevel guidance`).toBe(true);
      expect(
        containsFragment(text, 'high') && containsFragment(text, 'critical'),
        `${label} is missing the high/critical escalation levels`,
      ).toBe(true);
      expect(
        containsFragment(text, 'list affected dependents'),
        `${label} is missing the "list affected dependents" escalation action`,
      ).toBe(true);
    }
  });
});
