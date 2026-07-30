---
'@liendev/lien': patch
---

A single unrelated test run silently disabled the did-you-run-the-tests nudge for
an entire session.

`classifyTestCommand` had only two outcomes: `scoped` (a path-like token was
found) or `broad` (none was). A run scoped by test **name** carries no path-like
token, so it fell into `broad` by construction, and `computeUnverifiedFiles`
treats any broad run as evidence the whole edit set was exercised. Reproduced
end-to-end on the published 0.72.0 binary against pallets/flask:

```text
# edit recorded, no test run — correctly nags
• src/flask/helpers.py → tests/test_helpers.py (+35 more)

# same edit, then: pytest -k test_totally_unrelated_name
(completely silent)
```

Verified reproducing on all eight runners checked, plus one found while
investigating (`swift test --filter`, invisible through a different path):
`pytest -k`, `dotnet test --filter`, `rspec -e`, `mocha --grep`, `go test -run`,
`cargo test <name>`, `vitest -t`, `jest -t`.

This is the false-"tests ran" direction, and it invisibly switches off the
mechanism a foreign-repo trial showed actually changes agent behaviour — the Stop
recap blocking a finish is what sent that agent back to run the check it had
skipped.

Adds a third classification outcome — name-filtered — that is neither `broad` nor
a `scopeTokens` contributor, so a name-filtered run no longer licenses "everything
is verified". The fail-safe direction is to keep nagging: the nudge already carries
its own escape hatch ("if you already ran them, disregard and stop again"), so a
false nag costs one line while a false silence costs the whole mechanism.

Recognition uses **per-runner-family flag allow-lists rather than one global set**,
because the same spelling means different things per ecosystem — `tox -e py311`
selects an environment while `rspec -e NAME` selects a test, and a global set would
have wrongly un-broadened tox. Runner-specific value-skip sets keep build-config
flags from being misread as positional test names (`cargo test --features foo`,
`-p`, `--manifest-path`) and keep pnpm's workspace `--filter` broad (including the
`--filter=@scope/pkg` form, and the `pnpm --filter=<sel> test` ordering which
previously matched no runner pattern at all). Both collisions are pinned by
regression tests.

Documented explicitly, with tests, because a review raised it twice: **a
scope-broadening flag does not make a name-filtered run broad.** `./...`,
`.`, `--workspace` and `--all` broaden which *packages* compile; `-run Foo` and a
bare positional still filter which *tests execute*. `go test -run TestFoo ./...`
runs none of an unrelated file's tests, so it correctly nags — treating it as broad
would reintroduce this very bug.
