---
'@liendev/parser': minor
'@liendev/core': patch
---

Resolve workspace package specifiers (`import { X } from '@scope/pkg'`) to the package's source entry file during chunking, closing a monorepo blind spot in dependency analysis. Previously, imports written as a workspace package specifier (rather than a relative path) were stored raw and never matched any indexed file, so `get_dependents` couldn't see across package boundaries in npm-workspaces monorepos — e.g. a CLI package consuming a symbol from a sibling library package showed 0 dependents.

Workspace packages are now detected generically from the root `package.json`'s `workspaces` globs (supporting nested globs and negated excludes) and each member's declared source entry (`main`/`module`, falling back to the `src/index.<ext>` convention) — nothing is hardcoded to `@liendev`. The resulting map is applied the same way `./`/`../` specifiers already are, so file-level dependents, the transitive re-export BFS, and symbol-level usage tracking all pick up cross-package edges automatically. Deep/subpath imports (`@scope/pkg/subpath`) are out of scope for this pass and continue to pass through unresolved. Non-monorepo projects and external npm packages are unaffected.
