/**
 * Markdown rendering for BlastRadiusReport.
 *
 * Kept separate from computeBlastRadius so the prompt format can evolve
 * without touching compute logic.
 */

import type { BlastRadiusReport, BlastRadiusEntry, BlastRadiusDependent } from './blast-radius.js';

const LEVEL_LABEL: Record<string, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
};

/**
 * Render a blast-radius report as markdown wrapped in a `<blast_radius>` XML tag.
 * Returns an empty string when the report has no entries, so callers can
 * unconditionally append without an emptiness check.
 */
export function renderBlastRadiusMarkdown(report: BlastRadiusReport): string {
  if (report.entries.length === 0) return '';

  const lines: string[] = [];
  lines.push('<blast_radius>');
  lines.push(renderSummary(report));
  lines.push('');
  lines.push(...renderTable(report.entries));

  if (report.truncated) {
    const shown = report.entries.reduce((n, e) => n + e.dependents.length, 0);
    lines.push('');
    lines.push(
      `[truncated — showing ${shown} dependents across ${report.entries.length} seed(s); more exist]`,
    );
  }

  lines.push('</blast_radius>');
  return lines.join('\n');
}

function renderSummary(report: BlastRadiusReport): string {
  const level = LEVEL_LABEL[report.globalRisk.level] ?? report.globalRisk.level.toUpperCase();
  const reasoning = report.globalRisk.reasoning.join(', ');
  const base = `Global risk: ${level}`;
  if (reasoning.length > 0) {
    return `${base} — ${report.totalDistinctDependents} distinct dependents (${reasoning}).`;
  }
  return `${base} — ${report.totalDistinctDependents} distinct dependents.`;
}

function renderTable(entries: BlastRadiusEntry[]): string[] {
  const rows: string[] = [];
  rows.push('| Seed (changed) | Hops | Dependent | Tests | Complexity |');
  rows.push('|---|---|---|---|---|');

  for (const entry of entries) {
    const seedLabel = formatSeed(entry);
    // Intra-entry sort: shorter hops first, then alphabetical
    const deps = [...entry.dependents].sort((a, b) => {
      if (a.hops !== b.hops) return a.hops - b.hops;
      return a.filepath.localeCompare(b.filepath);
    });
    for (const dep of deps) {
      rows.push(
        `| \`${seedLabel}\` | ${dep.hops} | ${formatDependent(dep)} | ${dep.hasTestCoverage ? '✓' : '✗'} | ${formatComplexity(dep)} |`,
      );
    }
  }

  return rows;
}

function formatSeed(entry: BlastRadiusEntry): string {
  return `${entry.seed.filepath}:${entry.seed.symbolName}`;
}

function formatDependent(dep: BlastRadiusDependent): string {
  return `\`${dep.filepath}:${dep.symbolName}\` (L${dep.callSiteLine})`;
}

function formatComplexity(dep: BlastRadiusDependent): string {
  return typeof dep.complexity === 'number' ? String(dep.complexity) : '—';
}
