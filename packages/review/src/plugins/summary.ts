/**
 * PR Summary plugin.
 *
 * Generates a human-readable PR summary with risk assessment,
 * posted to the PR description. Leverages deterministic risk signals
 * from ReviewContext and LLM for natural-language synthesis.
 */

import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  SummaryFindingMetadata,
  PresentContext,
} from '../plugin-types.js';
import type { ComplexityDelta } from '../delta.js';
import { extractJSONFromCodeBlock } from '../json-utils.js';
import type { Logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Risk Signal Computation (deterministic)
// ---------------------------------------------------------------------------

type FileCategory = 'infra' | 'config' | 'db' | 'test' | 'docs' | 'source';

const CATEGORY_PATTERNS: [RegExp, FileCategory][] = [
  [/(?:cloudformation|terraform|cdk|pulumi|docker|k8s|kubernetes|helm)/i, 'infra'],
  [/(?:migration|schema|seed|\.sql)/i, 'db'],
  [/(?:\.test\.|\.spec\.|__tests__|test\/|tests\/)/i, 'test'],
  [/(?:\.md|\.txt|\.rst|docs\/|README)/i, 'docs'],
  [/\.(ya?ml|json|toml|ini|env)$/i, 'config'],
];

function categorizeFile(filepath: string): FileCategory {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(filepath)) return category;
  }
  return 'source';
}

export interface RiskSignals {
  totalFiles: number;
  categories: Record<FileCategory, number>;
  languages: string[];
  newViolations: number;
  improvedViolations: number;
  highRiskFileCount: number;
  hasExportChanges: boolean;
  uncoveredSourceFileCount: number;
}

function countUncoveredSourceFiles(files: string[], report: ComplexityReport): number {
  return files.filter(f => {
    if (categorizeFile(f) !== 'source') return false;
    const data = report.files[f];
    return !data || data.testAssociations.length === 0;
  }).length;
}

function countViolationDeltas(deltas: ReviewContext['deltas']): {
  newViolations: number;
  improvedViolations: number;
} {
  let newViolations = 0;
  let improvedViolations = 0;
  for (const delta of deltas ?? []) {
    if (delta.severity === 'new' || delta.severity === 'error' || delta.severity === 'warning')
      newViolations++;
    if (delta.severity === 'improved' || delta.severity === 'deleted') improvedViolations++;
  }
  return { newViolations, improvedViolations };
}

function countHighRiskFiles(files: string[], report: ComplexityReport): number {
  return files.filter(f => (report.files[f]?.dependents.length ?? 0) > 0).length;
}

export function computeRiskSignals(context: ReviewContext): RiskSignals {
  // Use allChangedFiles for categorization so we capture docs/config/infra files
  const allFiles = context.allChangedFiles ?? context.changedFiles;

  const categories: Record<FileCategory, number> = {
    infra: 0,
    config: 0,
    db: 0,
    test: 0,
    docs: 0,
    source: 0,
  };
  for (const file of allFiles) categories[categorizeFile(file)]++;

  const languages = [
    ...new Set(context.chunks.map(c => c.metadata.language).filter(Boolean)),
  ].sort() as string[];

  const { newViolations, improvedViolations } = countViolationDeltas(context.deltas);

  return {
    totalFiles: allFiles.length,
    categories,
    languages,
    newViolations,
    improvedViolations,
    highRiskFileCount: countHighRiskFiles(allFiles, context.complexityReport),
    hasExportChanges: detectExportChanges(context),
    uncoveredSourceFileCount: countUncoveredSourceFiles(allFiles, context.complexityReport),
  };
}

