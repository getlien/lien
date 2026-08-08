import { describe, it, expect } from 'vitest';
import {
  findJvmSamePackageDependents,
  buildJvmSamePackageIndex,
  resolveJvmSamePackageDependents,
  resolveJvmSamePackageDependentsBruteForce,
} from './jvm-same-package-signals.js';
import { javaPackageRelativePath } from './java-same-package-tests.js';
import type { CodeChunk } from './types.js';

interface ChunkOptions {
  file: string;
  content?: string;
  symbolName?: string;
  symbolType?: 'class' | 'interface' | 'method' | 'function';
  parentClass?: string;
  startLine?: number;
}

function makeChunk(opts: ChunkOptions): CodeChunk {
  return {
    content: opts.content ?? '',
    metadata: {
      file: opts.file,
      startLine: opts.startLine ?? 1,
      endLine: (opts.startLine ?? 1) + 10,
      type: opts.symbolType === 'class' || opts.symbolType === 'interface' ? 'class' : 'function',
      language: opts.file.endsWith('.kt') ? 'kotlin' : 'java',
      symbolName: opts.symbolName,
      symbolType: opts.symbolType,
      parentClass: opts.parentClass,
    },
  };
}

/** A top-level class/interface declaration chunk, optionally packaged and with extra import lines. */
function declChunk(
  file: string,
  symbolName: string,
  pkg?: string,
  imports: string[] = [],
): CodeChunk {
  const pkgLine = pkg ? `package ${pkg}\n\n` : '';
  const importLines = imports.map(i => `import ${i}`).join('\n');
  const kind = file.endsWith('.kt') && symbolName.startsWith('I') ? 'interface' : 'class';
  return makeChunk({
    file,
    content: `${pkgLine}${importLines}\n\n${kind} ${symbolName} { }`,
    symbolName,
    symbolType: 'class',
  });
}

/** A NESTED type declaration chunk (`parentClass` set), optionally packaged. */
function nestedDeclChunk(
  file: string,
  symbolName: string,
  parentClass: string,
  pkg?: string,
): CodeChunk {
  const pkgLine = pkg ? `package ${pkg}\n\n` : '';
  return makeChunk({
    file,
    content: `${pkgLine}class ${parentClass} { class ${symbolName} { } }`,
    symbolName,
    symbolType: 'class',
    parentClass,
  });
}

/** A production/test chunk whose body references `references` by name, optionally packaged/importing. */
function usageChunk(
  file: string,
  references: string[],
  pkg?: string,
  imports: string[] = [],
): CodeChunk {
  const pkgLine = pkg ? `package ${pkg}\n\n` : '';
  const importLines = imports.map(i => `import ${i}`).join('\n');
  return makeChunk({
    file,
    content: `${pkgLine}${importLines}\n\n${references.map(name => `${name}.doSomething();`).join('\n')}`,
    symbolName: 'someMethod',
    symbolType: 'method',
  });
}

