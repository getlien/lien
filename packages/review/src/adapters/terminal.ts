/**
 * Terminal output adapter for `lien review` CLI.
 *
 * Colored output grouped by file, sorted by severity.
 */

import type {
  OutputAdapter,
  AdapterResult,
  AdapterContext,
  ReviewFinding,
} from '../plugin-types.js';

/** ANSI color codes (no chalk dependency in the review package) */
const COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const;

const SEVERITY_COLORS: Record<string, string> = {
  error: COLORS.red,
  warning: COLORS.yellow,
  info: COLORS.blue,
};

const SEVERITY_LABELS: Record<string, string> = {
  error: 'ERROR',
  warning: 'WARN',
  info: 'INFO',
};

const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Terminal adapter: colored output grouped by file.
 */
export class TerminalAdapter implements OutputAdapter {
  private readonly useColor: boolean;

  constructor(opts?: { color?: boolean }) {
    this.useColor = opts?.color ?? true;
  }

  async present(findings: ReviewFinding[], context: AdapterContext): Promise<AdapterResult> {
    if (findings.length === 0) {
      this.print(`\n${this.c(COLORS.bold)}No review findings.${this.c(COLORS.reset)}\n`);
      return { posted: 0, skipped: 0, filtered: 0 };
    }

    const byFile = groupByFile(findings);

    this.print('');
    for (const [filepath, fileFindings] of byFile) {
      this.printFileFindings(filepath, fileFindings);
    }

    this.printSummary(findings);
    this.printLLMUsage(context);
    this.print('');

    return { posted: findings.length, skipped: 0, filtered: 0 };
  }

  private printFileFindings(filepath: string, findings: ReviewFinding[]): void {
    this.print(`${this.c(COLORS.bold)}${filepath}${this.c(COLORS.reset)}`);

    for (const f of findings) {
      const color = SEVERITY_COLORS[f.severity] ?? '';
      const label = SEVERITY_LABELS[f.severity] ?? f.severity.toUpperCase();
      const lineRef = f.line > 0 ? `:${f.line}` : '';
      const symbolRef = f.symbolName
        ? ` ${this.c(COLORS.dim)}(${f.symbolName})${this.c(COLORS.reset)}`
        : '';

      this.print(
        `  ${this.c(color)}${label}${this.c(COLORS.reset)} ${this.c(COLORS.gray)}[${f.category}]${this.c(COLORS.reset)}${lineRef}${symbolRef}`,
      );
      this.print(`    ${f.message}`);

      if (f.suggestion) {
        this.print(`    ${this.c(COLORS.dim)}Suggestion: ${f.suggestion}${this.c(COLORS.reset)}`);
      }

      if (f.evidence) {
        this.print(`    ${this.c(COLORS.dim)}${f.evidence}${this.c(COLORS.reset)}`);
      }
    }

    this.print('');
  }

  private printSummary(findings: ReviewFinding[]): void {
    const errorCount = findings.filter(f => f.severity === 'error').length;
    const warningCount = findings.filter(f => f.severity === 'warning').length;
    const infoCount = findings.filter(f => f.severity === 'info').length;

    const parts: string[] = [];
    if (errorCount > 0)
      parts.push(
        `${this.c(COLORS.red)}${errorCount} error${errorCount === 1 ? '' : 's'}${this.c(COLORS.reset)}`,
      );
    if (warningCount > 0)
      parts.push(
        `${this.c(COLORS.yellow)}${warningCount} warning${warningCount === 1 ? '' : 's'}${this.c(COLORS.reset)}`,
      );
    if (infoCount > 0) parts.push(`${this.c(COLORS.blue)}${infoCount} info${this.c(COLORS.reset)}`);

    this.print(
      `${this.c(COLORS.bold)}${findings.length} finding${findings.length === 1 ? '' : 's'}${this.c(COLORS.reset)} (${parts.join(', ')})`,
    );
  }

  private printLLMUsage(context: AdapterContext): void {
    const usage = context.llmUsage;
    if (!usage || usage.totalTokens === 0) return;

    const costStr = usage.cost > 0 ? ` ($${usage.cost.toFixed(4)})` : '';
    const modelStr = context.model ? ` | model: ${context.model}` : '';
    this.print(
      `${this.c(COLORS.dim)}LLM: ${usage.totalTokens.toLocaleString()} tokens${costStr}${modelStr}${this.c(COLORS.reset)}`,
    );
  }

  private c(code: string): string {
    return this.useColor ? code : '';
  }

  private print(line: string): void {
    console.log(line);
  }
}

/**
 * Sort findings by severity then file, and group by file path.
 */
function groupByFile(findings: ReviewFinding[]): Map<string, ReviewFinding[]> {
  const sorted = [...findings].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2);
    if (sevDiff !== 0) return sevDiff;
    return a.filepath.localeCompare(b.filepath);
  });

  const byFile = new Map<string, ReviewFinding[]>();
  for (const f of sorted) {
    const existing = byFile.get(f.filepath) || [];
    existing.push(f);
    byFile.set(f.filepath, existing);
  }
  return byFile;
}
