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

  for (const file of allFiles) {
    categories[categorizeFile(file)]++;
  }

  // Languages from chunks
  const langSet = new Set<string>();
  for (const chunk of context.chunks) {
    if (chunk.metadata.language) langSet.add(chunk.metadata.language);
  }

  // Complexity delta summary
  let newViolations = 0;
  let improvedViolations = 0;
  if (context.deltas) {
    for (const delta of context.deltas) {
      if (delta.severity === 'new' || delta.severity === 'error' || delta.severity === 'warning')
        newViolations++;
      if (delta.severity === 'improved' || delta.severity === 'deleted') improvedViolations++;
    }
  }

  // High-risk files (files with many dependents)
  let highRiskFileCount = 0;
  for (const file of allFiles) {
    const fileData = context.complexityReport.files[file];
    if (fileData && (fileData.dependentCount ?? 0) > 0) highRiskFileCount++;
  }

  // Export changes
  const hasExportChanges = detectExportChanges(context);

  return {
    totalFiles: allFiles.length,
    categories,
    languages: [...langSet].sort(),
    newViolations,
    improvedViolations,
    highRiskFileCount,
    hasExportChanges,
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

const MAX_TOTAL_CHARS = 30_000;

function buildCodeContext(
  chunks: CodeChunk[],
  report: ComplexityReport,
  changedFiles: string[],
): string {
  const changedFilesSet = new Set(changedFiles);
  const chunksByFile = new Map<string, CodeChunk[]>();

  for (const chunk of chunks) {
    const file = chunk.metadata.file;
    if (!changedFilesSet.has(file)) continue;
    if (chunk.metadata.symbolType === 'method') continue;
    if (chunk.metadata.type === 'block' && !chunk.metadata.symbolName) continue;
    const existing = chunksByFile.get(file) ?? [];
    existing.push(chunk);
    chunksByFile.set(file, existing);
  }

  // Sort files by dependentCount descending
  const sortedFiles = [...chunksByFile.keys()].sort((a, b) => {
    const depA = report.files[a]?.dependentCount ?? 0;
    const depB = report.files[b]?.dependentCount ?? 0;
    return depB - depA;
  });

  const sections: string[] = [];
  let totalChars = 0;

  for (const file of sortedFiles) {
    const fileChunks = chunksByFile.get(file)!;
    const fileCode = fileChunks.map(c => c.content).join('\n\n');
    if (totalChars + fileCode.length > MAX_TOTAL_CHARS) continue;

    const dependentCount = report.files[file]?.dependentCount ?? 0;
    const header =
      dependentCount > 0 ? `### ${file} (${dependentCount} dependents)` : `### ${file}`;
    sections.push(`${header}\n\`\`\`\n${fileCode}\n\`\`\``);
    totalChars += fileCode.length;
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
  if (signals.highRiskFileCount > 0)
    parts.push(`High-impact files (with dependents): ${signals.highRiskFileCount}`);
  if (signals.hasExportChanges) parts.push(`Export/interface changes detected`);

  return parts.join('\n');
}

export function buildSummaryPrompt(
  signals: RiskSignals,
  codeContext: string,
  context: ReviewContext,
): string {
  const body = context.pr?.body ? context.pr.body.slice(0, 2000) : undefined;
  const prHeader = context.pr ? `## PR: ${context.pr.title}${body ? `\n\n${body}` : ''}\n\n` : '';
  const hasDescription = !!body && body.trim().length > 0;

  const overviewGuideline = hasDescription
    ? `- **overview**: Add context the description misses — non-obvious implications, affected areas, or architectural impact. Do NOT restate what the PR description already says. If the description is comprehensive, return an empty string \`""\``
    : `- **overview**: Focus on intent, not implementation details`;

  const keyChangesGuideline = hasDescription
    ? `- **key_changes**: List only changes NOT already covered in the PR description. Return an empty array \`[]\` if the description already covers all key changes`
    : `- **key_changes**: 2-5 bullets, each under 100 characters`;

  return `You are a senior engineer writing a concise PR summary with risk assessment.

${prHeader}## Risk Signals

${formatRiskSignals(signals)}

## Changed Code

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
- **risk_level**: "low" for docs/tests/config-only, "medium" for source changes with moderate scope, "high" for infra/db/many dependents/export changes, "critical" for breaking changes to widely-used interfaces
- **confidence**: "high" when the code context is clear and complete, "medium" when some files were truncated or the scope is ambiguous, "low" when the context is very limited
${overviewGuideline}
${keyChangesGuideline}
- Be factual and specific — avoid vague language
- NEVER repeat information already present in the PR title or description — only add new insight`;
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

  let md = `### Lien Summary

> **${riskLabel} Risk** · ${confidenceLabel} Confidence
>
> ${response.risk_explanation}`;

  if (response.overview) {
    md += `\n\n**Overview** — ${response.overview}`;
  }

  if (response.key_changes.length > 0) {
    const keyChanges = response.key_changes.map(c => `- ${c}`).join('\n');
    md += `\n\n**Key Changes**\n${keyChanges}`;
  }

  md += `\n\n*[Lien Review](https://lien.dev)*`;

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

    logger.info('Computing risk signals for summary...');
    const signals = computeRiskSignals(context);

    const codeContext = buildCodeContext(chunks, complexityReport, changedFiles);
    const prompt = buildSummaryPrompt(signals, codeContext, context);
    const response = await context.llm.complete(prompt);

    const parsed = parseSummaryResponse(response.content, logger);
    if (!parsed) return [];

    const metadata: SummaryFindingMetadata = {
      pluginType: 'summary',
      riskLevel: parsed.risk_level,
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
        evidence: parsed.risk_explanation,
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

    // Update PR description with dedicated section markers
    if (context.updateDescription) {
      await context.updateDescription(markdown, 'summary');
    }

    // Append to check run summary
    context.appendSummary(markdown);
  }
}