describe('findJvmSamePackageDependents', () => {
  it('finds a same-package file that references a package-locally-unique type', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
    ];

    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([
      'src/main/java/a/b/Bar.java',
    ]);
  });

  it('works for Kotlin files the same way', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/kotlin/a/b/Foo.kt', 'Foo', 'a.b'),
      usageChunk('src/main/kotlin/a/b/Bar.kt', ['Foo'], 'a.b'),
    ];

    expect(findJvmSamePackageDependents('src/main/kotlin/a/b/Foo.kt', chunks)).toEqual([
      'src/main/kotlin/a/b/Bar.kt',
    ]);
  });

  it('returns [] for a non-JVM file', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/Bar.cs', ['Foo'], 'a.b'),
    ];
    expect(findJvmSamePackageDependents('src/Bar.cs', chunks)).toEqual([]);
  });

  it('returns [] when the target has no derivable package (G3)', () => {
    const chunks: CodeChunk[] = [
      declChunk('Foo.java', 'Foo'), // no package line
      usageChunk('Bar.java', ['Foo']),
    ];
    expect(findJvmSamePackageDependents('Foo.java', chunks)).toEqual([]);
  });

  it('G1prime: does not resolve a type name declared top-level in TWO files of the same package', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      declChunk('src/main/java/a/b/Foo2.java', 'Foo', 'a.b'), // same package, same name, different file
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo2.java', chunks)).toEqual([]);
  });

  it('G1prime is package-LOCAL, not corpus-wide: a same-named type in a DIFFERENT package does not block resolution', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      declChunk('src/main/java/x/y/Foo.java', 'Foo', 'x.y'), // different package, same simple name
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
    ];
    // This is exactly the case the ORIGINAL (corpus-wide) uniqueness gate
    // would have wrongly suppressed -- see module doc's G1' section.
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([
      'src/main/java/a/b/Bar.java',
    ]);
  });

  it('G2: does not cross into a different package, even a sub-package', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/sub/Bar.java', ['Foo'], 'a.b.sub'), // sub-package, NOT enclosing
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G4: excludes a candidate that declares its OWN nested type of the same name (nested-inclusive)', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      // Bar.java declares an unrelated NESTED Foo of its own, and separately
      // references its own nested Foo -- must not be misattributed to the
      // target's top-level Foo.
      nestedDeclChunk('src/main/java/a/b/Bar.java', 'Foo', 'Bar', 'a.b'),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G6: excludes a candidate whose single-type import binds the name to a DIFFERENT type', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b', ['x.y.Foo']),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G6: a single-type import naming the SAME target does not shadow (still resolves)', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b', ['a.b.Foo']),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([
      'src/main/java/a/b/Bar.java',
    ]);
  });

  it('G6: an import-on-demand (wildcard) does NOT shadow -- JLS 6.4.1', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b', ['x.y.*']),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([
      'src/main/java/a/b/Bar.java',
    ]);
  });

  it('G6: a single static import (import static a.B.C;) DOES shadow', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b', ['static x.y.Other.Foo']),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G6: a static import-on-demand (import static a.B.*;) does NOT shadow', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.kt', ['Foo'], 'a.b', ['static x.y.Foo.*']),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([
      'src/main/java/a/b/Bar.kt',
    ]);
  });

  it('G6: Kotlin import alias binds the ALIAS, not the FQN tail -- same-package Foo stays visible', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/kotlin/a/b/Foo.kt', 'Foo', 'a.b'),
      usageChunk('src/main/kotlin/a/b/Bar.kt', ['Foo'], 'a.b', ['x.y.Foo as Baz']),
    ];
    expect(findJvmSamePackageDependents('src/main/kotlin/a/b/Foo.kt', chunks)).toEqual([
      'src/main/kotlin/a/b/Bar.kt',
    ]);
  });

  it('G6 regression: a CRLF source file still detects the shadowing import (the regex must not require \\n-only line endings)', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      // Every line ends in a literal \r (as it would after `chunk.content
      // .split('\n')` on a real CRLF file) -- exercises the PRODUCTION
      // regex/binding path (via findJvmSamePackageDependents), not a
      // re-declared copy, so a regression here fails this test even if a
      // future edit only changes the exported behavior.
      makeChunk({
        file: 'src/main/java/a/b/Bar.java',
        content:
          'package a.b\r\n\r\nimport x.y.Foo;\r\n\r\nvoid method() { Foo.doSomething(); }\r\n',
        symbolName: 'method',
        symbolType: 'method',
      }),
    ];
    // Bar shadows Foo via a single-type import to a DIFFERENT package --
    // must be excluded (G6) despite the CRLF line endings.
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G6 regression: a trailing line comment on the import line does not defeat shadow detection', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      makeChunk({
        file: 'src/main/java/a/b/Bar.java',
        content:
          'package a.b\n\nimport x.y.Foo; // legacy alias, TODO remove\n\nvoid method() { Foo.doSomething(); }\n',
        symbolName: 'method',
        symbolType: 'method',
      }),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G7: a non-test candidate is not credited as a dependent of a test target', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/test/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
    ];
    expect(findJvmSamePackageDependents('src/test/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('G7: a test candidate IS credited as a dependent of a test target', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/test/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/test/java/a/b/Bar.java', ['Foo'], 'a.b'),
    ];
    expect(findJvmSamePackageDependents('src/test/java/a/b/Foo.java', chunks)).toEqual([
      'src/test/java/a/b/Bar.java',
    ]);
  });

  it('a production target IS resolved by a test-source-set candidate (production -> test is allowed by G7)', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/test/java/a/b/FooTest.java', ['Foo'], 'a.b'),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([
      'src/test/java/a/b/FooTest.java',
    ]);
  });

  it('import lines are excluded from the text-match corpus (a reference visible ONLY in an import line is not double-counted)', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      // Bar's ONLY textual occurrence of "Foo" is inside a static import line
      // naming an unrelated member -- Mechanism 1 (#1061) owns this, not this
      // module, so it must NOT show up here even though "Foo" is technically
      // present in the raw content.
      makeChunk({
        file: 'src/main/java/a/b/Bar.java',
        content: 'package a.b\n\nimport static a.b.Foo.SOME_CONSTANT;\n\nvoid method() {}',
        symbolName: 'method',
        symbolType: 'method',
      }),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });

  it('excludes the target file itself even when it references its own name', () => {
    const chunks: CodeChunk[] = [
      makeChunk({
        file: 'src/main/java/a/b/Foo.java',
        content: 'package a.b\n\nclass Foo { static Foo instance() { return new Foo(); } }',
        symbolName: 'Foo',
        symbolType: 'class',
      }),
    ];
    expect(findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks)).toEqual([]);
  });
});

