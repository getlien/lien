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

## Step 1 — get the deterministic facts

```bash
lien review --base <ref>          # candidates from the diff        (~100 ms)
```

`<ref>` is what you are reviewing against: `origin/main` for a branch, `HEAD` for
uncommitted work, `HEAD~1` for the last commit.

**Check the binary first.** `review --base` landed recently, and a globally
installed `lien` is often older than the checkout:

```bash
lien --version
```

If `lien review --base <ref>` prints `error: unknown option '--base'`, run the
local build instead — `node packages/cli/dist/index.js review --base <ref>` —
after `npm run build`. Do not quietly fall back to reviewing by hand; say that
you did. Watch for a bare `lien review` with no `--base`: it **exits 0 and
prints the help screen**, which is easy to misread as "ran clean, found nothing".

**Refresh the base ref.** `--base` is a two-dot `git diff <ref>`, so a stale
`origin/main` silently attributes other people's commits to this change. Run
`git fetch origin` first.

### Optional, and worth it

```bash
lien review --base <ref> --all-signals    # the 13 withheld signals  (~3.5 s)
lien review --base <ref> --include-tests  # tests are excluded by default
lien review --base <ref> --format json    # needed more often than you'd think
```

On a docs-only or markdown-heavy diff, nothing is parser-analyzable, so the
report leads with "nothing reviewable in them". That is about the *code* — the
documentation signals read the raw patch text and can still have found
candidates, and both renderers now list them under "still came from signals that
read the raw diff". Read past the first line; an empty analyzable set is not an
empty review.

### `lien health` is not a test-association lookup

Earlier guidance here told you to run `lien health --format json` for "test
associations". That was wrong, and following it produces false findings.

`lien health` ranks functions that already have a **complexity violation**, and
shows the top 5 for the whole repo. Measured here: only **12 functions in the
entire repo** are ranked at all, so the chance your changed file is among them
is small — and `--path` does not rescue it, because a file with no violation
yields `entries: []` regardless of scope.

(An earlier version of this note said 4 of the top 5 were fixtures from
`lien-review-testbed/`, which was true when that fixture app existed. It has
been deleted, taking most of the repo's violations with it — the ranked total
fell from 65 to 12. The conclusion got stronger, not weaker: a shorter ranking
is a narrower net.)

So it can tell you "this function is risky and under-tested" — and for the
functions it *does* rank, its `tests` field carries real paths. What it cannot do
is answer "here are the tests for the file I am reviewing", because your changed
file is almost never in that ranking.

**What does help:** `--all-signals` runs `test-coverage`, which reports exactly
which changed files have **no** associated test at all:

```
Changed files with no tests  (1)
    packages/site/docs/.vitepress/config.ts
```

That is a real answer to half of check 4 — it settles *whether* a changed file
has tests. It does not tell you *which* tests, so once it says a file has some,
find them with Glob and Grep.

### Read the caveats block

It reports what was NOT examined — untracked files, a signal that was withheld,
a parse that failed. Two gaps it does **not** report, which you must hold
yourself:

- **A signal that ran and found nothing leaves no trace in the output.** Only
  *withheld* signals are listed. You cannot tell "variant-sweep ran and found
  nothing" from "variant-sweep never ran" by reading the output. Check the
  withheld list explicitly.
- **`removed-export` is silently limited to TypeScript, JavaScript and Rust**
  (`/\.(?:[cm]?[jt]sx?|rs)$/`) and attaches no caveat saying so. On a Go, Java,
  Python, PHP, C#, Ruby, Kotlin or Swift diff it is blind, and check 1 is where
  that matters most.

## Step 2 — how much to trust the candidates

**Not much, and this is the important instruction.**

Those signals were built as pre-computed inputs for an LLM to adjudicate. On four
real diffs of this repo, adversarial review judged 106 candidates and rated
**none** actionable. `comparison-change` is the only one with measured true
positives, which is why it is the only one on by default. (That judgement is
recorded in the command's own output and in this file; there is no separate
artifact to re-read, so treat it as a calibration note, not a citation.)

Only **1 of 14** signals runs by default. `--all-signals` adds the other 13:
`stale-literal`, `removed-export`, `variant-sweep`, `unread-field`,
`catch-discrimination`, `sibling-surface`, `rename-sweep`, `untrusted-input`,
`test-coverage`, `docs-drift`, `doc-claims`, `guidance-surface`, `simplicity`.
Checks 1, 5, 6, 7, 8 and 9 below all reference worklists that **do not exist
unless you pass that flag**.

So:

- **A candidate is a hint about where to look, never a finding.** Confirm it
  against the actual code before you report it. Several signals match inside
  comments, docstrings and changelogs.
- **A signal's silence proves nothing.** Three signals are hard-gated to
  TypeScript/JavaScript (`catch-discrimination`, `unread-field`,
  `variant-sweep`), and `removed-export` to those plus Rust. Separately, the
  highest-volume signals cap their own output — `stale-literal` returned 8 of
  1,241 it had found on one diff, and returns exactly 8 on this repo's own
  history, which is the cap, not a count — so a short list is not a complete
  one. Gated, capped and never-ran all look identical: empty.
- **Never skip your own discovery because a signal ran.** The prompt this
  replaced said the grep "is already done for you". With measured precision this
  low, that instruction would make you miss things. Grep anyway.

Use the deterministic output for what it is genuinely good at: locating the
changed files, giving you the comparison-change divergence points, and printing
the removed-export / changeset cross-check that check 1 uses.

