/**
 * Pure test-run classification and coverage matching for FEATURE 2 (the
 * did-you-run-the-tests verification nudge). Given a raw Bash command string,
 * decides whether it looks like a test invocation and, if so, whether it ran
 * the whole suite/workspace (`broad`) or named specific files (`scoped`,
 * with `scopeTokens`). `computeUnverifiedFiles` then answers "which edited
 * files with associated tests were never covered by an observed run?" —
 * zero I/O, zero LLM, fully unit-testable with synthetic strings.
 *
 * Runner *recognition* stays generous by design — recognizing more commands
 * as test runs only ever reduces false nags, never causes one. Coverage
 * *matching* (`isCoveredByScope`) is deliberately NOT generous, despite an
 * earlier version of this module being bidirectional-substring (see the
 * 2026-07 deviation note in
 * docs/architecture/test-verification-nudge.md#deviation-from-generous-substring-matching):
 * substring containment let an unrelated run (`oauth.test.ts` covering
 * `auth.ts`) silently suppress a real nag, which is a worse failure mode
 * than an occasional false nag the escape-hatch wording already absorbs.
 *
 * A run scoped by test NAME rather than by file/directory (`pytest -k expr`,
 * `dotnet test --filter expr`, `go test -run regex`, a bare `cargo test
 * name`, ...) is neither `broad` NOR does it contribute any `scopeTokens` —
 * see the `NAME_FILTER_FLAGS`/`POSITIONAL_NAME_FILTER_RUNNERS` handling in
 * `classifyTestCommand` below. It tells us *some* test ran, but not which
 * files it covered, so `computeUnverifiedFiles` must keep nagging exactly as
 * if no run had been observed at all — the same fail-safe bias as the
 * substring-matching deviation above: a false nag costs one line of
 * (already-escape-hatched) text, a false "everything is verified" silently
 * disables the whole mechanism.
 */

import path from 'node:path';
import { getSupportedExtensions } from '@liendev/parser';

export interface TestRunClassification {
  isTestRun: boolean;
  /** True when the matched command has no file/scope-narrowing argument — a whole-suite run. */
  broad: boolean;
  /** Path/name-like arguments found after the runner keyword. Empty when `broad`. */
  scopeTokens: string[];
}

// Segment splitters: a shell command is split on these so a runner keyword
// buried after `cd x &&` (or `; `, `|`, `||`) is still recognized — only the
// segment containing the runner keyword is inspected for scope arguments.
const SEGMENT_SPLIT_RE = /&&|\|\||\||;/;

// A leading `VAR=value` environment assignment (`CI=1 npm test`,
// `NODE_ENV=test vitest`) must not defeat the runner-keyword match, which is
// anchored to the start of the segment. Stripped in a loop so multiple
// leading assignments (`CI=1 FORCE_COLOR=0 npm test`) are all removed.
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/;

function stripLeadingEnvAssignments(segment: string): string {
  let s = segment;
  while (ENV_ASSIGNMENT_RE.test(s)) {
    s = s.replace(ENV_ASSIGNMENT_RE, '');
  }
  return s;
}

// Package-manager/environment-runner wrappers (#905): `uv run pytest`,
// `poetry run pytest tests/foo.py`, `pipenv run pytest`, `rye run pytest`,
// and `pdm run pytest` all defeat every ^-anchored RUNNER_PATTERNS entry the
// same way an unstripped `CI=1` prefix would. These five are the mainstream
// named wrappers (uv/Astral, Poetry, Pipenv, Rye, PDM) — deliberately a
// closed allow-list, not a heuristic over arbitrary leading words, so a
// project's own custom wrapper script never gets silently treated as
// transparent. Only the `<wrapper> run` form is recognized; flags on the
// wrapper's own invocation *before* `run` (e.g. `poetry -C /path run ...`)
// are out of scope — not reported by #905 and not worth the complexity.
const WRAPPER_PREFIX_RE = /^(?:uv|poetry|pipenv|rye|pdm)\s+run(?=\s|$)/;

