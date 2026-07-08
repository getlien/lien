# Native Parser: Wire Format & Compat Contract

Status: Frozen for Phase 1 implementation (accompanies [ADR-013](decisions/0013-prebuilt-native-parser-napi-rs.md)).
Package impact: new `@liendev/parser-native` crate; `@liendev/parser`'s `ast/parser.ts` adapter is rewritten, everything else under `ast/**` is unaffected.

This is the contract Phase 1 implements: the JSON emitted by the Rust `parseTree(lang, source)` napi export, and the compat deserializer in `@liendev/parser` that reconstructs `Parser.SyntaxNode`-shaped plain objects from it. Every traverser, extractor, and complexity analyzer under `packages/parser/src/ast/**` — **excluding `ast/parser.ts` itself**, which is the adapter and is expected to change — must run unmodified against the reconstructed objects.

## 0. Scope: nodes never escape `@liendev/parser`

Confirmed by exhaustive grep: no `SyntaxNode`-typed value crosses the `@liendev/parser` package boundary, and `tree-sitter` is not a dependency of `core`, `cli`, `review`, or `action`. The public API of `parser` (`chunkByAST`, `extractSymbolInfo`, dependency/test associations, etc.) returns only plain data — never a node. **The compat shape below only has to satisfy consumers inside `packages/parser/src/ast/**`.** This is an internal implementation-detail contract, not a public API.

## 1. JSON wire shape (Rust → JS boundary)

One JSON object per node, depth-first, `children` nested inline. Defaults are omitted to shrink payload size; the deserializer fills them back in.

| Field | Type | Semantics |
|---|---|---|
| `type` | `string` | `node.kind()`. Always present. |
| `startIndex` | `number` | `node.start_byte()`. Always present. **UTF-8 byte offset**, not a JS-string index — see §2.3. |
| `endIndex` | `number` | `node.end_byte()`. Always present. UTF-8 byte offset. |
| `startRow` | `number` | `node.start_position().row`. Always present, 0-based. |
| `startCol` | `number` | `node.start_position().column`. Always present. UTF-8 byte offset within the row. |
| `endRow` | `number` | `node.end_position().row`. Always present, 0-based. |
| `endCol` | `number` | `node.end_position().column`. Always present. UTF-8 byte offset within the row. |
| `named` | `false \| undefined` | `node.is_named()`. **Omitted when `true`** (the common case) — presence always means `false`. |
| `field` | `string \| undefined` | `cursor.field_name()`. **Omitted** when the node has no field name under its parent. |
| `hasError` | `true \| undefined` | `node.has_error()`. **Omitted when `false`** (the common case) — presence always means `true`. |
| `isMissing` | `true \| undefined` | `node.is_missing()`. **Omitted when `false`** (the common case) — presence always means `true`. |
| `children` | `WireNode[]` | Always present (empty array for leaves), in tree-sitter's natural child order, unnamed tokens included. |

### 1.1 Wire-size optimization: omitted-default encoding

`field` is absent on the majority of nodes (only grammar-field children carry one), `named` is `true` on the large majority of nodes, and `hasError`/`isMissing` are `false` on essentially every node in well-formed source. Emitting all four unconditionally costs roughly 25–30 bytes of pure waste per node, compounding over files with thousands of nodes. Omitting them costs the deserializer three `??`-style fallbacks per node — free next to the one `JSON.parse` call this already requires.

Single-letter keys for every field (`t`, `s`, `e`, `sr`, ...) were considered and rejected: this JSON never crosses a network, only the napi FFI boundary once per file, and the dominant cost is the string-copy-plus-parse (roughly linear in byte count regardless of key length — V8 interns short repeated keys cheaply). The readability cost of single-letter keys is paid by every future contributor reading the Rust serializer or debugging a wire node, forever, for an unmeasured marginal win — not worth it per CLAUDE.md's readability-over-cleverness principle. Position fields (`startIndex`/`endIndex`/`startRow`/`startCol`/`endRow`/`endCol`) are not made optional: they're present on every node with no meaningful default, and their values are already minimal integers, so there is no lever left to pull on them.

### 1.2 TypeScript wire type declarations

