---
'@liendev/lien': patch
---

Fixes #908: `isCoveredByScope` (the did-you-run-the-tests nudge behind
`lien verify-tests note-run`/`report`/`recap`) now recognizes a
directory-scoped test run as covering the files inside it, not just an
exact basename/stem match. Go's own idiomatic `go test` invocation always
names a package directory, never an individual file — `go test
./pkg/x/...` (recursive) and `go test ./pkg/x` (that package only, no
subdirectories) previously matched nothing and left the whole package
nagging as unverified even after a correctly, narrowly-targeted run.

The new directory-scope check is path-segment-aware, not a string prefix:
`./pkg/cmd/label` (with or without the recursive `/...` suffix) does not
cover a different, unrelated package that merely shares a text prefix
(`./pkg/cmd/labeler`). The check is intentionally not Go-gated — any scope
token that names a directory rather than a specific file (no recognized
source extension) gets the same treatment, since `scopeTokens` carry no
record of which runner produced them and the same directory-scope
reasoning is valid for any other ecosystem's directory-scoped invocation
(e.g. `pytest tests/unit/`).

Purely additive: existing basename/stem matching, `classifyTestCommand`,
and every current `RUNNER_PATTERNS` entry are unchanged.
