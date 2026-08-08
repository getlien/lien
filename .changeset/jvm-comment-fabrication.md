---
'@liendev/parser': patch
---

Fix a precision gap in the Java/Kotlin same-package dependent resolver
(#1005 Phase 3, Item E): a same-package file whose ONLY textual reference to
a target type sat inside a Javadoc/KDoc comment (not real code) was counted
as a genuine dependent. `jvm-same-package-signals.ts`'s text-match corpus now
strips Javadoc/KDoc and block comments, plus whole comment-only lines, in
addition to the existing `import`/`package` line stripping — closing a gap
larger than Item D's entire measured gain (2.4%–19.6% of currently-shipped
same-package edges across 7 real corpora rested solely on a comment-only
match). Deliberately does not also strip a trailing same-line comment after
real code — measured to recover only 0-2 additional edges per corpus against
100+ comment-only-line fabrications already caught, not worth the added risk
of a bare `//` inside a string literal truncating a real code line. Query-time
only; no `INDEX_FORMAT_VERSION` bump needed.
