import { ComplexityReport } from '../types.js';

/**
 * SARIF (Static Analysis Results Interchange Format) 2.1.0
 * Used by GitHub Code Scanning to show results in Security tab
 * https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning
 */
interface SarifReport {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri?: string;
      rules?: SarifRule[];
    };
  };
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  shortDescription: {
    text: string;
  };
  fullDescription?: {
    text: string;
  };
  help?: {
    text: string;
  };
  defaultConfiguration?: {
    level: 'warning' | 'error' | 'note';
  };
}

interface SarifResult {
  ruleId: string;
  level: 'warning' | 'error' | 'note';
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
      region: {
        startLine: number;
        endLine: number;
      };
    };
  }>;
}

/**
 * Get the SARIF rule ID for a metric type
 */
function getRuleId(metricType: string): string {
  switch (metricType) {
    case 'cognitive': return 'lien/high-cognitive-complexity';
    case 'cyclomatic': return 'lien/high-cyclomatic-complexity';
    case 'halstead_effort': return 'lien/high-halstead-effort';
    case 'halstead_bugs': return 'lien/high-estimated-bugs';
    default: return 'lien/high-complexity';
  }
}

/**
 * Format complexity report as SARIF for GitHub Code Scanning
 */
export function formatSarifReport(report: ComplexityReport): string {
  const rules: SarifRule[] = [
    {
      id: 'lien/high-cyclomatic-complexity',
      shortDescription: {
        text: 'Too many test paths',
      },
      fullDescription: {
        text: 'Function or method requires too many test cases to achieve full branch coverage. Each decision point (if, switch, loop) adds a path that needs testing.',
      },
      help: {
        text: 'Consider refactoring by extracting methods, using early returns, or simplifying conditional logic to reduce the number of test paths.',
      },
    },
    {
      id: 'lien/high-cognitive-complexity',
      shortDescription: {
        text: 'High cognitive complexity',
      },
      fullDescription: {
        text: 'Function or method has high cognitive complexity (deeply nested or hard to understand), making it difficult to maintain.',
      },
      help: {
        text: 'Consider flattening nested conditionals, extracting helper functions, or using guard clauses.',
      },
    },
    {
      id: 'lien/high-halstead-effort',
      shortDescription: {
        text: 'Long time to understand',
      },
      fullDescription: {
        text: 'Function or method takes too long to understand, based on Halstead metrics (operators and operands count).',
      },
      help: {
        text: 'Consider simplifying expressions, reducing variable count, or breaking into smaller functions.',
      },
    },
    {
      id: 'lien/high-estimated-bugs',
      shortDescription: {
        text: 'High estimated bug count',
      },
      fullDescription: {
        text: 'Function or method is likely to contain bugs based on Halstead metrics (Volume / 3000), which estimates bug count from code complexity.',
      },
      help: {
        text: 'Consider simplifying the function, breaking into smaller units, or adding thorough test coverage.',
      },
    },
  ];

  const results: SarifResult[] = [];

  // Convert violations to SARIF results
  for (const [filepath, fileData] of Object.entries(report.files)) {
    for (const violation of fileData.violations) {
      const ruleId = getRuleId(violation.metricType);
      
      results.push({
        ruleId,
        level: violation.severity,
        message: {
          text: `${violation.symbolName}: ${violation.message}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: filepath,
              },
              region: {
                startLine: violation.startLine,
                endLine: violation.endLine,
              },
            },
          },
        ],
      });
    }
  }

  const sarifReport: SarifReport = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Lien Complexity Analyzer',
            version: '1.0.0',
            informationUri: 'https://github.com/liendev/lien',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarifReport, null, 2);
}

