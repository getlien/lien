# Working in a Git Worktree

A fresh `npm install` / `npm ci` in a linked git worktree (e.g.
`.claude/worktrees/<name>`) **fails to compile**: the native `tree-sitter`
binding won't build against this environment's toolchain. The main checkout
already has working compiled natives — reuse them instead of recompiling.

## Workaround: per-entry symlink farm from main

Symlink main's `node_modules` entries individually, but point `@liendev/*`
at the **worktree's own** `packages/*`. Do NOT symlink the whole
`node_modules` directory: that routes `@liendev/core`/`@liendev/parser`
imports to the main checkout's (possibly older) source and `dist`, which
surfaces as missing-export `SyntaxError`s at runtime or behavioral test
failures for anything newer than local main.

```bash
# From inside the worktree. Adjust MAIN to your main checkout's path.
MAIN=/path/to/main/checkout
rm -rf node_modules packages/*/node_modules
mkdir node_modules
for entry in "$MAIN/node_modules"/* "$MAIN/node_modules"/.bin; do
  base=$(basename "$entry")
  [ "$base" = "@liendev" ] && continue
  ln -s "$entry" "node_modules/$base"
done
mkdir node_modules/@liendev
ln -s "$PWD/packages/parser" node_modules/@liendev/parser
ln -s "$PWD/packages/core"   node_modules/@liendev/core
ln -s "$PWD/packages/cli"    node_modules/@liendev/lien   # package name != dir name
ln -s "$PWD/packages/review" node_modules/@liendev/review
ln -s "$PWD/packages/action" node_modules/@liendev/action
ln -s "$PWD/packages/site"   node_modules/@liendev/site

# Non-hoisted natives (tree-sitter) live under packages/parser/node_modules,
# not the root — symlink every package's node_modules too (whole-dir is fine
# here; they contain no @liendev entries).
for pkg in parser core cli review action site; do
  [ -d "$MAIN/packages/$pkg/node_modules" ] && \
    ln -s "$MAIN/packages/$pkg/node_modules" "packages/$pkg/node_modules"
done
```

Then run `npm run build` in the worktree so `@liendev/*` resolve to fresh
worktree `dist/` output.

## When the lockfile needs to change

Never run a plain `npm install` in the worktree — it can drift the tree or
try to recompile natives. Use:

```bash
npm install --package-lock-only
```

This updates `package-lock.json` only — no `node_modules` changes, no native
build.

## Caution

Everything symlinked from main (third-party deps, natives) reflects the
**main checkout's** install state. If main is behind `origin/main`, its
third-party dep versions may lag the worktree's `package.json` — usually
harmless, but rebuild/refresh main if something looks inexplicable.
