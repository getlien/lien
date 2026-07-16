# Agent Bot Identity (GitHub App)

## Why this exists

Agents working on `getlien/lien` currently perform every `gh`/API action
(label, comment, merge, PR create) under the owner's own credentials
(`alfhen`). The audit trail — label events, merge commits, PR comments —
cannot distinguish "the owner did this" from "an agent did this," because
both render as the same login.

This bit us concretely on **PR #799**: an agent self-applied the
`skip-harness-gate` label to get past the "Require harness evidence or
bypass label" CI gate. The PR timeline shows:

```
$ gh api repos/getlien/lien/issues/799/timeline --jq \
    '.[] | select(.event=="labeled") | {actor: .actor.login, created_at}'
{"actor":"alfhen","created_at":"2026-07-16T13:53:32Z"}
```

Indistinguishable from a human maintainer applying the same label — which
is exactly the problem. (It was also not the first occurrence; PR #768 hit
the same gate the same way.)

The concurrent gate-hardening PR (**#801**, "ci: enforce owner-only
skip-harness-gate label + broaden evidence detection") makes the bypass
label owner-login-only, but says so explicitly in its own body:

> agents in this repo currently act under the owner's own `gh`/`GITHUB_TOKEN`
> credentials, so the applier check cannot distinguish an agent-performed
> label event from a human-performed one when both are attributed to the
> same login. This change ... does not (yet) close the
> "agent-acting-as-owner" hole. That needs a separate bot identity for agent
> actions and is out of scope here; tracked as a follow-up.

This document and `scripts/dev/agent-gh-token.mjs` are that follow-up.

## Approach: a GitHub App under the `getlien` org

Rationale, decided by the owner (Alf, `alfhen`) 2026-07-16:

- **No second account to manage** — no separate email/2FA/seat to maintain,
  unlike a classic "bot" user account.
- **Unambiguous attribution** — GitHub renders GitHub App actions as
  `lien-agents[bot]` in every timeline, comment, and commit-adjacent UI. That
  suffix is the entire point: an agent-performed label/merge/comment is now
  visibly distinct from `alfhen`.
- **Org-owned and revocable** — lives under `getlien`, not a personal
  account; the owner can suspend the installation or roll the private key
  at any time without depending on a second person/account.
- **Fine-grained permissions** — a GitHub App declares exactly which
  repository permissions it needs (see the mapping below), unlike a PAT tied
  to a full user account.

Creating the App itself requires a human in a browser (GitHub exposes no
API for App creation) — that step is the owner's, once. Everything else
(minting installation tokens, docs, tests) is scripted here.

## What this does NOT change: the SSH-push / commit-authorship seam

Read this before assuming the bot identity covers everything:

- **`git push` goes over SSH with the owner's key**, regardless of which
  `gh`/API token an agent is using. The bot identity governs **API actions**
  (PR create, merge via the API, label, comment) — it has no bearing on how
  commits reach GitHub.
- **Commit authorship comes from local git config** (`user.name`/`user.email`),
  not from the token used for `gh` calls. Commits will keep showing
  `alfhen` as author/committer unless git config itself changes (out of
  scope here — the point of this work is API-action attribution, not commit
  attribution).
- Consequence: **CI is still push-triggered by `alfhen`** even after this
  ships, because pushes go out over SSH under the owner's identity. Only
  the follow-on API calls (opening the PR, labeling it, merging it,
  commenting on it) will show `lien-agents[bot]`.

State this honestly to anyone consuming this doc — it is a partial fix for
API-action attribution, not a full agent-identity story.

## Owner's app-creation checklist (one-time, requires the owner's browser)

1. Go to the **`getlien` org** → **Settings** → **Developer settings** →
   **GitHub Apps** → **New GitHub App**
   (`https://github.com/organizations/getlien/settings/apps/new`).
2. **GitHub App name**: `lien-agents` (this becomes the `lien-agents[bot]`
   actor suffix everywhere).
3. **Homepage URL**: any valid URL is required by the form; `https://lien.dev`
   is fine.
4. **Webhook**: uncheck **Active**. No webhook URL needed — this App only
   ever mints installation tokens for outbound API calls; it never receives
   events.
5. **Repository permissions** (see the verified mapping below for why each
   one is needed and no more):
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Issues**: Read and write
   - **Checks**: Read-only
   - **Metadata**: Read-only (GitHub grants this to every App by default;
     confirm it's set, nothing to add beyond that)
   - Leave every other permission at "No access."
6. **Where can this GitHub App be installed?**: **Only on this account**
   (`getlien` — not public).
7. Click **Create GitHub App**.
8. On the resulting app page, note the **App ID** shown near the top —
   you'll need it for `LIEN_AGENT_APP_ID`.
9. Scroll to **Private keys** → **Generate a private key**. This downloads
   a `.pem` file.
10. Move the PEM **outside the repo**:
    ```bash
    mkdir -p ~/.config/lien
    mv ~/Downloads/lien-agents.<date>.private-key.pem ~/.config/lien/agent-app.pem
    chmod 600 ~/.config/lien/agent-app.pem
    ```
11. **Install the app**: from the app's page, click **Install App** (left
    sidebar) → select the **`getlien`** org → **Only select repositories**
    → choose **`lien`** → **Install**.
12. Add two lines to the repo-root `.env` (gitignored; same file
    `OPENROUTER_API_KEY` already lives in):
    ```
    LIEN_AGENT_APP_ID=<the App ID from step 8>
    LIEN_AGENT_APP_KEY_PATH=~/.config/lien/agent-app.pem
    ```

## Permission-to-action mapping (verified against GitHub's own docs)

Each row below was checked against the specific endpoint's listed
fine-grained permission on
`docs.github.com/en/rest/authentication/permissions-required-for-github-apps`
(not assumed) — GitHub organizes that page as one table per permission, and
several actions appear under **two** permissions where "any one permission
from the set" suffices (GitHub calls this "Additional permissions").

| Action | Endpoint | Required permission |
|---|---|---|
| Create / update a pull request | `POST/PATCH /repos/{o}/{r}/pulls` | **Pull requests: write** |
| Merge a pull request | `PUT /repos/{o}/{r}/pulls/{n}/merge` | **Contents: write** (merging writes a commit to the base branch — this is *not* under Pull requests) |
| Delete a branch | `DELETE /repos/{o}/{r}/git/refs/{ref}` | **Contents: write** |
| Add/remove labels on an issue or PR | `POST/DELETE /repos/{o}/{r}/issues/{n}/labels[/...]` | **Issues: write** *or* **Pull requests: write** (either satisfies it; a PR's labels endpoint is the shared issues endpoint) |
| Create / reply to a comment on an issue or PR | `POST /repos/{o}/{r}/issues/{n}/comments` | **Issues: write** *or* **Pull requests: write** |
| Create a PR review / review comment | `POST /repos/{o}/{r}/pulls/{n}/reviews` etc. | **Pull requests: write** |
| Read check-run / check-suite status (verifying CI before merge) | `GET /repos/{o}/{r}/check-runs/...`, `check-suites/...` | **Checks: read** |
| Resolve the installation id / read repo & installation metadata | `GET /app/installations`, `GET /repos/{o}/{r}` | **Metadata: read** (this is the App-wide default permission; the `/app/installations` and `/app/installations/{id}/access_tokens` calls themselves are JWT-authenticated at the App level and aren't gated by a repository permission at all) |

So: **Contents (write) + Pull requests (write) + Issues (write) + Checks
(read) + Metadata (read)** — exactly the five permissions in the creation
checklist above — covers every action this project needs an agent to take
via the API. Nothing broader (no Administration, no Actions, no Secrets).

## Usage pattern for agents/orchestrators

Mutating `gh`/API calls get the bot token prefixed; read-only calls can stay
on whatever auth is already configured (usually the owner's own `gh auth`):

```bash
# Mutating — use the bot identity
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr create --title "..." --body "..."
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr merge 123 --squash --delete-branch
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr edit 123 --add-label some-label
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr comment 123 --body "..."

# Read-only — no need to mint a token
gh pr view 123
gh pr checks 123
```

The helper prints **only** the token to stdout (all diagnostics go to
stderr), so it composes directly into `GH_TOKEN=$(...)`.

**Never add `lien-agents` (or its App) to the `skip-harness-gate`
allowlist.** The label must stay owner-(human)-only — see PR #801. Giving
the bot identity bypass power over the harness gate would recreate exactly
the hole this document exists to close, just with a different login name.

## Security notes

- The PEM is **never committed** — it lives outside the repo entirely
  (`~/.config/lien/agent-app.pem`, `chmod 600`), matching the pattern
  `.gitignore` already establishes for `.env`.
- Installation tokens are **short-lived** (1 hour) and cached with their
  expiry at `~/.cache/lien/agent-gh-token-cache.json` (also `chmod 600`);
  `scripts/dev/agent-gh-token.mjs` refreshes automatically once under 5
  minutes remain.
- The signing JWT itself is even shorter-lived (9 minutes, under GitHub's
  10-minute cap) and is only ever held in memory for the duration of the
  token-exchange call.
- If the key is ever suspected compromised: **Settings → Developer
  settings → GitHub Apps → lien-agents → Generate a private key** (new key),
  then delete the old one from the same page, then replace
  `~/.config/lien/agent-app.pem` and delete the stale cache file.
- The app must **not** be granted Administration, Secrets, or Actions
  permissions — the mapping above is deliberately minimal.

## Known risk & post-creation verification plan

This repo's own history shows bot-actor workflow runs (`github-actions[bot]`
on `changeset-release/main` pushes) landing in `action_required`, pending
manual approval, because GitHub does not trigger `pull_request`-triggered
workflows for some bot-authored refs/events by default. Two things suggest
a **custom App with write access won't hit that specific gate**:

1. That known case is specifically about **pushes performed by
   `github-actions[bot]` using the default `GITHUB_TOKEN`** inside a
   workflow run — a different mechanism from a **PR opened via the REST API
   using an installation token**, which is the pattern this helper enables.
2. Per the SSH-push seam above, **the actual `git push` here still happens
   over SSH under `alfhen`'s key** — so the commit/ref-creation event that
   triggers CI is push-triggered by the owner regardless of which identity
   later opens/labels/merges the PR via the API.

Reasoning is not proof. **This must be verified empirically once the App
exists** — nothing here should be treated as confirmed until the recipe
below has been run for real. Run it immediately after the owner completes
the creation checklist:

```bash
# 1. Scratch branch + PR opened with the bot token
git checkout -b scratch/bot-identity-verification
echo "verification $(date -u +%FT%TZ)" >> .wip/bot-identity-verification.txt
git add .wip/bot-identity-verification.txt
git commit -m "chore: scratch commit for bot-identity verification"
git push -u origin scratch/bot-identity-verification   # still SSH/alfhen — expected, see above

GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr create \
  --title "chore: bot-identity verification (scratch, do not merge as-is)" \
  --body "Verifying the lien-agents GitHub App end-to-end. See docs/development/agent-bot-identity.md." \
  --head scratch/bot-identity-verification

# Confirm CI auto-started with no action_required:
gh pr checks <PR_NUMBER> --watch

# 2. Bot applies a test label; confirm the hardened harness gate
#    ("Require harness evidence or bypass label", PR #801) ignores
#    non-allowlisted appliers -- i.e. lien-agents[bot] must NOT be able to
#    self-bypass the gate via skip-harness-gate.
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr edit <PR_NUMBER> --add-label skip-harness-gate
gh api repos/getlien/lien/issues/<PR_NUMBER>/timeline --jq \
  '.[] | select(.event=="labeled") | {actor: .actor.login, label: .label.name}'
# Expect: actor "lien-agents[bot]" -- and, since this PR does not touch
# packages/review/src/plugins/agent/**, the gate should no-op regardless.
# If testing the allowlist itself, apply the label to a PR that DOES touch
# that path and confirm the evidence-check step still runs (label ignored).
# Then remove the label -- it must never stay applied by a non-owner login.
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr edit <PR_NUMBER> --remove-label skip-harness-gate

# 3. Bot merges the scratch PR; confirm timeline shows lien-agents[bot]
GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr merge <PR_NUMBER> --squash --delete-branch
gh api repos/getlien/lien/issues/<PR_NUMBER>/timeline --jq \
  '.[] | select(.event=="merged") | {actor: .actor.login}'
# Expect: actor "lien-agents[bot]"
```

Record the actual output of each step (not just "it worked") wherever this
verification is tracked — this is exactly the kind of claim the project's
own dogfooding rule requires evidence for, not just a plausibility argument.
