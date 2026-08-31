---
'@liendev/parser': minor
---

`@liendev/parser` now ships the deterministic review signals — 14 modules that answer one structural question each about a change ("does this literal still appear unconditionally elsewhere?", "did this PR add a variant to some but not all of a family's switch statements?") as pure functions over a diff plus parser output. No LLM, no network, no persisted index.

They previously lived in the unpublished review engine, which meant nothing else could use them without depending on that engine and, through it, on Octokit. They are about source structure, so they belong here.

The new public surface is 37 symbols, gated on one rule: a symbol is exported when production code outside its own module imports it. The 14 modules export 106 between them; the other 69 exist so their tests can reach them and stay unpublished deliberately, because exporting an internal from a published package means semver-locking it.

New input type: `SignalContext` — `chunks`, `changedFiles`, `allChangedFiles`, `complexityReport`, `repoChunks`, `pr` (`patches` and `diffLines`), and an optional `logger`. It was derived by auditing every field the 14 modules actually read, which is why nothing on it identifies a pull request: no signal reads `owner`, `repo`, `pullNumber`, or `title`, so a caller driving these from a local `git diff` needs no GitHub concepts to satisfy it.

Also public: `filterAnalyzableFiles`, the extension-and-vendor-path gate the signals run their inputs through.

No behavior change. The review engine's rendered prompts are byte-identical across this move on all three committed harness fixtures.
