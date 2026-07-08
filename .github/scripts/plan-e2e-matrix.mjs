#!/usr/bin/env node
// Computes the e2e-tests-parallel matrix for e2e.yml.
//
// Every normal (changeset- or `e2e`-label-triggered) PR run exercises all 12
// project/language e2e scripts once under the default LIEN_PARSER=legacy
// backend, PLUS a LIEN_PARSER=native rerun for exactly two representative
// jobs -- TypeScript (the most heavily used grammar) and Kotlin (the one
// vendored, non-npm-prebuilt grammar -- see ADR-013's Phase 0 crate audit)
// -- so every release-bound PR proves native e2e coverage without doubling
// all 12 jobs on every run.
//
// A workflow_dispatch run instead honors the `parser-mode` input, running
// the full 12-project suite under 'legacy', 'native', or both ('both' = the
// full 12x2 cross product) -- see e2e.yml's workflow_dispatch input
// description.
//
// Usage (from repo root, in CI): node .github/scripts/plan-e2e-matrix.mjs
// Env: IS_DISPATCH        = 'true' | 'false' (default 'false')
//      PARSER_MODE_INPUT  = 'legacy' (default) | 'native' | 'both' -- only
//                           consulted when IS_DISPATCH is 'true'
//      GITHUB_OUTPUT       = path to append "matrix=<json>" to (set by Actions)

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

// The two representative jobs that get a native rerun on every normal
// (non-dispatch) trigger -- see header comment above.
const REPRESENTATIVE_NATIVE_LANGUAGES = ['TypeScript', 'Kotlin'];

function withMode(entry, mode) {
  return Object.assign({}, entry, { mode: mode });
}

function planNormalRun() {
  const legacy = PROJECTS.map(function (p) {
    return withMode(p, 'legacy');
  });
  const native = PROJECTS.filter(function (p) {
    return REPRESENTATIVE_NATIVE_LANGUAGES.indexOf(p.language) !== -1;
  }).map(function (p) {
    return withMode(p, 'native');
  });
  return legacy.concat(native);
}

function planDispatchRun(parserMode) {
  if (parserMode === 'native') {
    return PROJECTS.map(function (p) {
      return withMode(p, 'native');
    });
  }
  if (parserMode === 'both') {
    return PROJECTS.map(function (p) {
      return withMode(p, 'legacy');
    }).concat(
      PROJECTS.map(function (p) {
        return withMode(p, 'native');
      }),
    );
  }
  // Default / 'legacy'.
  return PROJECTS.map(function (p) {
    return withMode(p, 'legacy');
  });
}

const isDispatch = (process.env.IS_DISPATCH || 'false').trim() === 'true';
const parserMode = (process.env.PARSER_MODE_INPUT || 'legacy').trim();
const matrix = isDispatch ? planDispatchRun(parserMode) : planNormalRun();

const outputLine = 'matrix=' + JSON.stringify(matrix) + '\n';
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
} else {
  process.stdout.write(outputLine);
}
