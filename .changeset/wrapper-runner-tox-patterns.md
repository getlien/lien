---
'@liendev/lien': patch
---

Fix #905: `RUNNER_PATTERNS` in the did-you-run-the-tests nudge (`lien
verify-tests note-run`) now sees through package-manager/environment-runner
wrapper prefixes — `uv run pytest`, `poetry run pytest tests/foo.py`,
`pipenv run pytest`, `rye run pytest`, and `pdm run pytest` all classify
exactly like their unwrapped form, including flags-with-values on the
wrapper's own invocation (`uv run --group tests pytest`). Also adds `tox`
(and `nox`) as recognized runners in their own right — `tox`/`tox run`/`tox
-e py311` are broad (no file named), while a `--` passthrough naming a path
(`tox -e py311 -- tests/test_x.py`) is scoped, same convention already
supported for `npm test -- path/to/x.test.ts`. Together these recognize
flask's own real CI command (`uv run --locked --no-default-groups --group
dev tox run`), which previously went completely unrecognized. Purely
additive recognition — `isCoveredByScope` and every existing pattern are
unchanged.
