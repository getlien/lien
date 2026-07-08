# @liendev/parser-native

Prebuilt native tree-sitter parser bindings for Lien, via a hand-rolled
napi-rs crate (no `@napi-rs/cli`). One export, `parseTree(lang, source)`,
returns a JSON-serialized tree -- see
[`docs/architecture/native-parser.md`](../../docs/architecture/native-parser.md)
for the full wire format and compat contract, and
[ADR-013](../../docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md)
for why this exists.

## Building

```bash
npm run build:native -w @liendev/parser-native
```

This vendors + patches `tree-sitter-kotlin` (`scripts/fetch-vendor.mjs`),
runs `cargo build --release`, and copies the resulting cdylib to
`./parser-native.node` (`scripts/copy-binary.mjs`). Requires the Rust
toolchain; not part of the root `npm run build` (that stays a no-op JS-only
build for this package).

## Platform resolution

`index.js` resolves the native binary in this order:

1. The per-platform npm package for the running platform (`scripts/platforms.json`
   is the canonical manifest of platform → npm package name → Rust target
   triple, also consumed by the CI prebuild matrix).
2. The local dev binary at `./parser-native.node` (from `build:native` above).
3. A clear error naming the platform triple and the remedy.

**No `optionalDependencies` committed.** `package.json` as checked into git
carries none -- they're generated and injected at publish time by
`scripts/publish-platform-packages.mjs`, run from `release.yml` against an
ephemeral CI checkout, never committed back. This mirrors what
`@napi-rs/cli`'s "napi prepublish" does for other native-addon projects,
hand-rolled per ADR-013's "no `@napi-rs/cli`" decision.

## CI / release wiring

- `.github/workflows/build-native.yml` builds one binary per platform in
  `scripts/platforms.json` (matrix computed by
  `.github/scripts/plan-native-build-matrix.mjs`, not hand-transcribed) and
  uploads each as a workflow artifact named after the platform id.
- `scripts/publish-platform-packages.mjs` turns those artifacts into
  `@liendev/parser-native-<platform>` package directories, `npm publish`es
  each, and injects the resulting `optionalDependencies` into this package's
  `package.json` before `changeset publish` packs it -- see `release.yml`'s
  `check-parser-native` / `build-native` / `release` jobs for the exact
  ordering.
- The same script's `--pack-only` mode is reused by `ci.yml`'s
  `release-smoke-test` job to produce an installable
  `@liendev/parser-native-linux-x64-gnu` tarball from a locally built binary,
  so that smoke test can exercise the loader's platform-package resolution
  path (#1 above), not just the local-binary fallback (#2).

## Tests

`npm run test -w @liendev/parser-native` runs against the locally built
`parser-native.node` (build it first with `build:native`).
