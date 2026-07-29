---
"@liendev/parser": patch
"@liendev/lien": patch
---

#935: a bare same-directory self-import specifier (`import { x } from '.'`)
was never resolved, so a same-directory barrel re-export test never
associated with the sibling file(s) it directly imports.

Root cause: `resolveRelativeImport` only recognized specifiers starting
with `./` or `../`. JS/TS's import extractor stores the raw source text
verbatim, and `import { x } from '.'`'s specifier is the literal string
`"."` — no leading slash, so it fell through unresolved and was stored in
chunk metadata exactly as written. None of `matchesFile`'s five strategies
can match an unresolved `"."` against anything.

Reproduced on a real indexed honojs/hono corpus:
`src/middleware/jsx-renderer/index.test.tsx` imports its own directory's
barrel via `from '.'`, and `lien annotate` reported "No test coverage" for
`src/middleware/jsx-renderer/index.ts` despite the test directly exercising
it. Same shape on `src/middleware/secure-headers/index.test.ts`.

Fix: `resolveRelativeImport` now also matches the bare, slash-free `.`/`..`
themselves (Node/TS module resolution treats them as "this directory" and
"the parent directory", exactly like their slash-suffixed forms) via a
single anchored regex, `RELATIVE_IMPORT_PATTERN`. This resolves to the
importer's own directory (or its parent) the same way an already-supported
`./` /`../` specifier does, so downstream matching needs no changes.
Python's own leading-dot relative imports (`.foo`, `..pkg`) are unaffected —
`PythonImportExtractor` already converts those to the `./`/`../`-prefixed
form before this function runs (#904), so the new bare-dot case only ever
fires for languages (JS/TS today) whose extractor stores the raw specifier
as-is.

Verified end-to-end on the real hono repro (both files now report their
own test file under "Test coverage") and via a 25-file coverage sample
across hono, gin, and flask confirming no regression.
