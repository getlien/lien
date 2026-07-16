/**
 * Guidance-surface passthrough for PR reviews.
 *
 * The review pipeline only chunks/analyzes files whose extension is in the
 * parser-supported set (see `filterAnalyzableFiles` in analysis.ts). That drops
 * two kinds of prose from the material the reviewer reasons about:
 *  - agent-guidance surfaces — shell hooks, `.mdc` rules, CLAUDE.md; and
 *  - project documentation — architecture docs / ADRs under `docs/`, the
 *    user-guide site under `packages/site/docs/`, and `.changeset/` entries.
 * Both make behavioral/structural claims about the code. For a tool whose
 * *product* is agent guidance, hiding a hook that calls a keyword search
 * "meaning-based discovery" is exactly wrong; the same is true of an ADR that
 * describes a mechanism the code no longer has, or a changeset whose "adds
 * <API>" line the diff's exports contradict. Stale docs/guidance are a
 * functional bug, not a style nit (see PR #658, and the 60-PR review-gap
 * analysis that found doc↔code drift escaping on exactly these surfaces).
 *
 * This module widens the review INPUT without touching the parser: it collects
 * the raw unified-diff hunks of any changed file that is a guidance/doc surface
 * and injects them as a clearly-labeled `<guidance_surface_changes>` block, so
 * the prose reaches the model (and the `doc-truth` rule) instead of being
 * silently dropped. It is a deterministic, zero-LLM pass over the existing
 * patches — mirroring the `<untrusted_input_sites>` / `<stale_literal_candidates>`
 * precedents (a focused view derived from the diff, appended unconditionally).
 *
 * Scope is deliberately tight (KISS): NOT every `.md`/`.json` in the repo — only
 * the guidance surfaces above and specific documentation roots (no blanket
 * `**\/*.md`, no source-tree READMEs). The passthrough is byte-capped both
 * per-file (so one huge doc can't evict the others) and in total; when either
 * cap bites it says so rather than truncating silently.
 */

import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A changed guidance/doc surface file and its raw unified-diff hunk(s). */
export interface GuidanceSurfaceChange {
  file: string;
  /** Raw unified-diff patch text for this file, as returned by the GitHub API. */
  patch: string;
}

// ---------------------------------------------------------------------------
// Guidance-surface definition
// ---------------------------------------------------------------------------

/**
 * A changed file is a "guidance surface" when its prose steers an agent or
 * documents the code's behavior, rather than being executable source the parser
 * can analyze. Kept tight on purpose — this is NOT "every doc/config file",
 * only:
 *  - CLAUDE.md at any depth (agent memory / project instructions);
 *  - shell hooks and `.mdc` rule files under an agent-guidance root
 *    (`plugins/**` for Claude Code plugins, `.cursor/**` for Cursor rules);
 *  - architecture docs / ADRs under the top-level `docs/` tree;
 *  - the published user-guide site under `packages/site/docs/`;
 *  - changeset entries (`.changeset/*.md`), whose prose claims what the public
 *    API now does.
 * The doc roots are anchored (top-level `docs/`, `packages/site/docs/`, and the
 * flat `.changeset/` dir) so source-tree READMEs and a blanket `**\/*.md` stay
 * out of scope. Paths are repo-relative (no leading `./`), matching GitHub's
 * file list.
 */
const GUIDANCE_SURFACE_MATCHERS: readonly RegExp[] = [
  // Agent-guidance surfaces: prose that steers an AI agent.
  /(?:^|\/)CLAUDE\.md$/,
  /^(?:plugins|\.cursor)\/.*\.(?:sh|mdc)$/,
  // Project-documentation surfaces: ADRs / design docs, the user-guide site,
  // and changeset entries. Anchored to specific roots — no blanket **/*.md.
  /^docs\/.*\.md$/,
  /^packages\/site\/docs\/.*\.md$/,
  /^\.changeset\/[^/]*\.md$/,
];

