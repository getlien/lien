/**
 * Snapshot from PR #716 ("docs(site): post-migration sweep — install story,
 * native parser, stale claims") captured at the planted-claim commit
 * headSha 4c805ea7ef21 (base 1462514ff87f). A docs-only PR: the four touched
 * files are all under packages/site/docs + a vitepress config. The claim lives
 * in the touched prose; the falsifying code lives OUT of the diff, in the
 * parser loader.
 *
 * THE PLANTED CLAIM (touched prose, packages/site/docs/guide/installation.md):
 *   "No compiler or build toolchain required on supported platforms — Lien's
 *    parser ships as prebuilt native binaries for macOS (arm64/x64), Linux
 *    (x64/arm64, glibc or musl, including Alpine), and Windows (x64), so there's
 *    no `node-gyp`, no Python/make/g++, no Xcode Command Line Tools step. Any
 *    other platform needs a one-time local build of the parser crate with the
 *    Rust toolchain"
 *
 * WHY IT'S SUSPECT (contradicting code — packages/parser-native/index.js,
 * `loadBinding`, present in repoChunks but NOT in the diff):
 *   The loader's resolution order is (1) the per-platform npm package, (2) a
 *   local dev binary at ./parser-native.node produced by
 *   `npm run build:native`, (3) throw "Build it with: npm run build:native".
 *   Its own comments say the per-platform packages are installed via
 *   optionalDependencies "once the release pipeline publishes them" and that
 *   the local build is "the expected path in this monorepo checkout until the
 *   release pipeline publishes per-platform packages." So the unqualified
 *   "ships as prebuilt native binaries / no toolchain required" claim overstates
 *   the state the loader actually encodes: a supported-platform install can
 *   still fall through to a source build that needs the Rust toolchain.
 *
 * WHAT A CORRECT FINDING MUST SAY: quote installation.md's "prebuilt native
 * binaries / no compiler or build toolchain required" claim and point at the
 * loader's source-build fallback (`npm run build:native` in
 * packages/parser-native/index.js) — including the loader's own "until the
 * release pipeline publishes per-platform packages" comment — as the code fact
 * the doc contradicts.
 *
 * Capture command (fixture carries pr.headSha 4c805ea7ef21…, base 1462514f…):
 *   npx tsx packages/review/test/harness/capture-pr.ts 716 \
 *     packages/review/test/harness/fixtures/doc-truth/pr716-install-claim.fixture.json \
 *     --sha 4c805ea7ef212c300c756202330ff59c7c96bfa2
 *
 * STRUCTURAL RISK for real-Kimi calibration (flagged, not papered over) —
 * VERIFIED via build-prompts.ts on this fixture (2026-07-11). Two compounding
 * risks:
 *   1. Reachability. The falsifying evidence (index.js) is NOT in the diff —
 *      the PR touches only doc files. The claim IS in-prompt (installation.md
 *      hunk + how-it-works.md, which redundantly asserts "installing Lien never
 *      compiles anything"), but the loader body is not — reaching it needs the
 *      reviewer to proactively get_files_context/read_file the UNCHANGED
 *      packages/parser-native/index.js. index.js IS in repoChunks (so
 *      get_files_context can surface it), but read_file/grep can be blind in
 *      replay, there is no diff signpost, and the dependency-signals section
 *      points at parser.ts's loadNativeBinding, not index.js's build:native
 *      fallback — so Kimi may never make the doc→loader leap on a docs-only PR.
 *   2. Weak contradiction on the merits. The fallback is CONDITIONAL — it only
 *      triggers when the per-platform prebuilt package isn't installed, and the
 *      loader's own comments scope that to the dev checkout ("until the release
 *      pipeline publishes per-platform packages"). By this fixture's SHA those
 *      packages had shipped (the PR summary calls prebuilt binaries "now the
 *      selling point"), so a rigorous reviewer could correctly conclude the doc
 *      is accurate for published installs and NOT fire — a legitimate no-fire.
 * Calibration status: 2/10 on `moonshotai/kimi-k2.7-code` (2026-07-11,
 * --calibrate 10) — as predicted below. Acceptance fixture for the phase-2
 * <doc_claims> deterministic signal.
 *
 * Net: expect this to calibrate LOW on Kimi, possibly correctly-low. It is the
 * second-shakiest fixture (after pr687's truncation block) and is deliberately
 * NOT tagged canary until a calibration baseline exists.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #716 4c805ea7 — installation.md claims the parser "ships as prebuilt native binaries" ' +
    'with "no compiler or build toolchain required", but parser-native/index.js falls back to a ' +
    'source build (`npm run build:native`) requiring the Rust toolchain',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    h.expectFindingMentions(
      [
        // The falsifying loader fact
        'build:native',
        'parser-native',
        'index.js',
        'loadbinding',
        'fallback',
        'fall back',
        'source build',
        'local build',
        'build from source',
        // The claim being flagged
        'prebuilt',
        'no compiler',
        'no toolchain',
        'toolchain',
        // Vocabulary a correct finding reaches for
        'rust',
        'cargo',
        'optionaldependencies',
        'per-platform',
        'published',
        'publishes',
        'native binar',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
  tags: [],
};

export default assertions;
