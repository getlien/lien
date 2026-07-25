---
'@liendev/parser': patch
---

Fix Java `import static a.b.ClassName.member;` (a specific, non-wildcard
static-member import) never resolving to a test association or dependent for
its defining class file (#864). `extractImportPath` was already returning a
syntactically-correct path, but one segment deeper than the class's own file
— `com.example.Utils.method` where the file is `com/example/Utils.java`, not
`com/example/Utils/method` — so `matchesFile`/`matchesPythonModule` could
never match it.

`JavaImportExtractor.extractImportPaths` now returns the class's derived FQN
(the raw path with its trailing segment dropped) as a second candidate
alongside the original, unchanged single path from `extractImportPath`. This
is safe rather than a guess: Java requires every top-level type to live in a
file named after it, and nested types/members always live inside their
enclosing top-level type's file, so dropping the trailing segment always
yields that type's correct FQN — whether the segment names a static member
(the common case) or a nested class (`import static a.B.Inner;`, correct by
the same rule). A static import reaching two-plus levels into nested classes
under-matches silently (the same behavior as before the fix) rather than
mismatching. Wildcard static imports and ordinary (non-static) imports are
unaffected.

Confirmed on a real clone of google/gson: `JsonReaderTest.java` statically
imports 8 specific members of `JsonToken` (`STRING`, `NUMBER`, `BEGIN_ARRAY`,
...) and was invisible to `lien annotate`'s test-coverage line for
`JsonToken.java` despite directly testing `JsonReader.peek()`'s `JsonToken`
return values; it now appears. A full before/after diff of every file's
test-association set across gson's 264 Java files shows exactly one changed
entry — this addition — confirming no new false positives elsewhere.

Kotlin's narrower analogous shape (`import a.b.myFunction` for a top-level
function/property defined in an arbitrarily-named file) is deliberately left
as an honest, undetermined gap rather than a guess: unlike Java, there is no
syntactic marker (no `static`-equivalent keyword) distinguishing a top-level
declaration from a class/object-member access in this grammar — both parse
to an identical flat `identifier` of `simple_identifier` segments — so
guessing risks the false-positive fan-out #868 warned against. This is
documented in `KotlinImportExtractor`'s class doc comment and pinned by a
regression test; #864 stays open for the Kotlin side.
