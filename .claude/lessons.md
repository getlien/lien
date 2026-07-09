# Lessons

Durable, git-tracked record of corrections. Read this at the start of every session. After any user correction, append a lesson here capturing the pattern (not just the fix) so it doesn't recur. Once a lesson proves durable, promote it to `CLAUDE.md` (or `docs/` for anything architectural) and remove it from here — this file is a staging area, not a permanent archive.

## Releasing (learned shipping 0.61.0/0.62.0, ADR-013 campaign)

- **Changesets "Version Packages" PRs have zero CI checks.** The bot pushes
  `changeset-release/main` with `GITHUB_TOKEN`, and GitHub never triggers
  workflows for such pushes — branch protection then blocks the merge and
  `gh` suggests `--admin` (don't). Fix: push an empty commit to
  `changeset-release/main` with your own credentials to fire the
  `pull_request` events, then merge normally once green.
- **npm/GitHub flake mid-release, and how to tell it from real failure.**
  npm can return E401 *after* a publish PUT already succeeded — check
  `npm view <pkg> time` for the version's timestamp before re-publishing,
  and reconcile the git tag + GitHub release by hand if changesets aborted
  between publish and tagging. A GitHub 502 during `gh pr merge` leaves a
  stale "Merge already in progress" lock for ~15 minutes — wait for
  `mergeStateStatus: CLEAN` and retry. An `npm install` seconds after a
  publish can see the package but miss its fresh `optionalDependencies`
  (registry propagation) — wait a minute and retry before diagnosing.
- **First publish of a new package cannot use OIDC.** npm's
  trusted-publishing UI only accepts packages that already exist, so a new
  package's first publish is local: a granular token with **"Bypass 2FA"
  explicitly enabled** (a plain granular token still gets EOTP), publish
  with `--provenance=false`, then configure the trusted publisher
  (workflow `release.yml`, environment field **empty** — no workflow here
  declares a GitHub environment) and revoke the token.

## CI / monorepo

- **Adding a workspace means hunting hardcoded package lists.** The new
  `packages/parser-native` broke three of them in separate CI rounds:
  `packages/action/Dockerfile` COPY lines, root `package.json`
  lint/format/test globs and scripts, and `ci.yml`'s release-smoke pack
  list. When adding a package, grep `.github/` + Dockerfiles + root
  scripts for explicit `packages/...` enumerations before pushing.
- **Every CI job whose code path reaches `parseAST`/`chunkFile` must build
  the native binary first**, via
  `npm run build:native -w @liendev/parser-native` after `npm ci`
  (keep that command on one line in docs — the docs-truth linter cannot
  resolve a wrapped `-w` workspace). There is no legacy fallback:
  a missing binding throws `NativeBindingLoadError` loudly by design.
  Audit new workflows for this — `npm test`, `lien delta`, review runs,
  and anything importing `@liendev/parser` all parse.
- **GitHub runner labels rot silently.** `macos-13` was retired; jobs
  targeting it sit "queued" forever with no error while sibling matrix
  jobs run. If one matrix job never starts, suspect the label before the
  workload. Current Intel macOS label: `macos-15-intel`.
