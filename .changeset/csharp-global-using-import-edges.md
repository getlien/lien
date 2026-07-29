---
"@liendev/parser": patch
"@liendev/lien": patch
---

#930: `global using Namespace;` was resolved as a file-to-file import of
every file in that namespace, so a boilerplate `GlobalUsings.cs` (no code,
just a list of `global using` directives) became a false "dependent" of,
and false "test coverage" for, every file in every namespace it lists —
while the file's own `dependentCount`/`riskLevel`/`riskReasoning` were
computed entirely from that boilerplate. Confirmed on a real 254-file C#
corpus (serilog/serilog): 13 of 25 sampled files' "confident" test-coverage
line was driven 100% by `GlobalUsings.cs` pollution; after this fix, zero
files anywhere in the corpus list a `GlobalUsings.cs` as an importer or as
test coverage.

Fixed in `CSharpImportExtractor` (`packages/parser/src/ast/languages/csharp.ts`):
a `using_directive` node with a leading, unnamed `global` token now
contributes no import path, since a global using's effect is project-wide,
not scoped to the file that declares it — that file has no real dependency
relationship with the namespaces it lists.

This does not recover the *true* dependents/test-coverage that a global
using makes invisible (C# needs no per-file `using` once a global using
exists for a namespace, so the import graph has no signal for those real
usages) — that requires a type-reference-based resolution mechanism this
codebase doesn't have today (unlike the directory-based same-package/
same-directory heuristics `test-associations.ts` already has for Go/Java),
and is tracked separately. This change only removes the false edges.
