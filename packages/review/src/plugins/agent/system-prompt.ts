/**
 * System prompt and initial message builder for the agent review plugin.
 *
 * Uses techniques from aisnacks.io/courses/advanced-prompting/:
 * - XML tags to separate instructions from context (structured input)
 * - Few-shot examples showing exact finding format with input → output → expected
 * - Multi-phase investigation: structural analysis, then edge case sweep
 * - Generate-review pattern: investigate, then self-check for missed issues
 *
 * The system prompt is assembled dynamically from active rules. Each rule
 * contributes its prompt fragment and optional few-shot example. Constant
 * sections (tools, self-review, output format, bad examples) are always included.
 */

import type { ReviewContext } from '../../plugin-types.js';
import type { BlastRadiusReport } from '../../blast-radius.js';
import { renderBlastRadiusMarkdown } from '../../blast-radius-render.js';
import type { ResolvedRules } from './types.js';

// ---------------------------------------------------------------------------
// Constant Sections (always included)
// ---------------------------------------------------------------------------

const INTRO = `You are a senior code reviewer for Lien Review. Your job is to find real bugs — not style issues, not preferences, but code that produces wrong output or breaks callers.`;

const TOOLS_SECTION = `<tools>
You have these tools to investigate the codebase:
- get_dependents: Find all callers/importers of a file or symbol
- get_files_context: Get all code chunks, imports, exports, and call sites for files
- list_functions: Search for symbols by name pattern
- grep_codebase: Search the entire repository for a text pattern (regex). Use to find all files that reference a symbol, including cross-package imports within this monorepo.
- get_complexity: Get complexity metrics for files
- read_file: Read file contents from the repo

A <blast_radius> section may be present in your initial message. It lists pre-computed transitive dependents of the changed symbols, with test coverage and complexity overlay. Use it as your starting map. Call get_dependents only for drill-down on specific symbols not already covered there.
</tools>`;

const SELF_REVIEW = `### Self-Review
Before outputting findings, ask yourself:
- "Did I check every branch/condition in each changed function?"
- "Did I check what happens when the function's assumptions are violated?"
- "Are there any interactions between the changed functions I missed?"`;

const BAD_EXAMPLES = `### Bad finding — DO NOT report things like this:
- "Consider adding JSDoc to this function" (style)
- "This function could be more efficient" (preference)
- "Missing test coverage" (unless critical path)
- "Variable name could be clearer" (naming)`;

const RULES_SECTION = `<rules>
## Rules

Report ONLY:
- Bugs that produce wrong output for specific inputs
- Breaking changes where callers will malfunction
- Silent error swallowing (NaN → '0%', undefined → false, etc.)
- Concurrency bugs: race conditions, TOCTOU, unprotected check-then-act

Do NOT report:
- Style, naming, formatting
- Missing tests
- Pre-existing issues not introduced by this PR
- Performance (unless clear regression)
- Purely preferential suggestions
- Theoretical edge cases with no realistic caller
- Confirmations that code is correct ("this is safe", "no issue here"). If your analysis shows the code is fine, do not create a finding — silence means approval.
- Suggestions to update PR descriptions, comments, or documentation
</rules>`;

const OUTPUT_FORMAT = `<output_format>
After investigation, output a JSON block in a \`\`\`json code fence:

{
  "findings": [
    {
      "filepath": "relative/path.ts",
      "line": 42,
      "endLine": 45,
      "symbolName": "functionName",
      "severity": "error | warning",
      "category": "bug | breaking_change | logic_error | error_handling | type_mismatch | risk",
      "message": "Specific: input X → returns Y → should return Z",
      "suggestion": "Fix with code snippet",
      "evidence": "What check found this",
      "ruleId": "optional — which rule triggered this (e.g., 'edge-case-sweep', 'concurrency-race')"
    }
  ],
  "summary": {
    "riskLevel": "low | medium | high | critical",
    "overview": "One paragraph — what this PR does and its risk profile. Focus on impact, not how you investigated. Do not mention tool names.",
    "keyChanges": ["bullet 1", "bullet 2"]
  }
}

If you find no issues, return empty findings with a low-risk summary. Do not fabricate findings.
</output_format>`;

// ---------------------------------------------------------------------------
// Dynamic Prompt Assembly
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the review agent.
 *
 * Assembles constant sections with dynamically-selected rule prompt fragments
 * and examples based on which rules are active for this PR.
 */
export function buildSystemPrompt(rules: ResolvedRules): string {
  // Build strategy section from active rule prompts
  const rulePrompts = rules.active.map(r => r.prompt).join('\n\n');

  const strategySection = `<strategy>
## Investigation Strategy

${rulePrompts}

${SELF_REVIEW}
</strategy>`;

  // Build examples section from active rule examples
  const ruleExamples = rules.active
    .filter(r => r.example)
    .map(r => r.example)
    .join('\n\n');

  const examplesSection = `<examples>
## Example Findings (for calibration)

${ruleExamples}

${BAD_EXAMPLES}
</examples>`;

  return `${INTRO}

${TOOLS_SECTION}

${strategySection}

${examplesSection}

${RULES_SECTION}

${OUTPUT_FORMAT}`;
}

/** Max characters for the diff section before truncation. */
const MAX_DIFF_CHARS = 50_000;

