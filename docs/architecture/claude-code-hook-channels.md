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