```typescript
/** Wire format emitted by the native parseTree() binding. One JSON string per parse. */
export interface WireNode {
  type: string;
  startIndex: number; // UTF-8 byte offset — NOT directly usable as a JS string index, see §2.3
  endIndex: number; // UTF-8 byte offset
  startRow: number; // 0-based line number
  startCol: number; // UTF-8 byte offset within startRow
  endRow: number; // 0-based line number
  endCol: number; // UTF-8 byte offset within endRow
  named?: false; // absent means true
  field?: string; // absent means "no field name"
  hasError?: true; // absent means false
  isMissing?: true; // absent means false
  children: WireNode[];
}
```

## 2. Compat object contract (JS/TS reconstruction)

### 2.1 Construction strategy

Build **eagerly**, in one recursive pass over the already-`JSON.parse`d `WireNode` tree, immediately after parse. `children`/`namedChildren` must be real, eager `Array`s — **not** lazy getters that reconstruct on each access. Reasons: dozens of call sites chain `.find`/`.filter`/`.forEach`/`.some`/`.slice`/`.findIndex`/`.flatMap`/`.at` and direct index access on these arrays (92 sites for `namedChildren` alone, e.g. `ast/languages/python.ts:278` does `node.namedChildren[index]` right after a `.findIndex(...)` on the same array); a lazy getter would be slower under repeated access and, if it ever produced fresh object instances per call, would silently break the reference-equality invariant in §2.5.

```typescript
class CompatSyntaxNode implements Parser.SyntaxNode {
  readonly type: string;
  readonly isNamed: boolean;
  readonly isMissing: boolean;
  readonly hasError: boolean;
  readonly children: CompatSyntaxNode[]; // real array, eager
  readonly namedChildren: CompatSyntaxNode[]; // real array, eager (filter of children)
  readonly childCount: number;
  readonly namedChildCount: number;
  parent: CompatSyntaxNode | null = null; // back-patched by the parent during its own construction
  readonly startIndex: number; // UTF-16 code-unit offset (converted, see §2.3)
  readonly endIndex: number;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };

  private readonly _fieldMap: Map<string, CompatSyntaxNode> | null;
  private readonly _source: string;
  private _text: string | undefined; // lazy, memoized

  get text(): string {
    if (this._text === undefined) {
      this._text = this._source.slice(this.startIndex, this.endIndex);
    }
    return this._text;
  }

  child(index: number): CompatSyntaxNode | null {
    return this.children[index] ?? null;
  }
  namedChild(index: number): CompatSyntaxNode | null {
    return this.namedChildren[index] ?? null;
  }
  childForFieldName(name: string): CompatSyntaxNode | null {
    return this._fieldMap?.get(name) ?? null;
  }
}

interface CompatTree {
  rootNode: CompatSyntaxNode;
}
```

### 2.2 Every `SyntaxNode`/`Tree` member lien uses