## Step 3 — the nine checks

Silence means approval: if a check finds nothing, say nothing. **Three checks
are exceptions** — 4, 7 and 8 — and are marked below. For those, reporting
nothing without having investigated is a failure, not a safe default. Check 9
carries a weaker version of the same duty.

### 1. Structural caller impact

Read the imports and exports of every changed file, then find the callers of
every changed or removed exported symbol. Ask whether each caller still behaves
correctly under the new contract.

Removed exports are the top source of breaking changes in deletion diffs. Grep
for every removed symbol by exact name — `--all-signals` will list some, and its
evidence has been measured wrong (it has reported surviving references for
symbols that have none, and matched a removed name as a prefix of its
replacement), so verify each one yourself. Remember it is blind outside
TS/JS/Rust.

Two steps that are easy to skip:

- **Follow the cascade, not just the direct caller.** For a high-fan-in symbol,
  walk one hop further: a caller that adapts cleanly may still hand a changed
  value to *its* callers.
- **Cross-check removals against the changeset.** For a published package, an
  export removal that no changeset mentions is a reportable contradiction —
  someone ships a breaking change as a patch. `lien review --all-signals`
  already prints this join; read it rather than recomputing it.

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
2. Find the tests for the changed function **yourself**: Glob the conventional
   test paths for that file, then Grep for the function name across the test
   tree. Pass `--include-tests` if you want the signals to see test files too.
   `--all-signals`' `test-coverage` tells you which changed files have none at
   all; no command names the specific tests for a file you choose. See the
   `lien health` note in step 1.
3. Judge the implementation first: does the new boundary match what the change
   set out to do? If it does not, that is a defect — report it.
4. Then judge the coverage, and keep the two separate. A test that asserts the
   *old* behaviour is a defect: it now passes against code it was written to
   reject, or it fails and someone will "fix" it in the wrong direction. A
   boundary with no test pinning it is **not** a defect — correct code with thin
   coverage is still correct. Report it as a required test for this change,
   which is the one coverage gap this review does raise (see "What to report").
   Cite the test file and line you read. If you conclude no test exists, say
   where you looked; "a tool returned nothing" is not evidence of absence.
5. Suggest a **test pair** pinning the boundary from both sides: the divergence
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

Focus on fields and variants this change introduced. With `--all-signals` you
get variant-sweep, sibling-surface and unread-field worklists; all three were
measured noisy and two are TS/JS-only, so treat them as places to look and grep
for consumers yourself.

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

The `catch-discrimination` signal covers this, but only under `--all-signals`
and only for TypeScript/JavaScript. On every other language, and on a default
run, this check is entirely your own reading.

### 7. Untrusted input validation — **investigate, do not default to silence**

A function reads untrusted bytes (`JSON.parse`, a request body, a file, an env
var, a subprocess's stdout) and the parsed value reaches typed consumer code
without a guard. Check every parse site the diff adds or changes.

The `untrusted-input` signal needs `--all-signals`. It fires on test assertions
whenever tests are in scope, so it is noisy by construction — judge the site,
not the match.

### 8. Stale duplicated literals — **investigate, do not default to silence**

A literal changed in one place and the old value survives elsewhere. Needs
`--all-signals` (`stale-literal`), and it is the most heavily truncated signal
in the set — 8 shown of 1,241 found, on one measured diff. A short list here is
the least trustworthy short list in the whole run, which is exactly why this
check may not fall back to silence.

Confirm the surviving site genuinely should track the changed one — a changelog
entry naming an old value is a changelog working correctly, and this signal has
been measured to fire mostly on inline-code spans in markdown.

### 9. Documentation truth

For each doc the change touched, identify the claims it makes about behaviour,
then verify each against the current code. A renamed symbol whose surrounding
prose was not re-read is the classic miss; `--all-signals` precomputes exactly
that as `rename-sweep`, with counts of how many it could not show.

Two guards, because this check is the easiest one to turn into noise:

- **Scope to prose the diff actually touched**, plus prose that describes
  something the diff renamed or removed. Do not audit the whole documentation
  corpus.
- **"I could not verify this claim" is not a finding.** Report a doc defect only
  when you can point at the code that contradicts it. If you cannot locate the
  relevant code, silence is correct.

`--all-signals` also includes `docs-drift`, `doc-claims` and `guidance-surface`
worklists. These read the raw patch, so they work on a docs-only diff where
nothing is parser-analyzable — see the note in step 1 about reading past the
"nothing reviewable" line.

## What to report

Any concrete defect this change introduces. Wrong output, broken callers and
swallowed failures are the common shapes, but they are not the whole list: an
authorization bypass, sensitive data reaching a log or a response, an injection
site, silent data corruption, or a path that hangs or exhausts a resource all
count, and several of those return a perfectly valid value while doing it.
Check 7 exists to find exactly that class, so the report must have room for it.

The test for reportability is *concrete*, not *severe*: you can name the input
or state that triggers it and what goes wrong. Not style, not naming, not
preferences, not pre-existing issues the change did not introduce.

One coverage exception, and only one: a **boundary or threshold change with no
test pinning the new behaviour** (check 4). That is a required test for this
change, and it is reported as a test to add rather than as a defect in the code.
Missing tests in general are still out of scope.

For each: the file and line, the concrete trigger (input X → returns Y → should
return Z), the fix, and one line of evidence naming what you actually inspected.

If your analysis shows the code is fine, report nothing. Silence means approval —
except for checks 4, 7 and 8, where you must show you looked.