// Flags on the wrapper's `run` invocation itself that take a following,
// space-separated value — e.g. `uv run --group tests pytest` must not treat
// "tests" as the start of the wrapped command. `--flag=value` (a single
// token) never needs this list; it's handled generically below. Deliberately
// scoped to uv's documented flags (the only one of the five with common
// value-taking flags before the wrapped command in practice); harmless if a
// future wrapper happens to share a flag name.
const WRAPPER_VALUE_FLAGS = new Set([
  '--group',
  '--no-group',
  '--extra',
  '--no-extra',
  '--with',
  '--with-editable',
  '--with-requirements',
  '--index',
  '--python',
  '-p',
  '--directory',
  '-C',
  '--env-file',
  '--package',
]);

/** Drop leading flags (and, for known value-taking flags, their value) until the wrapped command's own keyword is reached. */
function stripWrapperFlags(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const token = tokens[i];
    i += !token.includes('=') && WRAPPER_VALUE_FLAGS.has(token) ? 2 : 1;
  }
  return tokens.slice(i);
}

/** Strip one recognized `<wrapper> run [flags...]` prefix, or return null when the segment doesn't start with one. */
function stripLeadingWrapperPrefix(segment: string): string | null {
  const match = segment.match(WRAPPER_PREFIX_RE);
  if (!match) return null;
  const tokens = segment.slice(match[0].length).trim().split(/\s+/).filter(Boolean);
  return stripWrapperFlags(tokens).join(' ');
}

/**
 * Repeatedly strip leading `VAR=value` assignments and recognized wrapper
 * prefixes until neither applies — handles both `CI=1 uv run pytest` (env
 * before wrapper) and a wrapper stripped down to reveal a further env
 * assignment or nested wrapper (e.g. `uv run poetry run pytest`).
 */
function stripLeadingWrappersAndEnv(segment: string): string {
  let s = stripLeadingEnvAssignments(segment);
  for (;;) {
    const stripped = stripLeadingWrapperPrefix(s);
    if (stripped === null) break;
    s = stripLeadingEnvAssignments(stripped);
  }
  return s;
}

// Flags whose VALUE scopes a whole package/workspace, not a single file —
// `npm test -w @liendev/core` must classify as broad even though
// "@liendev/core" contains a "/". The flag and its value are both skipped
// before scanning for path-like tokens.
//
// `--filter` is deliberately NOT here even though pnpm also uses it for
// workspace scoping: `pnpm --filter my-pkg test` (filter BEFORE the script)
// is matched whole by its own anchored RUNNER_PATTERNS entry above (the
// flag+value never reach this remainder scan at all); `pnpm test --filter
// my-pkg` (filter AFTER) is instead handled by the pnpm-specific
// `PNPM_TEST_VALUE_FLAGS` below, scoped to that ordering only — a global
// entry here would also swallow dotnet/swift's unrelated test-NAME use of
// the identical spelling, which must NOT be silently skipped (see
// NAME_FILTER_FLAGS below).
const WORKSPACE_SCOPE_FLAGS = new Set(['-w', '--workspace']);

// Flags whose value narrows a run to specific test NAMES rather than a
// file/directory/workspace — `pytest -k expr`, `dotnet test --filter expr`,
// `rspec -e name`, `mocha --grep pattern`, `go test -run regex`, `vitest -t`
// / `jest -t` (or `--testNamePattern`). Recognizing one of these flags marks
// the run as name-filtered: some tests genuinely ran, but which files they
// covered is unknowable from the command line alone, so (per the module doc
// comment) the run must end up neither `broad` nor contributing a
// `scopeTokens` entry — never silently "verified", never a hard failure
// either. A bare `cargo test <name>` has no flag at all (see
// `POSITIONAL_NAME_FILTER_RUNNERS` below for that positional case).
//
// Deliberately PER-RUNNER-FAMILY, not one global set: a couple of these
// short flag spellings are reused with UNRELATED meaning by another runner
// in this same file. Concretely, tox's `-e ENV` selects which configured
// environment to run (still that environment's whole configured suite, not
// a named test — see the `tox`/`nox` comment on RUNNER_PATTERNS), which is
// NOT the same thing as rspec's `-e NAME` (a single named example).
// Recognizing bare `-e` globally would wrongly flip `tox -e py311` from
// broad (correct, must not regress) to name-filtered.
const PYTEST_NAME_FILTER_FLAGS = new Set(['-k', '-m']);
const RSPEC_NAME_FILTER_FLAGS = new Set(['-e', '--example']);
const MOCHA_NAME_FILTER_FLAGS = new Set(['--grep', '-g']);
const GO_TEST_NAME_FILTER_FLAGS = new Set(['-run']);
// vitest and jest share the same Jest-descended CLI convention.
const JS_TEST_NAME_FILTER_FLAGS = new Set(['-t', '--testNamePattern']);
// dotnet and swift both spell their (unrelated-to-pnpm) test-name filter
// `--filter`. pnpm's own `--filter` is either fully absorbed by its
// dedicated anchored RUNNER_PATTERNS entry (filter BEFORE the script) or
// handled by the pnpm-specific `PNPM_TEST_VALUE_FLAGS` value-skip (filter
// AFTER) — `nameFilterFlagsFor` only returns this set for `dotnet test`/
// `swift test` specifically, so there is no collision in practice despite
// the shared spelling.
const DOTNET_SWIFT_NAME_FILTER_FLAGS = new Set(['--filter']);
const NO_NAME_FILTER_FLAGS: ReadonlySet<string> = new Set();