| Member | Representative usage | Compat implementation |
|---|---|---|
| `node.type` | `ast/symbols.ts:49` (222 non-test sites) | Direct string copy from `wire.type`. |
| `node.text` | `ast/complexity/halstead.ts:103,130,134,141` | Lazy memoized getter: `sourceString.slice(startIndex, endIndex)` using the UTF-16-converted indices (§2.3). |
| `node.namedChildren` | `ast/symbols.ts:48,52,327` (92 sites) | Real eager `Array<CompatSyntaxNode>`: `children.filter(c => c.isNamed)`. |
| `node.children` | `ast/complexity/halstead.ts:184`, `ast/languages/rust.ts:153`, `ast/languages/javascript.ts:95,180` | Real eager `Array<CompatSyntaxNode>`, one per `wire.children[i]`, recursively constructed, in wire order. |
| `node.namedChildCount` | `ast/languages/java.ts:307` | `namedChildren.length`, set once at construction. |
| `node.namedChild(i)` | `ast/languages/javascript.ts:249,497`, `ast/languages/swift.ts:373` | `namedChildren[i] ?? null`. |
| `node.childForFieldName(name)` | Pervasive, 154 sites, e.g. `ast/complexity/halstead.ts:128`, `ast/extractors/symbol-helpers.ts:12` | `Map<string, CompatSyntaxNode>` built once at construction from `wire.children[*].field`, storing the **same object references** already placed in `children`/`namedChildren` (§2.5). Returns `null` on miss. |
| `node.startPosition` (`.row` only) | `ast/chunker.ts:216,303,382`, every `ast/languages/*.ts` (48 sites, all `.row`) | `{ row: wire.startRow, column: <converted, §2.3> }`. |
| `node.endPosition` (`.row` only) | `ast/chunker.ts:216,304,383` (38 sites, all `.row`) | Same pattern using `endRow`/`endCol`. |
| `node.startIndex` | `ast/extractors/symbol-helpers.ts:15` (`content.slice(node.startIndex, bodyNode.startIndex)`), `ast/languages/kotlin.ts:81,83` | `byteToUtf16(wire.startIndex)` — must be directly usable as a JS-string index into the original source, since call sites slice `content` with it directly, not via `.text`. See §2.3. |
| `node.endIndex` | `ast/languages/kotlin.ts:81` | Same conversion. |
| `node.parent` | `ast/symbols.ts:291,292,296` (ancestor walk-up), `ast/languages/rust.ts:62,72`, `ast/languages/javascript.ts:76,82,678`, `ast/languages/php.ts:68,74` | Back-reference: after constructing a node's `children`, set `child.parent = thisNode` for each. Root's `parent = null`. |
| `tree.rootNode` | `ast/parser.ts:56`, `ast/chunker.ts:58` | `CompatTree = { rootNode: CompatSyntaxNode }`. |
| `tree.rootNode.hasError` | `ast/parser.ts:56` — the line-chunking-fallback trigger | `wire.hasError ?? false` on the root node. |
| Reference equality: `childForFieldName(...)` result `===` the same node reached via `namedChildren` | `ast/complexity/cognitive.ts:76,101` | Correctness constraint on the two members above, not a member itself — see §2.5. |
| `parser.parse(content)` *(adapter-only)* | `ast/parser.ts:53` | Not part of the frozen consumer contract. Replaced by the native `parseTree(lang, content)` call + `JSON.parse` + `CompatTree` construction. |
| `parser.setLanguage(grammar)` *(adapter-only)* | `ast/parser.ts:19` | Replaced by passing a language-name string to the native binding; `parserCache: Map<SupportedLanguage, Parser>` is removed entirely. |

`isMissing` (per node) and `hasError` (per non-root node) have **zero current call sites** but are required regardless: `isMissing` is the exact capability that disqualified `@ast-grep/napi` in the spike (see ADR-013), and freezing a shape that can't represent it would foreclose ever using it; `hasError` is an O(1) cached flag on every tree-sitter node, so emitting it per-node costs nothing and avoids a future wire-shape change for error-localization features.

### 2.3 Byte-offset vs. UTF-16 semantics — the critical, empirically-verified decision

**The problem:** tree-sitter's Rust core is byte-oriented (`Node::start_byte()`/`end_byte()`, `Point.column` are UTF-8 byte offsets). JavaScript strings are indexed by UTF-16 code units. For any source file with a multi-byte UTF-8 character before a node of interest, a byte offset and the corresponding JS-string index diverge.

**What lien's existing code assumes:** `ast/extractors/symbol-helpers.ts:15` does `content.slice(node.startIndex, bodyNode.startIndex)` — `.slice()` on the **original JS source string**, directly with `node.startIndex`, not via `.text`. For this to work today, whatever `node-tree-sitter` hands back as `.startIndex` must already be a valid JS-string (UTF-16) index into `content`.

