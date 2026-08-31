---
name: review
description: Review a change for real defects — breaking callers, silent error swallowing, boundary off-by-ones, omitted variants, stale duplicated literals, and documentation that no longer matches the code. Runs Lien's deterministic passes first, then reasons over the result.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(git *), Bash(lien *), Bash(node *), Bash(npm run *), Read, Glob, Grep
---

# Review a change

Nine checks, in a deliberate order: cheap deterministic facts first, then the
reasoning that needs them.

This replaces the agent-review plugin's injected prompt. Where that prompt said
"a `<removed_exports>` section may be in your initial message", the equivalent
here is a command you run yourself — same facts, visible provenance.

## Step 1 — get the deterministic facts (zero tokens, ~100 ms)

```bash
lien review --base <ref>          # candidates from the diff
lien health --format json         # risk ranking + test associations
```

`<ref>` is what you are reviewing against: `origin/main` for a branch, `HEAD` for
uncommitted work, `HEAD~1` for the last commit.

Add `--all-signals` when you want the wider worklists (removed exports, variant
sweeps, sibling surfaces, unread fields, stale literals, doc drift). It costs
~3 s instead of ~100 ms because it scans the whole repo.

**Read the caveats block.** It tells you what was NOT examined — untracked files,
languages a signal skips, signals that were withheld, a parse that failed. A
signal that could not look is not a signal that found nothing.

## Step 2 — how much to trust the candidates

**Not much, and this is the important instruction.**

Those signals were built as pre-computed inputs for an LLM to adjudicate. On four
real diffs of this repo, adversarial review judged 106 candidates and rated
**none** actionable. `comparison-change` is the only one with measured true
positives, which is why it is the only one on by default.

So:

- **A candidate is a hint about where to look, never a finding.** Confirm it
  against the actual code before you report it. Several signals match inside
  comments, docstrings and changelogs.
- **A signal's silence proves nothing.** Three of the largest are hard-gated to
  TypeScript/JavaScript. Others cap their own output — `stale-literal` returned 8
  of 1,241 it had found on one diff. Empty output from a gated or capped signal
  is not evidence of absence.
- **Never skip your own discovery because a signal ran.** The prompt this
  replaced said the grep "is already done for you". With measured precision this
  low, that instruction would make you miss things. Grep anyway.

Use the deterministic output for what it is genuinely good at: locating changed
files, their test associations, their fan-in, and the risk ranking.

## Step 3 — the nine checks

Silence means approval: if a check finds nothing, say nothing. **Two checks are
exceptions** and are called out below — for those, reporting nothing without
having investigated is a failure, not a safe default.

### 1. Structural caller impact

Read the imports and exports of every changed file, then find the callers of
every changed or removed exported symbol. Ask whether each caller still behaves
correctly under the new contract.

Removed exports are the top source of breaking changes in deletion diffs. Grep
for every removed symbol by exact name — `--all-signals` will list some, and its
evidence has been measured wrong (it has reported surviving references for
symbols that have none, and matched a removed name as a prefix of its
replacement), so verify each one yourself.

Read the **full body** of every changed function, not just the diff hunk.

### 2. Edge case sweep

For each changed or new function, mentally execute it with: zero, negatives,
`NaN`, `Infinity`, `null`/`undefined`, empty string/array/object, very large
values, and asymmetric positive-vs-negative inputs. Trace step by step, decide
what it returns, and decide whether that is correct.

### 3. Concurrency

For code touching transactions, locks or shared state:

- **TOCTOU** — a check (`exists()`, `find()`, `count()`) that runs *before* the
  lock is acquired. Two callers can both pass it.
- **Lock ordering** — the lock must come before the condition it protects.
- **Check-then-act in a transaction** — `if (exists()) return` followed by
  `lockForUpdate()` leaves the check unprotected.

### 4. Boundary and threshold changes — **investigate, do not default to silence**

The title, body and commit message are claims, not evidence. "Off-by-one fix",
"harmless tweak" and "minor correction" describe what the author believes.

1. Identify the exact input where old and new semantics diverge. `> 5` → `>= 5`
   diverges at 5. `== 0` → `=== 0` diverges at `'0'` versus `0`.
   `lien review`'s comparison-change output locates these, and it is the one
   signal that has earned trust — but skim the diff too, since it misses
   compound changes where an operator and a literal changed on the same line.
2. Find the test associations for the changed file (`lien health --format json`
   carries them) and read those test files.
3. **Report a finding unless** a test calls the function with the exact
   divergence input *and* asserts the new behaviour. Test absent, test covers a
   different input, test asserts the old behaviour — all findings. Cite the test
   file and line you read, or note its absence.
4. Suggest a **test pair** pinning the boundary from both sides: the divergence
   input, and the adjacent value on the unchanged side.

### 5. Incomplete handling

When a function consumes a typed object, check every declared field is handled:

- **Unread fields** — an interface declares X, nothing reads X. Callers setting
  it get a silent no-op.
- **Missing cases** — a switch or if-chain over a union or enum that does not
  cover every variant.
- **Partial iteration** — some config properties handled, others skipped.
- **Declared but unimplemented** — a type promises a contract the implementation
  only partly honours. Worst when the type is public API or a config schema.

Focus on fields and variants this change introduced. `--all-signals` offers
variant-sweep, sibling-surface and unread-field worklists; all three were
measured noisy, so treat them as places to look and grep for consumers yourself.

### 6. Silent error swallowing

For each error-handling block added or changed, ask: **if this operation fails,
will the caller know?** If not, that is a bug.

- Empty catch, or a body that is only a comment.
- Log-only catch — no rethrow, no error return, no failure state. The caller
  gets a "success" built from zero values.
- Blanket catch of `Exception`/`Error`/`BaseException` when one specific error
  was expected, masking unrelated failures.
- Go's `_ = err`, or `if err != nil { return nil }` without propagating.
- `.catch(() => {})` — the rejection is consumed and the chain continues with
  `undefined`.

### 7. Untrusted input validation — **investigate, do not default to silence**

A function reads untrusted bytes (`JSON.parse`, a request body, a file, an env
var, a subprocess's stdout) and the parsed value reaches typed consumer code
without a guard. Check every parse site the diff adds or changes.

Note that this signal fires on test assertions when tests are in scope, so it is
noisy by construction — judge the site, not the match.

### 8. Stale duplicated literals

A literal changed in one place and the old value survives elsewhere. Confirm the
surviving site genuinely should track the changed one — a changelog entry naming
an old value is a changelog working correctly, and this signal has been measured
to fire mostly on inline-code spans in markdown.

### 9. Documentation truth

For each doc the change touched, identify the claims it makes about behaviour,
then verify each against the current code. A renamed symbol whose surrounding
prose was not re-read is the classic miss.

Also consider docs the change did *not* touch: if it removed or renamed
something, another document may still describe the old form as current.
`--all-signals` includes a docs-drift worklist for this.

## What to report

Only defects that produce wrong output, break callers, or swallow failures.
Not style, not naming, not missing tests in general, not preferences, not
pre-existing issues the change did not introduce.

For each: the file and line, the concrete trigger (input X → returns Y → should
return Z), the fix, and one line of evidence naming what you actually inspected.

If your analysis shows the code is fine, report nothing. Silence means approval —
except for checks 4 and 7, where you must show you looked.