/** True when `file` is a guidance or documentation surface (see matchers). */
export function isGuidanceSurface(file: string): boolean {
  return GUIDANCE_SURFACE_MATCHERS.some(re => re.test(file));
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Collect the changed guidance/doc-surface files and their raw diff hunks from
 * the PR patches, SMALLEST HUNK FIRST. Order is a budget-fairness decision,
 * not cosmetics: with a total cap, processing in diff order lets one
 * voluminous prose file exhaust the budget and evict small claim-dense files
 * entirely (observed on PR #687, where skills/rules prose crowded out the
 * config-system.md retired-key note the doc-truth rule needed to see).
 * Smallest-first guarantees every compact claim-bearing hunk gets in before
 * any file needs truncation. Exposed for testing.
 */
export function collectGuidanceSurfaceChanges(
  patches: Map<string, string>,
): GuidanceSurfaceChange[] {
  const changes: GuidanceSurfaceChange[] = [];
  for (const [file, patch] of patches) {
    if (isGuidanceSurface(file)) changes.push({ file, patch });
  }
  return changes.sort((a, b) => a.patch.length - b.patch.length);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Total budget for the passed-through hunks. Larger than a hooks-only budget
 * because doc PRs can be much bigger (a site-wide docs sweep, a multi-file ADR
 * update), but still bounded: input-budget bloat measurably degrades finding
 * quality (PR #613). When the total is exhausted the block says how many files
 * were omitted — never a silent drop.
 */
const MAX_GUIDANCE_CHARS = 12_000;

/**
 * Per-file cap on a single hunk's passed-through bytes. Keeps one huge doc from
 * eating the whole budget and evicting the other changed surfaces: each file
 * contributes at most this much, and anything past it is marked truncated with
 * a read_file pointer. A few KB is enough to carry the claim-bearing prose of a
 * typical ADR / guide / changeset hunk.
 */
const MAX_PER_FILE_CHARS = 3_000;

const HEADER = `<guidance_surface_changes>
The diffs below are GUIDANCE and DOCUMENTATION surfaces this PR changed: agent-guidance files (Claude/Cursor hooks, \`.mdc\` rules, CLAUDE.md) and project docs (architecture/ADRs under \`docs/\`, the user-guide site under \`packages/site/docs/\`, and \`.changeset/\` entries). None are code-analyzed — no AST, chunks, or signals are computed for them — so their raw hunks are passed through here. For a tool whose product is agent guidance, prose that mis-describes behavior is a functional bug: a hook calling a keyword search "meaning-based", an ADR/doc claiming a flag is "disabled when X" the code contradicts, or a changeset whose "adds/renames <API>" line the diff's exports don't match. Apply the doc-truth check to the BEHAVIORAL and STRUCTURAL claims in these hunks — verify each against the code the diff touches (and against a referenced ADR when both are visible); for changesets, public-API claims must match the diff's actual exports. Do NOT report pure wording/style nits, and stay silent on claims the code confirms are accurate. These are raw passed-through hunks, not verified facts: when the claim describes code that is NOT itself part of this diff, reading the hunk alone does not confirm or refute it — call get_files_context (or read_file) on the described symbol to check, per the doc-truth protocol; get_files_context reads indexed chunks, so it still works when grep_codebase/read_file are blind in some review modes.`;

/** Render one file's hunk as a fenced, labeled block. */
function renderFileBlock(file: string, patch: string): string {
  return `### ${file} (guidance-surface change — not code-analyzed)\n\`\`\`diff\n${patch}\n\`\`\``;
}

/**
 * Render the collected guidance/doc-surface changes as a
 * `<guidance_surface_changes>` block for the agent's initial message. Returns ''
 * when there are none, so callers can append unconditionally.
 *
 * Two caps keep the block bounded without silent loss:
 *  - each file's hunk is capped at MAX_PER_FILE_CHARS, so one oversized doc
 *    can't evict the others (over-cap hunks are marked truncated in place and
 *    the loop CONTINUES to the next file);
 *  - the total is capped at MAX_GUIDANCE_CHARS; once it is exhausted the
 *    remaining files are omitted with an explicit count.
 * Both a per-file truncation and a whole-file omission are stated inline.
 */
export function renderGuidanceSurfaceChanges(changes: GuidanceSurfaceChange[]): string {
  if (changes.length === 0) return '';

  const blocks: string[] = [];
  let used = 0;
  let omittedFiles = 0;

  for (let i = 0; i < changes.length; i++) {
    const { file, patch } = changes[i];
    const framing = renderFileBlock(file, '').length;
    // Bytes available for THIS file's patch: the smaller of the per-file cap
    // and whatever remains of the total budget after this file's fixed framing.
    const patchBudget = Math.min(MAX_PER_FILE_CHARS, MAX_GUIDANCE_CHARS - used - framing);
    if (patchBudget <= 0) {
      // No room left even for framing: omit this file and all that follow.
      omittedFiles = changes.length - i;
      break;
    }
    if (patch.length <= patchBudget) {
      const block = renderFileBlock(file, patch);
      blocks.push(block);
      used += block.length;
      continue;
    }
    // Patch exceeds its slice: include the slice, mark it truncated, and keep
    // going so later files still get their own slice.
    const truncatedPatch = patch.slice(0, patchBudget);
    const cut = patch.length - truncatedPatch.length;
    const block = `${renderFileBlock(file, truncatedPatch)}\n[hunk truncated to respect the input budget — ${cut} more char(s) for this file; use read_file for the full contents]`;
    blocks.push(block);
    used += block.length;
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
 * Returns '' when there is no diff or no changed guidance/doc surface.
 */
export function renderGuidanceSurfaceSection(context: ReviewContext): string {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return '';
  return renderGuidanceSurfaceChanges(collectGuidanceSurfaceChanges(patches));
}
