#!/usr/bin/env node
// Computes the e2e-tests-parallel matrix for e2e.yml.
//
// ADR-013 Phase 4-B removed the legacy (node-tree-sitter) parser backend
// entirely -- native is the only backend now, so every trigger (PR,
// workflow_dispatch) runs the full 12-project suite exactly once, under
// LIEN_PARSER=native. There is no longer a parser-mode axis to plan around;
// this script now just emits the static project list with a constant `mode`.
//
// The `mode: 'native'` field is kept on every entry (rather than dropped)
// purely so job names (`E2E - ${{ matrix.project }} (${{ matrix.language }},
// ${{ matrix.mode }})`) and failure-artifact names in e2e.yml stay byte-for-
// byte identical to the native-mode entries the pre-4-B matrix already
// produced on every trigger -- avoids churning check names that branch
// protection / required-checks config may reference.
//
// Usage (from repo root, in CI): node .github/scripts/plan-e2e-matrix.mjs
// Env: GITHUB_OUTPUT = path to append "matrix=<json>" to (set by Actions;
//      falls back to stdout when unset, e.g. local dry-run)

import { appendFileSync } from 'node:fs';

const PROJECTS = [
  { project: 'Requests', language: 'Python', script: 'test:e2e:python' },
  { project: 'Zod', language: 'TypeScript', script: 'test:e2e:typescript' },
  { project: 'Express', language: 'JavaScript', script: 'test:e2e:javascript' },
  { project: 'Monolog', language: 'PHP', script: 'test:e2e:php' },
  { project: 'Anyhow', language: 'Rust', script: 'test:e2e:rust' },
  { project: 'Chi', language: 'Go', script: 'test:e2e:go' },
  { project: 'JavaPoet', language: 'Java', script: 'test:e2e:java' },
  { project: 'MediatR', language: 'CSharp', script: 'test:e2e:csharp' },
  { project: 'Sinatra', language: 'Ruby', script: 'test:e2e:ruby' },
  { project: 'Klaxon', language: 'Kotlin', script: 'test:e2e:kotlin' },
  { project: 'SwiftyJSON', language: 'Swift', script: 'test:e2e:swift' },
  { project: 'MCP Round Trip', language: 'Protocol', script: 'test:e2e:mcp' },
];

const matrix = PROJECTS.map(function (p) {
  return Object.assign({}, p, { mode: 'native' });
});

const outputLine = 'matrix=' + JSON.stringify(matrix) + '\n';
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
} else {
  process.stdout.write(outputLine);
}