/** Which name-filter flags apply for the runner `matchedRunnerText` (`match[0]`) identified — empty when that runner has none. */
function nameFilterFlagsFor(matchedRunnerText: string): ReadonlySet<string> {
  const text = matchedRunnerText.trim();
  if (/pytest$/.test(text)) return PYTEST_NAME_FILTER_FLAGS;
  if (/rspec$/.test(text)) return RSPEC_NAME_FILTER_FLAGS;
  if (/^mocha$/.test(text)) return MOCHA_NAME_FILTER_FLAGS;
  if (/^go\s+test$/.test(text)) return GO_TEST_NAME_FILTER_FLAGS;
  if (/vitest$/.test(text) || /^jest$/.test(text)) return JS_TEST_NAME_FILTER_FLAGS;
  if (/^dotnet\s+test$/.test(text) || /^swift\s+test$/.test(text)) {
    return DOTNET_SWIFT_NAME_FILTER_FLAGS;
  }
  return NO_NAME_FILTER_FLAGS;
}

/** `token` is one of `flags`, bare or as its `--flag=value` single-token form. */
function isNameFilterFlag(token: string, flags: ReadonlySet<string>): boolean {
  if (flags.has(token)) return true;
  return [...flags].some(flag => token.startsWith(`${flag}=`));
}

// Runners whose own CLI convention narrows to a named test via a BARE
// positional argument — no flag at all — so the generic isNameFilterFlag
// scan above can't see it. `cargo test [TESTNAME]` is the one such form
// among RUNNER_PATTERNS; every other name-filter above is flag-driven.
// Deliberately keyed on the exact matched runner text (`match[0]`, e.g.
// "cargo test") rather than "any bare leftover token", which would also
// wrongly swallow `cargo nextest run`'s required `run` subcommand keyword
// and Gradle's `-x <task>`/`--exclude-task <task>` exclusion VALUE (both are
// bare tokens with a completely different meaning) — see the matching
// negative test cases in test-run-matcher.test.ts.
const POSITIONAL_NAME_FILTER_RUNNERS = new Set(['cargo test']);

function isPositionalNameFilterRunner(matchedRunnerText: string): boolean {
  return POSITIONAL_NAME_FILTER_RUNNERS.has(matchedRunnerText.trim());
}

// `cargo test`'s own build/compile-config flags that take a value — NONE of
// these narrow which tests run at all (they configure feature flags, which
// package/manifest/target/profile to build, or job parallelism), so the run
// stays whatever the rest of the command implies (broad, absent any other
// scoping). Without this set, `extractPathLikeTokens`'s bare-token tracking
// (feeding `isPositionalNameFilterRunner` above) misread e.g. `--features
// foo`'s value "foo" as a bare positional TEST NAME, flipping a genuinely
// broad `cargo test --features foo` to falsely name-filtered — caught in
// review (the same collision hazard as tox `-e`/rspec `-e`, and
// cargo-nextest's `run` keyword, just a third instance of it). Skipped as
// flag+value, same mechanism as WORKSPACE_SCOPE_FLAGS/CONFIG_FLAGS, but kept
// cargo-test-specific (via `valueSkipFlagsFor`) rather than global, since
// e.g. `-j`/`--target` aren't universally safe to blanket-skip for every
// runner. `--test <name>` (a specific integration-test-binary target) is
// deliberately NOT here: it doesn't configure the build, it selects which
// tests run, so its value should keep flowing through as an ordinary bare
// token — landing on the same name-filtered (not broad, not silently
// "scoped") outcome as a plain positional filter, which is the safe
// direction for a target name we don't have infrastructure to resolve
// against real file paths.
const CARGO_TEST_VALUE_FLAGS = new Set([
  '-p',
  '--package',
  '--exclude',
  '--manifest-path',
  '--lockfile-path',
  '--target',
  '--target-dir',
  '--profile',
  '-j',
  '--jobs',
  '-F',
  '--features',
  '--color',
  '--message-format',
]);
const NO_VALUE_SKIP_FLAGS: ReadonlySet<string> = new Set();

