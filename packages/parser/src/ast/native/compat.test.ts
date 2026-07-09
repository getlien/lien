import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkByAST } from '../chunker.js';
import { extractExports, extractImports, extractCallSites } from '../symbols.js';
import type { SyntaxNode } from '../types.js';
import { mustParse } from '../test/helpers/parse-fixture.js';
import {
  FIXTURES,
  TS_SOURCE,
  PYTHON_SOURCE,
  SWIFT_SOURCE,
  toGoldenTree,
  findFieldReferenceViolations,
  type GoldenTree,
} from './compat-fixtures.js';

/**
 * Regression tests for the native compat deserializer
 * (docs/architecture/native-parser.md).
 *
 * ADR-013 Phase 4-B removed the legacy node-tree-sitter backend entirely, so
 * these can no longer build a live "legacy" oracle tree to diff native
 * against (the pre-4-B version of this file did exactly that, via a second
 * `new Parser()` + real tree-sitter-<lang> grammar per fixture). Native is
 * now the only backend, and its output for these fixtures was already
 * verified against legacy during ADR-013's earlier phases (the parity gate
 * and the flagged dual-mode CI run) -- so that verified-correct output is
 * frozen as committed golden fixtures under ./__fixtures__/, and these
 * tests become regression guards against the *current* native output
 * drifting from it, rather than a live cross-backend diff.
 *
 * To regenerate a fixture after an intentional change to compat-fixtures.ts
 * (a new FIELDS_TO_CHECK entry, a changed fixture source, etc.): temporarily
 * add a small vitest test that imports the same helpers used here
 * (toGoldenTree / chunkByAST / extract*), writes its output to the
 * __fixtures__/*.json paths via node:fs, run it once with
 * `npm run test -w @liendev/parser -- <temp-file>`, review the resulting
 * diff, then delete the temp file. No node-tree-sitter (or any other
 * external grammar package) is needed -- generation only depends on
 * @liendev/parser-native, already a normal runtime dependency of this
 * package, so no permanent generator script is kept here for that.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

function loadGolden<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8')) as T;
}

describe('native compat deserializer: structural fidelity (golden fixtures)', () => {
  const golden = loadGolden<Record<string, GoldenTree>>('structural-fidelity.json');

  describe.each(FIXTURES)('$name', ({ name, lang, source }) => {
    it('matches the committed golden tree', () => {
      const root = mustParse(source, lang);
      const actual = toGoldenTree(root, root.hasError);
      expect(actual).toEqual(golden[name]);
    });

    it('has no childForFieldName reference-equality violations', () => {
      // Native-only structural invariant (native-parser.md section 2.5):
      // doesn't depend on the golden fixture, so it's checked live.
      const root = mustParse(source, lang);
      expect(findFieldReferenceViolations(root)).toEqual([]);
    });
  });
});

describe('native compat deserializer: isMissing round-trip', () => {
  it('round-trips a genuine MISSING node (Go unclosed parameter list)', () => {
    const root = mustParse('func foo(', 'go');
    expect(root.hasError).toBe(true);

    function findMissing(node: SyntaxNode): SyntaxNode | null {
      if (node.isMissing) return node;
      for (const child of node.children) {
        const found = findMissing(child);
        if (found) return found;
      }
      return null;
    }

    const missing = findMissing(root);
    expect(missing).not.toBeNull();
    expect(missing!.type).toBe(')');
    expect(missing!.startIndex).toBe(missing!.endIndex);
  });
});

interface ExtractorParityGolden {
  tsExports: string[];
  tsImports: string[];
  pyCallSites: unknown[];
  tsChunks: unknown[];
  swiftChunks: Array<{ metadata: { returnType?: string } }>;
}

describe('native compat deserializer: real extractor parity (golden fixtures)', () => {
  const golden = loadGolden<ExtractorParityGolden>('extractor-parity.json');

  it('extractExports matches the golden output (typescript)', () => {
    const root = mustParse(TS_SOURCE, 'typescript');
    expect(extractExports(root, 'typescript')).toEqual(golden.tsExports);
  });

  it('extractImports matches the golden output (typescript)', () => {
    const root = mustParse(TS_SOURCE, 'typescript');
    expect(extractImports(root, 'typescript')).toEqual(golden.tsImports);
  });

  it('extractCallSites matches the golden output (python)', () => {
    const root = mustParse(PYTHON_SOURCE, 'python');
    expect(extractCallSites(root, 'python')).toEqual(golden.pyCallSites);
  });

  it('chunkByAST matches the golden output end-to-end (typescript)', () => {
    expect(chunkByAST('greeter.ts', TS_SOURCE)).toEqual(golden.tsChunks);
  });

  it('chunkByAST matches the golden output end-to-end (swift), including returnType', () => {
    const swiftChunks = chunkByAST('greeter.swift', SWIFT_SOURCE);
    expect(swiftChunks).toEqual(golden.swiftChunks);

    // Guard against a vacuous pass: assert the fixture actually exercises
    // returnType extraction, so a future regression that silently dropped
    // returnType wouldn't slip through toEqual() alone (e.g. if the golden
    // fixture were accidentally regenerated from a broken build).
    const returnTypes = swiftChunks.map(c => c.metadata.returnType).filter(Boolean);
    expect(returnTypes).toEqual(['String', 'String', 'Int', 'String']);
  });
});

// resolveParserBackend() unit tests live in ../backend.test.ts.