describe('resolveJvmSamePackageDependentsBruteForce (P1: brute-force oracle)', () => {
  /** A varied fixture spanning every gate: G1'/G2/G4/G6/G7, Java and Kotlin, multiple packages. */
  function fixture(): CodeChunk[] {
    return [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
      usageChunk('src/test/java/a/b/FooTest.java', ['Foo'], 'a.b'),
      nestedDeclChunk('src/main/java/a/b/Baz.java', 'Foo', 'Baz', 'a.b'), // G4
      usageChunk('src/main/java/a/b/Shadowed.java', ['Foo'], 'a.b', ['x.y.Foo']), // G6
      usageChunk('src/main/java/a/b/OnDemand.java', ['Foo'], 'a.b', ['x.y.*']), // G6 (not excluded)
      declChunk('src/main/java/a/b/sub/Foo.java', 'Foo', 'a.b.sub'), // different package
      usageChunk('src/main/java/a/b/sub/Bar.java', ['Foo'], 'a.b.sub'),
      declChunk('src/main/java/x/y/Ambiguous.java', 'Ambiguous', 'x.y'),
      declChunk('src/main/java/x/y/Ambiguous2.java', 'Ambiguous', 'x.y'), // G1' collision
      usageChunk('src/main/java/x/y/Ref.java', ['Ambiguous'], 'x.y'),
      declChunk('src/main/kotlin/p/q/Widget.kt', 'Widget', 'p.q'),
      usageChunk('src/main/kotlin/p/q/Consumer.kt', ['Widget'], 'p.q', ['z.Widget as W']),
      declChunk('src/test/java/a/b/OnlyTest.java', 'OnlyTest', 'a.b'),
    ];
  }

  it('agrees exactly with the fast (pruned) resolver for every target in a multi-gate fixture', () => {
    const chunks = fixture();
    const index = buildJvmSamePackageIndex(chunks);
    const targets = [...new Set(chunks.map(c => c.metadata.file))];

    for (const target of targets) {
      const fast = resolveJvmSamePackageDependents(target, index);
      const brute = resolveJvmSamePackageDependentsBruteForce(target, index);
      expect(fast).toEqual(brute);
    }
  });
});

describe('P3: subset containment', () => {
  it('the fast resolver never returns a file outside its own package-local candidate set', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
      usageChunk('src/main/java/x/y/Unrelated.java', ['Foo'], 'x.y'), // different package -- must never appear
      declChunk('src/main/java/x/y/Placeholder.java', 'Placeholder', 'x.y'),
    ];
    const result = findJvmSamePackageDependents('src/main/java/a/b/Foo.java', chunks);
    const samePackageFiles = new Set(['src/main/java/a/b/Foo.java', 'src/main/java/a/b/Bar.java']);
    for (const file of result) expect(samePackageFiles.has(file)).toBe(true);
    expect(result).toEqual(['src/main/java/a/b/Bar.java']);
  });

  it('every result is drawn from the exact set of files the index knows about for that package', () => {
    const chunks: CodeChunk[] = [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
      usageChunk('src/main/java/a/b/Baz.java', ['Foo'], 'a.b'),
    ];
    const index = buildJvmSamePackageIndex(chunks);
    const result = resolveJvmSamePackageDependents('src/main/java/a/b/Foo.java', index);
    const universe = new Set(index.filesByPackage.get('a.b'));
    for (const file of result) expect(universe.has(file)).toBe(true);
  });
});

