---
'@liendev/parser': minor
---

Fix C# properties being invisible to symbol tooling (#871): `property_declaration` and `indexer_declaration` are now chunked as their own symbols, so `api-delta`, `get_dependents`, and `list_functions` can see a property being removed or changing type — properties are C#'s dominant public-API idiom (auto-properties, expression-bodied properties, DTO/POCO surfaces), and previously not one of them was chunked as a symbol.

Chunked as `symbolType: 'method'` (Route A), reusing the existing type rather than adding a new `'property'` value to the `symbolType` union — no language emits `'property'` today, and `signature-delta.ts`'s `functionMetadataByKey`/`isExportedChunk` already treat `'method'`-typed chunks as part of a class's exported surface when the class itself is exported, so this requires zero changes outside `csharp.ts`.

Covered forms:

- Accessor-list properties (`public string Name { get; set; }`), including a getter-only shape and `init` accessors.
- Expression-bodied properties (`public int Count => …`) — the signature captures the contract (type + normalized accessor shape, `{ get; }`) and deliberately excludes the getter's expression, mirroring how a method's body is excluded from its own signature: editing the expression is not a signature change, but changing the property's type or accessor shape is.
- Static properties.
- Interface properties.
- Indexers (`public int this[int index] { get; set; }`), named `this` (indexers have no `name` field in the grammar).

Deliberately not covered: record primary-constructor properties (`record Person(string Name)`) — the grammar represents them as plain `parameter` nodes inside the record's `parameter_list`, a different node shape than `property_declaration`, out of scope for this fix.

Honest cost: chunking every property means a DTO/POCO-heavy C# codebase's index grows. Measured on a shallow clone of AutoMapper/AutoMapper (560 files, 512 `.cs`): chunk count went from 11,175 to 12,411 (+1,236, +11.1%; +1,053 of those are the new `method`-typed property/indexer chunks), and `structural.db` grew from ~23.4 MiB to ~24.4 MiB (+~1.08 MiB, +~4.6%). No other language's chunking changed.
