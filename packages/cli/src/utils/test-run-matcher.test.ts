import { describe, it, expect } from 'vitest';
import { classifyTestCommand, computeUnverifiedFiles } from './test-run-matcher.js';

describe('classifyTestCommand — broad vs scoped classification table', () => {
  it.each<[string, boolean, boolean, string[]]>([
    // [command, isTestRun, broad, scopeTokens]
    ['npm test', true, true, []],
    ['npm run test', true, true, []],
    ['npm t', true, true, []],
    ['yarn test', true, true, []],
    ['pnpm test', true, true, []],
    ['bun test', true, true, []],
    ['pytest', true, true, []],
    ['cargo test', true, true, []],
    ['go test ./...', true, true, []],
    ['npm test -w @liendev/core', true, true, []],
    ['npm run test -w @scope/pkg', true, true, []],
    ['pnpm --filter my-pkg test', true, true, []],
    ['nx test my-app', true, true, []],
    ['pytest tests/unit/foo_test.py', true, false, ['tests/unit/foo_test.py']],
    ['npm test -- path/to/x.test.ts', true, false, ['path/to/x.test.ts']],
    ['vitest run src/a.test.ts', true, false, ['src/a.test.ts']],
    ['npx vitest run src/b.test.ts', true, false, ['src/b.test.ts']],
    ['jest src/c.test.ts', true, false, ['src/c.test.ts']],
    ['mocha test/d.spec.js', true, false, ['test/d.spec.js']],
    ['python -m pytest tests/e_test.py', true, false, ['tests/e_test.py']],
    ['python3.11 -m pytest tests/e_test.py', true, false, ['tests/e_test.py']],
    ['cargo nextest run', true, true, []],
    ['bundle exec rspec spec/foo_spec.rb', true, false, ['spec/foo_spec.rb']],
    ['rspec spec/foo_spec.rb', true, false, ['spec/foo_spec.rb']],
    ['phpunit tests/FooTest.php', true, false, ['tests/FooTest.php']],
    ['dotnet test', true, true, []],
    ['deno test', true, true, []],
    ['gradle test', true, true, []],
    ['mvn test', true, true, []],
    // Not test runs at all.
    ['ls -la', false, false, []],
    ['git status', false, false, []],
    ['echo testing', false, false, []],
    ['npm install', false, false, []],
    // A runner keyword buried after a shell chain — segment splitting.
    ['cd packages/cli && npm test', true, true, []],
    ['cd packages/cli && npm test -- src/foo.test.ts', true, false, ['src/foo.test.ts']],
  ])('%s -> isTestRun=%s broad=%s scopeTokens=%j', (command, isTestRun, broad, scopeTokens) => {
    expect(classifyTestCommand(command)).toEqual({ isTestRun, broad, scopeTokens });
  });

  it("Go's glob-all pattern (./...) is not treated as a scoping path even though it contains '/'", () => {
    expect(classifyTestCommand('go test ./...')).toEqual({
      isTestRun: true,
      broad: true,
      scopeTokens: [],
    });
  });

  it("an npm workspace-scope flag's value is excluded even though it contains '/'", () => {
    const result = classifyTestCommand('npm test -w @liendev/core');
    expect(result.broad).toBe(true);
    expect(result.scopeTokens).toEqual([]);
  });

  it('multiple segments separated by ; or | are all inspected', () => {
    expect(classifyTestCommand('echo hi; npm test -- src/foo.test.ts')).toEqual({
      isTestRun: true,
      broad: false,
      scopeTokens: ['src/foo.test.ts'],
    });
  });

  it('"npm t" does not falsely match inside "npm test"', () => {
    // Sanity: "npm test" must classify as broad (no path args), not
    // accidentally short-circuit through the "npm t" pattern in some other way.
    expect(classifyTestCommand('npm test').isTestRun).toBe(true);
  });
});

describe('computeUnverifiedFiles', () => {
  it('returns every edited file when there are no runs at all', () => {
    const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
    expect(computeUnverifiedFiles(edits, [])).toEqual([
      { file: 'src/foo.ts', tests: ['src/foo.test.ts'] },
    ]);
  });

  it('any broad run silences the whole report, even alongside scoped runs', () => {
    const edits = new Map([
      ['src/foo.ts', ['src/foo.test.ts']],
      ['src/bar.ts', ['src/bar.test.ts']],
    ]);
    const runs = [
      { isTestRun: true, broad: false, scopeTokens: ['src/foo.test.ts'] },
      { isTestRun: true, broad: true, scopeTokens: [] },
    ];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
  });

  it('a scoped run covers a file whose test basename it names', () => {
    const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['src/foo.test.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
  });

  it('a scoped run naming an unrelated file leaves the edit unverified', () => {
    const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['src/other.test.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([
      { file: 'src/foo.ts', tests: ['src/foo.test.ts'] },
    ]);
  });

  it('a scoped run naming the source file itself (not just the test) also covers it', () => {
    const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['src/foo.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
  });

  it('matching is case-insensitive', () => {
    const edits = new Map([['src/Foo.ts', ['src/Foo.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['SRC/FOO.TEST.TS'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
  });

  it('a non-test-run classification (isTestRun: false) never contributes broad or scope', () => {
    const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
    const runs = [{ isTestRun: false, broad: false, scopeTokens: [] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([
      { file: 'src/foo.ts', tests: ['src/foo.test.ts'] },
    ]);
  });

  it('an empty edits map yields an empty result regardless of runs', () => {
    expect(computeUnverifiedFiles(new Map(), [])).toEqual([]);
  });
});
