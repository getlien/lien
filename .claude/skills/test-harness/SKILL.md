---
name: test-harness
description: Run the agent-review prompt harness in CC iteration mode against a rule or fixture. Free, low-fidelity. Use for prompt-authoring inner loop. The 9/10 reliability bar must still be measured via `npm run test:harness --calibrate 10` against OpenRouter/Gemini before shipping any prompt change.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash, Read, Write, Glob, Agent
---

# Agent-Review Test Harness — CC Iteration Mode

You are running the test harness for the agent-review plugin's rule prompts. This is the **free, fast iteration** path. It uses Claude (you, via subagents) to drive the same system + initial prompts the agent plugin would build in production. Output is a qualitative pass/fail per fixture.

**Critical caveat — relay this to the user once per invocation:** CC mode is *not* a substitute for the OpenRouter calibration run. A passing CC run means "Claude reading this prompt produces the expected behavior." Production runs Gemini 2.5 Flash, which is materially less capable. Before merging a prompt change, the user must run `OPENROUTER_API_KEY=… npm run test:harness -w @liendev/review -- --calibrate 10 --rule <rule>` and meet the 9/10 bar (per issue #538).

## Step 1: Resolve the argument

The user invoked you with one of:
- `/test-harness <rule-id>` — e.g. `/test-harness boundary-change`. Run all fixtures under `packages/review/test/harness/fixtures/<rule-id>/`.
- `/test-harness <fixture-path>` — explicit path to a `.fixture.json`. Run only that one.
- `/test-harness <rule-id> --votes 3` — run K times per fixture and report agreement.

Default `--votes` is 1 (cheapest). Use 3 when probing flakiness.

If the rule has no fixtures: tell the user and stop.

## Step 2: Load and assemble prompts

For each fixture, run:

```bash
npx tsx packages/review/test/harness/build-prompts.ts <fixture-path>
```

Capture the JSON output. It contains `systemPrompt` and `initialMessage` — the exact strings the agent plugin would feed an LLM in production.

Use the Read tool to also load the sibling `.assertions.ts` (same basename, `.fixture.json` → `.assertions.ts`) so you can show the user what's being checked. You don't need to parse the assertions module — the assert-cli step does that.

## Step 3: Spawn one subagent per vote

For each of K votes, use the Agent tool with these parameters:

- `subagent_type: "general-purpose"`
- `description: "Agent-review simulation for <rule-id>"`
- `prompt`: the wrapper template below, with `{systemPrompt}` and `{initialMessage}` substituted from step 2.

Wrapper template:

> You are simulating an LLM inside an automated code-review tool. Your role is defined by the SYSTEM PROMPT below; the USER MESSAGE describes the PR you are reviewing. Investigate using your available tools (Read, Grep, Glob) against the local repo working directory. Follow the investigation strategy described in the SYSTEM PROMPT exactly.
>
> When done, output **exactly one** fenced JSON block at the end matching the `<output_format>` schema in the SYSTEM PROMPT. After that JSON block, output a second fenced block tagged `harness-meta` listing the **production tool names** you logically used during investigation, one per line. Map your CC tools to the production tool name vocabulary so assertions match across modes:
>
> | Your CC tool | Production tool name to log |
> | --- | --- |
> | `Read <file>` | `get_files_context` |
> | `Grep <pattern>` (text or regex over files) | `grep_codebase` |
> | `Glob` / file-pattern listing | `list_functions` |
> | inspecting who calls a symbol | `get_dependents` |
> | Reading a single file's contents | `read_file` |
>
> Output one production tool name per line (just the bare name, e.g. `get_files_context`). Do not include any text after the second block.
>
> SYSTEM PROMPT:
> ```
> {systemPrompt}
> ```
>
> USER MESSAGE:
> ```
> {initialMessage}
> ```

Spawn the K subagents in parallel (single message, multiple Agent tool calls) when K > 1.

## Step 4: Parse each subagent's response

For each returned subagent result:

1. Extract the first ```json ... ``` block — parse it as `{findings, summary}`.
2. Extract the ```harness-meta ... ``` block — split on newlines, drop blanks, treat each line as a production tool name (per the mapping in Step 3).
3. Build a HarnessResult object:
   ```json
   {
     "findings": [...],
     "toolCalls": ["get_files_context", "grep_codebase", "read_file"],
     "turns": 1
   }
   ```
   (`turns: 1` is a placeholder — we don't have access to the subagent's actual turn count. The toolCalls list MUST use production tool names so `expectToolCalled('get_files_context', …)` assertions work in both modes.)
4. Write it to a temp file: `/tmp/harness-result-<rule>-<vote-index>.json`.

If a subagent's response has no parseable JSON block, count it as a failure with a note.

## Step 5: Run assertions

For each result file, run:

```bash
npx tsx packages/review/test/harness/assert-cli.ts \
  <path-to-.assertions.ts> \
  /tmp/harness-result-<rule>-<vote-index>.json
```

Capture the JSON output and exit code:
- exit 0 → assertion passed
- exit 1 → Tier 1 failure (hard signal — the prompt is broken)
- exit 2 → Tier 2 failure (ambiguous — phrasing drift, may need keyword set widening)
- exit 3 → loader error (fix this before reporting)

## Step 6: Aggregate and report

For each fixture, summarize across K votes:

- **Agreement** — how many votes produced the same Tier 1 outcome (rule fired vs not fired). All-agree is a high-confidence result. Disagreement = flaky; refuse to call green.
- **Pass rate** — `passes / K`.
- **First failure detail** — for the user to inspect.

Print a compact summary like:

```
=== boundary-change ===

✓ placeholder.fixture.json — 1/1 passed (1 finding, ruleId=boundary-change)
✗ ge-5-threshold-shift.fixture.json — 2/3 passed (1 Tier 2 fail: "test pair" not mentioned)

Summary: 1/2 fixtures green, 1 flaky.

⚠️  CC mode result. Run --calibrate 10 against OpenRouter before merging any prompt change.
```

Show finding excerpts (first 200 chars of `message`) for any fixture that failed assertions, so the user can see what the model actually produced.

## Failure modes — what to look out for

1. **Subagent ignores the SYSTEM PROMPT** — produces generic Claude commentary instead of the JSON output_format. Re-spawn once with stronger framing if needed; otherwise count as failure.
2. **Subagent emits multiple JSON blocks** — parse only the first one (after the prose).
3. **`harness-meta` block missing** — proceed with empty `toolCalls`; Tier 1 `expectToolCalled` assertions will fail. Note in output.
4. **Fixture file path missing repoRootDir** — subagent has no real repo to read from. Use the working directory (the harness fixture's `repoRootDir` is informational; the subagent should default to grep'ing the current Lien repo).
5. **Build-prompts errors out** — usually means fixture schema is wrong. Surface the error verbatim to the user.

## What to do after a green CC run

A passing CC run is **necessary but not sufficient** to ship a rule or prompt
change. After CC mode is green, recommend the OpenRouter calibration
explicitly so the user (or a follow-up autonomous run) closes the loop:

```bash
npm run test:harness -w @liendev/review -- --rule <rule-id> --calibrate 10
```

Auto-loads `OPENROUTER_API_KEY` from `.env` at the repo root via
`process.loadEnvFile()`. Shippable when pass-rate ≥ 9/10. See
`packages/review/test/harness/README.md` for the full failure-mode table.

## What this skill does NOT do

- Run the actual `AgentReviewPlugin.analyze()` code path. (That requires OpenRouter mode, `npm run test:harness`.)
- Measure cost or token usage. (Subagents don't expose this back to the parent.)
- Hit the 9/10 reliability bar. (CC fidelity is too high; only OpenRouter calibration counts toward shipping decisions.)

If the user wants any of the above, point them at OpenRouter mode.
