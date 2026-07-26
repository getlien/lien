import { describe, it, expect } from 'vitest';
import {
  buildGoTestDirIndex,
  pairGoBasenameTest,
  findGoPackageLevelTests,
  type GoTestCandidate,
} from './go-same-directory-tests.js';

/** A candidate whose `normalized` form matches the extension-stripped `file`. */
function candidate(file: string): GoTestCandidate {
  return { file, normalized: file.replace(/\.go$/, '') };
}

describe('buildGoTestDirIndex + pairGoBasenameTest (tier 1)', () => {
  it('pairs a basename-matched test file in the same directory', () => {
    const index = buildGoTestDirIndex([candidate('pkg/cmd/label/list_test.go')]);

    expect(pairGoBasenameTest('pkg/cmd/label/list', index)).toEqual(['pkg/cmd/label/list_test.go']);
  });

  it('does not pair across directories even with a matching basename', () => {
    const index = buildGoTestDirIndex([candidate('pkg/cmd/other/list_test.go')]);

    expect(pairGoBasenameTest('pkg/cmd/label/list', index)).toEqual([]);
  });

  it('does not pair a test file with a different basename in the same directory', () => {
    const index = buildGoTestDirIndex([candidate('pkg/cmd/label/create_test.go')]);

    expect(pairGoBasenameTest('pkg/cmd/label/list', index)).toEqual([]);
  });

  it('returns nothing for a directory with no candidates at all', () => {
    const index = buildGoTestDirIndex([]);

    expect(pairGoBasenameTest('pkg/cmd/label/list', index)).toEqual([]);
  });

  it('pairs a top-level (no-directory) file correctly', () => {
    const index = buildGoTestDirIndex([candidate('main_test.go')]);

    expect(pairGoBasenameTest('main', index)).toEqual(['main_test.go']);
  });

  it('dedupes when multiple chunks exist for the same physical test file', () => {
    // A real test file commonly yields more than one chunk (one per
    // function/block) -- each becomes its own candidate, so the module
    // itself must not report the same file twice.
    const index = buildGoTestDirIndex([
      candidate('pkg/cmd/label/list_test.go'),
      candidate('pkg/cmd/label/list_test.go'),
    ]);

    expect(pairGoBasenameTest('pkg/cmd/label/list', index)).toEqual(['pkg/cmd/label/list_test.go']);
  });

  it('structurally cannot self-match when the query target is itself a _test.go file', () => {
    // A _test.go target would need a candidate whose basename is the
    // target's own basename plus a second, literal "_test" suffix
    // (list_test -> list_test_test) to match -- never the target's own
    // basename, so no self-match guard is needed here (unlike
    // findGoPackageLevelTests below, which has no basename discriminator).
    const index = buildGoTestDirIndex([
      candidate('pkg/cmd/label/list_test.go'),
      candidate('pkg/cmd/label/create_test.go'),
    ]);

    expect(pairGoBasenameTest('pkg/cmd/label/list_test', index)).toEqual([]);
  });
});

describe('findGoPackageLevelTests (tier 2, fallback only)', () => {
  it('returns every test file in the target directory regardless of basename', () => {
    const index = buildGoTestDirIndex([candidate('internal/licenses/licenses_test.go')]);

    expect(findGoPackageLevelTests('internal/licenses/embed_linux_amd64', index)).toEqual([
      'internal/licenses/licenses_test.go',
    ]);
  });

  it('returns all test files when a directory has several', () => {
    const index = buildGoTestDirIndex([
      candidate('pkg/cmd/codespace/create_test.go'),
      candidate('pkg/cmd/codespace/list_test.go'),
    ]);

    const result = findGoPackageLevelTests('pkg/cmd/codespace/root', index);
    expect(result).toHaveLength(2);
    expect(result).toContain('pkg/cmd/codespace/create_test.go');
    expect(result).toContain('pkg/cmd/codespace/list_test.go');
  });

  it('returns an empty array for a directory with no test files at all', () => {
    const index = buildGoTestDirIndex([candidate('pkg/other/foo_test.go')]);

    expect(findGoPackageLevelTests('pkg/untested/bar', index)).toEqual([]);
  });

  it('dedupes when multiple chunks exist for the same physical test file (real-world internal/licenses shape)', () => {
    // Regression case found dogfooding against a real cli/cli clone:
    // licenses_test.go yielded two chunks, and the pre-dedupe
    // implementation reported it twice in the package-level fallback list.
    const index = buildGoTestDirIndex([
      candidate('internal/licenses/licenses_test.go'),
      candidate('internal/licenses/licenses_test.go'),
    ]);

    expect(findGoPackageLevelTests('internal/licenses/embed_linux_amd64', index)).toEqual([
      'internal/licenses/licenses_test.go',
    ]);
  });

  it('excludes the target itself when the query target is a _test.go file in its own directory index', () => {
    // Calling `lien annotate` directly on a _test.go file (or scanning one
    // as a target for any other reason) must not report the file as
    // "covered by itself" -- the target is a candidate in its own
    // directory's index, same as any other test file there.
    const index = buildGoTestDirIndex([
      candidate('pkg/cmd/label/list_test.go'),
      candidate('pkg/cmd/label/create_test.go'),
    ]);

    const result = findGoPackageLevelTests('pkg/cmd/label/list_test', index);

    expect(result).not.toContain('pkg/cmd/label/list_test.go');
    expect(result).toEqual(['pkg/cmd/label/create_test.go']);
  });

  it('returns an empty array when the only candidate in the directory is the target itself', () => {
    const index = buildGoTestDirIndex([candidate('pkg/cmd/label/list_test.go')]);

    expect(findGoPackageLevelTests('pkg/cmd/label/list_test', index)).toEqual([]);
  });
});