// pnpm's own `--filter`/`-F` (https://pnpm.io/filtering), when it appears
// AFTER the script name (`pnpm test --filter <selector>`) rather than before
// it (`pnpm --filter <selector> test`, already fully absorbed by its own
// anchored RUNNER_PATTERNS entry above). A package selector routinely
// contains "/" (a scope, `@hono/core`) — caught in review: without this set,
// that value was independently scanned and misread as a PATH-like scope
// token, flipping a genuinely broad `pnpm test --filter @hono/core` to a
// falsely narrow "scoped to ./@hono/core" — the fourth instance of the same
// short-flag-collision hazard in this file. The `--filter=value` single-token
// form doesn't need an entry here: it already starts with `-`, so it's
// caught by the generic dash-prefix skip before ever reaching the path check
// (verified: `pnpm test --filter=@hono/core` already classifies broad).
const PNPM_TEST_VALUE_FLAGS = new Set(['--filter', '-F']);

/** True for the generic `pnpm test`/`pnpm test:script` match — i.e. NOT the dedicated `pnpm --filter <pkg> test` anchored form, where `--filter` never reaches this scan at all. */
function isPnpmTestRunner(matchedRunnerText: string): boolean {
  return /^pnpm\s+test(:\S*)?$/.test(matchedRunnerText.trim());
}

/** Which extra flag+value pairs should be fully skipped (beyond the universal WORKSPACE_SCOPE_FLAGS/CONFIG_FLAGS) for the runner `matchedRunnerText` identified. */
function valueSkipFlagsFor(matchedRunnerText: string): ReadonlySet<string> {
  if (isPositionalNameFilterRunner(matchedRunnerText)) return CARGO_TEST_VALUE_FLAGS;
  if (isPnpmTestRunner(matchedRunnerText)) return PNPM_TEST_VALUE_FLAGS;
  return NO_VALUE_SKIP_FLAGS;
}

// Flags whose value is a config file path, not a test/source file —
// `vitest --config vitest.config.ts` runs whatever the config's own
// `include` pattern selects (typically the whole suite), not just the named
// config file. The flag and its value are both skipped, same mechanism as
// the workspace-scope flags above.
const CONFIG_FLAGS = new Set(['-c', '--config']);

// A token whose basename matches this is a config file even when it wasn't
// preceded by a --config/-c flag (covers runners that accept the config
// path positionally) — never a scope-narrowing argument.
const CONFIG_FILE_RE = /\.config\.[^./]+$/i;

// Go's "all packages, recursively" convention. Contains a "/" but names no
// specific file, so it must not count as a scoping argument.
const GLOB_ALL_TOKENS = new Set(['./...', '...']);

