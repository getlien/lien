---
'@liendev/lien': minor
---

`lien delta --base <ref>` — compare against any ref, not just `HEAD`, and give the sixth commit gate a CI backstop.

Until now `lien delta` only ever compared the working tree to `HEAD`, so a crossing introduced by an earlier commit in a PR (already sitting at `HEAD`, with a clean working tree) was invisible to the gate — the other five commit gates are enforced in CI, but this one ran purely on an agent's honor system. `--base <ref>` compares the current state against any ref instead: `git diff --name-status` scoped to that ref, `before` content read via `git show <ref>:path`, same file filtering and edge-case handling (added/deleted/renamed/unborn) as the default mode. Composes with `--file`, `--format json`, `--soft`, and `--threshold`; omitting `--base` is byte-for-byte unchanged.

CI now runs `lien delta --base "origin/$GITHUB_BASE_REF"` on every pull request, so a complexity crossing introduced anywhere in a PR's commits — not just its latest one — fails the build instead of merging silently.
