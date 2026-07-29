import { describe, it, expect } from 'vitest';
import {
  javaPackageRelativePath,
  toJavaTestCandidate,
  buildJavaTestDirIndex,
  pairJavaBasenameTest,
  findJavaPackageLevelTests,
  type JavaTestCandidate,
} from './java-same-package-tests.js';

/** A candidate whose `packageRelative` form is derived from a `src/<sourceSet>/java/...` path. */
function candidate(file: string): JavaTestCandidate {
  const relative = javaPackageRelativePath(file.replace(/\.java$/, ''));
  if (relative === null) throw new Error(`test fixture path doesn't follow the layout: ${file}`);
  return { file, packageRelative: relative };
}

describe('javaPackageRelativePath', () => {
  it('strips the src/main/java/ prefix', () => {
    expect(javaPackageRelativePath('retrofit/src/main/java/retrofit2/Response')).toBe(
      'retrofit2/Response',
    );
  });

  it('strips the src/test/java/ prefix from a different module root', () => {
    expect(
      javaPackageRelativePath(
        'retrofit-adapters/guava/src/test/java/retrofit2/adapter/guava/GuavaCallAdapterFactoryTest',
      ),
    ).toBe('retrofit2/adapter/guava/GuavaCallAdapterFactoryTest');
  });

  it('strips an arbitrarily-named sourceSet (androidTest, kotlin-test module, etc.)', () => {
    expect(
      javaPackageRelativePath('retrofit/android-test/src/androidTest/java/retrofit2/BasicCallTest'),
    ).toBe('retrofit2/BasicCallTest');
  });

  it('returns null for a path that does not follow the Standard Directory Layout', () => {
    expect(javaPackageRelativePath('scripts/Generate')).toBeNull();
    expect(javaPackageRelativePath('src/main/kotlin/retrofit2/Foo')).toBeNull();
  });
});

describe('toJavaTestCandidate', () => {
  const identity = (p: string): string => p.replace(/\.java$/, '');

  it('builds a candidate for a Standard Directory Layout path', () => {
    const result = toJavaTestCandidate('mod/src/test/java/retrofit2/ResponseTest.java', identity);
    expect(result).toEqual({
      file: 'mod/src/test/java/retrofit2/ResponseTest.java',
      packageRelative: 'retrofit2/ResponseTest',
    });
  });

  it('returns null for a path that does not follow the layout', () => {
    expect(toJavaTestCandidate('scripts/GenerateTest.java', identity)).toBeNull();
  });
});

describe('buildJavaTestDirIndex + pairJavaBasenameTest (tier 1)', () => {
  it('pairs a basename-matched test file across DIFFERENT module roots sharing a package (retrofit repro, #925)', () => {
    const index = buildJavaTestDirIndex([
      candidate(
        'retrofit-adapters/guava/src/test/java/retrofit2/adapter/guava/GuavaCallAdapterFactoryTest.java',
      ),
    ]);

    expect(
      pairJavaBasenameTest(
        'retrofit-adapters/guava/src/main/java/retrofit2/adapter/guava/GuavaCallAdapterFactory',
        index,
      ),
    ).toEqual([
      'retrofit-adapters/guava/src/test/java/retrofit2/adapter/guava/GuavaCallAdapterFactoryTest.java',
    ]);
  });

  it('does not pair across different packages even with a matching basename', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/other/GuavaCallAdapterFactoryTest.java'),
    ]);

    expect(
      pairJavaBasenameTest(
        'retrofit-adapters/guava/src/main/java/retrofit2/adapter/guava/GuavaCallAdapterFactory',
        index,
      ),
    ).toEqual([]);
  });

  it('does not pair a test file with a different basename in the same package', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/adapter/guava/OtherTest.java'),
    ]);

    expect(
      pairJavaBasenameTest(
        'retrofit-adapters/guava/src/main/java/retrofit2/adapter/guava/GuavaCallAdapterFactory',
        index,
      ),
    ).toEqual([]);
  });

  it('returns nothing for a package with no candidates at all', () => {
    const index = buildJavaTestDirIndex([]);

    expect(pairJavaBasenameTest('mod/src/main/java/retrofit2/Response', index)).toEqual([]);
  });

  it('returns nothing for a target that does not follow the Standard Directory Layout', () => {
    const index = buildJavaTestDirIndex([candidate('mod/src/test/java/pkg/FooTest.java')]);

    expect(pairJavaBasenameTest('scripts/Generate', index)).toEqual([]);
  });

  it('dedupes when multiple chunks exist for the same physical test file', () => {
    const file = 'mod/src/test/java/retrofit2/ResponseTest.java';
    const index = buildJavaTestDirIndex([candidate(file), candidate(file)]);

    expect(pairJavaBasenameTest('mod/src/main/java/retrofit2/Response', index)).toEqual([file]);
  });

  it('structurally cannot self-match when the query target is itself a Test.java file', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/ResponseTest.java'),
      candidate('mod/src/test/java/retrofit2/CallTest.java'),
    ]);

    expect(pairJavaBasenameTest('mod/src/test/java/retrofit2/ResponseTest', index)).toEqual([]);
  });
});

describe('findJavaPackageLevelTests (tier 2, fallback only)', () => {
  it('returns every test file sharing the target package-relative directory regardless of basename', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/adapter/guava/ListenableFutureTest.java'),
    ]);

    expect(
      findJavaPackageLevelTests('mod/src/main/java/retrofit2/adapter/guava/HttpException', index),
    ).toEqual(['mod/src/test/java/retrofit2/adapter/guava/ListenableFutureTest.java']);
  });

  it('returns all test files when a package has several, across module roots', () => {
    const index = buildJavaTestDirIndex([
      candidate('retrofit/java-test/src/test/java/retrofit2/CallTest.java'),
      candidate('retrofit/kotlin-test/src/test/java/retrofit2/KotlinUnitTest.java'),
    ]);

    const result = findJavaPackageLevelTests('retrofit/src/main/java/retrofit2/Utils', index);
    expect(result).toHaveLength(2);
    expect(result).toContain('retrofit/java-test/src/test/java/retrofit2/CallTest.java');
    expect(result).toContain('retrofit/kotlin-test/src/test/java/retrofit2/KotlinUnitTest.java');
  });

  it('returns an empty array for a package with no test files at all', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/other/FooTest.java'),
    ]);

    expect(findJavaPackageLevelTests('mod/src/main/java/retrofit2/untested/Bar', index)).toEqual(
      [],
    );
  });

  it('excludes the target itself when the query target is a Test.java file in its own package index', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/ResponseTest.java'),
      candidate('mod/src/test/java/retrofit2/CallTest.java'),
    ]);

    const result = findJavaPackageLevelTests('mod/src/test/java/retrofit2/ResponseTest', index);

    expect(result).not.toContain('mod/src/test/java/retrofit2/ResponseTest.java');
    expect(result).toEqual(['mod/src/test/java/retrofit2/CallTest.java']);
  });

  it('returns an empty array when the only candidate in the package is the target itself', () => {
    const index = buildJavaTestDirIndex([
      candidate('mod/src/test/java/retrofit2/ResponseTest.java'),
    ]);

    expect(findJavaPackageLevelTests('mod/src/test/java/retrofit2/ResponseTest', index)).toEqual(
      [],
    );
  });

  it('returns an empty array for a target that does not follow the Standard Directory Layout', () => {
    const index = buildJavaTestDirIndex([candidate('mod/src/test/java/pkg/FooTest.java')]);

    expect(findJavaPackageLevelTests('scripts/Generate', index)).toEqual([]);
  });
});
