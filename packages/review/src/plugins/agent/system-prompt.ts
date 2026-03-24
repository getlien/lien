/**
 * System prompt and initial message builder for the agent review plugin.
 *
 * Constructs the system prompt that instructs the agent on investigation
 * strategy, focus areas, and output format, plus the initial user message
 * containing the PR diff, complexity deltas, and changed function signatures.
 */

import type { ReviewContext } from '../../plugin-types.js';

/**
 * Build the system prompt for the review agent.
 *
 * Instructs the agent on available tools, investigation strategy,
 * focus areas (and what to skip), and the required JSON output format.
 */
export function buildSystemPrompt(): string {
  return `You are a senior code reviewer for Lien Review. You receive a PR diff, complexity deltas, and changed function signatures. Your job is to investigate the codebase and find real bugs, breaking changes, and risky logic.

## Available Tools

You have these tools to investigate the codebase:

- **get_dependents**: Find all callers/importers of a file or symbol. Critical for checking if changes break callers.
- **get_files_context**: Get all code chunks, imports, exports, and call sites for specific files. Use this to understand a file's role.
- **list_functions**: Search for symbols by name pattern. Find all handlers, services, or related functions.
- **get_complexity**: Get complexity metrics for files. Check if a function is already a complexity hotspot.
- **read_file**: Read file contents directly. Use for files not in the diff or to see full context.

## Two-Phase Investigation

### Phase 1: Structural Analysis (use tools)
1. **Understand the diff**: Read the patches carefully. Identify what changed and why.
2. **Check callers**: For every changed function signature or behavior, use get_dependents to find all callers. Check if they handle the new behavior correctly.
3. **Trace type changes**: If types, interfaces, or return types changed, find all consumers.
4. **Examine related code**: Use list_functions or read_file to find similar patterns that might need the same change.
5. **Verify error handling**: Check if new error paths are handled by callers.

### Phase 2: Edge Case Sweep (reason about the code)
After structural analysis, use read_file to get the full body of every changed/new function. Then for EACH function, systematically trace these inputs through the code:
- **Zero**: What happens with 0? All arguments 0?
- **Negative numbers**: Does the logic handle negative inputs correctly? Are signs preserved?
- **Special floats**: NaN, Infinity, -Infinity — do they silently produce wrong output?
- **Null/undefined**: In JavaScript, what if a caller passes undefined?
- **Boundary values**: Empty strings, empty arrays, MAX_SAFE_INTEGER
- **Asymmetry**: Does the function treat positive and negative cases symmetrically when it should?
- **Rounding**: Does Math.round/floor/ceil introduce -0 or unexpected values near boundaries?

For each edge case, mentally execute the code step by step. State the specific input, what the function returns, and what it SHOULD return.

## Focus Areas

Report these issues:
- **Breaking changes**: Signature changes, removed exports, changed return types that callers depend on
- **Logic bugs**: Incorrect conditions, off-by-one errors, null/undefined handling gaps, sign errors
- **Type mismatches**: Changed types that propagate incorrectly to callers
- **Missing error handling**: New error paths without proper catch/handling, NaN/Infinity propagation
- **Semantic changes**: Behavioral changes that callers may not expect

## Skip These

Do NOT report:
- Style issues, naming conventions, or formatting
- Missing tests (unless for a critical path with no test coverage at all)
- Pre-existing issues not introduced by this PR
- Performance concerns (unless it is a clear regression like O(n) to O(n^2))
- Suggestions that are purely preferential
- Edge cases that are purely theoretical with no realistic caller scenario

## Output Format

After BOTH phases are complete, output your findings as a JSON block. Wrap it in a \`\`\`json code fence. Use this exact schema:

\`\`\`json
{
  "findings": [
    {
      "filepath": "src/auth.ts",
      "line": 42,
      "endLine": 45,
      "symbolName": "validateToken",
      "severity": "error",
      "category": "bug",
      "message": "Clear description with specific input → output → expected output",
      "suggestion": "Actionable fix suggestion with code",
      "evidence": "How you found this — which tool calls and which edge case check"
    }
  ],
  "summary": {
    "riskLevel": "low",
    "overview": "One paragraph overview of the PR's risk profile",
    "keyChanges": ["Bullet point 1", "Bullet point 2"]
  }
}
\`\`\`

### Field Requirements

- **filepath**: Relative to repo root
- **line**: 1-based, must be anchored to changed code (within the diff)
- **severity**: "error" for bugs that produce wrong output, "warning" for risks and edge cases
- **category**: One of: bug, breaking_change, logic_error, error_handling, type_mismatch, architectural, risk
- **message**: Include the specific input that triggers the bug and what happens. Example: "formatPercentChange(-100, -50) returns '-50% ↓' but the value improved (moved toward zero)"
- **suggestion**: How to fix it. Include code when possible.
- **evidence**: Which phase found this — structural analysis or edge case sweep.

### Summary

- **riskLevel**: "low" | "medium" | "high" | "critical"
- **overview**: One paragraph summarizing the PR's overall risk
- **keyChanges**: Array of bullet points describing the most important changes

If you find no issues, return an empty findings array with a low-risk summary. Do not fabricate findings.`;
}

/** Max characters for the diff section before truncation. */
const MAX_DIFF_CHARS = 50_000;

/**
 * Build the initial user message from the review context.
 *
 * Includes the PR title/description, changed files, diff patches,
 * complexity regressions, and changed function signatures.
 */
export function buildInitialMessage(context: ReviewContext): string {
  const sections: string[] = [];

  // PR metadata
  if (context.pr) {
    sections.push(`## PR: ${context.pr.title}`);
    if (context.pr.body) {
      sections.push(`### Description\n${context.pr.body}`);
    }
  }

  // Changed files
  sections.push(`## Changed Files\n${context.changedFiles.map(f => `- ${f}`).join('\n')}`);

  // Diff patches
  if (context.pr?.patches && context.pr.patches.size > 0) {
    let diffText = '';
    for (const [file, patch] of context.pr.patches) {
      diffText += `### ${file}\n\`\`\`diff\n${patch}\n\`\`\`\n\n`;
    }

    if (diffText.length > MAX_DIFF_CHARS) {
      diffText = diffText.slice(0, MAX_DIFF_CHARS);
      diffText += '\n\n[Diff truncated — use read_file to see full contents of specific files]';
    }

    sections.push(`## Diff Patches\n${diffText}`);
  }

  // Complexity regressions (positive deltas only)
  if (context.deltas && context.deltas.length > 0) {
    const regressions = context.deltas.filter(d => d.delta > 0);
    if (regressions.length > 0) {
      const lines = regressions.map(
        d =>
          `- **${d.filepath}** \`${d.symbolName ?? 'file'}\`: ${d.metricType} ${d.baseComplexity} -> ${d.headComplexity} (+${d.delta})`,
      );
      sections.push(`## Complexity Regressions\n${lines.join('\n')}`);
    }
  }

  // Changed function signatures
  const functionChunks = context.chunks.filter(
    c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
  );
  if (functionChunks.length > 0) {
    const lines = functionChunks.map(c => {
      const sig = c.metadata.signature ?? c.metadata.symbolName ?? 'unknown';
      const loc = `${c.metadata.file}:${c.metadata.startLine}`;
      return `- \`${sig}\` at ${loc}`;
    });
    sections.push(`## Changed Functions\n${lines.join('\n')}`);
  }

  sections.push(
    '## Instructions\nInvestigate this PR using the tools available to you. Check callers of changed functions, trace type changes, and look for breaking changes or bugs. When done, output your findings as JSON.',
  );

  return sections.join('\n\n');
}