// Conservative allow-list (see docs/architecture/test-verification-nudge.md
// section on runner recognition). Each pattern is anchored to the start of a
// (trimmed, env-assignment-stripped) command segment; the boundary
// `(?=\s|$)` stops "npm t" from matching inside "npm test". `(:\S*)?` on the
// npm-run-script/yarn/pnpm forms recognizes custom script names like
// `npm run test:e2e:python` (this repo's own convention) — npm's bare `npm
// test` shorthand has no such custom-name form, so it's left unextended.
const RUNNER_PATTERNS: RegExp[] = [
  /^npm\s+run\s+test(:\S*)?(?=\s|$)/,
  /^npm\s+test(?=\s|$)/,
  /^npm\s+t(?=\s|$)/,
  /^yarn\s+test(:\S*)?(?=\s|$)/,
  // pnpm's own workspace selector (https://pnpm.io/filtering), `--filter` or
  // its documented `-F` alias, BEFORE the script name. `(?:\s+\S+|=\S+)`
  // accepts both the space-separated form (`--filter <selector>`) and the
  // single-token `=` form pnpm's own docs also show (`--filter=selector`) —
  // caught in review: the `=` form was previously unrecognized entirely
  // (`pnpm --filter=@hono/core test` matched no pattern at all), always
  // nagging even though pnpm's docs list it as the canonical way to exclude
  // a package (`--filter=!foo`).
  /^pnpm\s+(?:--filter|-F)(?:\s+\S+|=\S+)\s+test(?=\s|$)/,
  /^pnpm\s+test(:\S*)?(?=\s|$)/,
  /^bun\s+test(?=\s|$)/,
  /^npx\s+vitest(?=\s|$)/,
  /^vitest(?=\s|$)/,
  /^jest(?=\s|$)/,
  /^mocha(?=\s|$)/,
  /^python[0-9.]*\s+-m\s+pytest(?=\s|$)/,
  /^pytest(?=\s|$)/,
  /^go\s+test(?=\s|$)/,
  /^cargo\s+nextest(?=\s|$)/,
  /^cargo\s+test(?=\s|$)/,
  /^bundle\s+exec\s+rspec(?=\s|$)/,
  /^rspec(?=\s|$)/,
  // Ruby's Rake/Minitest convention: the task name is a namespaced suffix
  // (`test`, `test:core`), never a file/path, so `(:\S*)?` mirrors the
  // npm-run-script form above rather than being scanned as a scope token.
  /^bundle\s+exec\s+rake\s+test(:\S*)?(?=\s|$)/,
  /^(\.\/)?rake\s+test(:\S*)?(?=\s|$)/,
  // PHP: phpunit is typically vendored per-project (`vendor/bin/phpunit`,
  // `./vendor/bin/phpunit`), not installed globally; the bare form is kept
  // as a subset of this pattern rather than a separate one.
  /^(\.\/)?(vendor\/bin\/)?phpunit(?=\s|$)/,
  // PHP: `composer test` is a common composer.json `scripts` alias, same
  // class as `npm test`.
  /^composer\s+test(?=\s|$)/,
  /^dotnet\s+test(?=\s|$)/,
  /^deno\s+test(?=\s|$)/,
  // Swift/SwiftPM's one canonical test-invocation form. `--filter X` names a
  // suite, not a path — recognized as a name filter (see
  // DOTNET_SWIFT_NAME_FILTER_FLAGS), so this stays name-filtered (not
  // broad, not scoped) rather than either extreme.
  /^swift\s+test(?=\s|$)/,
  /^gradle\s+test(?=\s|$)/,
  // Gradle wrapper script (the near-universal per-project convention,
  // distinct from a globally-installed `gradle`). Gradle invocations commonly
  // chain multiple task names and flags before the one that matters
  // (`clean test`, `--no-daemon test`, `-PmyProp=value test`), so
  // `(?:[\w.:=-]+\s+)*` absorbs any number of leading bare/colon-namespaced
  // task tokens and `-P`-style property flags — deliberately excluding `/`
  // so a real scope-narrowing file argument is never swallowed as a "task".
  // The negative lookbehind guards specifically the `test` this pattern is
  // about to accept as satisfying the match: `-x`/`--exclude-task` EXCLUDE
  // their single following argument rather than running it, so a `test`
  // immediately preceded by one of those flags (`-x test`, `--exclude-task
  // test`) must not count as "ran test" — the opposite of what happened.
  // Checking only immediately before the candidate `test` (rather than
  // blanket-blocking `-x`/`--exclude-task` from ever appearing earlier in
  // the command) correctly still recognizes `-x someOtherTask test` and
  // `test -x someOtherTask`, where a *different* task is excluded and
  // `test` genuinely runs. `(\S*:)?` absorbs a Gradle task path like
  // `:exposed-core:test` into the match itself so it is never mistaken for
  // a scope-narrowing file token (it names no file). Requires the literal
  // `test` task to actually be present and not excluded (a bare `./gradlew
  // clean` or `./gradlew -x test` stays unrecognized).
  /^(\.\/)?gradlew\s+(?:[\w.:=-]+\s+)*(?<!(?:-x|--exclude-task)\s)(\S*:)?test(?=\s|$)/,
  /^mvn\s+test(?=\s|$)/,
  /^nx\s+test(?:\s+\S+)?(?=\s|$)/,
  // #905: tox (Python's test-orchestration tool, alongside nox) had no entry
  // at all. Bare `tox`/`tox run`/`tox -e py311` run the whole configured
  // suite for that environment — no file is named, so these stay broad.
  // tox's `-e ENV` is deliberately NOT in any NAME_FILTER_FLAGS set (it
  // selects an environment, not a named test — the value is just an
  // ordinary non-path token the scope scan ignores). tox's own convention
  // for narrowing is the `--` passthrough (`tox -e py311 --
  // tests/test_x.py`), forwarding args to the env's underlying test
  // command — the same generic path-token scan that already handles `npm
  // test -- path/to/x.test.ts` picks up a path-like token after `--` for
  // free, since `--` itself is skipped as a flag.
  /^tox(\s+run)?(?=\s|$)/,
  /^python[0-9.]*\s+-m\s+tox(?=\s|$)/,
  // nox: same shape and same passthrough (`nox -s test -- tests/test_x.py`).
  /^nox(?=\s|$)/,
  /^python[0-9.]*\s+-m\s+nox(?=\s|$)/,
];

