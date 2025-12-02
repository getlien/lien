/**
 * Run lien complexity analysis via CLI
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import type { ComplexityReport } from './types.js';

/**
 * Run lien complexity command on specified files
 */
export async function runComplexityAnalysis(
  files: string[],
  threshold: string
): Promise<ComplexityReport | null> {
  if (files.length === 0) {
    core.info('No files to analyze');
    return null;
  }

  let stdout = '';
  let stderr = '';

  const args = [
    'complexity',
    '--format',
    'json',
    '--threshold',
    threshold,
    '--files',
    ...files,
  ];

  core.info(`Running: lien ${args.join(' ')}`);

  try {
    const exitCode = await exec.exec('lien', args, {
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString();
        },
        stderr: (data: Buffer) => {
          stderr += data.toString();
        },
      },
      ignoreReturnCode: true,
    });

    // lien complexity may exit with non-zero if violations found, that's OK
    if (exitCode !== 0 && !stdout.trim()) {
      core.warning(`lien complexity exited with code ${exitCode}`);
      if (stderr) {
        core.warning(`stderr: ${stderr}`);
      }
    }

    if (!stdout.trim()) {
      core.info('No complexity output received');
      return null;
    }

    const report: ComplexityReport = JSON.parse(stdout);
    return report;
  } catch (error) {
    core.error(`Failed to run complexity analysis: ${error}`);
    return null;
  }
}

/**
 * Filter files to only include those that can be analyzed
 * (excludes non-code files, vendor, node_modules, etc.)
 */
export function filterAnalyzableFiles(files: string[]): string[] {
  const codeExtensions = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.php',
  ]);

  const excludePatterns = [
    /node_modules\//,
    /vendor\//,
    /dist\//,
    /build\//,
    /\.min\./,
    /\.bundle\./,
    /\.generated\./,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/,
  ];

  return files.filter((file) => {
    // Check extension
    const ext = file.slice(file.lastIndexOf('.'));
    if (!codeExtensions.has(ext)) {
      return false;
    }

    // Check exclude patterns
    for (const pattern of excludePatterns) {
      if (pattern.test(file)) {
        return false;
      }
    }

    return true;
  });
}

