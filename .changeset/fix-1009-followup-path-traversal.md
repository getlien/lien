---
"@liendev/parser": patch
---

Clamp PHP require-target resolution (`php-require.ts`'s `requireTargetExists`, added in #1009/#1063) to `workspaceRoot`. Previously `path.join(workspaceRoot, specifier)` resolved `..` segments without clamping the result, so a statically-resolvable specifier like `require __DIR__ . '/../../../../etc/passwd';` could `fs.statSync` a real file entirely outside the indexed project and get trusted as a genuine require/include dependency edge. Now rejected before the existence check ever runs: the candidate path's relative path back to `workspaceRoot` must not escape (start with `..`) or be absolute (the cross-drive case on Windows).