function matchRunner(segment: string): RegExpMatchArray | null {
  for (const pattern of RUNNER_PATTERNS) {
    const match = segment.match(pattern);
    if (match) return match;
  }
  return null;
}

function sourceExtensions(): ReadonlySet<string> {
  return new Set(getSupportedExtensions().map(ext => `.${ext}`));
}

/** A token names a file/test when it looks like a path or ends in a source extension (test files share their language's extension). */
function isPathLikeToken(token: string, extensions: ReadonlySet<string>): boolean {
  if (GLOB_ALL_TOKENS.has(token)) return false;
  if (CONFIG_FILE_RE.test(token)) return false;
  if (token.includes('/')) return true;
  return [...extensions].some(ext => token.endsWith(ext));
}

interface ScopeScanResult {
  /** Path-like tokens found (see `isPathLikeToken`) — a genuine file/directory scope. */
  pathTokens: string[];
  /** A recognized name-filter flag (`NAME_FILTER_FLAGS`) was present in the remainder. */
  sawNameFilterFlag: boolean;
  /** A bare (non-flag, non-path) token was present — only meaningful for `POSITIONAL_NAME_FILTER_RUNNERS`. */
  sawBareToken: boolean;
}

/**
 * Scan the remainder of a segment after its matched runner keyword for
 * scoping arguments. Skips flags (dash-prefixed) and, for workspace-scope,
 * config, and runner-specific value-taking flags specifically, their value
 * too (a manual index loop is required here to look ahead one token — not a
 * tree-sitter AST walk, so the codebase's array-methods-only rule for
 * SyntaxNode iteration doesn't apply). `valueSkipFlags` (from
 * `valueSkipFlagsFor`) covers flags whose value would otherwise be
 * misread as scoping evidence — e.g. `cargo test --features foo`'s "foo"
 * looking like a bare positional test name. A name-filter flag's own value,
 * by contrast, is deliberately NOT skipped as a pair (unlike these): the
 * flag's mere presence is enough to signal "name-filtered", and letting its
 * value fall through the ordinary path-token check for free still promotes
 * it to a real scope token on the rare occasion it happens to look like a
 * path.
 */
function extractPathLikeTokens(
  remainder: string,
  extensions: ReadonlySet<string>,
  nameFilterFlags: ReadonlySet<string>,
  valueSkipFlags: ReadonlySet<string>,
): ScopeScanResult {
  const tokens = remainder.trim().split(/\s+/).filter(Boolean);
  const pathTokens: string[] = [];
  let sawNameFilterFlag = false;
  let sawBareToken = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (WORKSPACE_SCOPE_FLAGS.has(token) || CONFIG_FLAGS.has(token) || valueSkipFlags.has(token)) {
      i++; // also skip the flag's value
      continue;
    }
    if (isNameFilterFlag(token, nameFilterFlags)) {
      sawNameFilterFlag = true;
      continue;
    }
    if (token.startsWith('-')) continue;
    if (isPathLikeToken(token, extensions)) {
      pathTokens.push(token);
    } else {
      sawBareToken = true;
    }
  }
  return { pathTokens, sawNameFilterFlag, sawBareToken };
}

