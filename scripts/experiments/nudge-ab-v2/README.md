# nudge-ab-v2 experiment kit

> This file is **tool-usage documentation co-located with the runnable script it
> describes** (how to invoke `run.mjs`), not permanent project documentation — the
> authoritative, tracked write-up is the protocol doc and the two A/B docs under
> `docs/development/`. It lives next to the code it documents on purpose; the repo's
> "permanent docs live in `docs/`" rule is satisfied by the protocol doc, which this
> README defers to.

The runnable instrument for the **task-decoupled** A/B re-test of two Lien nudges
(blast-radius warning, did-you-run-the-tests Stop advisory). The **frozen
pre-registration** — hypotheses, scenario rationale, arms, metrics, abort criteria,
cost — is the authority and lives at
[`docs/development/nudge-ab-v2-protocol.md`](../../../docs/development/nudge-ab-v2-protocol.md).
Read it first. This README only covers how to drive the kit.

## Why v2 exists

The v1 A/Bs came back null because the scenarios were **task-forced**: the nudged
behavior was derivable from the task, so both arms did it and there was no headroom.
v2 decouples them — out-of-file dependents with no in-file hint, a test associated to
its source only by `import` (never by filename), and plain feature prompts that never
mention callers/tests/risk. See the protocol doc's §1–§2.

## Layout

```
run.mjs         orchestrator: check | probe | run <blast|verify>
detect.mjs      frozen, deterministic metric detection (pure functions)
hooks/          silent-note-edit.sh — experiment scaffolding (NOT a shipped hook)
fixtures/       pristine scenario repos (blast, verify), materialized per trial
prompts/        the frozen task + probe prompts
```

The real nudges under test are the shipped `plugins/claude/hooks/api-delta-write.sh`
(blast) and `recap-stop.sh` (verify); the runner wires them by absolute path via
`--settings` and toggles them with their real env kill switches
(`LIEN_BLAST_HOOK`, `LIEN_RECAP`).

## Commands

```bash
node run.mjs check   # zero-LLM: asserts the fixtures still trigger their nudges. FREE.
node run.mjs probe   # mandatory clean-context + plumbing precondition (1 claude call).
node run.mjs run blast    # 20 arm trials (gated on the probe having passed)
node run.mjs run verify   # 20 arm trials
```

`check` requires only a built CLI (`npm run build` + `build:native`). `probe`/`run`
additionally require the `claude` CLI and API budget — **run only after owner
approval of the cost** (protocol §9). The runner refuses to start an arm until the
probe has passed. Outputs land in `.wip/nudge-ab-v2/` (gitignored).

## Do not

- Do not add or redefine a metric after an arm has run — the pre-registration is
  frozen (protocol §6).
- Do not "fix" a null into a lift claim — a null is a null (protocol §6c, §8).
