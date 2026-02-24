/**
 * Complexity review plugin.
 *
 * Detects complexity violations using @liendev/parser and posts them as
 * check run annotations. Pure AST — no LLM involved.
 */

import { z } from 'zod';
import { RISK_ORDER, type ComplexityViolation, type ComplexityReport } from '@liendev/parser';
import type {
  ReviewPlugin,
  ReviewContext,
  ReviewFinding,
  ComplexityFindingMetadata,
  PresentContext,
} from '../plugin-types.js';
import { getMetricLabel, formatComplexityValue, formatThresholdValue } from '../prompt.js';

export const complexityConfigSchema = z.object({
  threshold: z.number().default(15),
  blockOnNewErrors: z.boolean().default(false),
});

/**
 * Complexity review plugin: detects violations and annotates the check run.
 */
export class ComplexityPlugin implements ReviewPlugin {
  id = 'complexity';
  name = 'Complexity Review';
  description = 'Detects complexity violations and annotates the check run';
  requiresLLM = false;
  configSchema = complexityConfigSchema;
  defaultConfig = { threshold: 15, blockOnNewErrors: false };

  shouldActivate(context: ReviewContext): boolean {
    return context.complexityReport.summary.totalViolations > 0;
  }

  async analyze(context: ReviewContext): Promise<ReviewFinding[]> {
    const { complexityReport, deltas, logger } = context;

    const allViolations = Object.values(complexityReport.files).flatMap(f => f.violations);
    const violations = prioritizeViolations(allViolations, complexityReport);
    logger.info(`Complexity plugin: ${violations.length} violations to review`);

    const deltaMap = buildDeltaLookup(deltas);
    return violations.map(v => violationToFinding(v, deltaMap));
  }

  async present(findings: ReviewFinding[], context: PresentContext): Promise<void> {
    const complexityFindings = findings.filter(f => f.pluginId === 'complexity');

    context.setSummary(buildComplexitySummary(complexityFindings, findings, context));

    if (complexityFindings.length === 0) return;

    context.addAnnotations(
      worstPerFunction(complexityFindings).map(f => ({
        path: f.filepath,
        start_line: f.line,
        end_line: f.line,
        annotation_level: f.severity === 'error' ? ('failure' as const) : ('warning' as const),
        message: f.message,
        title: f.symbolName ? `${f.symbolName} — ${f.evidence}` : (f.evidence ?? 'Complexity'),
      })),
    );
  }
}

/**
 * Build a markdown summary for the check run output.
 * Used as the check run `summary` field — visible in the GitHub Checks tab.
 */
function buildComplexitySummary(
  complexityFindings: ReviewFinding[],
  allFindings: ReviewFinding[],
  context: PresentContext,
): string {
  const sections: string[] = [];

  // Complexity section
  if (complexityFindings.length === 0) {
    sections.push('✅ No complexity violations found.');
  } else {
    const errors = complexityFindings.filter(f => f.severity === 'error').length;
    const warnings = complexityFindings.filter(f => f.severity === 'warning').length;
    const functions = worstPerFunction(complexityFindings);

    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
    if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
    const heading = `${complexityFindings.length} violation${complexityFindings.length === 1 ? '' : 's'} across ${functions.length} function${functions.length === 1 ? '' : 's'} — ${parts.join(', ')}`;

    const deltaLine =
      context.deltaSummary && context.deltaSummary.totalDelta !== 0
        ? `\n\nComplexity change this PR: ${context.deltaSummary.totalDelta > 0 ? '+' : ''}${context.deltaSummary.totalDelta} (${context.deltaSummary.degraded} degraded, ${context.deltaSummary.improved} improved)`
        : '';

    const rows = functions
      .map(f => {
        const meta = f.metadata as ComplexityFindingMetadata;
        const label = getMetricLabel(meta.metricType);
        const value = formatComplexityValue(meta.metricType, meta.complexity);
        const threshold = formatThresholdValue(meta.metricType, meta.threshold);
        const sev = f.severity === 'error' ? ' 🔴' : '';
        return `| \`${f.symbolName ?? '?'}\` | \`${f.filepath}:${f.line}\` | ${label} | ${value}${sev} | ${threshold} |`;
      })
      .join('\n');

    const table = `| Function | Location | Metric | Value | Threshold |\n|---|---|---|---|---|\n${rows}`;
    sections.push(`${heading}${deltaLine}\n\n${table}`);
  }

  // Architectural observations section
  const archFindings = allFindings.filter(f => f.pluginId === 'architectural');
  if (archFindings.length > 0) {
    const archLines = archFindings
      .map(f => `> **${f.message}**\n> ${f.evidence ?? ''}\n> *Suggestion: ${f.suggestion ?? ''}*`)
      .join('\n\n');
    sections.push(`### Architectural observations\n\n${archLines}`);
  }

  return sections.join('\n\n');
}