/**
 * P2: post-hoc re-derivation property test. For every edge the resolver
 * produces, independently re-derive all SIX gates from raw chunk CONTENT
 * (never from the resolver's own internal index/state) and confirm they
 * still hold. This is the property that would actually catch a dropped or
 * reordered gate -- P1 and P3 above both still pass even if G1' were
 * silently removed from the fast path (since the brute-force oracle would
 * have the identical bug, and every produced result still lives inside its
 * own package), so this is not optional -- see #1005 Phase 1's plan.
 */
describe('P2: post-hoc re-derivation', () => {
  /** Independently derive `package` from raw content -- deliberately NOT importing `derivePackage`. */
  function rederivePackage(chunks: CodeChunk[], file: string): string | undefined {
    const fileChunks = chunks
      .filter(c => c.metadata.file === file)
      .sort((a, b) => a.metadata.startLine - b.metadata.startLine);
    for (const chunk of fileChunks) {
      const match = /^[ \t]*package[ \t]+([\w.]+)/m.exec(chunk.content);
      if (match) return match[1];
    }
    return undefined;
  }

  /** Independently derive every top-level class/interface name a file declares. */
  function rederiveTopLevelNames(chunks: CodeChunk[], file: string): string[] {
    return chunks
      .filter(
        c =>
          c.metadata.file === file &&
          !c.metadata.parentClass &&
          (c.metadata.symbolType === 'class' || c.metadata.symbolType === 'interface'),
      )
      .map(c => c.metadata.symbolName as string);
  }

  /** Independently derive whether a file declares `typeName` ANYWHERE (nested-inclusive). */
  function rederiveDeclaresAnywhere(chunks: CodeChunk[], file: string, typeName: string): boolean {
    return chunks.some(
      c =>
        c.metadata.file === file &&
        (c.metadata.symbolType === 'class' || c.metadata.symbolType === 'interface') &&
        c.metadata.symbolName === typeName,
    );
  }

  /** Independently derive a file's single-type/single-static import bindings from raw content. */
  function rederiveShadowBindings(chunks: CodeChunk[], file: string): Map<string, string> {
    const bindings = new Map<string, string>();
    for (const chunk of chunks.filter(c => c.metadata.file === file)) {
      for (const line of chunk.content.split('\n')) {
        const m =
          /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+)(?:[ \t]+as[ \t]+([A-Za-z_$][\w$]*))?[ \t]*;?[ \t]*$/.exec(
            line,
          );
        if (!m) continue;
        const fqn = m[1];
        const bound = m[2] ?? fqn.split('.').pop();
        if (bound) bindings.set(bound, fqn);
      }
    }
    return bindings;
  }

  /** Independently derive whether `file` is in a test source set (mirrors `isTestFile`'s directory rule). */
  function rederiveIsTest(file: string): boolean {
    return /(^|[/\\])(test|tests)[/\\]/i.test(file);
  }

  function fixture(): CodeChunk[] {
    return [
      declChunk('src/main/java/a/b/Foo.java', 'Foo', 'a.b'),
      usageChunk('src/main/java/a/b/Bar.java', ['Foo'], 'a.b'),
      usageChunk('src/test/java/a/b/FooTest.java', ['Foo'], 'a.b'),
      nestedDeclChunk('src/main/java/a/b/Baz.java', 'Foo', 'Baz', 'a.b'),
      usageChunk('src/main/java/a/b/Shadowed.java', ['Foo'], 'a.b', ['x.y.Foo']),
      usageChunk('src/main/java/a/b/OnDemand.java', ['Foo'], 'a.b', ['x.y.*']),
      declChunk('src/main/java/a/b/sub/Foo.java', 'Foo', 'a.b.sub'),
      usageChunk('src/main/java/a/b/sub/Bar.java', ['Foo'], 'a.b.sub'),
      declChunk('src/main/java/x/y/Ambiguous.java', 'Ambiguous', 'x.y'),
      declChunk('src/main/java/x/y/Ambiguous2.java', 'Ambiguous', 'x.y'),
      usageChunk('src/main/java/x/y/Ref.java', ['Ambiguous'], 'x.y'),
      declChunk('src/main/kotlin/p/q/Widget.kt', 'Widget', 'p.q'),
      usageChunk('src/main/kotlin/p/q/Consumer.kt', ['Widget'], 'p.q', ['z.Widget as W']),
    ];
  }

  it('every produced edge independently re-verifies all six gates from raw content', () => {
    const chunks = fixture();
    const targets = [...new Set(chunks.map(c => c.metadata.file))];

    let edgeCount = 0;
    for (const target of targets) {
      const targetPackage = rederivePackage(chunks, target);
      const result = findJvmSamePackageDependents(target, chunks);

      for (const dependent of result) {
        edgeCount++;
        const dependentPackage = rederivePackage(chunks, dependent);

        // G2: exact package equality.
        expect(dependentPackage).toBe(targetPackage);
        expect(targetPackage).toBeDefined(); // G3

        // Find the specific target type name that made this edge (at least one must satisfy every gate).
        const targetNames = rederiveTopLevelNames(chunks, target);
        const matchingNames = targetNames.filter(typeName => {
          // G1': exactly one file in this package declares this name top-level.
          const owners = new Set(
            chunks
              .filter(
                c =>
                  !c.metadata.parentClass &&
                  (c.metadata.symbolType === 'class' || c.metadata.symbolType === 'interface') &&
                  c.metadata.symbolName === typeName &&
                  rederivePackage(chunks, c.metadata.file) === targetPackage,
              )
              .map(c => c.metadata.file),
          );
          if (owners.size !== 1) return false;

          // G4: dependent must not declare its own (nested-inclusive) typeName.
          if (rederiveDeclaresAnywhere(chunks, dependent, typeName)) return false;

          // G6: dependent's own shadow binding, if any, must resolve back to the target.
          const bound = rederiveShadowBindings(chunks, dependent).get(typeName);
          if (bound && bound !== `${targetPackage}.${typeName}`) return false;

          // G7: non-test dependent must not be credited for a test target.
          if (!rederiveIsTest(dependent) && rederiveIsTest(target)) return false;

          // Text match on non-import content.
          const nonImportContent = chunks
            .filter(c => c.metadata.file === dependent)
            .map(c =>
              c.content
                .split('\n')
                .filter(l => !/^[ \t]*import\b/.test(l))
                .join('\n'),
            )
            .join('\n');
          return new RegExp(`\\b${typeName}\\b`).test(nonImportContent);
        });

        expect(matchingNames.length).toBeGreaterThan(0);
      }
    }

    // Sanity: the fixture is rich enough that this property test actually
    // exercised real edges, not a vacuously-true empty loop.
    expect(edgeCount).toBeGreaterThan(0);
  });
});