function detectExportChanges(context: ReviewContext): boolean {
  if (!context.baselineReport) return false;

  for (const chunk of context.chunks) {
    if (chunk.metadata.exports && chunk.metadata.exports.length > 0) {
      if (!context.baselineReport.files[chunk.metadata.file]) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Code Context Assembly (same pattern as ArchitecturalPlugin)
// ---------------------------------------------------------------------------

const MAX_TOTAL_CHARS = 50_000;

function groupChunksByFile(
  chunks: CodeChunk[],
  changedFilesSet: Set<string>,
): Map<string, CodeChunk[]> {
  const map = new Map<string, CodeChunk[]>();
  // Separate method chunks as fallback for files with no class/function-level chunks
  const methodFallback = new Map<string, CodeChunk[]>();

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (!changedFilesSet.has(file)) continue;
    if (chunk.metadata.symbolType === 'method') {
      const existing = methodFallback.get(file) ?? [];
      existing.push(chunk);
      methodFallback.set(file, existing);
      continue;
    }
    if (chunk.metadata.type === 'block' && !chunk.metadata.symbolName) continue;
    const existing = map.get(file) ?? [];
    existing.push(chunk);
    map.set(file, existing);
  }

  // Use method chunks for files that produced no primary chunks (e.g. migrations)
  for (const [file, fallbackChunks] of methodFallback) {
    if (!map.has(file)) map.set(file, fallbackChunks);
  }

  return map;
}

type FileDeltaMap = Map<string, ComplexityDelta>;

function buildDeltaMap(deltas: ComplexityDelta[] | null): Map<string, FileDeltaMap> {
  const map = new Map<string, FileDeltaMap>();
  for (const delta of deltas ?? []) {
    const fileMap = map.get(delta.filepath) ?? new Map<string, ComplexityDelta>();
    fileMap.set(`${delta.symbolName}:${delta.metricType}`, delta);
    map.set(delta.filepath, fileMap);
  }
  return map;
}

function computeChangedFunctions(
  file: string,
  fileChunks: CodeChunk[] | undefined,
  diffLines: Map<string, Set<number>> | undefined,
): Set<string> {
  const changed = new Set<string>();
  if (!fileChunks || !diffLines) return changed;

  const fileDiffLines = diffLines.get(file);
  if (!fileDiffLines || fileDiffLines.size === 0) return changed;

  for (const chunk of fileChunks) {
    const name = chunk.metadata.symbolName;
    if (!name) continue;
    for (const line of fileDiffLines) {
      if (line >= chunk.metadata.startLine && line <= chunk.metadata.endLine) {
        changed.add(name);
        break;
      }
    }
  }
  return changed;
}

function buildFileStats(
  file: string,
  report: ComplexityReport,
  fileDeltaMap: FileDeltaMap | undefined,
  changedFunctions: Set<string>,
): string {
  const fileData = report.files[file];
  const lines: string[] = [];

  if (fileData) {
    if (fileData.dependents.length > 0)
      lines.push(`*depended on by: ${fileData.dependents.join(', ')}*`);

    if (fileData.testAssociations.length > 0) {
      lines.push(`*tests: ${fileData.testAssociations.join(', ')}*`);
    } else if (categorizeFile(file) === 'source') {
      lines.push('*tests: none*');
    }
  }

  if (changedFunctions.size > 0) {
    lines.push(`*changed: ${[...changedFunctions].join(', ')}*`);
  }

  if (fileData?.violations && fileData.violations.length > 0) {
    const formatted = fileData.violations.map(v => {
      const icon = v.severity === 'error' ? '🔴' : '🟡';
      const delta = fileDeltaMap?.get(`${v.symbolName}:${v.metricType}`);
      let deltaStr = '';
      if (delta) {
        if (delta.severity === 'new') deltaStr = ' new';
        else if (delta.delta > 0) deltaStr = ` +${delta.delta}`;
        else if (delta.delta < 0) deltaStr = ` ${delta.delta}`;
      }
      return `${v.symbolName} (${v.metricType} ${v.complexity}/${v.threshold} ${icon}${deltaStr})`;
    });
    lines.push(`*violations: ${formatted.join(', ')}*`);
  }

  return lines.join('\n');
}

/**
 * Select which chunks to include given the remaining character budget.
 * Returns all chunks if they fit, falls back to changed chunks only, or null if nothing fits.
 */
function selectChunksForBudget(
  file: string,
  fileChunks: CodeChunk[],
  remainingBudget: number,
  diffLines: Map<string, Set<number>> | undefined,
): CodeChunk[] | null {
  const allCode = fileChunks.map(c => c.content).join('\n\n');
  if (allCode.length <= remainingBudget) return fileChunks;

  const fileDiffLines = diffLines?.get(file);
  if (!fileDiffLines || fileDiffLines.size === 0) return null;

  const changedChunks = fileChunks.filter(c =>
    [...fileDiffLines].some(line => line >= c.metadata.startLine && line <= c.metadata.endLine),
  );
  if (changedChunks.length === 0) return null;

  const changedCode = changedChunks.map(c => c.content).join('\n\n');
  return changedCode.length <= remainingBudget ? changedChunks : null;
}

function buildFileSection(
  file: string,
  report: ComplexityReport,
  fileChunks: CodeChunk[] | undefined,
  remainingBudget: number,
  fileDeltaMap: FileDeltaMap | undefined,
  diffLines: Map<string, Set<number>> | undefined,
): { text: string; contentChars: number } {
  const changedFunctions = computeChangedFunctions(file, fileChunks, diffLines);
  const stats = buildFileStats(file, report, fileDeltaMap, changedFunctions);
  const header = stats ? `### ${file}\n${stats}` : `### ${file}`;

  if (fileChunks) {
    const chunks = selectChunksForBudget(file, fileChunks, remainingBudget, diffLines);
    if (chunks) {
      const code = chunks.map(c => c.content).join('\n\n');
      return { text: `${header}\n\`\`\`\n${code}\n\`\`\``, contentChars: code.length };
    }
  }

  return { text: `${header}\n*(content not available)*`, contentChars: 0 };
}

function buildCodeContext(
  chunks: CodeChunk[],
  report: ComplexityReport,
  changedFiles: string[],
  allChangedFiles: string[],
  deltas?: ComplexityDelta[] | null,
  diffLines?: Map<string, Set<number>>,
): string {
  const chunksByFile = groupChunksByFile(chunks, new Set(changedFiles));
  const deltaMap = buildDeltaMap(deltas ?? null);

  const sortedFiles = [...allChangedFiles].sort((a, b) => {
    const depA = report.files[a]?.dependents.length ?? 0;
    const depB = report.files[b]?.dependents.length ?? 0;
    return depB - depA;
  });

  const sections: string[] = [];
  let totalChars = 0;

  for (const file of sortedFiles) {
    const { text, contentChars } = buildFileSection(
      file,
      report,
      chunksByFile.get(file),
      MAX_TOTAL_CHARS - totalChars,
      deltaMap.get(file),
      diffLines,
    );
    sections.push(text);
    totalChars += contentChars;
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Prompt Building
// ---------------------------------------------------------------------------

function formatRiskSignals(signals: RiskSignals): string {
  const parts: string[] = [];
  parts.push(`Files changed: ${signals.totalFiles}`);

  const nonZeroCategories = Object.entries(signals.categories)
    .filter(([, count]) => count > 0)
    .map(([cat, count]) => `${cat}: ${count}`);
  if (nonZeroCategories.length > 0) {
    parts.push(`Categories: ${nonZeroCategories.join(', ')}`);
  }

  if (signals.languages.length > 0) {
    parts.push(`Languages: ${signals.languages.join(', ')}`);
  }

  if (signals.newViolations > 0) parts.push(`New complexity violations: ${signals.newViolations}`);
  if (signals.improvedViolations > 0)
    parts.push(`Improved/resolved: ${signals.improvedViolations}`);
  if (signals.hasExportChanges) parts.push(`Export/interface changes detected`);

  return parts.join('\n');
}

function buildDiffSection(
  allChangedFiles: string[],
  patches: Map<string, string> | undefined,
): string {
  if (!patches || patches.size === 0) return '';

  const sections: string[] = [];
  let totalChars = 0;

  for (const file of allChangedFiles) {
    const patch = patches.get(file);
    if (!patch) continue;

    const remaining = MAX_TOTAL_CHARS - totalChars;
    if (remaining <= 0) break;

    const truncated =
      patch.length > remaining ? patch.slice(0, remaining) + '\n... (truncated)' : patch;
    sections.push(`### ${file}\n\`\`\`diff\n${truncated}\n\`\`\``);
    totalChars += patch.length;
  }

  return sections.join('\n\n');
}

export function buildSummaryPrompt(
  signals: RiskSignals,
  codeContext: string,
  context: ReviewContext,
): string {
  const body = context.pr?.body ? context.pr.body.slice(0, 2000) : undefined;
  const prHeader = context.pr ? `## PR: ${context.pr.title}${body ? `\n\n${body}` : ''}\n\n` : '';
  const hasDescription = !!body && body.trim().length > 0;

  const allChangedFiles = context.allChangedFiles ?? context.changedFiles;
  const diffSection = buildDiffSection(allChangedFiles, context.pr?.patches);

  const overviewGuideline = hasDescription
    ? `- **overview**: Add context the description misses — non-obvious implications, affected areas, or architectural impact. Do NOT restate what the PR description already says. If the description is comprehensive, return an empty string \`""\``
    : `- **overview**: Focus on intent, not implementation details`;

  const keyChangesGuideline = hasDescription
    ? `- **key_changes**: Derive strictly from the diff above — list only changes NOT already covered in the PR description. Return an empty array \`[]\` if the description already covers all key changes`
    : `- **key_changes**: Derive strictly from the diff above — 2-5 bullets stating what was added, removed, or changed. Avoid inferring changes not visible in the diff`;

  return `You are a senior engineer writing a concise PR summary with risk assessment.

${prHeader}## Risk Signals

${formatRiskSignals(signals)}
${diffSection ? `\n## What Changed\n\n${diffSection}\n` : ''}
## Code Context

${codeContext}

## Instructions

Write a brief PR summary. Respond with ONLY valid JSON:

\`\`\`json
{
  "risk_level": "low | medium | high | critical",
  "confidence": "low | medium | high",
  "risk_explanation": "1-2 sentences explaining the risk level",
  "overview": "1-2 sentence summary of what this PR does (or empty string if PR description is sufficient)",
  "key_changes": ["change 1", "change 2"]
}
\`\`\`

Guidelines:
- **risk_level**: "low" for docs/tests/config-only, "medium" for source changes with moderate scope, "high" for infra/db/many dependents/export changes/untested source files, "critical" for breaking changes to widely-used interfaces
- **confidence**: "high" when the diff and code context are clear and complete, "medium" when some files were truncated or the scope is ambiguous, "low" when the context is very limited
${overviewGuideline}
${keyChangesGuideline}
- Be factual and specific — avoid vague language
- NEVER repeat information already present in the PR title or description — only add new insight
- Assess risk based on the CODE IMPACT (what the diff actually does), not the PR description framing. A PR described as "test" or "experiment" is still high-risk if it modifies auth, payment, or widely-used interfaces`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

interface SummaryResponse {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  risk_explanation: string;
  overview: string;
  key_changes: string[];
}

const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const VALID_CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const RISK_LABELS = ['low', 'medium', 'high', 'critical'] as const;

/**
 * Escalate risk level based on findings from other plugins.
 * Bug finder errors → at least "high". Complexity errors → at least "medium".
 */
function escalateRisk(
  baseRisk: 'low' | 'medium' | 'high' | 'critical',
  priorFindings: ReviewFinding[],
): 'low' | 'medium' | 'high' | 'critical' {
  let level = RISK_ORDER[baseRisk] ?? 0;

  const bugErrors = priorFindings.filter(f => f.pluginId === 'bugs' && f.severity === 'error');
  if (bugErrors.length > 0) level = Math.max(level, RISK_ORDER['high']);

  const complexityErrors = priorFindings.filter(
    f => f.pluginId === 'complexity' && f.severity === 'error',
  );
  if (complexityErrors.length > 0) level = Math.max(level, RISK_ORDER['medium']);

  return RISK_LABELS[level];
}

function formatEscalationReason(priorFindings: ReviewFinding[]): string {
  const bugFindings = priorFindings.filter(f => f.pluginId === 'bugs' && f.severity === 'error');
  if (bugFindings.length === 0) return '';

  const parts = bugFindings.map(f => {
    const meta = f.metadata as { callers?: Array<{ symbol: string }> } | undefined;
    const callerCount = meta?.callers?.length ?? 0;
    const sym = f.symbolName ? `\`${f.symbolName}\`` : 'a changed function';
    return `${sym} (${callerCount} caller${callerCount === 1 ? '' : 's'} affected)`;
  });

  return `Bug finder found errors in ${parts.join(', ')}.`;
}

function isValidSummaryResponse(parsed: unknown): parsed is SummaryResponse {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  return (
    typeof p.risk_level === 'string' &&
    VALID_RISK_LEVELS.has(p.risk_level) &&
    typeof p.confidence === 'string' &&
    VALID_CONFIDENCE_LEVELS.has(p.confidence) &&
    typeof p.risk_explanation === 'string' &&
    typeof p.overview === 'string' &&
    Array.isArray(p.key_changes) &&
    p.key_changes.every((c: unknown) => typeof c === 'string')
  );
}

export function parseSummaryResponse(content: string, logger: Logger): SummaryResponse | null {
  const jsonStr = extractJSONFromCodeBlock(content);

  try {
    const parsed = JSON.parse(jsonStr);
    if (isValidSummaryResponse(parsed)) return parsed;
  } catch {
    // Fall through to retry
  }

  // Aggressive retry: find outermost JSON object
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (isValidSummaryResponse(parsed)) {
        logger.info('Recovered summary response with retry parsing');
        return parsed;
      }
    } catch {
      // Total failure
    }
  }

  logger.warning('Failed to parse summary LLM response');
  return null;
}

// ---------------------------------------------------------------------------
// Markdown Formatting
// ---------------------------------------------------------------------------

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatSummaryMarkdown(response: SummaryResponse): string {
  const riskLabel = capitalizeFirst(response.risk_level);
  const confidenceLabel = capitalizeFirst(response.confidence);

  let md = `**${riskLabel} Risk** · ${confidenceLabel} Confidence — ${response.risk_explanation}`;

  if (response.overview) {
    md += `\n\n**Overview** — ${response.overview}`;
  }

  if (response.key_changes.length > 0) {
    const keyChanges = response.key_changes.map(c => `- ${c}`).join('\n');
    md += `\n\n**Key Changes**\n${keyChanges}`;
  }

  return md;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export class SummaryPlugin implements ReviewPlugin {
  id = 'summary';
  name = 'PR Summary';
  description = 'Human-readable PR summary with risk assessment';
  requiresLLM = true;

  shouldActivate(context: ReviewContext): boolean {
    return !!context.pr;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    if (!context.llm) return [];

    const { chunks, complexityReport, changedFiles, logger } = context;
    const allChangedFiles = context.allChangedFiles ?? changedFiles;

    logger.info('Computing risk signals for summary...');
    const signals = computeRiskSignals(context);

    const codeContext = buildCodeContext(
      chunks,
      complexityReport,
      changedFiles,
      allChangedFiles,
      context.deltas,
      context.pr?.diffLines,
    );
    const prompt = buildSummaryPrompt(signals, codeContext, context);
    const response = await context.llm.complete(prompt, { temperature: 0 });

    const parsed = parseSummaryResponse(response.content, logger);
    if (!parsed) return [];

    // Escalate risk based on findings from other plugins (bug errors → high risk)
    const priorFindings = context.priorFindings ?? [];
    const riskLevel = escalateRisk(parsed.risk_level, priorFindings);
    const riskExplanation =
      riskLevel !== parsed.risk_level
        ? `${parsed.risk_explanation} ${formatEscalationReason(priorFindings)}`
        : parsed.risk_explanation;

    const metadata: SummaryFindingMetadata = {
      pluginType: 'summary',
      riskLevel,
      confidence: parsed.confidence,
      overview: parsed.overview,
      keyChanges: parsed.key_changes,
    };

    return [
      {
        pluginId: 'summary',
        filepath: '',
        line: 0,
        severity: 'info',
        category: 'summary',
        message: parsed.overview,
        evidence: riskExplanation,
        metadata,
      },
    ];
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    if (findings.length === 0) return;

    const finding = findings[0];
    const meta = finding.metadata as SummaryFindingMetadata | undefined;
    if (!meta || meta.pluginType !== 'summary') return;

    const response: SummaryResponse = {
      risk_level: meta.riskLevel,
      confidence: meta.confidence,
      risk_explanation: finding.evidence ?? '',
      overview: meta.overview,
      key_changes: meta.keyChanges,
    };

    const markdown = formatSummaryMarkdown(response);

    // Contribute to unified PR description
    context.appendDescription(markdown, 'summary');

    // Append to check run summary
    context.appendSummary(markdown);
  }
}
