---
'@liendev/parser': patch
'@liendev/lien': patch
---

**C# declarations inside `#if ... #endif` are no longer invisible.**

Anything wrapped in a conditional-compilation block produced **no chunk and no
symbol at all** — so `lien complexity`, `lien health` and `lien review` were
blind to it. The grammar wraps such code in a `preproc_if` node, and
`CSharpTraverser.shouldTraverseChildren` did not treat that as transparent, so
the traversal never descended into it. The file still parsed fine; its
contents simply never reached the index.

Measured on `serilog/serilog` (216 `.cs` files), files collapsing to a single
symbol-less whole-file chunk:

```
before: 16
after:   9
```

Seven files recovered. The nine that remain are seven legitimately trivial
ones (`GlobalUsings.cs`, `AssemblyInfo.cs`, a top-level-statements
`Program.cs` — nothing to extract) and two that root in a tree-sitter `ERROR`
node, which is a grammar limitation and tracked separately.

**It also affects members, not just top-level declarations.** A
conditionally-compiled method inside a class body sits at
`declaration_list > preproc_if > method_declaration`, which was the same
blindness — and a far more common shape in real C# than a whole type inside
`#if`. That case is fixed by the same change and has its own test.

**`#if`/`#else` takes the first branch only, deliberately.** The grammar
*nests* `preproc_elif`/`preproc_else` inside `preproc_if`, so making those
transparent too would extract the same logical declaration once per branch —
`class Impl` twice for a plain `#if/#else`, three times with an `#elif`.
Duplicate symbols with one name are fabrication, which is a worse failure than
omission and something this repo has already paid for once (#1056: two
unrelated files reporting an identical 144-file dependent list). Choosing the
*correct* branch would require knowing the build configuration, which a parser
reading a single file cannot. So: first branch, deterministically, and the
`#else` branch stays unindexed. Pinned by tests.

`#region` needed nothing — `preproc_region`/`preproc_endregion` are siblings
of the declarations they visually wrap, not parents, so they never hid
anything. Verified against the grammar and pinned by a test, so nobody
"completes" this fix by adding them and reintroducing the duplication risk for
no gain.

Fixes the tractable half of #970. The remaining half — a declaration split
mid-signature across `#if`/`#else`, which makes tree-sitter root the whole
file in `ERROR` (`ILogger.cs`, 1,371 lines, and `PropertyBinder.cs`) — needs a
grammar upgrade or a preprocessing pass and is out of scope.