/**
 * Classify a raw Bash command string. `isTestRun` is false (broad/scopeTokens
 * both empty/false) when no segment matches a recognized runner. When at
 * least one matching segment carries no scoping argument, the whole
 * classification is `broad` (a whole-suite run is present) even if another
 * segment in the same command also named specific files.
 *
 * A segment that instead carries a test-NAME filter (a `NAME_FILTER_FLAGS`
 * flag, or a bare positional for a `POSITIONAL_NAME_FILTER_RUNNERS` runner)
 * and no path tokens is neither `broad` nor a contributor to `scopeTokens` —
 * see the module doc comment for why "ran, scope unknown" must not be
 * conflated with "ran the whole suite".
 */
export function classifyTestCommand(command: string): TestRunClassification {
  const extensions = sourceExtensions();
  const segments = command
    .split(SEGMENT_SPLIT_RE)
    .map(s => stripLeadingWrappersAndEnv(s.trim()))
    .filter(Boolean);

  let isTestRun = false;
  let broad = false;
  const scopeTokens = new Set<string>();

  for (const segment of segments) {
    const match = matchRunner(segment);
    if (!match) continue;
    isTestRun = true;
    const remainder = segment.slice(match[0].length);
    const { pathTokens, sawNameFilterFlag, sawBareToken } = extractPathLikeTokens(
      remainder,
      extensions,
      nameFilterFlagsFor(match[0]),
      valueSkipFlagsFor(match[0]),
    );
    if (pathTokens.length > 0) {
      pathTokens.forEach(t => scopeTokens.add(t));
      continue;
    }
    const nameFiltered =
      sawNameFilterFlag || (sawBareToken && isPositionalNameFilterRunner(match[0]));
    if (!nameFiltered) {
      broad = true;
    }
  }

  if (!isTestRun) return { isTestRun: false, broad: false, scopeTokens: [] };
  return { isTestRun: true, broad, scopeTokens: broad ? [] : [...scopeTokens] };
}

/** Case-insensitive basename of a scope token or associated test/file path. */
function baseKey(p: string): string {
  return path.basename(p).toLowerCase();
}

/**
 * Case-insensitive basename with one trailing extension AND one trailing
 * `.test`/`.spec` segment stripped, so `foo.test.ts` and `foo.ts` (or
 * `foo.spec.ts`) share the same stem. Scoped narrowly to the dotted
 * `name.test.ext`/`name.spec.ext` convention per the reviewer's ruling below
 * — other per-language test-naming conventions (Python's `test_foo.py`,
 * Go's `foo_test.go`, Ruby's `foo_spec.rb`) are not covered by stem
 * equality; they still match via the exact-basename branch in
 * `isCoveredByScope` whenever the run names the real associated test file,
 * which is the common case (the ledger already stores the true test path).
 */
function stemKey(p: string): string {
  const base = baseKey(p);
  const withoutExt = base.replace(/\.[^./]+$/, '');
  return withoutExt.replace(/\.(test|spec)$/, '');
}

/**
 * Split a scope token into its directory portion and whether it carries
 * Go's recursive `/...` suffix (`go test ./pkg/x/...`). A token with no
 * `/...` suffix is still a directory scope, just non-recursive — matching
 * Go's own semantics exactly: `go test ./pkg/x` runs only that package,
 * never its subdirectories (each is a separate package); only the `/...`
 * form recurses. A trailing slash (with or without the wildcard) is
 * stripped first so `./pkg/x/` and `./pkg/x` parse identically.
 */
function parseDirectoryScope(token: string): { dir: string; recursive: boolean } {
  const trimmed = token.replace(/\/+$/, '');
  if (trimmed.endsWith('/...')) {
    return { dir: trimmed.slice(0, -'/...'.length), recursive: true };
  }
  return { dir: trimmed, recursive: false };
}

