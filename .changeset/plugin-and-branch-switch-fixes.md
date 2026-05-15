---
'@liendev/parser': minor
'@liendev/core': minor
'@liendev/lien': minor
---

Ship the Claude Code plugin and a saga of fixes for branch-switch reconciliation in `lien serve`.

**Claude Code plugin** (#555). Install once with `/plugin marketplace add getlien/lien` + `/plugin install lien` and Lien's MCP tools + the Explore agent are available in every session, in every repo — no per-project `lien init` needed. The `serve` command also gains an `LIEN_FORCE_INDEX=1` opt-in and skips auto-indexing in non-git directories so the plugin doesn't index scratch dirs.

**Branch-switch reconciliation, full saga (#556).** When you `git checkout` away from a branch that had files which don't exist on the new branch, Lien now actually drops the chunks for those files from the index. Required three-layered fixes:

- **Path-key normalization** (#557): `indexMultipleFiles` and `indexSingleFile` now thread `rootDir` through `normalizeToRelativePath`, so chunks at index time and deletion time use the same relative-path key. `indexedBranch` / `indexedCommit` are surfaced in `indexInfo` so callers can detect drift.
- **Tip-to-tip diff** (#559): `getChangedFiles` switched from three-dot (`A...B`, "PR-diff" semantic — silently omits files that exist only on `A`) to two-dot (`A..B`, direct tip diff). Also fixes a false-prefix bug in `normalizeToRelativePath` where `/apple/foo` against root `/app` would slice to `le/foo` instead of falling through to `path.relative`.
- **Always-on git poll** (#561): the `.git/HEAD` file watcher misses git's atomic ref rewrites (chokidar/FSEvents on macOS reports the rename of `.git/HEAD.lock`, not a change event on `HEAD` itself), so the existing event-driven trigger never fired in practice. `createGitPollInterval` now runs alongside the file watcher as a backstop instead of only as a `--no-watch` fallback. Includes a fix for the `detectChanges`-already-advanced-state race when both watcher and poll fire concurrently.

**Freshness metadata** (#562). `indexInfo.indexDate` and `msSinceLastReindex` now reflect the most recent reconciliation (max of version-file timestamp and in-session reindex timestamp), so both external `lien index` and in-process incremental reindexes surface correctly.
