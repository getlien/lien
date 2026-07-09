# Working in a Git Worktree

As of ADR-013 Phase 4-B (the retirement of `node-tree-sitter` and its 11
npm grammar packages), a plain `npm install` / `npm ci` works normally in a
linked git worktree — no symlink farm needed. The install-time compile
failure this doc used to work around was `node-tree-sitter`'s `node-gyp`
build breaking against this environment's Apple-clang toolchain; that native
binding is gone. The one other native addon in the tree, `better-sqlite3`,
resolves a prebuilt binary via `prebuild-install` rather than compiling
locally, so it isn't a blocker either. Verified empirically: `npm ci` in a
scratch worktree of this branch completed in ~7s with no compile step.

```bash
# From inside a fresh linked worktree — just works now.
npm ci
npm run build
```

`@liendev/parser-native`'s Rust crate (`packages/parser-native`) is a
separate matter: it isn't built by `npm install`/`npm ci` at all (see that
package's own `build` script), so it's unaffected either way. If you're
touching the Rust crate itself, see its README for the `cargo build`
toolchain requirement — that's a `parser-native`-specific concern, not a
worktree one.

## Historical note

Before Phase 4-B, this doc documented a per-entry `node_modules` symlink
farm from a main checkout, because `node-tree-sitter`'s native binding
failed to compile in a linked worktree. That workaround, the dual-
`tree-sitter`-core lockfile landmine, and the `tree-sitter-kotlin`
no-prebuilds gap are all retired along with the dependency itself — see
[ADR-013](../architecture/decisions/0013-prebuilt-native-parser-napi-rs.md).
