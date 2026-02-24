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
    if (complexityFindings.length === 0) return;

    context.addAnnotations(
      complexityFindings.map(f => ({
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
