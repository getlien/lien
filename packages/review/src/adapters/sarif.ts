/**
 * SARIF output adapter.
 *
 * Maps ReviewFinding[] to SARIF format for CI integration.
 * Follows the pattern from `lien complexity --format sarif`.
 */

import type {
  OutputAdapter,
  AdapterResult,
  AdapterContext,
  ReviewFinding,
} from '../plugin-types.js';

/**
 * SARIF severity level mapping.
 */
const SEVERITY_TO_SARIF: Record<string, string> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

/**
 * SARIF output adapter: produces SARIF JSON to stdout.
 */
export class SARIFAdapter implements OutputAdapter {
  async present(findings: ReviewFinding[], context: AdapterContext): Promise<AdapterResult> {
    const sarifOutput = buildSARIF(findings);
    console.log(JSON.stringify(sarifOutput, null, 2));
    return { posted: findings.length, skipped: 0, filtered: 0 };
  }
}

/**
 * Build a SARIF 2.1.0 log from review findings.
 */
function buildSARIF(findings: ReviewFinding[]): SARIFLog {
  // Collect unique rules from findings
  const ruleMap = new Map<string, SARIFRule>();
  for (const f of findings) {
    const ruleId = `${f.pluginId}/${f.category}`;
    if (!ruleMap.has(ruleId)) {
      ruleMap.set(ruleId, {
        id: ruleId,
        shortDescription: { text: `${f.pluginId}: ${f.category}` },
        defaultConfiguration: {
          level: SEVERITY_TO_SARIF[f.severity] ?? 'note',
        },
      });
    }
  }

  const results: SARIFResult[] = findings.map(f => {
    const ruleId = `${f.pluginId}/${f.category}`;
    const result: SARIFResult = {
      ruleId,
      level: SEVERITY_TO_SARIF[f.severity] ?? 'note',
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.filepath },
            region: {
              startLine: f.line,
              ...(f.endLine ? { endLine: f.endLine } : {}),
            },
          },
        },
      ],
    };

    if (f.suggestion) {
      result.fixes = [
        {
          description: { text: f.suggestion },
        },
      ];
    }

    return result;
  });

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'lien-review',
            informationUri: 'https://lien.dev',
            rules: Array.from(ruleMap.values()),
          },
        },
        results,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// SARIF Types (minimal)
// ---------------------------------------------------------------------------

interface SARIFLog {
  $schema: string;
  version: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        rules: SARIFRule[];
      };
    };
    results: SARIFResult[];
  }>;
}

interface SARIFRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: string };
}

interface SARIFResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number; endLine?: number };
    };
  }>;
  fixes?: Array<{ description: { text: string } }>;
}
