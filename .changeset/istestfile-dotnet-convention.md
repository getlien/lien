---
"@liendev/parser": patch
---

Fix `isTestFile()` in path-matching.ts to recognize the dominant .NET
xUnit/NUnit/MSTest test-naming convention: a `Tests` suffix glued onto a
longer identifier (`UnitTests/`, `IntegrationTests/`, `AutoMapper.DI.Tests/`
directories) rather than a delimited `test`/`spec` path segment, and
filenames ending in `Test.cs`/`Tests.cs` (`ScopeTests.cs`,
`ConfigurationFeatureTest.cs`).

`isTestFile()` is the pre-filter gating all test-association discovery
(`findTestAssociationsFromChunks`), so this was a 100% test-association
failure for C# projects using the standard .NET project-template layout
(confirmed on `AutoMapper/AutoMapper`, where none of its 364 test files
under `src/UnitTests/`, `src/IntegrationTests/`, or
`src/AutoMapper.DI.Tests/` ever cleared the gate). Scoped to `.cs` paths;
both the directory-segment and filename regexes require a literal
capital-T `Tests`/`Test` suffix (no case-insensitive flag), so
`Latest.cs`/`Contest.cs` and a `latest/`-style directory are not
misclassified, and no other language's behavior moves, mirroring how the
existing Swift branch is scoped to `.swift`.

Fixes #866.
