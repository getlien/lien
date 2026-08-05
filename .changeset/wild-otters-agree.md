---
'@liendev/parser': patch
'@liendev/review': patch
---

Share one chunk-line lookup between `get_dependents` usage snippets and review's dependent context (#1087)

Both computed a snippet's position as `callSiteLine - chunk.metadata.startLine`,
which is only exact when a chunk's content starts on the line `startLine` names.
A module-level chunk's does not — `createChunkFromRange` trims its range's
leading blank lines out of the content while `startLine` keeps naming the
untrimmed start — so the subtraction overshoots: `get_dependents` returned a
neighbouring statement as the snippet, and review's `extractSnippetWindow`
either centred its window a line late or, once the overshoot exceeded the
content, returned `null` and dropped the snippet from the review prompt
entirely.

Both now go through `findChunkLineIndex`, which locates the line by finding the
nearby one that mentions the symbol. `review`'s module-level callers are also
labelled `(module-level)` rather than `unknown`, matching what parser already
reports, and the `()` suffix is dropped for them since module-level code is not
a function.