describe('cross-check: content-derived package agrees with path-derived package', () => {
  it('agrees with javaPackageRelativePath wherever both are derivable', () => {
    const cases: Array<{ file: string; pkg: string }> = [
      { file: 'src/main/java/com/squareup/javapoet/TypeSpec.java', pkg: 'com.squareup.javapoet' },
      { file: 'src/test/java/retrofit2/HttpExceptionTest.java', pkg: 'retrofit2' },
      { file: 'module/src/test/java/a/b/c/Foo.java', pkg: 'a.b.c' },
    ];

    for (const { file, pkg } of cases) {
      const chunks = [declChunk(file, 'Foo', pkg)];
      const index = buildJvmSamePackageIndex(chunks);
      const contentDerived = index.packageByFile.get(file);

      // javaPackageRelativePath returns `<package/path>/<basename>` -- derive
      // its package-only prefix by stripping the basename.
      const relative = javaPackageRelativePath(file.replace(/\.java$/, ''));
      expect(relative).not.toBeNull();
      const pathDerivedPackage = relative!.split('/').slice(0, -1).join('.');

      expect(contentDerived).toBe(pkg);
      expect(pathDerivedPackage).toBe(pkg);
      expect(contentDerived).toBe(pathDerivedPackage);
    }
  });

  it('javaPackageRelativePath is Kotlin-blind (hard-codes src/.../java/) -- content-derivation still works for Kotlin, documenting the asymmetry rather than unifying the two notions (out of scope for Phase 1)', () => {
    const file = 'src/main/kotlin/com/beust/klaxon/JsonObject.kt';
    const chunks = [declChunk(file, 'JsonObject', 'com.beust.klaxon')];
    const index = buildJvmSamePackageIndex(chunks);

    expect(index.packageByFile.get(file)).toBe('com.beust.klaxon');
    expect(javaPackageRelativePath(file.replace(/\.kt$/, ''))).toBeNull();
  });

  // #1005 Phase 2 AC7: the two tests above only ever assert AGREEMENT on the
  // subset of files where BOTH notions already derive something -- a weak
  // canary, since it can't distinguish "the two mechanisms are consistent"
  // from "we only ever checked the cases where they were never going to
  // disagree". This test instead classifies a small representative fixture
  // set into the four possible outcomes and pins the exact COUNT/shape of
  // each bucket, so a future change that shifts which bucket a file falls
  // into (e.g. a `derivePackage` regex tweak, or a `javaPackageRelativePath`
  // layout extension) trips this test instead of passing silently.
  it('pins the exact shape of the residual set where path-derived and content-derived package notions disagree or one is undefined', () => {
    function pathDerivedPackage(file: string): string | null {
      const relative = javaPackageRelativePath(file.replace(/\.(java|kt)$/, ''));
      if (relative === null) return null;
      const segments = relative.split('/').slice(0, -1);
      return segments.length > 0 ? segments.join('.') : null;
    }

    const cases: Array<{ label: string; file: string; content: string }> = [
      {
        // Both derivable, and they agree -- the case the earlier "weak
        // canary" tests already cover.
        label: 'agree-both-derivable',
        file: 'src/main/java/a/b/Foo.java',
        content: 'package a.b;\n\nclass Foo { }',
      },
      {
        // Content-derivable (a `package` line is present), but NOT under
        // the Standard Directory Layout `javaPackageRelativePath` requires
        // -- path-derivation fails.
        label: 'content-only',
        file: 'flat/NoSourceRoot.java',
        content: 'package a.b;\n\nclass NoSourceRoot { }',
      },
      {
        // Under the Standard Directory Layout (path-derivable), but its
        // chunk content carries no `package` line at all (e.g. a stale
        // extraction, or Java's legal-but-rare unnamed/default package) --
        // content-derivation fails (G3).
        label: 'path-only',
        file: 'src/main/java/a/b/NoPackageStatement.java',
        content: 'class NoPackageStatement { }',
      },
      {
        // Neither notion can derive a package at all.
        label: 'neither-derivable',
        file: 'NoPackageNoRoot.java',
        content: 'class NoPackageNoRoot { }',
      },
    ];

    const chunks: CodeChunk[] = cases.map(({ file, content }) =>
      makeChunk({
        file,
        content,
        symbolName: file
          .split('/')
          .pop()!
          .replace(/\.java$/, ''),
        symbolType: 'class',
      }),
    );
    const index = buildJvmSamePackageIndex(chunks);

    const buckets = { agreeBothDerivable: 0, contentOnly: 0, pathOnly: 0, neitherDerivable: 0 };
    for (const { label, file } of cases) {
      const contentDerived = index.packageByFile.get(file);
      const pathDerived = pathDerivedPackage(file);

      if (contentDerived !== undefined && pathDerived !== null) {
        expect(contentDerived).toBe(pathDerived); // the "agree" half of this bucket
        buckets.agreeBothDerivable += 1;
      } else if (contentDerived !== undefined && pathDerived === null) {
        buckets.contentOnly += 1;
      } else if (contentDerived === undefined && pathDerived !== null) {
        buckets.pathOnly += 1;
      } else {
        buckets.neitherDerivable += 1;
      }

      // Cross-check the fixture is actually shaped the way its label claims.
      expect(label).toBe(
        contentDerived !== undefined && pathDerived !== null
          ? 'agree-both-derivable'
          : contentDerived !== undefined
            ? 'content-only'
            : pathDerived !== null
              ? 'path-only'
              : 'neither-derivable',
      );
    }

    expect(buckets).toEqual({
      agreeBothDerivable: 1,
      contentOnly: 1,
      pathOnly: 1,
      neitherDerivable: 1,
    });
  });
});
