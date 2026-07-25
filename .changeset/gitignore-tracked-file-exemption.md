---
"@liendev/parser": patch
---

Fix two related bugs where lexical ignore rules silently dropped real,
committed source from the index (#899, #900), reproduced against a clone of
`cli/cli`:

- **#899**: the hardcoded `build/**`/`**/build/**` entries in
  `ALWAYS_IGNORE_PATTERNS` unconditionally swallowed any directory literally
  named `build`, with no way to distinguish generated output from real
  source (`internal/build/build.go`, a hand-written Go file defining
  `Version`/`Date`, was entirely absent from the manifest).
- **#900**: `.gitignore` was applied lexically to every file with no
  tracked-file exemption. Real git only ever ignores UNTRACKED files, so a
  stale bare-name pattern (a root `.gitignore` line `gh`, meant to hide a
  locally built binary) matched — and silently dropped — the unrelated,
  fully tracked `cmd/gh/` and `internal/gh/` source trees, including the
  literal `func main()` entrypoint.

**Fix**: in a git repository, `scanCodebase` and `createGitignoreFilter` now
union the lexical scan/filter with git's tracked-file list
(`getGitTrackedFiles`, one `git ls-files -z` call, cached for the life of
one scan/filter — never a per-file subprocess). A path git tracks is
rescued from `ALWAYS_IGNORE_PATTERNS`, `.gitignore`, and ecosystem excludes
regardless, with one exception: `NEVER_INDEX_EVEN_IF_TRACKED_PATTERNS`
(`.git/**`, `.lien/**`, `node_modules/**`, `.claude/worktrees/**`) is a hard
carve-out that stays excluded even if git tracks it, since git *can* track
a committed `node_modules` or a nested `.claude/worktrees` clone and
indexing either reproduces the 21GB-index blowup `ALWAYS_IGNORE_PATTERNS`
exists to prevent. Non-git directories are unaffected — the tracked-file
set is empty and the union is a no-op, preserving today's pure-lexical
behavior exactly.

New regression coverage in `gitignore.test.ts`/`scanner.test.ts`: tracked
source at depth inside a `build`-named directory, tracked source shadowed
by a bare-name `.gitignore` pattern, the tracked-vs-untracked distinction
(an untracked file under the same paths stays excluded), and the hard
carve-out (a tracked `node_modules` file is never rescued).
