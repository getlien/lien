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
    // #870: Ruby (Rake/Minitest), PHP (vendored phpunit / composer script),
    // Swift (SwiftPM), and Gradle-wrapper forms — each ecosystem's own
    // standard/idiomatic test-invocation command.
    ['bundle exec rake test:core', true, true, []],
    ['rake test', true, true, []],
    ['./rake test', true, true, []],
    [
      'vendor/bin/phpunit tests/Cookie/SetCookieTest.php',
      true,
      false,
      ['tests/Cookie/SetCookieTest.php'],
    ],
    ['./vendor/bin/phpunit', true, true, []],
    ['composer test', true, true, []],
    ['swift test', true, true, []],
    // 2026-07-29: `--filter` here names a suite, not a path/workspace — a
    // name-filtered run (see the name-filter table below), NOT broad. This
    // used to be (incorrectly) broad because `--filter` was globally
    // skip-invisible via WORKSPACE_SCOPE_FLAGS.
    ['swift test --filter HTTPHeadersTests', true, false, []],
    ['./gradlew test', true, true, []],
    ['./gradlew :exposed-core:test', true, true, []],
    ['gradlew test', true, true, []],
    // CodeRabbit review finding on PR #873: a real, common Gradle
    // multi-task invocation (`clean test`) was previously unrecognized
    // because the pattern required `test` immediately after `gradlew`.
    ['./gradlew clean test', true, true, []],
    ['gradlew build test', true, true, []],
    ['./gradlew clean :exposed-core:test', true, true, []],
    // CodeRabbit review follow-up: common Gradle flags before the test task.
    ['./gradlew --no-daemon test', true, true, []],
    ['./gradlew -q test', true, true, []],
    ['./gradlew -PmyProp=value test', true, true, []],
    // Negative guards: a non-test Rake task must not be swallowed by the
    // broad `rake test(:sub)?` recognition above, and a Gradle invocation
    // with no `test` task at all must stay unrecognized.
    ['rake db:migrate', false, false, []],
    ['./gradlew build', false, false, []],
    ['./gradlew clean', false, false, []],
    // Lien Review finding on PR #873 (Medium Risk): `-x test` / `--exclude-task
    // test` EXCLUDE the test task rather than running it — the opposite of
    // "tests ran" — so these must stay unrecognized even though the literal
    // substring "test" is present.
    ['./gradlew -x test', false, false, []],
    ['./gradlew build -x test', false, false, []],
    ['./gradlew --exclude-task test', false, false, []],
    // But if `test` genuinely runs earlier in the same command, excluding a
    // *different* task afterward must not defeat recognition.
    ['./gradlew test -x integrationTest', true, true, []],
    // Lien Review follow-up: excluding a *different* task before test also
    // must not defeat recognition — only `test` itself being the excluded
    // argument should be rejected.
    ['./gradlew -x integrationTest test', true, true, []],
    ['./gradlew --exclude-task integrationTest test', true, true, []],
    // Not test runs at all.
    ['ls -la', false, false, []],
    ['git status', false, false, []],
    ['echo testing', false, false, []],
    ['npm install', false, false, []],
    // A runner keyword buried after a shell chain — segment splitting.
    ['cd packages/cli && npm test', true, true, []],
    ['cd packages/cli && npm test -- src/foo.test.ts', true, false, ['src/foo.test.ts']],
    // Leading VAR=value env assignments must not defeat the anchored match.
    ['CI=1 npm test', true, true, []],
    ['NODE_ENV=test vitest', true, true, []],
    ['CI=1 FORCE_COLOR=0 npm test -- src/foo.test.ts', true, false, ['src/foo.test.ts']],
    // npm run/yarn/pnpm custom script forms (npm test itself has no such form).
    ['npm run test:e2e:python', true, true, []],
    ['npm run test:e2e:python -w packages/cli', true, true, []],
    ['yarn test:unit', true, true, []],
    ['pnpm test:unit -- src/foo.test.ts', true, false, ['src/foo.test.ts']],
    // A --config/-c value is never a scope token, even with a source extension.
    ['vitest --config vitest.config.ts', true, true, []],
    ['jest -c jest.config.js src/foo.test.ts', true, false, ['src/foo.test.ts']],
    // #905: package-manager/environment-runner wrapper prefixes must not
    // defeat the wrapped command's own pattern — same broad-vs-scoped
    // semantics as the unwrapped form.
    ['uv run pytest', true, true, []],
    ['uv run pytest tests/foo.py', true, false, ['tests/foo.py']],
    ['poetry run pytest', true, true, []],
    ['poetry run pytest tests/foo.py', true, false, ['tests/foo.py']],
    ['pipenv run pytest', true, true, []],
    ['pipenv run pytest tests/foo.py', true, false, ['tests/foo.py']],
    ['rye run pytest', true, true, []],
    ['rye run pytest tests/foo.py', true, false, ['tests/foo.py']],
    ['pdm run pytest', true, true, []],
    ['pdm run pytest tests/foo.py', true, false, ['tests/foo.py']],
    // Flags-with-values on the wrapper's own `run` invocation must be skipped
    // (flag + value), not naively popped as a single generic token.
    ['uv run --group tests pytest', true, true, []],
    ['uv run --group tests pytest tests/foo.py', true, false, ['tests/foo.py']],
    ['uv run --group=tests pytest', true, true, []],
    // The flask CI repro from #905 (uv run --locked --no-default-groups
    // --group dev tox run) — boolean flags then a value flag then the
    // wrapped `tox run` command.
    ['uv run --locked --no-default-groups --group dev tox run', true, true, []],
    // A leading VAR=value assignment before the wrapper must still be
    // stripped (the two stripping passes compose).
    ['CI=1 uv run pytest', true, true, []],
    // #905: tox — bare/`run`/`-e ENV` forms are broad (no file named); the
    // `--` passthrough is scoped when it forwards a path-like argument.
    ['tox', true, true, []],
    ['tox run', true, true, []],
    ['tox -e py311', true, true, []],
    ['python -m tox', true, true, []],
    ['python3.11 -m tox', true, true, []],
    ['tox -e py311 -- tests/test_x.py', true, false, ['tests/test_x.py']],
    // nox: same shape and same passthrough convention as tox.
    ['nox', true, true, []],
    ['nox -s test', true, true, []],
    ['python -m nox', true, true, []],
    ['nox -s test -- tests/test_x.py', true, false, ['tests/test_x.py']],
    // Composed: a wrapper around tox.
    ['uv run tox run', true, true, []],
    ['uv run tox -e py311 -- tests/test_x.py', true, false, ['tests/test_x.py']],
    // 2026-07-29: a run scoped by test NAME rather than file/directory has no
    // path-like scope token, so before this fix it fell back to `broad`
    // (silently marking the whole session's edits "verified"). Each of
    // these must come back name-filtered: isTestRun, NOT broad, and no
    // scopeTokens — see the module doc comment and computeUnverifiedFiles
    // describe block below for what that third state means downstream.
    ['pytest -k test_totally_unrelated_name', true, false, []],
    ['pytest -k "some expr"', true, false, []],
    ['pytest -m slow', true, false, []],
    ['dotnet test --filter FullyQualifiedName~Some.Unrelated.Test', true, false, []],
    ['dotnet test --filter=Category=Foo', true, false, []],
    ['rspec -e "some unrelated example"', true, false, []],
    ['rspec --example "some unrelated example"', true, false, []],
    ['bundle exec rspec -e "some unrelated example"', true, false, []],
    ["mocha --grep 'unrelated pattern'", true, false, []],
    ['mocha -g unrelated', true, false, []],
    ['go test -run TestUnrelated', true, false, []],
    ['go test -run=TestUnrelated', true, false, []],
    ['cargo test test_unrelated_name', true, false, []],
    ['vitest -t "unrelated name"', true, false, []],
    ['jest -t "unrelated name"', true, false, []],
    ['jest --testNamePattern "unrelated name"', true, false, []],
    ['npx vitest run -t "unrelated name"', true, false, []],
    ['swift test --filter HTTPHeadersTests', true, false, []],
    // Compound: a path present alongside a name filter must still scope
    // normally by the path — the name filter must not downgrade it.
    ['pytest -k name tests/test_helpers.py', true, false, ['tests/test_helpers.py']],
    [
      'dotnet test --filter FullyQualifiedName~Foo tests/FooTests.cs',
      true,
      false,
      ['tests/FooTests.cs'],
    ],
    // Negative guards: these must NOT be swept up as name-filtered and must
    // stay exactly as before. tox's `-e ENV` looks identical in shape to
    // rspec's `-e NAME` but means something unrelated (which configured
    // environment to run, not a named test) — this is the concrete
    // collision the per-runner-family flag scoping in NAME_FILTER_FLAGS
    // exists to avoid.
    ['tox -e py311', true, true, []],
    // cargo-nextest's required `run` subcommand keyword is a bare token in
    // the same position a `cargo test <name>` filter would be, but it must
    // not be misread as one.
    ['cargo nextest run', true, true, []],
    // Gradle's exclude-task flags take a bare task-name VALUE in the same
    // position a name filter's value would sit, but excluding a task is the
    // opposite of "ran a named test" and must stay broad.
    ['./gradlew test -x integrationTest', true, true, []],
    ['./gradlew --exclude-task integrationTest test', true, true, []],
    // Regression (caught in review): `cargo test`'s own build/compile-config
    // flags take a bare VALUE in the exact same position a positional test
    // name would sit (`cargo test [TESTNAME]`) — the third instance of this
    // hazard class in this file (after tox `-e`/rspec `-e` and cargo-nextest's
    // `run`). None of these narrow which tests run; the value must not be
    // misread as a test name, and the run must stay `broad`.
    ['cargo test --features foo', true, true, []],
    ['cargo test -F foo', true, true, []],
    ['cargo test --features=foo', true, true, []],
    ['cargo test -p my_crate', true, true, []],
    ['cargo test --package my_crate', true, true, []],
    ['cargo test --exclude other_crate', true, true, []],
    ['cargo test --manifest-path ./Cargo.toml', true, true, []],
    ['cargo test --lockfile-path ./Cargo.lock', true, true, []],
    ['cargo test --target x86_64-unknown-linux-gnu', true, true, []],
    ['cargo test --target-dir ./target', true, true, []],
    ['cargo test --profile release', true, true, []],
    ['cargo test -j 4', true, true, []],
    ['cargo test --jobs 4', true, true, []],
    ['cargo test --color always', true, true, []],
    ['cargo test --message-format json', true, true, []],
    // A build-config flag alongside a genuine positional test name must
    // still be recognized as name-filtered by that name — the flag-value
    // skip must not eat the real positional too.
    ['cargo test --features foo some_unrelated_name', true, false, []],
    // `--test <name>` selects a specific integration-test BINARY target by
    // name, not a file path and not a build-config value — it genuinely
    // narrows which tests run, so (unlike the build-config flags above) it
    // is deliberately NOT skipped. There's no infrastructure here to resolve
    // a bare target name against a real file, so it lands on the same safe
    // name-filtered (not broad) outcome as a plain `cargo test <name>`.
    ['cargo test --test integration_test', true, false, []],
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

  it('a stem match (different dir, .spec vs .test) still covers — not just exact basename', () => {
    const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['other/foo.spec.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
  });

  // Reviewer repros (strict matching, no substring containment): a scope
  // token must NOT cover a file just because one is a substring of the
  // other's basename. Each of these NAGS (stays unverified) — under the
  // prior bidirectional-substring version of isCoveredByScope, all three
  // were silently (and wrongly) marked "covered".
  it('does NOT cover auth.ts via an unrelated oauth.test.ts run (substring, not a real match)', () => {
    const edits = new Map([['src/auth.ts', ['src/auth.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['src/oauth.test.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([
      { file: 'src/auth.ts', tests: ['src/auth.test.ts'] },
    ]);
  });

  it('does NOT cover user.ts via an unrelated superuser.test.ts run', () => {
    const edits = new Map([['src/user.ts', ['src/user.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['src/superuser.test.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([
      { file: 'src/user.ts', tests: ['src/user.test.ts'] },
    ]);
  });

  it('does NOT cover a.ts via an unrelated data.test.ts run', () => {
    const edits = new Map([['src/a.ts', ['src/a.test.ts']]]);
    const runs = [{ isTestRun: true, broad: false, scopeTokens: ['src/data.test.ts'] }];
    expect(computeUnverifiedFiles(edits, runs)).toEqual([
      { file: 'src/a.ts', tests: ['src/a.test.ts'] },
    ]);
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

  // #908: Go's own idiomatic go test invocation always names a PACKAGE
  // (directory), never a file -- `go test ./pkg/x/...` (recursive) and
  // `go test ./pkg/x` (exact package only) previously matched nothing in
  // isCoveredByScope's basename-only check, nagging even a correctly,
  // narrowly-targeted run.
  describe('directory-scoped runs (#908)', () => {
    it('a recursive directory scope (go test ./pkg/x/...) covers a file directly in that directory', () => {
      const edits = new Map([['pkg/cmd/label/list.go', ['pkg/cmd/label/list_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/label/...'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });

    it('a recursive directory scope covers a file nested in a subdirectory', () => {
      const edits = new Map([['pkg/cmd/label/sub/deep.go', ['pkg/cmd/label/sub/deep_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/label/...'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });

    it('a non-recursive directory scope (go test ./pkg/x, no ...) covers a file directly in that directory', () => {
      const edits = new Map([['pkg/cmd/label/list.go', ['pkg/cmd/label/list_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/label'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });

    it('a non-recursive directory scope does NOT cover a file in a subdirectory (Go: each dir is its own package)', () => {
      const edits = new Map([['pkg/cmd/label/sub/deep.go', ['pkg/cmd/label/sub/deep_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/label'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([
        { file: 'pkg/cmd/label/sub/deep.go', tests: ['pkg/cmd/label/sub/deep_test.go'] },
      ]);
    });

    it('a directory scope for a different package still nags (path-segment-aware, not string-prefix)', () => {
      // The exact false-clear class this fix must not reopen: "label" is a
      // text prefix of "labeler", but pkg/cmd/labeler is a real, different,
      // unrelated package.
      const edits = new Map([['pkg/cmd/labeler/other.go', ['pkg/cmd/labeler/other_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/label/...'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([
        { file: 'pkg/cmd/labeler/other.go', tests: ['pkg/cmd/labeler/other_test.go'] },
      ]);
    });

    it('a non-recursive directory scope for a different package (no ...) also still nags', () => {
      const edits = new Map([['pkg/cmd/labeler/other.go', ['pkg/cmd/labeler/other_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/label'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([
        { file: 'pkg/cmd/labeler/other.go', tests: ['pkg/cmd/labeler/other_test.go'] },
      ]);
    });

    it('a directory scope matches via the associated test file directory too, not just the edited file', () => {
      // Go's own same-package convention means these are usually identical,
      // but the check is symmetric with the existing basename/stem checks,
      // which also look at both the file and its tests.
      const edits = new Map([['pkg/cmd/label/list.go', ['pkg/cmd/other/list_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/other/...'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });

    it('a scope token that names a real file (recognized extension) is NOT treated as a directory scope', () => {
      // Unusual for `go test` in practice, but must not regress existing
      // file-scoped matching for any other runner that DOES pass file paths.
      const edits = new Map([['pkg/cmd/label/list.go', ['pkg/cmd/label/list_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['pkg/cmd/label/list_test.go'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });

    it('a directory scope one level up does not cover a file two levels down without the recursive suffix', () => {
      const edits = new Map([['pkg/cmd/label/sub/deep.go', ['pkg/cmd/label/sub/deep_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([
        { file: 'pkg/cmd/label/sub/deep.go', tests: ['pkg/cmd/label/sub/deep_test.go'] },
      ]);
    });

    it('a directory scope one level up DOES cover a file two levels down WITH the recursive suffix', () => {
      const edits = new Map([['pkg/cmd/label/sub/deep.go', ['pkg/cmd/label/sub/deep_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['./pkg/cmd/...'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });

    it('a directory scope token without a leading ./ still matches (go test pkg/x/...)', () => {
      const edits = new Map([['pkg/cmd/label/list.go', ['pkg/cmd/label/list_test.go']]]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: ['pkg/cmd/label/...'] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });
  });

  // 2026-07-29: name-filtered runs (`classifyTestCommand` returning `isTestRun:
  // true, broad: false, scopeTokens: []`) must behave, downstream in
  // computeUnverifiedFiles, exactly as if no run had been observed at all —
  // neither silencing the report (that was the bug: a name-filtered run
  // used to come back `broad: true` and clear every edited file) nor
  // crashing on the empty scopeTokens array.
  describe('name-filtered runs contribute no coverage', () => {
    it('a lone name-filtered run leaves every edited file unverified, same as no run at all', () => {
      const edits = new Map([
        ['src/foo.ts', ['src/foo.test.ts']],
        ['src/bar.ts', ['src/bar.test.ts']],
      ]);
      const runs = [{ isTestRun: true, broad: false, scopeTokens: [] }];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([
        { file: 'src/foo.ts', tests: ['src/foo.test.ts'] },
        { file: 'src/bar.ts', tests: ['src/bar.test.ts'] },
      ]);
    });

    it('a name-filtered run alongside a real scoped run only clears the scoped file, not the rest', () => {
      const edits = new Map([
        ['src/foo.ts', ['src/foo.test.ts']],
        ['src/bar.ts', ['src/bar.test.ts']],
      ]);
      const runs = [
        { isTestRun: true, broad: false, scopeTokens: [] }, // e.g. pytest -k unrelated_name
        { isTestRun: true, broad: false, scopeTokens: ['src/foo.test.ts'] },
      ];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([
        { file: 'src/bar.ts', tests: ['src/bar.test.ts'] },
      ]);
    });

    it('a genuinely broad run alongside a name-filtered run still clears everything', () => {
      const edits = new Map([['src/foo.ts', ['src/foo.test.ts']]]);
      const runs = [
        { isTestRun: true, broad: false, scopeTokens: [] }, // name-filtered
        { isTestRun: true, broad: true, scopeTokens: [] }, // e.g. npm test
      ];
      expect(computeUnverifiedFiles(edits, runs)).toEqual([]);
    });
  });
});