/** Options for initial-message assembly. */
export interface BuildInitialMessageOptions {
  /** Pre-computed blast-radius report to inject as a `<blast_radius>` block. */
  blastRadius?: BlastRadiusReport | null;
}

/**
 * Build the initial user message from the review context.
 *
 * Uses XML tags to separate context sections (structured input technique
 * from aisnacks.io — reduces misinterpretation between instructions and data).
 */
export function buildInitialMessage(
  context: ReviewContext,
  opts: BuildInitialMessageOptions = {},
): string {
  const sections: string[] = [];
  appendIfPresent(sections, renderPrMetadata(context));
  sections.push(renderChangedFiles(context));
  appendIfPresent(sections, renderDiff(context));
  appendIfPresent(sections, renderComplexityRegressions(context));
  appendIfPresent(sections, renderChangedFunctions(context));
  appendIfPresent(sections, renderBlastRadius(opts));
  appendIfPresent(sections, renderDeletedExports(context));
  sections.push(
    'Investigate this PR. Use the investigation strategy described in your instructions, then output findings as JSON.',
  );
  return sections.join('\n\n');
}

function appendIfPresent(sections: string[], value: string | null): void {
  if (value) sections.push(value);
}

function renderPrMetadata(context: ReviewContext): string | null {
  if (!context.pr) return null;
  const body = context.pr.body ? `\nDescription: ${context.pr.body}` : '';
  return `<pr_metadata>\nTitle: ${context.pr.title}${body}\n</pr_metadata>`;
}

function renderChangedFiles(context: ReviewContext): string {
  const list = context.changedFiles.map(f => `- ${f}`).join('\n');
  return `<changed_files>\n${list}\n</changed_files>`;
}

function renderDiff(context: ReviewContext): string | null {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return null;
  let diffText = '';
  for (const [file, patch] of patches) {
    diffText += `### ${file}\n\`\`\`diff\n${patch}\n\`\`\`\n\n`;
  }
  if (diffText.length > MAX_DIFF_CHARS) {
    diffText =
      diffText.slice(0, MAX_DIFF_CHARS) +
      '\n\n[Diff truncated — use read_file to see full contents of specific files]';
  }
  return `<diff>\n${diffText}</diff>`;
}

function renderComplexityRegressions(context: ReviewContext): string | null {
  const deltas = context.deltas;
  if (!deltas || deltas.length === 0) return null;
  const regressions = deltas.filter(d => d.delta > 0);
  if (regressions.length === 0) return null;
  const lines = regressions.map(
    d =>
      `- ${d.filepath} \`${d.symbolName ?? 'file'}\`: ${d.metricType} ${d.baseComplexity} -> ${d.headComplexity} (+${d.delta})`,
  );
  return `<complexity_regressions>\n${lines.join('\n')}\n</complexity_regressions>`;
}

function renderChangedFunctions(context: ReviewContext): string | null {
  const functionChunks = context.chunks.filter(
    c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
  );
  if (functionChunks.length === 0) return null;
  const lines = functionChunks.map(c => {
    const sig = c.metadata.signature ?? c.metadata.symbolName ?? 'unknown';
    const loc = `${c.metadata.file}:${c.metadata.startLine}`;
    return `- \`${sig}\` at ${loc}`;
  });
  return `<changed_functions>\n${lines.join('\n')}\n</changed_functions>`;
}

function renderBlastRadius(opts: BuildInitialMessageOptions): string | null {
  if (!opts.blastRadius) return null;
  const rendered = renderBlastRadiusMarkdown(opts.blastRadius);
  return rendered.length > 0 ? rendered : null;
}

function renderDeletedExports(context: ReviewContext): string | null {
  const patches = context.pr?.patches;
  if (!patches) return null;
  const deletedExports = extractDeletedExports(patches);
  if (deletedExports.length === 0) return null;
  const list = deletedExports.map(e => `- ${e}`).join('\n');
  return `<deleted_exports>\nThese exports were REMOVED in this PR. Use grep_codebase to check if any file still imports them. After checking deleted exports, continue with the rest of your investigation (edge case sweep on new/changed functions, self-review).\n${list}\n</deleted_exports>`;
}

/**
 * Extract symbol names of deleted exports from diff patches.
 * Looks for lines like `-export { Foo } from ...` or `-export { Foo, Bar }`.
 */
function extractDeletedExports(patches: Map<string, string>): string[] {
  const symbols: string[] = [];

  for (const [, patch] of patches) {
    const lines = patch.split('\n');
    for (const line of lines) {
      // Match removed export lines: -export { X, Y } from ...
      if (!line.startsWith('-')) continue;
      const exportMatch = line.match(/^-\s*export\s*\{([^}]+)\}/);
      if (exportMatch) {
        const names = exportMatch[1].split(',').map(s =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        );
        symbols.push(...names.filter(n => n && !n.startsWith('type ')));
      }
      // Match removed re-export: -export { default as X } from ...
      const reexportMatch = line.match(/^-\s*export\s*\{\s*(\w+)\s*\}/);
      if (reexportMatch && !exportMatch) {
        symbols.push(reexportMatch[1]);
      }
    }
  }

  return [...new Set(symbols)];
}
