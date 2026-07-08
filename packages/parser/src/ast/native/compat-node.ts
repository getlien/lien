import type { WireNode } from '@liendev/parser-native';
import { buildOffsetMaps } from './offset-map.js';
import type { OffsetMaps } from './offset-map.js';

export interface CompatPosition {
  row: number;
  column: number;
}

/** {row, column} for a position already converted to a UTF-16 index. */
function toPosition(row: number, index: number, maps: OffsetMaps): CompatPosition {
  return { row, column: index - maps.rowStartUtf16[row] };
}

interface BuiltChildren {
  children: CompatSyntaxNode[];
  namedChildren: CompatSyntaxNode[];
  fieldMap: Map<string, CompatSyntaxNode> | null;
}

/**
 * Registers `name -> child` in `fieldMap` (allocating it on first use),
 * first-match wins (native-parser.md section 2.1: repeated field names keep
 * the earliest child). Returns the map so callers can thread it back.
 */
function registerField(
  fieldMap: Map<string, CompatSyntaxNode> | null,
  name: string,
  child: CompatSyntaxNode,
): Map<string, CompatSyntaxNode> {
  const map = fieldMap ?? new Map();
  if (!map.has(name)) map.set(name, child);
  return map;
}

/**
 * Recursively construct `parent`'s children, and derive namedChildren and
 * the field-name lookup map in the same pass (native-parser.md section 2.1:
 * first-match wins on repeated field names). Split out of the constructor
 * so CompatSyntaxNode's own constructor stays a short field-assignment list.
 */
function buildChildren(
  wireChildren: WireNode[],
  source: string,
  maps: OffsetMaps,
  parent: CompatSyntaxNode,
): BuiltChildren {
  const children: CompatSyntaxNode[] = [];
  const namedChildren: CompatSyntaxNode[] = [];
  let fieldMap: Map<string, CompatSyntaxNode> | null = null;

  for (const wireChild of wireChildren) {
    const child = new CompatSyntaxNode(wireChild, source, maps);
    child.parent = parent;
    children.push(child);
    if (child.isNamed) namedChildren.push(child);
    if (wireChild.field) {
      fieldMap = registerField(fieldMap, wireChild.field, child);
      // Swift-only: a child position can carry two field names when the
      // grammar nests field() around a shared hidden rule (e.g. the
      // "return_type" position also carries "name") -- see
      // packages/parser-native/index.d.ts's WireNode.field2 doc comment.
      if (wireChild.field2) fieldMap = registerField(fieldMap, wireChild.field2, child);
    }
  }

  return { children, namedChildren, fieldMap };
}

/**
 * Structural reconstruction of a tree-sitter SyntaxNode from the native
 * parser's wire format. Implements only the members ast/** consumers
 * actually use (native-parser.md section 2.2).
 */
export class CompatSyntaxNode {
  readonly type: string;
  readonly isNamed: boolean;
  readonly isMissing: boolean;
  readonly hasError: boolean;
  readonly children: CompatSyntaxNode[];
  readonly namedChildren: CompatSyntaxNode[];
  readonly childCount: number;
  readonly namedChildCount: number;
  parent: CompatSyntaxNode | null = null;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: CompatPosition;
  readonly endPosition: CompatPosition;
  private readonly fieldMap: Map<string, CompatSyntaxNode> | null;
  private readonly source: string;
  private cachedText: string | undefined;

  constructor(wire: WireNode, source: string, maps: OffsetMaps) {
    this.type = wire.type;
    this.isNamed = wire.named ?? true;
    this.isMissing = wire.isMissing ?? false;
    this.hasError = wire.hasError ?? false;
    this.source = source;
    this.startIndex = maps.byteToUtf16[wire.startIndex];
    this.endIndex = maps.byteToUtf16[wire.endIndex];
    this.startPosition = toPosition(wire.startRow, this.startIndex, maps);
    this.endPosition = toPosition(wire.endRow, this.endIndex, maps);

    const built = buildChildren(wire.children, source, maps, this);
    this.children = built.children;
    this.namedChildren = built.namedChildren;
    this.childCount = built.children.length;
    this.namedChildCount = built.namedChildren.length;
    this.fieldMap = built.fieldMap;
  }

  get text(): string {
    if (this.cachedText === undefined) {
      this.cachedText = this.source.slice(this.startIndex, this.endIndex);
    }
    return this.cachedText;
  }

  child(index: number): CompatSyntaxNode | null {
    return this.children[index] ?? null;
  }

  namedChild(index: number): CompatSyntaxNode | null {
    return this.namedChildren[index] ?? null;
  }

  childForFieldName(name: string): CompatSyntaxNode | null {
    return this.fieldMap?.get(name) ?? null;
  }
}

export interface CompatTree {
  rootNode: CompatSyntaxNode;
}

/**
 * Reconstruct a full compat tree from one native parseTree() wire payload.
 * Eager: the whole tree is built in a single recursive pass immediately
 * after JSON.parse (native-parser.md section 2.1) -- children and
 * namedChildren are real arrays, not lazy getters.
 */
export function buildCompatTree(wireRoot: WireNode, source: string): CompatTree {
  const maps = buildOffsetMaps(source);
  return { rootNode: new CompatSyntaxNode(wireRoot, source, maps) };
}
