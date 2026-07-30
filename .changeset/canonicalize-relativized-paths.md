---
'@liendev/lien': patch
---

The read-time impact nudge was **completely silent** for any project whose path
resolves through a symlink — which includes every macOS project under `/tmp` or
`/var`, and any repo reached via a symlinked ancestor.

Claude Code sends an **absolute** `tool_input.file_path`, while `rootDir` comes
from `process.cwd()`, which the OS returns already realpath-resolved. Two
`path.relative` sites compared one against the other without canonicalizing:

- `toRepoRelativeFile` (`nudge-events.ts`) logged
  `"file": "../../../../tmp/lien-dogfood-460173c9/hono/src/context.ts"` instead of
  `"src/context.ts"`, corrupting the paths the `lien stats` funnel joins on.
- `resolvePaths` (`annotate-cmd.ts`) — the worse one. There a `..`-prefixed result
  trips an "outside the project root" rejection, so `lien annotate` produced **no
  output at all** for a real in-repo file. Confirmed on the released build:

```
$ lien annotate /abs/path/behind/symlink/src/utils/url.ts
(nothing)
$ lien annotate src/utils/url.ts
⚠ Lien: _getQueryParam cognitive 45/15 (over) ...
Lien impact for src/utils/url.ts: • 11 files import this ...
```

Since `annotate-read.sh` only emits when the annotation is non-empty, the entire
read-time nudge — and its shown-event recording — vanished for affected users,
with nothing to indicate it. A nudge that fails by not appearing is
indistinguishable from a nudge with nothing to say.

Both sites now canonicalize `rootDir` and the file argument through a shared
`canonicalizePath` (`fs.realpathSync`, falling back to the parent directory for a
path that no longer exists, then to identity — it never throws, because these run
inside hooks on every edit), and reject a result that still escapes the root rather
than recording it.

Other `path.relative(process.cwd(), …)` sites were audited and ruled out:
`delta-git.ts` already had its own equivalent fix (the pattern this mirrors),
`agent-tools.ts` realpaths `rootDir` once up front, and the indexer paths take
`rootDir` from the same construction as their file arguments. The review harness's
`toRepoRelative` is offline tooling, not runtime telemetry, and was left alone.