/** Strip a leading "./" so `./pkg/x` and `pkg/x` compare equal. */
function normalizeDirForComparison(dir: string): string {
  return dir.replace(/^\.\//, '');
}

/**
 * True when `token` names a directory rather than a specific file — i.e. it
 * carries no recognized source extension once a `/...` recursive suffix is
 * stripped. Go's own `go test` invocation ALWAYS names a package directory,
 * never an individual file (there is no per-file `go test` form at all), so
 * this fires for essentially every real Go scope token — but the check
 * itself is deliberately language-agnostic, not Go-gated: `scopeTokens` are
 * flattened across every matched run with no record of which runner
 * produced them (tagging would need a much larger structural change than
 * this fix warrants), and "this names a directory, not a file" is an
 * equally valid signal for any other ecosystem's directory-scoped run
 * (e.g. `pytest tests/unit/`).
 */
function isDirectoryScopeToken(token: string, extensions: ReadonlySet<string>): boolean {
  const { dir } = parseDirectoryScope(token);
  return ![...extensions].some(ext => dir.endsWith(ext));
}

/**
 * Path-segment-aware directory containment: is `fileDir` the scope
 * token's own directory (always allowed), or nested under it (only when
 * the token's `/...` recursive suffix was present)?
 *
 * Deliberately NOT a string-prefix check — `./pkg/cmd/label` must not
 * cover `./pkg/cmd/labeler`, a real, different, unrelated package that
 * merely shares a text prefix. Comparing for exact equality, or a prefix
 * of `scopeDir + '/'` specifically, anchors the match to a genuine
 * path-segment boundary instead of a raw substring.
 */
function isDirCoveredByScopeToken(fileDir: string, scopeToken: string): boolean {
  const { dir, recursive } = parseDirectoryScope(scopeToken);
  const scopeDir = normalizeDirForComparison(dir);
  const normalizedFileDir = normalizeDirForComparison(fileDir);
  if (normalizedFileDir === scopeDir) return true;
  return recursive && normalizedFileDir.startsWith(`${scopeDir}/`);
}

/**
 * A pending edited file is covered when a scoped run's token EXACTLY matches
 * (case-insensitive) the file's own basename or an associated test's
 * basename, or when their stems match after stripping one extension and one
 * `.test`/`.spec` segment (so a run naming `foo.test.ts` covers an edit to
 * `foo.ts`, and vice versa) — or when the token is a directory scope (#908,
 * `go test ./pkg/x/...` / `./pkg/x`) whose directory contains the file's own
 * directory or an associated test's directory (see `isDirCoveredByScopeToken`
 * for the recursive-vs-exact distinction).
 *
 * Deliberately NOT substring/bidirectional-containment, unlike an earlier
 * version of this function — see the module doc comment and the dated
 * deviation note in docs/architecture/test-verification-nudge.md: substring
 * matching let e.g. a `oauth.test.ts` run silently "cover" an unrelated
 * `auth.ts` edit (because "auth" is a substring of "oauth"), which is a
 * worse failure mode (a real gap goes unnoticed) than the false nag this
 * feature is otherwise biased to avoid. The directory-scope check above is
 * exactly as strict, just at the directory level (`isDirCoveredByScopeToken`
 * anchors on a real path-segment boundary, never a bare string prefix).
 */
function isCoveredByScope(
  file: string,
  tests: string[],
  scopeTokens: string[],
  extensions: ReadonlySet<string>,
): boolean {
  const fileBase = baseKey(file);
  const fileStem = stemKey(file);
  const testBases = tests.map(baseKey);
  const testStems = tests.map(stemKey);
  const candidateDirs = [file, ...tests].map(p => path.posix.dirname(p));

  return scopeTokens.some(token => {
    const tokenBase = baseKey(token);
    if (tokenBase === fileBase || testBases.includes(tokenBase)) return true;
    const tokenStem = stemKey(token);
    if (tokenStem === fileStem || testStems.includes(tokenStem)) return true;
    if (!isDirectoryScopeToken(token, extensions)) return false;
    return candidateDirs.some(dir => isDirCoveredByScopeToken(dir, token));
  });
}

/**
 * Which edited files (with associated tests) were never observed covered by
 * a test run this session. Conservative bias: if ANY observed run is broad,
 * the whole edit set is presumed exercised and this returns empty — a
 * plausible whole-suite/whole-workspace run beats a possibly-incomplete
 * per-file cross-check. Otherwise, a file is unverified unless some scoped
 * run's tokens match its basename or an associated test's basename.
 */
export function computeUnverifiedFiles(
  edits: Map<string, string[]>,
  runs: TestRunClassification[],
): Array<{ file: string; tests: string[] }> {
  if (runs.some(r => r.isTestRun && r.broad)) return [];

  const scopeTokens = runs.filter(r => r.isTestRun && !r.broad).flatMap(r => r.scopeTokens);
  const extensions = sourceExtensions();

  const unverified: Array<{ file: string; tests: string[] }> = [];
  for (const [file, tests] of edits) {
    if (!isCoveredByScope(file, tests, scopeTokens, extensions)) unverified.push({ file, tests });
  }
  return unverified;
}
