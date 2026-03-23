/**
 * Changed config key analysis.
 *
 * Detects changed config keys (.env, .json, .yaml, .toml, .ini) and checks
 * if consuming code's assumptions are broken by the value change.
 */

import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext, ReviewFinding, BugCallerInfo } from '../../plugin-types.js';
import { MAX_CALLER_SNIPPET_CHARS } from './types.js';
import { truncateContent, formatCallerTable } from './formatting.js';
import { parseBugResponse } from './parsing.js';

export const CONFIG_FILE_PATTERNS = /\.(env(\..*)?|json|ya?ml|toml|ini)$/;

const MAX_TYPE_IMPORTERS = 5;

interface ChangedConfigKey {
  filepath: string;
  key: string;
  oldValue: string;
  newValue: string;
}

/**
 * Detect changed config keys from diff patches of config files.
 */
export function detectChangedConfigKeys(patches: Map<string, string>): ChangedConfigKey[] {
  const results: ChangedConfigKey[] = [];

  for (const [filepath, patch] of patches) {
    if (!CONFIG_FILE_PATTERNS.test(filepath)) continue;

    const removed = new Map<string, string>();
    const added = new Map<string, string>();

    for (const line of patch.split('\n')) {
      if (!line.startsWith('-') && !line.startsWith('+')) continue;
      if (line.startsWith('---') || line.startsWith('+++')) continue;

      const content = line.slice(1).trim();
      if (!content || content.startsWith('#') || content.startsWith('//')) continue;

      const kv = parseConfigLine(content, filepath);
      if (!kv) continue;

      if (line.startsWith('-')) removed.set(kv.key, kv.value);
      else added.set(kv.key, kv.value);
    }

    // Keys that changed value (present in both with different values)
    for (const [key, oldVal] of removed) {
      const newVal = added.get(key);
      if (newVal !== undefined && newVal !== oldVal) {
        results.push({ filepath, key, oldValue: oldVal, newValue: newVal });
      }
    }
  }

  return results;
}

/**
 * Parse a config line into key-value pair based on file type.
 */
export function parseConfigLine(
  line: string,
  filepath: string,
): { key: string; value: string } | null {
  if (/\.env(\..*)?$/.test(filepath) || filepath.endsWith('.ini')) {
    // KEY=value or KEY="value"
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/);
    if (match) return { key: match[1], value: match[2].replace(/^["']|["']$/g, '') };
  }

  if (filepath.endsWith('.json')) {
    // "key": value
    const match = line.match(/^\s*"([^"]+)"\s*:\s*(.+?)\s*,?\s*$/);
    if (match) return { key: match[1], value: match[2].replace(/^["']|["']$/g, '') };
  }

  if (/\.ya?ml$/.test(filepath)) {
    // key: value
    const match = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_./-]*)\s*:\s*(.+)/);
    if (match) return { key: match[2], value: match[3].replace(/^["']|["']$/g, '').trim() };
  }

  if (filepath.endsWith('.toml')) {
    // key = value
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_.-]*)\s*=\s*(.+)/);
    if (match) return { key: match[1], value: match[2].replace(/^["']|["']$/g, '').trim() };
  }

  return null;
}

/**
 * Find repo chunks that reference a config key by name.
 * Searches for common config access patterns across languages.
 */
export function findConfigReferences(key: string, repoChunks: CodeChunk[]): CodeChunk[] {
  const seen = new Set<string>();
  // Common patterns: process.env.KEY, env('KEY'), config('KEY'), Config::get('KEY'),
  // os.environ['KEY'], os.getenv('KEY'), env::var("KEY")
  return repoChunks.filter(c => {
    if (!c.metadata.symbolName) return false;
    const uid = `${c.metadata.file}::${c.metadata.symbolName}`;
    if (seen.has(uid)) return false;
    if (c.content.includes(key)) {
      seen.add(uid);
      return true;
    }
    return false;
  });
}

/**
 * Analyze changed config keys by finding code that references them.
 */
export async function analyzeChangedConfigKeys(context: ReviewContext): Promise<ReviewFinding[]> {
  if (!context.llm || !context.repoChunks || !context.pr?.patches) return [];

  const changedKeys = detectChangedConfigKeys(context.pr.patches);
  if (changedKeys.length === 0) return [];

  context.logger.info(`Bug finder: ${changedKeys.length} changed config key(s) to analyze`);

  const findings = (
    await Promise.all(
      changedKeys
        .map(k => ({ ...k, refs: findConfigReferences(k.key, context.repoChunks!) }))
        .filter(k => k.refs.length > 0)
        .map(async ({ filepath, key, oldValue, newValue, refs }) => {
          const topRefs = refs.slice(0, MAX_TYPE_IMPORTERS);
          const refSections = topRefs
            .map(c => {
              const content = truncateContent(c.content, MAX_CALLER_SNIPPET_CHARS);
              return `**${c.metadata.file}::${c.metadata.symbolName}** (line ${c.metadata.startLine})\n\`\`\`${c.metadata.language ?? ''}\n${content}\n\`\`\``;
            })
            .join('\n\n');

          const prompt = `Check if this config value change breaks consuming code. Be terse — write like a linter, not a human.

## Changed Config

File: ${filepath}
Key: \`${key}\`
Before: \`${oldValue}\`
After:  \`${newValue}\`

## Code that references ${key}

${refSections}

## Response Format

ONLY valid JSON.

\`\`\`json
{
  "bugs": [
    {
      "changedFunction": "${key}",
      "callerFilepath": "path/to/file.ts",
      "callerLine": 42,
      "callerSymbol": "functionName",
      "severity": "error or warning",
      "category": "broken_assumption",
      "description": "Short statement (max 15 words)",
      "suggestion": "Short fix (max 15 words)"
    }
  ]
}
\`\`\`

Rules:
- ONLY report bugs you are confident about
- Look for: hardcoded assumptions about the old value, type mismatches from new value, boundary violations
- If no bugs, return \`{ "bugs": [] }\``;

          const response = await context.llm!.complete(prompt, { temperature: 0 });
          const bugs = parseBugResponse(response.content, context.logger);

          return bugs.map(bug => {
            const callerInfos: BugCallerInfo[] = [
              {
                filepath: bug.callerFilepath,
                line: bug.callerLine,
                symbol: bug.callerSymbol,
                category: bug.category,
                description: bug.description,
                suggestion: bug.suggestion,
              },
            ];

            return {
              pluginId: 'bugs',
              filepath,
              line: 1,
              symbolName: key,
              severity: bug.severity,
              category: 'bug',
              message: formatCallerTable(callerInfos),
              metadata: {
                pluginType: 'bugs',
                changedFunction: `${filepath}::${key}`,
                callers: callerInfos,
              },
            } satisfies ReviewFinding;
          });
        }),
    )
  ).flat();

  if (findings.length > 0) {
    context.logger.info(`Bug finder: ${findings.length} config key violation(s) found`);
  }

  return findings;
}