/**
 * Deduplicate findings to one per function — keep the worst metric.
 * Worst = highest severity, then highest overage ratio (complexity / threshold).
 */
function worstPerFunction(findings: ReviewFinding[]): ReviewFinding[] {
  const groups = new Map<string, ReviewFinding>();
  for (const f of findings) {
    const key = `${f.filepath}::${f.symbolName ?? f.line}`;
    const existing = groups.get(key);
    if (!existing || isWorseThan(f, existing)) {
      groups.set(key, f);
    }
  }
  return Array.from(groups.values());
}

const SEVERITY_RANK: Record<string, number> = { error: 2, warning: 1, info: 0 };

function isWorseThan(a: ReviewFinding, b: ReviewFinding): boolean {
  const rankA = SEVERITY_RANK[a.severity] ?? 0;
  const rankB = SEVERITY_RANK[b.severity] ?? 0;
  if (rankA !== rankB) return rankA > rankB;
  const metaA = a.metadata as ComplexityFindingMetadata | undefined;
  const metaB = b.metadata as ComplexityFindingMetadata | undefined;
  if (metaA && metaB)
    return metaA.complexity / metaA.threshold > metaB.complexity / metaB.threshold;
  return false;
}

/**
 * Build a delta lookup from filepath::symbolName::metricType to delta value.
 */
function buildDeltaLookup(deltas: ReviewContext['deltas']): Map<string, number> {
  const map = new Map<string, number>();
  if (!deltas) return map;
  for (const d of deltas) {
    map.set(`${d.filepath}::${d.symbolName}::${d.metricType}`, d.delta);
  }
  return map;
}

/**
 * Convert a single ComplexityViolation into a ReviewFinding.
 */
function violationToFinding(v: ComplexityViolation, deltaMap: Map<string, number>): ReviewFinding {
  const metricType = v.metricType || 'cyclomatic';
  const delta = deltaMap.get(`${v.filepath}::${v.symbolName}::${metricType}`) ?? null;
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, v.threshold);

  return {
    pluginId: 'complexity',
    filepath: v.filepath,
    line: v.startLine,
    endLine: v.endLine,
    symbolName: v.symbolName,
    severity: v.severity,
    category: metricType,
    message: buildMessage(v, metricType, valueDisplay, thresholdDisplay),
    evidence: `${metricLabel}: ${valueDisplay} (threshold: ${thresholdDisplay})`,
    metadata: {
      pluginType: 'complexity',
      metricType,
      complexity: v.complexity,
      threshold: v.threshold,
      delta,
      symbolType: v.symbolType,
    } satisfies ComplexityFindingMetadata,
  };
}

/**
 * Build a per-metric actionable message for a violation.
 */
function buildMessage(
  v: ComplexityViolation,
  metricType: string,
  valueDisplay: string,
  thresholdDisplay: string,
): string {
  const t = v.symbolType;
  switch (metricType) {
    case 'cyclomatic':
      return `This ${t} requires ${valueDisplay} for full coverage (threshold: ${thresholdDisplay}). Too many branches — consider splitting into smaller, focused functions.`;
    case 'cognitive':
      return `This ${t} has cognitive complexity ${v.complexity} (threshold: ${v.threshold}). Deep nesting or complex control flow — consider early returns or extracting nested blocks.`;
    case 'halstead_effort':
      return `This ${t} takes ${valueDisplay} to understand (threshold: ${thresholdDisplay}). Reduce operator and operand variety to improve readability.`;
    case 'halstead_bugs':
      return `This ${t} has estimated bug density ${valueDisplay} (threshold: ${thresholdDisplay}). High algorithmic complexity increases error likelihood — consider simplifying the logic.`;
    default:
      return `This ${t} has complexity ${v.complexity} (threshold: ${v.threshold}). Consider refactoring to reduce complexity.`;
  }
}

/**
 * Prioritize violations by impact (dependents + severity).
 */
function prioritizeViolations(
  violations: ComplexityViolation[],
  report: ComplexityReport,
): ComplexityViolation[] {
  return [...violations].sort((a, b) => {
    const fileA = report.files[a.filepath];
    const fileB = report.files[b.filepath];

    const impactA = (fileA?.dependentCount || 0) * 10 + RISK_ORDER[fileA?.riskLevel || 'low'];
    const impactB = (fileB?.dependentCount || 0) * 10 + RISK_ORDER[fileB?.riskLevel || 'low'];

    if (impactB !== impactA) return impactB - impactA;

    const severityOrder = { error: 2, warning: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}
