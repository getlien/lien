# Working in a Git Worktree

As of ADR-013 Phase 4-B (the retirement of `node-tree-sitter` and its 11
npm grammar packages), a plain `npm install` / `npm ci` works normally in a
linked git worktree: no symlink farm needed. The install-time compile
failure this doc used to work around was `node-tree-sitter`'s `node-gyp`
build breaking against this environment's Apple-clang toolchain; that native
binding is gone. The one other native addon in the tree, `better-sqlite3`,
resolves a prebuilt binary via `prebuild-install` rather than compiling
locally, so it isn't a blocker either. Verified empirically: `npm ci` in a
scratch worktree of this branch completed in ~7s with no compile step.

```bash
# From inside a fresh linked worktree.
npm ci
npm run build
npm run build:native -w @liendev/parser-native   # required by gate 6, `lien delta`
```

`@liendev/parser-native`'s Rust crate (`packages/parser-native`) is a
separate matter: it isn't built by `npm install`/`npm ci` at all (see that
package's own `build` script). If you're touching the Rust crate itself, see
its README for the `cargo build` toolchain requirement; that's a
`parser-native`-specific concern, not a worktree one.

Build it in every fresh worktree anyway, whatever you're changing. `lien delta`
— gate 6 of the mandatory pre-commit chain in CLAUDE.md — parses your working
tree, so it needs the native binding even if you only touched a script, a doc or
a config. Without it the gate dies on an uncaught `NativeBindingLoadError`. The
error does name the fix command, but you meet it at the end of the gate chain,
having been told setup was already complete.

## A fresh worktree with no `node_modules` fails quietly, not loudly

A worktree that hasn't had `npm ci` run in it yet does not error out and tell you so. Node's module resolution walks up the directory tree looking for `node_modules`, and a worktree under `.claude/worktrees/<name>` sits two directories below the main checkout, so resolution silently falls through to the main checkout's `node_modules` instead of the (missing) one in the worktree. If that main checkout's `node_modules` happens to be stale, for example missing the `@liendev/parser-native` symlink, the result is confusing `tsc` module-resolution errors that reference the main checkout's own paths, not an obvious prompt to run `npm ci`. Diagnose it with `ls node_modules` in the worktree itself: if it's missing or empty, that's the cause. The remedy is the same as above: run `npm ci` in the worktree (about 7 seconds), `npm run build`, and `npm run build:native -w @liendev/parser-native`.

## Historical note

Before Phase 4-B, this doc documented a per-entry `node_modules` symlink
farm from a main checkout, because `node-tree-sitter`'s native binding
failed to compile in a linked worktree. That workaround, the dual-
`tree-sitter`-core lockfile landmine, and the `tree-sitter-kotlin`
no-prebuilds gap are all retired along with the dependency itself. See
[ADR-013](../architecture/decisions/0013-prebuilt-native-parser-napi-rs.md).
