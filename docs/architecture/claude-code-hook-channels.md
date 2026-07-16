# Claude Code Hook Output Channels

Reference for which Claude Code hook output channels actually reach the model
on its next turn, and which are silently dropped. Verified behaviorally (a
PostToolUse hook emitting a directive, checked for model compliance) against
**Claude Code 2.1.142** — re-verify if the hook protocol changes in a future
version.

## Reaches the model

- `hookSpecificOutput.additionalContext` (PostToolUse) — surfaces as a
  `<system-reminder>` block in the next user turn. Use this to deliver context
  alongside a tool result (`plugins/claude/hooks/annotate-read.sh`,
  `delta-write.sh`).
- `exit 2` + stderr (any hook) — surfaces as a tool error the model sees. Use
  this to block a tool call with a message the model must read.
- `hookSpecificOutput.updatedInput.prompt` (PreToolUse, on the subagent-launch
  tool) — reaches the launched subagent's own prompt. `updatedInput` replaces
  the whole `tool_input` object, so the hook must echo back every original
  field (`subagent_type`, `description`, etc.) or the call silently breaks
  (`augment-explore-task.sh`).

## Recorded but NOT delivered to the model

- Bare top-level `systemMessage` (PreToolUse or PostToolUse) — written to the
  transcript as a `hook_system_message` attachment, never reaches the model's
  next-turn input. Don't design model-visible behavior around it.
- `hookSpecificOutput.updatedToolOutput` for `Read` (PostToolUse) — ignored;
  the Read result returns unchanged. Likely ignored for any tool returning
  structured (non-string) output.

## The Agent-vs-Task matcher gotcha

The subagent-launching tool is named `Agent` in current Claude Code, `Task` in
older versions. Hook-dev docs and community examples often still say `Task`.
Match both — `"matcher": "Agent|Task"` (`plugins/claude/hooks/hooks.json`).

**Re-audited 2026-07-16, still correct.** The official tool reference
(`code.claude.com/docs/en/tools-reference`, fetched the same day) lists
`Agent` as the sole subagent-spawn tool; `Task` no longer exists as a tool
name at all (the `Task*` family that remains — `TaskCreate`/`TaskGet`/
`TaskList`/`TaskOutput`/`TaskStop`/`TaskUpdate` — is the unrelated
session task-list feature, not the subagent launcher). The plugin's
`"Agent|Task"` matcher already covers the current name, so
`augment-explore-task.sh` fires normally — confirmed by replaying both
`tool_name: "Agent"` and `tool_name: "Task"` payloads through the script,
now covered permanently by `packages/cli/test/augment-explore-hook.test.ts`.
`Task` stays in the matcher as a free legacy-version alias; no reason to
remove it.

Same audit also checked `delta-write.sh`'s `"Edit|Write|MultiEdit"` matcher:
`Edit`/`Write` are current; `MultiEdit` was removed from Claude Code with no
replacement tool name (its batch-edit use case folded into `Edit`'s
`replace_all`). Same conclusion — harmless legacy alias, not a live bug,
since `Edit`/`Write` alone already fire the hook on every current edit.
`MultiEdit`'s presence is already exercised by `delta-write-hook.test.ts`
and was left as-is.

## How to apply

| Intent | Channel |
| --- | --- |
| Deliver context the model should see, mid-action | PostToolUse + `additionalContext` |
| Block the tool with a message the model must read | exit 2 + stderr |
| Mutate what a subagent sees in its own prompt | PreToolUse + `updatedInput` (echo every field) |

Before wiring a hook to a specific tool name, verify the name in the target CC
version — grep a session transcript
(`~/.claude/projects/<project>/<session>.jsonl`) for `"name":"<ToolName>"` in
`tool_use` blocks rather than trusting docs.