**Empirical verification** (run against this worktree's installed `tree-sitter@0.25.0` + `tree-sitter-javascript`): parsing `` const a = "héllo🎉world";\nfunction foo() { return "café🎉"; }\n `` (source length 62 UTF-16 units, 68 UTF-8 bytes):

```
function_declaration node: startIndex=26, endIndex=61
node.text (via .text): "function foo() { return \"café🎉\"; }"  (length 35)

source.slice(26, 61)                              === node.text   → true
Buffer.from(source,'utf8').subarray(26,61).toString('utf8')       → garbled, mismatched
```

A second check on column semantics (`` let café = "🎉x";\n ``): the prefix `let café = ` is 11 UTF-16 units but 12 UTF-8 bytes; the string node's `startPosition.column` reported **11** — matching UTF-16 length, not byte length.

A third check on `hasError`/`isMissing` (`function foo( { return 1; }`): `rootNode.hasError` is `true`, but a walk for `isMissing` nodes found **zero** — this grammar recovers via `ERROR` nodes for this malformation rather than `MISSING` tokens. A MISSING-triggering case needs an incomplete-but-otherwise-valid construct (e.g. an unclosed string), which is exactly the case the `@ast-grep/napi` disqualification concerned (see ADR-013) — this is carried forward as an open question (§5).

**Conclusion:** `node-tree-sitter`, fed a JS string (as `ast/parser.ts:53`'s `parser.parse(content)` always does — never a `Buffer`), returns `startIndex`/`endIndex`/`.column` as **UTF-16 code-unit offsets**, despite the `.d.ts` doc comments literally saying "byte offset" — those comments describe the native Rust semantics you'd get feeding a `Buffer`, not what you get here. `.row` is unaffected either way, since a newline byte is always exactly 1 byte = 1 UTF-16 unit.

**Decision:** the Rust crate keeps emitting native UTF-8 byte offsets on the wire (cheapest, most natural for `tree_sitter::Node`). The **compat deserializer** converts byte offsets to UTF-16 code-unit offsets before exposing `.startIndex`/`.endIndex`/`.column`, so existing call sites like `symbol-helpers.ts:15` keep working unmodified and produce identical output to today.

**Conversion algorithm** — one pass per parsed file, O(byte length), done once right after `JSON.parse`, before/during compat-tree construction:

```typescript
interface OffsetMaps {
  byteToUtf16: Uint32Array; // byteToUtf16[byteOffset] = utf16 offset at that byte position
  rowStartUtf16: Uint32Array; // rowStartUtf16[row] = utf16 offset of the start of that row
}

function buildOffsetMaps(source: string): OffsetMaps {
  const bytes = Buffer.from(source, 'utf8');
  const byteToUtf16 = new Uint32Array(bytes.length + 1);
  const rowStarts: number[] = [0];
  let byteIdx = 0;
  let utf16Idx = 0;
  while (byteIdx < bytes.length) {
    byteToUtf16[byteIdx] = utf16Idx;
    const b = bytes[byteIdx];
    let charBytes: number;
    let utf16Units: number;
    if (b < 0x80) {
      charBytes = 1;
      utf16Units = 1;
      if (b === 0x0a /* \n */) rowStarts.push(utf16Idx + 1);
    } else if ((b & 0xe0) === 0xc0) {
      charBytes = 2;
      utf16Units = 1;
    } else if ((b & 0xf0) === 0xe0) {
      charBytes = 3;
      utf16Units = 1;
    } else {
      charBytes = 4;
      utf16Units = 2; // astral plane -> surrogate pair
    }
    byteIdx += charBytes;
    utf16Idx += utf16Units;
  }
  byteToUtf16[bytes.length] = utf16Idx;
  return { byteToUtf16, rowStartUtf16: Uint32Array.from(rowStarts) };
}

// per node, given the maps + wire fields:
const startIndex = maps.byteToUtf16[wire.startIndex];
const endIndex = maps.byteToUtf16[wire.endIndex];
const startColumn = startIndex - maps.rowStartUtf16[wire.startRow];
const endColumn = endIndex - maps.rowStartUtf16[wire.endRow];
```

This relies on tree-sitter node boundaries always landing on UTF-8 codepoint boundaries for well-formed input — true in normal lexing, and `byteToUtf16` is only ever queried at such boundaries, never mid-codepoint. `.text` is then simply `source.slice(startIndex, endIndex)` using the already-converted UTF-16 indices — a native V8 string slice on the original JS source string (not a re-sliced byte `Buffer`), provably identical to `node-tree-sitter`'s own `.text` per the experiment above.

### 2.4 `.column` is computed but is dead code in lien today

Exhaustive grep confirms **zero** non-test call sites read `.startPosition.column`/`.endPosition.column` anywhere in `packages/parser/src` — only `.row` is ever used (86 combined sites). Correct `.column` computation is still required for contract completeness/fidelity (it costs nothing extra once the offset maps exist for `.startIndex` anyway, and a future traverser might reasonably want it) — but it means the risk of the byte-offset decision in §2.3 is lower than it would otherwise be: `.startIndex`/`.endIndex` are the fields that matter today, specifically because of `symbol-helpers.ts:15`.

### 2.5 Reference-equality invariant

`ast/complexity/cognitive.ts:76,101` compare a node obtained via `childForFieldName(...)` against a node obtained by iterating `.namedChildren`, using `===`/`!==`. The field-name lookup map **must** be populated with the same `CompatSyntaxNode` instances already present in `children`/`namedChildren`, built in the same construction pass — not a second, independent reconstruction. This is the easiest correctness bug to introduce in a from-scratch implementation, and it fails silently: it only shows up as subtly-wrong cognitive-complexity scores, not a crash or a type error.

## 3. Non-goals — node-tree-sitter members Phase 1 will NOT implement

Verified via exhaustive grep of `packages/parser/src/**/*.ts` (src and test) against the full `SyntaxNode`/`Tree`/`Parser`/`TreeCursor`/`Query` surface in `tree-sitter@0.25.0`'s type declarations. Zero hits for every item below.

- **`SyntaxNode`**: `id`, `typeId`, `grammarId`, `grammarType`, `isExtra`, `hasChanges`, `isError`, `parseState`, `nextParseState`, `descendantCount`, `tree` (backlink to owning `Tree`), `toString()`, `childCount` (only `namedChildCount` is used), `child(index)` (only `namedChild(index)` is used), `firstChild`, `lastChild`, `firstNamedChild`, `lastNamedChild`, `nextSibling`, `previousSibling`, `nextNamedSibling`, `previousNamedSibling`, `childForFieldId`, `fieldNameForChild`, `fieldNameForNamedChild`, `childrenForFieldName`, `childrenForFieldId`, `firstChildForIndex`, `firstNamedChildForIndex`, `childWithDescendant`, `descendantForIndex`, `descendantForPosition`, `namedDescendantForIndex`, `namedDescendantForPosition`, `descendantsOfType`, `closest`, `walk()`.
- **`Tree`** (besides `.rootNode`): `rootNodeWithOffset`, `edit`, `walk`, `getText`, `getChangedRanges`, `getIncludedRanges`, `getEditedRange`, `printDotGraph`.
- **`Parser`** (besides the adapter-only `setLanguage`/`parse`): `getIncludedRanges`, `getTimeoutMicros`, `setTimeoutMicros`, `reset`, `getLanguage`, `getLogger`, `setLogger`, `printDotGraphs`. No call site ever passes `oldTree` (incremental reparse) or `options` (`bufferSize`, `includedRanges`) — every parse is a full fresh parse of a complete string.
- **Entirely unused subsystems**: `TreeCursor` (lien never constructs one — the Rust *serializer* uses one internally, but that's implementation detail on the Rust side), `Query`/`QueryCapture`/`QueryMatch`/`QueryOptions`, `LookaheadIterator`, `Parser.Input` (custom chunked-input callback — always a plain string is passed).

None of the above need wire representation or a compat implementation in Phase 1. If a future traverser needs one (e.g. `closest()` for cleaner ancestor-walking instead of the manual `while (current.parent)` loops in `symbols.ts`/`rust.ts`/`javascript.ts`/`php.ts`), it's trivially addable later as a compat *method* with zero wire-shape change — `parent` is already frozen into the shape.

## 4. Language table

Which grammar export each language's `LanguageDefinition` (`packages/parser/src/ast/languages/*.ts`) actually uses:

| Language | Extensions | npm grammar export used today | Rust crate export |
|---|---|---|---|
| TypeScript | `ts`, `tsx` | `TypeScript.typescript` — **both extensions route through the plain TypeScript grammar**; `TypeScript.tsx`/`LANGUAGE_TSX` is not used anywhere in lien today, though the crate audit confirmed it also works | `LANGUAGE_TYPESCRIPT` |
| JavaScript | `js`, `jsx`, `mjs`, `cjs` | `JavaScript` (single default export; JSX is handled by the same grammar, not a separate parser) | `LANGUAGE` |
| PHP | `php` | `PHPParser.php` — **not** `PHPParser.php_only`/`LANGUAGE_PHP_ONLY` | `LANGUAGE_PHP` |
| Python | `py` | `Python` (single default export) | `LANGUAGE` |
| Rust | `rs` | `Rust` (single default export) | `LANGUAGE` |
| Go | `go` | `Go` (single default export) | `LANGUAGE` |
| Java | `java` | `Java` (single default export) | `LANGUAGE` |
| C# | `cs` | `CSharp` (single default export) | `LANGUAGE_C_SHARP` |
| Ruby | `rb` | `Ruby` (single default export) | `LANGUAGE` |
| Kotlin | `kt` | `Kotlin` (single default export) | vendored crate's `language()` (old-style `extern "C"` binding, no Rust-side API change needed) |
| Swift | `swift` | `Swift` (single default export) | `LANGUAGE` |

TypeScript and PHP are the only two languages where the npm package (and the Rust crate) expose more than one grammar; lien uses exactly one of the two in both cases.

## 5. Open questions carried into Phase 1/2

1. **`isMissing` round-trip is unproven.** The empirical test (`mb-test.cjs`, §2.3) could not produce a MISSING node — the tested grammar recovered via `ERROR` nodes for that malformation. Phase 1/2 must add a fixture using an incomplete-but-otherwise-valid construct (e.g. an unclosed string or paren) to prove `isMissing` actually round-trips through the wire format end to end, not just that the field exists in the type.
2. **Lone/unpaired surrogates at the napi FFI boundary.** The byte↔UTF-16 offset-map algorithm (§2.3) assumes well-formed UTF-8 and codepoint-aligned tree-sitter node boundaries. napi-rs converts an incoming JS string to a Rust `String`, which enforces valid UTF-8; a JS string containing a lone surrogate (legal WTF-16, illegal Unicode) will presumably be lossily converted (e.g. to U+FFFD) at that boundary. Whether this matches `node-tree-sitter`'s current behavior on such input has not been empirically checked. Low priority — flagged for completeness, not blocking.
3. **Parse-stage concurrency cap.** Per [ADR-013](decisions/0013-prebuilt-native-parser-napi-rs.md#negative--risks), `concurrency=16` combined with megabyte-scale files measures ~1.55GB peak RSS — at/over the 1.5GB ceiling — and there is no parse-stage file-size gate today. A fix (a lower parse-stage concurrency ceiling, independent of the unrelated I/O-bound stat concurrency) must land before general availability.
4. **Test-file construction scope.** 15 `*.test.ts` files (one per language, plus `extractors.test.ts`, `halstead.test.ts`) construct `new Parser()` + `parser.setLanguage(<real grammar module>)` + `parser.parse(...)` directly, bypassing `ast/parser.ts` entirely, to get ground-truth trees for testing traversers/extractors. This spec's compat contract covers everything these tests *consume*; their *construction* path is a different surface. Recommendation: keep `tree-sitter` + all `tree-sitter-<lang>` packages as `devDependencies` through Phase 1 — real `SyntaxNode`s trivially satisfy `Parser.SyntaxNode` and double as Phase 2 parity-gate fixtures for free. Revisit dropping them entirely at Phase 4 once parity is proven.
5. **The `parseAST()` "Invalid argument" large-file fallback is likely not reproduced by the native path.** `ast/parser.ts`'s documented node-tree-sitter buffer quirk on 1000+ line files (caught via try/catch, falls back to line-based chunking) is npm-binding-specific, not a fundamental tree-sitter limitation — a direct `tree_sitter::Parser::parse` call likely doesn't hit it at all. Phase 2's parity gate should expect (not flag as a regression) previously line-chunked large files getting full AST-aware chunking under native — a correct-but-different result.
6. **Position-object identity/caching** (fresh `{row, column}` object per access vs. memoized per node) is a pure micro-optimization choice — nothing in lien compares position objects by reference, only node references (§2.5). Left as a Phase 1 implementation detail, not frozen here.
