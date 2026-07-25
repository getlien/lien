---
"@liendev/parser": patch
"@liendev/lien": patch
---

Honesty-only fix for #875: C# lets a nested namespace body reference an
*enclosing* namespace's members unqualified, with no `using` directive at
all (`namespace AutoMapper.UnitTests { ... }` can reference
`AutoMapper.TypeMap` purely via ordinary C# name resolution). Confirmed
against AutoMapper/AutoMapper: 355/364 `UnitTests/` files rely on exactly
this and carry no relevant `using`, so import-based test-association has no
per-file signal for them — a structural gap, not a matching bug. `lien
annotate`'s test-coverage line no longer claims `No test coverage.` on
these files; it now reports `Test coverage not determinable from imports
(enclosing-namespace access).` instead, for any language whose new
`LanguageDefinition.enclosingNamespaceAccess` flag is set (only C# today,
checked via the new `hasEnclosingNamespaceAccess()` export).

This is deliberately a separate flag from `wholeModuleImports`: C#'s
*explicit* dotted `using AutoMapper.X;` still resolves real per-file
associations correctly (the other 9/364 files, #866/#868) — folding this
into `wholeModuleImports` would make `isUnresolvableWholeModuleImport`
discard those working usings too (C# usings are dotted, never slashed, so
every one of them is "bare" by that check) and regress them. No heuristic
recovery (no name-proximity matching) — every other language's wording and
behavior is unchanged.
