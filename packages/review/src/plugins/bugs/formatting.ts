/**
 * Formatting utilities for Bug Finder findings.
 *
 * Handles caller tables, GitHub links, review comments, and summary output.
 */

import type { ReviewFinding, BugFindingMetadata, BugCallerInfo } from '../../plugin-types.js';
import type { BugReport, ChangedFunction, PromptBatch } from './types.js';
import { BUG_REVIEW_MARKER } from './types.js';

// ---------------------------------------------------------------------------
// Content truncation
// ---------------------------------------------------------------------------

export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n// ... truncated';
}

// ---------------------------------------------------------------------------
// Finding construction -- group bugs per changed function
// ---------------------------------------------------------------------------

export function associateBugToFunction(bug: BugReport, batch: PromptBatch): ChangedFunction | null {
  // Primary: match by changedFunction name from LLM response
  if (bug.changedFunction) {
    const match = batch.functions.find(fn => fn.symbolName === bug.changedFunction);
    if (match) return match;
  }

  // Fallback: match by caller filepath + symbol (more precise than filepath alone)
  for (const fn of batch.functions) {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
    if (
      callers.some(
        c => c.caller.filepath === bug.callerFilepath && c.caller.symbolName === bug.callerSymbol,
      )
    )
      return fn;
  }

  // Last resort: match by caller filepath only
  for (const fn of batch.functions) {
    const callers = batch.callerMap.get(`${fn.filepath}::${fn.symbolName}`) ?? [];
    if (callers.some(c => c.caller.filepath === bug.callerFilepath)) return fn;
  }

  return null;
}

export function bugsToGroupedFindings(bugs: BugReport[], batch: PromptBatch): ReviewFinding[] {
  // Group bugs by changed function
  const grouped = new Map<ChangedFunction, BugReport[]>();
  for (const bug of bugs) {
    const fn = associateBugToFunction(bug, batch);
    if (!fn) continue;
    const existing = grouped.get(fn) ?? [];
    existing.push(bug);
    grouped.set(fn, existing);
  }

  // One finding per changed function
  const findings: ReviewFinding[] = [];
  for (const [fn, fnBugs] of grouped) {
    const callers: BugCallerInfo[] = fnBugs.map(b => ({
      filepath: b.callerFilepath,
      line: b.callerLine,
      symbol: b.callerSymbol,
      category: b.category,
      description: b.description,
      suggestion: b.suggestion,
    }));

    const worstSeverity = fnBugs.some(b => b.severity === 'error') ? 'error' : 'warning';

    const metadata: BugFindingMetadata = {
      pluginType: 'bugs',
      changedFunction: `${fn.filepath}::${fn.symbolName}`,
      callers,
    };

    findings.push({
      pluginId: 'bugs',
      filepath: fn.filepath,
      line: fn.chunk.metadata.startLine,
      symbolName: fn.symbolName,
      severity: worstSeverity,
      category: 'bug',
      message: formatCallerTable(callers),
      metadata,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function buildBlobBase(pr?: {
  owner: string;
  repo: string;
  headSha: string;
}): string | null {
  if (!pr) return null;
  return `https://github.com/${pr.owner}/${pr.repo}/blob/${pr.headSha}`;
}

export function callerLink(c: BugCallerInfo, blobBase: string | null): string {
  if (blobBase) {
    return `[${c.filepath}:${c.line}](${blobBase}/${c.filepath}#L${c.line})`;
  }
  return `\`${c.filepath}:${c.line}\``;
}

/** Plain table (no links) -- stored in finding.message during analyze(). */
export function formatCallerTable(callers: BugCallerInfo[]): string {
  const count = callers.length;
  const header = `${count} caller${count === 1 ? '' : 's'} affected by this change\n\n`;
  const rows = callers.map(
    c => `| \`${c.filepath}:${c.line}\` | \`${c.symbol}\` | ${c.description} | ${c.suggestion} |`,
  );
  return `${header}| Caller | Function | Issue | Fix |\n|---|---|---|---|\n${rows.join('\n')}`;
}

/** Rebuild the message with GitHub links for present(). */
export function rebuildMessageWithLinks(f: ReviewFinding, blobBase: string | null): string {
  const meta = f.metadata as BugFindingMetadata | undefined;
  if (!meta?.callers || !blobBase) return f.message;
  return formatLinkedCallerTable(meta.callers, blobBase);
}

export function formatLinkedCallerTable(callers: BugCallerInfo[], blobBase: string | null): string {
  const count = callers.length;
  const header = `${count} caller${count === 1 ? '' : 's'} affected by this change\n\n`;
  const rows = callers.map(
    c => `| ${callerLink(c, blobBase)} | \`${c.symbol}\` | ${c.description} | ${c.suggestion} |`,
  );
  return `${header}| Caller | Function | Issue | Fix |\n|---|---|---|---|\n${rows.join('\n')}`;
}

export function formatBugReviewComment(findings: ReviewFinding[]): string {
  const sections = findings.map(f => {
    const sym = f.symbolName ? `\`${f.symbolName}\`` : f.filepath;
    return `**${sym}** (\`${f.filepath}:${f.line}\`)\n\n${f.message}`;
  });
  return `${BUG_REVIEW_MARKER}\n**Bug Finder**\n\n${sections.join('\n\n---\n\n')}`;
}

export function formatBugSummary(findings: ReviewFinding[], blobBase: string | null): string {
  const sections = findings.map(f => {
    const meta = f.metadata as BugFindingMetadata;
    const callerCount = meta.callers.length;
    const rows = meta.callers.map(c => `| ${callerLink(c, blobBase)} | ${c.description} |`);
    return `**\`${f.symbolName}\`** (\`${f.filepath}:${f.line}\`) — ${callerCount} caller${callerCount === 1 ? '' : 's'} affected\n\n| Caller | Issue |\n|---|---|\n${rows.join('\n')}`;
  });
  return `### Bug Finder\n\n${sections.join('\n\n')}`;
}
