/**
 * Guidance-surface passthrough for PR reviews.
 *
 * The review pipeline only chunks/analyzes files whose extension is in the
 * parser-supported set (see `filterAnalyzableFiles` in analysis.ts). That drops
 * the agent-guidance surfaces — shell hooks, `.mdc` rules, CLAUDE.md — from the
 * material the reviewer reasons about. For a tool whose *product* is agent
 * guidance, that is exactly the wrong thing to hide: a hook that calls a
 * keyword search "meaning-based discovery", or a CLAUDE.md that describes a flag
 * the code no longer honors, actively misroutes the agents that read it. Stale
 * guidance is a functional bug, not a style nit (see PR #658).
 *
 * This module widens the review INPUT without touching the parser: it collects
 * the raw unified-diff hunks of any changed file that is a guidance surface and
 * injects them as a clearly-labeled `<guidance_surface_changes>` block, so the
 * prose reaches the model (and the `doc-truth` rule) instead of being silently
 * dropped. It is a deterministic, zero-LLM pass over the existing patches —
 * mirroring the `<untrusted_input_sites>` / `<stale_literal_candidates>`
 * precedents (a focused view derived from the diff, appended unconditionally).
 *
 * Scope is deliberately tight (KISS): NOT every `.md`/`.json` in the repo — only
 * surfaces whose prose steers an agent. The passthrough is byte-capped; when the
 * cap is hit it says so rather than truncating silently.
 */

import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A changed guidance-surface file and its raw unified-diff hunk(s). */
export interface GuidanceSurfaceChange {
  file: string;
  /** Raw unified-diff patch text for this file, as returned by the GitHub API. */
  patch: string;
}

// ---------------------------------------------------------------------------
// Guidance-surface definition
// ---------------------------------------------------------------------------

/**
 * A changed file is a "guidance surface" when its prose steers an agent rather
 * than being executable source the parser can analyze. Kept tight on purpose —
 * this is NOT "every doc/config file", only:
 *  - CLAUDE.md at any depth (agent memory / project instructions);
 *  - shell hooks and `.mdc` rule files under an agent-guidance root
 *    (`plugins/**` for Claude Code plugins, `.cursor/**` for Cursor rules).
 * Paths are repo-relative (no leading `./`), matching GitHub's file list.
 */
const GUIDANCE_SURFACE_MATCHERS: readonly RegExp[] = [
  /(?:^|\/)CLAUDE\.md$/,
  /^(?:plugins|\.cursor)\/.*\.(?:sh|mdc)$/,
];

/** True when `file` is an agent-guidance surface (see GUIDANCE_SURFACE_MATCHERS). */
export function isGuidanceSurface(file: string): boolean {
  return GUIDANCE_SURFACE_MATCHERS.some(re => re.test(file));
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Collect the changed guidance-surface files and their raw diff hunks from the
 * PR patches, preserving the patches' iteration order. Exposed for testing.
 */
export function collectGuidanceSurfaceChanges(
  patches: Map<string, string>,
): GuidanceSurfaceChange[] {
  const changes: GuidanceSurfaceChange[] = [];
  for (const [file, patch] of patches) {
    if (isGuidanceSurface(file)) changes.push({ file, patch });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Total budget for the passed-through hunks. Deliberately modest: input-budget
 * bloat measurably degrades finding quality (PR #613), and guidance surfaces are
 * usually small (a hook, a rule file, a CLAUDE.md section). When the budget is
 * exhausted the block says how much was omitted — never a silent drop.
 */
const MAX_GUIDANCE_CHARS = 6_000;

const HEADER = `<guidance_surface_changes>
The diffs below are AGENT-GUIDANCE surfaces this PR changed (Claude/Cursor hooks, \`.mdc\` rules, CLAUDE.md). They are guidance-surface changes, NOT code-analyzed — no AST, chunks, or signals are computed for them, so their raw hunks are passed through here. For a tool whose product is agent guidance, prose that mis-describes behavior is a functional bug (a hook calling a keyword search "meaning-based", a doc claiming a flag is "disabled when X" the code contradicts). Apply the doc-truth check to behavioral claims in these hunks; do NOT report pure wording/style nits.`;

/** Render one file's hunk as a fenced, labeled block. */
function renderFileBlock(file: string, patch: string): string {
  return `### ${file} (guidance-surface change — not code-analyzed)\n\`\`\`diff\n${patch}\n\`\`\``;
}

/**
 * Render the collected guidance-surface changes as a `<guidance_surface_changes>`
 * block for the agent's initial message. Returns '' when there are none, so
 * callers can append unconditionally. Caps the total passed-through bytes and,
 * if the cap is hit, states what was truncated/omitted rather than dropping
 * content silently.
 */
export function renderGuidanceSurfaceChanges(changes: GuidanceSurfaceChange[]): string {
  if (changes.length === 0) return '';

  const blocks: string[] = [];
  let used = 0;
  let omittedFiles = 0;

  for (let i = 0; i < changes.length; i++) {
    const { file, patch } = changes[i];
    const remaining = MAX_GUIDANCE_CHARS - used;
    if (remaining <= 0) {
      omittedFiles = changes.length - i;
      break;
    }
    const block = renderFileBlock(file, patch);
    if (block.length <= remaining) {
      blocks.push(block);
      used += block.length;
      continue;
    }
    // The patch doesn't fit whole: include as much as the budget allows and
    // mark this file's hunk as truncated, then stop (subsequent files omitted).
    const truncatedPatch = patch.slice(
      0,
      Math.max(0, remaining - renderFileBlock(file, '').length),
    );
    const cut = patch.length - truncatedPatch.length;
    blocks.push(
      `${renderFileBlock(file, truncatedPatch)}\n[hunk truncated to respect the input budget — ${cut} more char(s) for this file; use read_file for the full contents]`,
    );
    omittedFiles = changes.length - i - 1;
    break;
  }

  const parts = [HEADER, ...blocks];
  if (omittedFiles > 0) {
    parts.push(
      `[+${omittedFiles} more changed guidance-surface file(s) omitted to respect the input budget — inspect them with read_file if a behavioral claim is at stake]`,
    );
  }
  parts.push('</guidance_surface_changes>');
  return parts.join('\n\n');
}

/**
 * Build the `<guidance_surface_changes>` section from the review context.
 * Returns '' when there is no diff or no changed guidance surface.
 */
export function renderGuidanceSurfaceSection(context: ReviewContext): string {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return '';
  return renderGuidanceSurfaceChanges(collectGuidanceSurfaceChanges(patches));
}
