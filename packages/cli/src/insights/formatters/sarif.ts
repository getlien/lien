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
 * Format complexity report as SARIF for GitHub Code Scanning
 */
export function formatSarifReport(report: ComplexityReport): string {
  const rules: SarifRule[] = [
    {
      id: 'lien/high-complexity',
      shortDescription: {
        text: 'High cyclomatic complexity',
      },
      fullDescription: {
        text: 'Function or method has high cyclomatic complexity, making it difficult to understand and maintain.',
      },
      help: {
        text: 'Consider refactoring by extracting methods, using early returns, or simplifying conditional logic.',
      },
      // No defaultConfiguration - level is determined by actual violation severity
    },
  ];

  const results: SarifResult[] = [];

  // Convert violations to SARIF results
  for (const [filepath, fileData] of Object.entries(report.files)) {
    for (const violation of fileData.violations) {
      results.push({
        ruleId: 'lien/high-complexity',
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

