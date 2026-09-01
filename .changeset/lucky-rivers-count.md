---
'@liendev/lien': patch
'@liendev/parser': patch
---

**`lien review` no longer reports deleted files as parse failures.**

A diff that deletes files sent every one of them into the set `review` tried to parse, and a deleted file has no working-tree content — so they came back as failures. On a large deletion the report read:

```
lien review — 94 changed file(s) vs origin/main
Not examined:
  92 files could not be parsed and were not examined
```

All 92 were simply gone from disk. Zero were genuine parse failures, and a reader has no way to tell that from a broken parser.

Deletions now get their own line, and are excluded from the reviewed set rather than silently dropped — a deletion diff is mostly deleted files, so a reader seeing a small "changed files" count on a large PR should be told why:

```
lien review — 4 changed file(s) vs origin/main
Not examined:
  26 changed file(s) are not parser-analyzable ...
  2 changed test file(s) were excluded ...
  217 deleted file(s) — nothing to parse, so not reviewed.
```

`lien delta` never had this problem: it reads `git diff --name-status` and renders deletions as `· removed`. `lien review` parsed the raw unified diff, where `deleted file mode` blocks look like any other changed file.

Also in `@liendev/parser`: its README described the package as providing "capabilities used by Lien's lexical code search" and existing "to enable lightweight consumers (like `@liendev/review`)". Lexical search and that package have both since been removed, so the npm page described the library in terms of two things that no longer exist. It now says what the package actually is.
