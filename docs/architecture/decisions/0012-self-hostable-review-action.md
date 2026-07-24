# ADR-012: Self-Hostable GitHub Action for PR Review

**Status**: Accepted
**Date**: 2026-06-27
**Deciders**: Core Team
**Related**: ADR-009 (extracted `@liendev/parser` to shrink the *hosted* Review app's image, predates and is not this pivot), PR #581, #593

## Context and Problem Statement

Lien Review originally ran as a hosted SaaS: a Laravel control plane (`platform/`, `app.lien.dev`) dispatching PR review jobs over NATS to a fleet of `packages/runner` workers. This carried real cost:

- Every consumer needed a hosted account/webhook wired to `app.lien.dev`: an operational dependency and a trust boundary, since their code had to reach Lien's servers.
- The platform was a full deployment target regardless of review volume: Laravel app, database, NATS broker, Kubernetes overlays (`platform/k8s/`).
- ADR-009 had already shrunk the *hosted* app's Docker image by extracting `@liendev/parser` out of `@liendev/core`, but that only reduced image size; it didn't remove the server/DB/NATS dependency itself.

## Decision

Decouple Lien Review from the hosted platform entirely: ship it as a self-contained GitHub Action that runs inside the consumer's own `pull_request` workflow using the workflow's built-in `GITHUB_TOKEN`: no server, database, NATS, or hosted backend required.

- **PR #581**: extracted a transport-agnostic `reviewPullRequest()` core into `@liendev/review` (stripped NATS/Laravel/`LogBuffer`/service-token/staleness concerns; LLM choice driven by `ctx.llm`). New `packages/action` (a Docker container action) builds review context from the `pull_request` event payload (head SHA from `pull_request.head.sha`, not `GITHUB_SHA`), self-clones the PR via `GITHUB_TOKEN`, posts findings as inline PR comments and workflow annotations, writes a step summary, and maps a `fail-on` input to the exit code. Fork PRs are detected and warned about, with a documented `pull_request_target` opt-in (safe: code is read/parsed, never executed).
- Same-day hardening: collapsing two separate Lien checks into one (#584), defaulting the check to advisory (`fail-on: never`, #585), and later pinning the agent-review model default (#592, `moonshotai/kimi-k2.7-code`).
- **PR #593**: retired `packages/runner` (the NATS-based review runner) and `platform/` (the Laravel 12 app plus its K8s/infra) outright: deletion only. No surviving package imports `@liendev/runner`; shared code (`clone.ts` etc.) had already moved into `@liendev/review` during the action decoupling.
- **Distribution**: `packages/action` builds to a Docker image published to GHCR (`.github/workflows/publish-action.yml`) on every `@liendev/lien@*` release tag, piggybacked on that tag because `@liendev/action` and `@liendev/review` are private/unpublished, so changesets never tags them directly. The image is then synced to a public `getlien/lien-review` dist repo so consumers can `uses: getlien/lien-review@v1`. This monorepo dogfoods the action on its own PRs via `.github/workflows/lien-review.yml`, which builds from source and runs the entrypoint directly rather than the published image, since the dist repo + `GH_DIST_TOKEN` haven't been provisioned yet.

## Consequences

### Positive

- Zero hosted infrastructure to run or pay for: no Laravel app, no database, no NATS broker, no Kubernetes overlays. `packages/action`'s only runtime dependencies are `@liendev/parser` and `@liendev/review`.
- No trust boundary crossing: a consumer's code never leaves their own GitHub Actions runner; the action self-clones by SHA using the workflow's own `GITHUB_TOKEN`.
- Simpler mental model: the action posts no Checks API check run of its own; the workflow job itself is the single status check, so there's no separate webhook-driven backend state to keep in sync.

### Negative

- No cross-repo aggregation or dashboard: each repo runs review independently inside its own Actions minutes, with no shared queue, retry infrastructure, or cross-repo view.
- Publishing still requires one-time human setup (the `getlien/lien-review` dist repo plus a `GH_DIST_TOKEN` secret) that hasn't happened yet; until it does, the documented `uses: getlien/lien-review@v1` quick start doesn't resolve to a real release, and this repo's own CI builds the action from source instead.
  **Update (2026-07-12):** that setup is done: `getlien/lien-review` is a real, published dist repo (tags `v1`, `0.62.0` to `0.64.0`, resolving to `docker://ghcr.io/getlien/lien-review:v1`), so the quick start now resolves for consumers. This monorepo's own CI still builds from source rather than pulling the image, unchanged and deliberate: it dogfoods the current commit, not the last released tag.
- `platform/` and `packages/runner` are retired in git but not guaranteed gone from every working checkout: a checkout that predates PR #593, or a local restore of `platform/`, leaves an untracked, undocumented pile of dead Laravel code. Both are remnants scheduled for deletion, not live parts of the monorepo.

### Neutral

- `@liendev/action` and `@liendev/review` stay `private: true`: distributed as a Docker image plus a dist-repo `action.yml`, never published to npm.
- The floating `:v1` Docker tag is the Action's own public-interface version (its `action.yml` inputs/outputs contract), bumped manually on a breaking change, independent of `@liendev/lien`'s semver, the same convention as `actions/checkout@v4`.

## References

- PR #581: self-hostable GitHub Action for PR review
- PR #593: retire `packages/runner` and `platform/`
- ADR-009: extracted `@liendev/parser` (predates and is not this pivot; it shrank the *hosted* app's image, not this decoupling)
- `packages/action/README.md`: consumer quick start, permissions, and the publishing runbook
