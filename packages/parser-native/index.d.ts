/**
 * Wire format emitted by the native parseTree() binding. One JSON string per
 * parse, depth-first, children nested inline. Defaults are omitted to shrink
 * payload size -- see docs/architecture/native-parser.md §1/§1.1 for the
 * full contract this type mirrors.
 */
export interface WireNode {
  type: string;
  startIndex: number; // UTF-8 byte offset -- NOT directly usable as a JS string index, see spec §2.3
  endIndex: number; // UTF-8 byte offset
  startRow: number; // 0-based line number
  startCol: number; // UTF-8 byte offset within startRow
  endRow: number; // 0-based line number
  endCol: number; // UTF-8 byte offset within endRow
  named?: false; // absent means true
  field?: string; // absent means "no field name"
  // Swift-only: some tree-sitter-swift productions nest field() calls around
  // a shared hidden rule (e.g. `field("return_type", field("name", ...))`),
  // so one child position can carry two field names. `field` is whichever
  // TreeCursor::field_name() reports (empirically the innermost); `field2`,
  // when present, is the other one. Absent for every other language and for
  // the vast majority of Swift nodes (single- or no-field positions).
  field2?: string;
  hasError?: true; // absent means false
  isMissing?: true; // absent means false
  children: WireNode[];
}

/**
 * Parses `source` as `lang` and returns the whole tree serialized as one
 * JSON string (parse it with `JSON.parse` to get a `WireNode`).
 *
 * @throws if `lang` is not one of the supported language ids (see
 *   `packages/parser/src/ast/languages/registry.ts`'s `LANGUAGE_IDS`)
 */
export declare function parseTree(lang: string, source: string): string;
