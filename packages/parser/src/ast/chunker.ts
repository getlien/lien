import type { ASTChunk, SupportedLanguage, SyntaxNode } from './types.js';
import { parseAST, detectLanguage, isASTSupported } from './parser.js';
import {
  extractSymbolInfo,
  extractImports,
  extractImportedSymbols,
  extractExports,
  extractCallSites,
  type ManifestRoots,
} from './symbols.js';
import { calculateCognitiveComplexity, calculateHalstead } from './complexity/index.js';
import { getTraverser } from './traversers/index.js';
import { resolveWorkspacePackageEntries } from '../workspace-packages.js';
import { resolvePsr4Map } from '../php-psr4.js';
import { resolveGoModulePrefix } from '../go-module.js';
import { detectPythonSrcLayoutRoot } from '../python-src-layout.js';
import { resolveRustCrateMap } from '../rust-crate-map.js';
import { resolveJvmSourceRoots } from '../jvm-source-root.js';

export interface ASTChunkOptions {
  minChunkSize?: number;
  /**
   * Absolute path to the workspace/monorepo root. When provided (and the
   * root has an npm `workspaces` field), bare package specifiers that name a
   * sibling workspace package (e.g. `@scope/pkg`) are resolved to that
   * package's source entry file, so cross-package imports participate in
   * dependency analysis. Omit for non-monorepo projects — behavior is
   * unchanged.
   */
  workspaceRoot?: string;
}

/**
 * Context extracted from the AST for chunk creation.
 */
interface ASTContext {
  lines: string[];
  fileImports: string[];
  importedSymbols: Record<string, string[]>;
  fileExports: string[];
  traverser: ReturnType<typeof getTraverser>;
}

/**
 * Validate language support and parse the file.
 * @throws Error if language not supported or parsing fails
 */
function parseAndValidate(filepath: string, content: string) {
  const language = detectLanguage(filepath);
  if (!language) {
    throw new Error(`Unsupported language for file: ${filepath}`);
  }

  const parseResult = parseAST(content, language);
  if (!parseResult.tree) {
    throw new Error(`Failed to parse ${filepath}: ${parseResult.error}`);
  }

  return { language, rootNode: parseResult.tree.rootNode };
}

/**
 * Languages that use `./` / `../` specifiers with filesystem semantics, where
 * resolving relative imports against the importer's path produces the correct
 * workspace-relative target.
 *
 * Deliberately excludes Rust: `super::x` from a "leaf" file `src/foo.rs`
 * resolves to the SIBLING module `src/x`, not to `src/../x` — Rust's
 * `self::`/`super::` traverse the MODULE tree, which only sometimes lines up
 * with a filesystem `..` (it depends on whether the importer is itself a
 * `mod.rs`/`lib.rs`/`main.rs` — see `RustImportExtractor`'s doc comments), so
 * this generic filesystem-style join would produce wrong keys for it. Rust
 * resolves `self::`/`super::` precisely via its OWN extractor-internal
 * mechanism instead (#928, `resolveRustRelativeModulePath` in
 * `ast/languages/rust.ts`, threaded through via `ManifestRoots.rustCrateMap`'s
 * sibling `importerFile` argument) — this set staying Rust-free is about
 * which MECHANISM resolves it, not whether it's resolved at all.
 *
 * Includes Python (#904): `PythonImportExtractor` converts a relative
 * import's leading-dot form (`.foo`, `..pkg`) to a `./`/`../`-prefixed
 * specifier at extraction time — mirroring Rust's own `super::` -> `../`
 * conversion, but unlike Rust the converted form IS a real filesystem-join
 * relationship (Python's dot-counting maps directly onto ascending
 * directories from the importer's own), so it's safe to resolve here the
 * same way JS/TS specifiers are.
 *
 * Includes PHP (#1009): `PHPImportExtractor.extractStaticRequireTargets`
 * emits a `./`- or `../`-prefixed specifier for a statically-resolvable
 * `require`/`include` target (a plain literal, one prefixed with
 * `__DIR__`/`dirname(__FILE__)`, or one prefixed with `dirname(__DIR__)` --
 * the file's PARENT directory) — a genuine filesystem-relative-to-this-file
 * relationship, same shape as JS/TS's own relative imports. PHP's OTHER
 * import form (`use` statements, namespace-qualified, resolved via
 * `matchesPHPNamespace`/PSR-4 instead) never produces a `./`/`../`-prefixed
 * specifier, so adding PHP here has zero effect on it —
 * `RELATIVE_IMPORT_PATTERN` simply never matches.
 */
const RESOLVE_RELATIVE_IMPORTS: ReadonlySet<SupportedLanguage> = new Set([
  'javascript',
  'typescript',
  'python',
  'php',
]);

/**
 * Languages whose bare package specifiers can name a sibling *workspace*
 * package (`@scope/pkg`). Deliberately a separate, narrower set than
 * `RESOLVE_RELATIVE_IMPORTS`: npm workspaces is a JS-ecosystem-specific
 * mechanism, so extending workspace-package resolution to Python (whose bare
 * specifiers mean something entirely different — see `../python-src-layout.ts`)
 * would conflate two unrelated resolution concerns for no benefit.
 */
const RESOLVE_WORKSPACE_PACKAGES: ReadonlySet<SupportedLanguage> = new Set([
  'javascript',
  'typescript',
]);

/**
 * Per-language manifest-root builders backing `buildManifestRoots` below,
 * dispatched via `MANIFEST_ROOT_BUILDERS` rather than an if-chain so adding a
 * language never grows `buildManifestRoots`'s own complexity (each builder is
 * independently trivial). PHP resolves `composer.json`'s PSR-4 map; Go
 * resolves `go.mod`'s module prefix; Python detects an on-disk `src/` layout
 * (#901 — see `../python-src-layout.ts` for why this is filesystem-detected
 * rather than manifest-declared); Rust resolves the Cargo workspace's member
 * crate names (#903); Java/Kotlin detect the on-disk Maven/Gradle source-set
 * layout (#1046/#1005 Mechanism 1 — see `../jvm-source-root.ts`, same
 * filesystem-detected rationale as Python's); JS/TS always opts into
 * `resolveDirectoryIndex: true` (#953, no detection step needed — unlike the
 * others' manifest/filesystem detection, a directory's `index.<ext>` entry
 * file is checked per-specifier at resolution time, in
 * `resolveJsDirectoryIndex` itself). Every other language has no builder
 * registered, which `buildManifestRoots` treats as `undefined` (a no-op —
 * see `ManifestRoots` in `./symbols.ts`).
 */
type ManifestRootsBuilder = (workspaceRoot: string) => ManifestRoots | undefined;

function buildPhpManifestRoots(workspaceRoot: string): ManifestRoots | undefined {
  const psr4Map = resolvePsr4Map(workspaceRoot);
  // `workspaceRoot` is threaded through UNCONDITIONALLY (not just when
  // `psr4Map` is non-empty, unlike before #1009) for two reasons: (1) so
  // `resolvePsr4Import` can pick between multiple candidate directories for
  // the same prefix (#1002) by checking which one exists on disk, and (2) so
  // `appendStaticRequireTargets`'s existence check (`php-require.ts`'s
  // `requireTargetExists`) has a root to check against even for a PHP
  // project with no composer.json at all — exactly the framework-less/
  // legacy/WordPress case #1009 targets. A no-op for PSR-4 resolution itself
  // when the map is empty: `resolvePsr4Import` already short-circuits on
  // `psr4Map.size === 0`, so this is zero behavior change for `use`-statement
  // resolution.
  return { psr4Map, workspaceRoot };
}

function buildGoManifestRoots(workspaceRoot: string): ManifestRoots | undefined {
  const goModulePrefix = resolveGoModulePrefix(workspaceRoot);
  return goModulePrefix ? { goModulePrefix } : undefined;
}

function buildPythonManifestRoots(workspaceRoot: string): ManifestRoots | undefined {
  const pythonSrcLayoutRoot = detectPythonSrcLayoutRoot(workspaceRoot);
  return pythonSrcLayoutRoot ? { pythonSrcLayoutRoot, workspaceRoot } : undefined;
}

function buildRustManifestRoots(workspaceRoot: string): ManifestRoots | undefined {
  const rustCrateMap = resolveRustCrateMap(workspaceRoot);
  // `workspaceRoot` is threaded through too (#1056): a bare crate-root
  // import (`use crate_name::Symbol;`, no submodule path) needs it to read
  // the target crate's own root file when resolving which specific file
  // declares `Symbol` -- see `../rust-crate-exports.ts`.
  return rustCrateMap.size > 0 ? { rustCrateMap, workspaceRoot } : undefined;
}

function buildJvmManifestRoots(workspaceRoot: string): ManifestRoots | undefined {
  const jvmSourceRoots = resolveJvmSourceRoots(workspaceRoot);
  return jvmSourceRoots.length > 0 ? { jvmSourceRoots, workspaceRoot } : undefined;
}

function buildJsManifestRoots(workspaceRoot: string): ManifestRoots {
  return { resolveDirectoryIndex: true, workspaceRoot };
}

const MANIFEST_ROOT_BUILDERS: Partial<Record<SupportedLanguage, ManifestRootsBuilder>> = {
  php: buildPhpManifestRoots,
  go: buildGoManifestRoots,
  python: buildPythonManifestRoots,
  rust: buildRustManifestRoots,
  java: buildJvmManifestRoots,
  kotlin: buildJvmManifestRoots,
  javascript: buildJsManifestRoots,
  typescript: buildJsManifestRoots,
};

/**
 * Build the manifest-declared import-root mapping for a file's language, when
 * `workspaceRoot` is available. Returns `undefined` (rather than an object
 * with empty/absent fields) when nothing is found, so the corresponding
 * resolution step is skipped entirely for projects that don't need it. See
 * `MANIFEST_ROOT_BUILDERS` above for what each language does.
 */
function buildManifestRoots(
  language: SupportedLanguage,
  workspaceRoot: string | undefined,
): ManifestRoots | undefined {
  if (!workspaceRoot) return undefined;
  return MANIFEST_ROOT_BUILDERS[language]?.(workspaceRoot);
}

/**
 * Prepare AST context by extracting imports, exports, and symbols.
 *
 * For JS/TS/Python, `filepath` is threaded into the import extractors so that
 * relative specifiers (`./foo`, `../bar`, and — since #904 — Python's
 * extractor-converted `.foo`/`..pkg` forms) are resolved to workspace-relative
 * paths at index time. This prevents cross-package basename collisions in the
 * downstream dependency analysis (see #525).
 *
 * When `workspaceRoot` is also provided and the file is JS/TS, bare package
 * specifiers naming a sibling workspace package (`@scope/pkg`) are resolved
 * the same way, to that package's source entry file — closing the monorepo
 * cross-package blind spot in `get_dependents`. Gated to its own narrower
 * `RESOLVE_WORKSPACE_PACKAGES` set (not the relative-imports set above): npm
 * workspaces is a JS-ecosystem mechanism unrelated to Python's bare-specifier
 * semantics.
 *
 * Independently, when `workspaceRoot` is provided and the file is PHP, Go,
 * Python, or Rust, `buildManifestRoots` resolves that project's manifest- or
 * filesystem-detected import root (composer.json PSR-4 / go.mod module
 * prefix / on-disk `src/` layout / Cargo workspace member crate names — see
 * #867, #901, #903) so namespace-, module-, package-, or crate-qualified
 * imports resolve to real workspace-relative paths too.
 */
function prepareASTContext(
  content: string,
  rootNode: SyntaxNode,
  language: SupportedLanguage,
  filepath: string,
  workspaceRoot?: string,
): ASTContext {
  const resolutionPath = RESOLVE_RELATIVE_IMPORTS.has(language) ? filepath : undefined;
  const workspacePackages =
    RESOLVE_WORKSPACE_PACKAGES.has(language) && workspaceRoot
      ? resolveWorkspacePackageEntries(workspaceRoot)
      : undefined;
  const manifestRoots = buildManifestRoots(language, workspaceRoot);
  // Rust's self::/super:: resolution (#928) needs the file's real path
  // UNCONDITIONALLY, unlike `resolutionPath` above (which is deliberately
  // gated to skip Rust — see `RESOLVE_RELATIVE_IMPORTS`'s doc comment).
  // `rustImporterFile` is the dedicated, ungated channel for that; every
  // other language's extractor ignores it.
  const rustImporterFile = language === 'rust' ? filepath : undefined;
  return {
    lines: content.split('\n'),
    fileImports: extractImports(
      rootNode,
      language,
      resolutionPath,
      workspacePackages,
      manifestRoots,
      rustImporterFile,
    ),
    importedSymbols: extractImportedSymbols(
      rootNode,
      language,
      resolutionPath,
      workspacePackages,
      manifestRoots,
      rustImporterFile,
    ),
    fileExports: extractExports(rootNode, language),
    traverser: getTraverser(language),
  };
}

/**
 * Process a single top-level node into a chunk.
 */
function processTopLevelNode(
  node: SyntaxNode,
  filepath: string,
  content: string,
  context: ASTContext,
  language: SupportedLanguage,
): ASTChunk {
  const { lines, fileImports, fileExports, importedSymbols, traverser } = context;

  // For variable declarations, try to find the function inside
  let actualNode = node;
  if (traverser.isDeclarationWithFunction(node)) {
    const declInfo = traverser.findFunctionInDeclaration(node);
    if (declInfo.functionNode) {
      actualNode = declInfo.functionNode;
    }
  }

  // For methods, find the parent container name (e.g., class name)
  const parentClassName = traverser.findParentContainerName(actualNode);
  const symbolInfo = extractSymbolInfo(actualNode, content, parentClassName, language);
  const nodeContent = getNodeContent(node, lines);

  return createChunk(
    filepath,
    node,
    nodeContent,
    symbolInfo,
    fileImports,
    language,
    emitsChildChunks(node, traverser),
    fileExports,
    importedSymbols,
  );
}

/**
 * Does `findTopLevelNodes` emit chunks for this node's members as well as for
 * the node itself?
 *
 * Mirrors exactly the two branches there that push a node and keep descending:
 * a container it can actually descend INTO (`shouldExtractChildren` *and* a
 * non-null `getContainerBody` — e.g. a class, whose methods each become their
 * own chunk), and a transparent container (`transparentContainerTypes`, e.g.
 * Ruby's `module`). Every other top-level node is a leaf of the chunk tree —
 * `findTopLevelNodes` returns on match without descending — so its line range
 * overlaps no other chunk's.
 *
 * The `getContainerBody` half is load-bearing, not belt-and-braces:
 * `shouldExtractChildren` states an *intent* to descend that a language may
 * then decline per node. Python's `decorated_definition` is in
 * `containerTypes`, but `getContainerBody` returns null for a decorated
 * FUNCTION (only a decorated class has a body worth recursing into) — so a
 * `@decorator`-ed top-level function is a leaf, and treating it as a container
 * silently dropped its call sites. Measured on psf/requests: 384 of 2580
 * references, i.e. this predicate getting it wrong looks like a 15%
 * *regression*, not a missing improvement.
 *
 * Only used to decide call-site extraction (see `createChunk`), where the
 * overlap would mean double-counting.
 */
function emitsChildChunks(node: SyntaxNode, traverser: ReturnType<typeof getTraverser>): boolean {
  if (traverser.transparentContainerTypes?.includes(node.type)) return true;
  return traverser.shouldExtractChildren(node) && traverser.getContainerBody(node) !== null;
}

/**
 * Process all top-level nodes into chunks.
 */
function processTopLevelNodes(
  topLevelNodes: SyntaxNode[],
  filepath: string,
  content: string,
  context: ASTContext,
  language: SupportedLanguage,
): ASTChunk[] {
  return topLevelNodes.map(node => processTopLevelNode(node, filepath, content, context, language));
}

/**
 * Chunk a file using AST-based semantic boundaries
 *
 * Uses Tree-sitter to parse code into an AST and extract semantic chunks
 * (functions, classes, methods) that respect code structure.
 *
 * **Known Limitations:**
 * - Tree-sitter may fail with "Invalid argument" error on very large files (1000+ lines)
 * - When this occurs, Lien automatically falls back to line-based chunking
 * - Configure fallback behavior via `chunking.astFallback` ('line-based' or 'error')
 *
 * @param filepath - Path to the file
 * @param content - File content
 * @param options - Chunking options
 * @returns Array of AST-aware chunks
 * @throws Error if AST parsing fails and astFallback is 'error'
 */
export function chunkByAST(
  filepath: string,
  content: string,
  options: ASTChunkOptions = {},
): ASTChunk[] {
  const { minChunkSize = 5, workspaceRoot } = options;

  // Parse and validate
  const { language, rootNode } = parseAndValidate(filepath, content);

  // Prepare context
  const context = prepareASTContext(content, rootNode, language, filepath, workspaceRoot);

  // Find and process top-level nodes
  const topLevelNodes = findTopLevelNodes(rootNode, context.traverser);
  const topLevelChunks = processTopLevelNodes(topLevelNodes, filepath, content, context, language);

  // Extract uncovered code (imports, exports, top-level statements)
  const coveredRanges = topLevelNodes.map(n => ({
    start: n.startPosition.row,
    end: n.endPosition.row,
  }));
  const uncoveredChunks = withModuleLevelCallSites(
    extractUncoveredCode(
      context.lines,
      coveredRanges,
      filepath,
      minChunkSize,
      context.fileImports,
      language,
      context.fileExports,
      context.importedSymbols,
      // When no top-level node was recognized (e.g. a file containing only bare
      // statements/calls, like a single `test(...)` block with no exported
      // declaration), coveredRanges is empty and the single "uncovered" range
      // below is the entire file — the file's only chance at a chunk. See
      // extractUncoveredCode for why minChunkSize must not apply there.
      topLevelNodes.length === 0,
    ),
    rootNode,
    language,
    coveredRanges,
  );

  // Combine and sort by line number
  return [...topLevelChunks, ...uncoveredChunks].sort(
    (a, b) => a.metadata.startLine - b.metadata.startLine,
  );
}

/** Check if node is a function-containing declaration at top level */
function isFunctionDeclaration(
  node: SyntaxNode,
  depth: number,
  traverser: ReturnType<typeof getTraverser>,
): boolean {
  if (depth !== 0 || !traverser.isDeclarationWithFunction(node)) return false;
  return traverser.findFunctionInDeclaration(node).hasFunction;
}

/** Check if node is a target type at valid depth */
function isTargetNode(
  node: SyntaxNode,
  depth: number,
  traverser: ReturnType<typeof getTraverser>,
): boolean {
  return depth <= 1 && traverser.targetNodeTypes.includes(node.type);
}

/**
 * Find all top-level nodes that should become chunks
 *
 * Uses a language-specific traverser to handle different AST structures.
 * This function is now language-agnostic - all language-specific logic
 * is delegated to the traverser.
 *
 * @param rootNode - Root AST node
 * @param traverser - Language-specific traverser
 * @returns Array of nodes to extract as chunks
 */
function findTopLevelNodes(
  rootNode: SyntaxNode,
  traverser: ReturnType<typeof getTraverser>,
): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];

  function traverse(node: SyntaxNode, depth: number): void {
    // Capture function declarations and target nodes
    if (isFunctionDeclaration(node, depth, traverser) || isTargetNode(node, depth, traverser)) {
      nodes.push(node);
      return;
    }

    // Handle containers - emit the container itself AND traverse body for children
    if (traverser.shouldExtractChildren(node)) {
      nodes.push(node);
      const body = traverser.getContainerBody(node);
      if (body) traverse(body, depth + 1);
      return;
    }

    // Transparent containers (e.g. Ruby's `module`): emit a chunk for the
    // node itself, but — unlike shouldExtractChildren above — keep
    // traversing its children at the SAME depth instead of depth + 1. That's
    // what makes them "transparent" for the depth budget `isTargetNode`
    // enforces: a class (or method) nested inside one must still be found as
    // if the transparent container weren't there. See
    // `LanguageTraverser.transparentContainerTypes`'s doc comment.
    if (traverser.transparentContainerTypes?.includes(node.type)) {
      nodes.push(node);
    }

    // Traverse children of traversable nodes
    if (!traverser.shouldTraverseChildren(node)) return;
    for (const child of node.namedChildren) {
      traverse(child, depth);
    }
  }

  traverse(rootNode, 0);
  return nodes;
}

/**
 * Extract content for a specific AST node
 */
function getNodeContent(node: SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;

  return lines.slice(startLine, endLine + 1).join('\n');
}

/** Maps symbol types to legacy symbol array keys */
const SYMBOL_TYPE_TO_ARRAY: Record<string, 'functions' | 'classes' | 'interfaces'> = {
  function: 'functions',
  method: 'functions',
  class: 'classes',
  interface: 'interfaces',
};

/** Symbol types that have meaningful complexity metrics */
const COMPLEXITY_SYMBOL_TYPES = new Set(['function', 'method']);

/**
 * Build legacy symbols object for backward compatibility
 */
function buildLegacySymbols(symbolInfo: ReturnType<typeof extractSymbolInfo>): {
  functions: string[];
  classes: string[];
  interfaces: string[];
} {
  const symbols = {
    functions: [] as string[],
    classes: [] as string[],
    interfaces: [] as string[],
  };

  if (symbolInfo?.name && symbolInfo.type) {
    const arrayKey = SYMBOL_TYPE_TO_ARRAY[symbolInfo.type];
    if (arrayKey) symbols[arrayKey].push(symbolInfo.name);
  }

  return symbols;
}

/**
 * Determine chunk type from symbol info
 */
function getChunkType(
  symbolInfo: ReturnType<typeof extractSymbolInfo>,
): 'block' | 'class' | 'function' {
  if (!symbolInfo) return 'block';
  return symbolInfo.type === 'class' ? 'class' : 'function';
}

/**
 * Create a chunk from an AST node
 */
function createChunk(
  filepath: string,
  node: SyntaxNode,
  content: string,
  symbolInfo: ReturnType<typeof extractSymbolInfo>,
  imports: string[],
  language: SupportedLanguage,
  nodeEmitsChildChunks: boolean,
  fileExports?: string[],
  importedSymbols?: Record<string, string[]>,
): ASTChunk {
  const symbols = buildLegacySymbols(symbolInfo);
  const shouldCalcComplexity = symbolInfo?.type && COMPLEXITY_SYMBOL_TYPES.has(symbolInfo.type);

  // Calculate complexity metrics only for functions and methods
  const cognitiveComplexity = shouldCalcComplexity ? calculateCognitiveComplexity(node) : undefined;

  // Calculate Halstead metrics only for functions and methods
  const halstead = shouldCalcComplexity ? calculateHalstead(node, language) : undefined;

  // Call sites, on the other hand, are extracted for EVERY chunk whose range
  // no other chunk overlaps — not just functions and methods (#1087). Sharing
  // `shouldCalcComplexity` used to make a top-level `const schema =
  // z.object({...})` or `export const client = createClient(...)` contribute
  // no call-site evidence at all, since neither is a 'function'/'method'
  // symbol; measured on this repo, that silence covered 94% of the call
  // expressions in the tree.
  //
  // The one exclusion is a container (`nodeEmitsChildChunks`): its range
  // *contains* its members' chunks, and nothing downstream dedupes call sites
  // across a file's chunks, so extracting here would report every method's
  // calls a second time under the class. Module-level code no chunk covers is
  // handled by `withModuleLevelCallSites` below.
  const callSites = nodeEmitsChildChunks ? undefined : extractCallSites(node, language);

  return {
    content,
    metadata: {
      file: filepath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      type: getChunkType(symbolInfo),
      language,
      symbols,
      symbolName: symbolInfo?.name,
      symbolType: symbolInfo?.type,
      parentClass: symbolInfo?.parentClass,
      complexity: symbolInfo?.complexity,
      cognitiveComplexity,
      parameters: symbolInfo?.parameters,
      signature: symbolInfo?.signature,
      returnType: symbolInfo?.returnType,
      imports,
      // Symbol-level dependency tracking
      // NOTE: `exports` and `importedSymbols` are file-level concepts, but we deliberately
      // attach them to every chunk from the same file (including "uncovered" chunks).
      // This duplicates some metadata, but greatly simplifies dependency analysis,
      // since consumers can inspect a single chunk in isolation without additional lookups.
      // This increases storage overhead but is acceptable given typical file sizes and chunk counts.
      ...(fileExports && fileExports.length > 0 && { exports: fileExports }),
      ...(importedSymbols && Object.keys(importedSymbols).length > 0 && { importedSymbols }),
      ...(callSites && callSites.length > 0 && { callSites }),
      // Halstead metrics
      halsteadVolume: halstead?.volume,
      halsteadDifficulty: halstead?.difficulty,
      halsteadEffort: halstead?.effort,
      halsteadBugs: halstead?.bugs,
    },
  };
}

/**
 * Represents a range of lines in a file
 */
interface LineRange {
  start: number;
  end: number;
}

/**
 * Find gaps between covered ranges (uncovered code)
 */
function findUncoveredRanges(coveredRanges: LineRange[], totalLines: number): LineRange[] {
  const uncoveredRanges: LineRange[] = [];
  let currentStart = 0;

  // Sort covered ranges
  const sortedRanges = [...coveredRanges].sort((a, b) => a.start - b.start);

  for (const range of sortedRanges) {
    if (currentStart < range.start) {
      // There's a gap before this range
      uncoveredRanges.push({
        start: currentStart,
        end: range.start - 1,
      });
    }
    currentStart = range.end + 1;
  }

  // Handle remaining code after last covered range
  if (currentStart < totalLines) {
    uncoveredRanges.push({
      start: currentStart,
      end: totalLines - 1,
    });
  }

  return uncoveredRanges;
}

/**
 * Create a chunk from a line range
 */
function createChunkFromRange(
  range: LineRange,
  lines: string[],
  filepath: string,
  language: SupportedLanguage,
  imports: string[],
  fileExports?: string[],
  importedSymbols?: Record<string, string[]>,
): ASTChunk {
  const uncoveredLines = lines.slice(range.start, range.end + 1);
  const content = uncoveredLines.join('\n').trim();

  return {
    content,
    metadata: {
      file: filepath,
      startLine: range.start + 1,
      endLine: range.end + 1,
      type: 'block',
      language,
      // Empty symbols for uncovered code (imports, exports, etc.)
      symbols: { functions: [], classes: [], interfaces: [] },
      imports,
      // Symbol-level dependency tracking
      ...(fileExports && fileExports.length > 0 && { exports: fileExports }),
      ...(importedSymbols && Object.keys(importedSymbols).length > 0 && { importedSymbols }),
    },
  };
}

/** Is this 1-based line inside any of these 0-based-row ranges? */
function lineIsCovered(line: number, coveredRanges: LineRange[]): boolean {
  const row = line - 1;
  return coveredRanges.some(r => row >= r.start && row <= r.end);
}

/**
 * Attach call sites to the module-level ("uncovered") chunks — the top-level
 * statements no function/class chunk covers (#1087).
 *
 * `createChunk` needs a `SyntaxNode` and only ever sees the top-level nodes
 * `findTopLevelNodes` recognized, so bare top-level statements — the ones that
 * reach `createChunkFromRange` from a raw line range instead — had no path to
 * call-site extraction at all: route/DI registration, `app.use(...)`, and
 * (because a Vitest/Jest file is almost entirely bare top-level statements)
 * every `expect(chunkByAST(...))` in the test suite. Together with the widened
 * gate in `createChunk`, this took the share of TypeScript files in this repo
 * that reference a locally-declared identifier from 52.0% to 88.5%.
 *
 * Works from the whole-file `rootNode` — there is no node to hand a line
 * range — and drops anything `coveredRanges` already claims, so a call site is
 * attributed exactly once even though `findUncoveredRanges` can return a range
 * that overlaps a container's (it rewinds past nested covered ranges, e.g. a
 * class plus its own methods). That single-attribution property is the
 * constraint, not a nicety: neither `dependency-analyzer.ts`'s
 * `extractSymbolUsagesFromChunks` nor `review`'s `buildCallerEdges` dedupes
 * across a file's chunks, so a doubled attribution would inflate
 * `totalUsageCount` and caller-edge counts.
 *
 * Complexity metrics are untouched — `shouldCalcComplexity` still gates
 * cognitive/Halstead exactly as before; only call sites widen.
 */
function withModuleLevelCallSites(
  chunks: ASTChunk[],
  rootNode: SyntaxNode,
  language: SupportedLanguage,
  coveredRanges: LineRange[],
): ASTChunk[] {
  if (chunks.length === 0) return chunks;

  const all = extractCallSites(rootNode, language);
  const moduleLevel =
    coveredRanges.length === 0 ? all : all.filter(cs => !lineIsCovered(cs.line, coveredRanges));
  if (moduleLevel.length === 0) return chunks;

  return chunks.map(chunk => {
    const { startLine, endLine } = chunk.metadata;
    const callSites = moduleLevel.filter(cs => cs.line >= startLine && cs.line <= endLine);
    if (callSites.length === 0) return chunk;
    return { ...chunk, metadata: { ...chunk.metadata, callSites } };
  });
}

/**
 * Validate that a chunk meets the minimum size requirements
 */
function isValidChunk(chunk: ASTChunk, minChunkSize: number): boolean {
  const lineCount = chunk.metadata.endLine - chunk.metadata.startLine + 1;
  return chunk.content.length > 0 && lineCount >= minChunkSize;
}

/**
 * Extract code that wasn't covered by function/class chunks
 * (imports, exports, top-level statements)
 *
 * `minChunkSize` exists to avoid emitting noise chunks for small leftover
 * gaps *alongside* real function/class chunks in an otherwise normal file
 * (e.g. a lone blank-line gap between two functions). It must not apply when
 * the resulting chunk is the sole representation of the file's content —
 * doing so wouldn't shrink a chunk, it would silently drop the whole file
 * from the index. Two cases bypass it, both via `skipMinSize` below:
 *   - `hasExports`: barrel/re-export-only files (see "barrel/re-export
 *     files" tests in chunker.test.ts).
 *   - `fileHasNoTopLevelChunks`: files with zero recognized top-level nodes
 *     at all — e.g. a file containing only a bare `test(...)` call with no
 *     exported declaration. `coveredRanges` is empty in that case, so there
 *     is exactly one uncovered range and it spans the entire file.
 * Either way, `chunk.content.length > 0` still filters out empty/whitespace-
 * only files.
 */
function extractUncoveredCode(
  lines: string[],
  coveredRanges: Array<{ start: number; end: number }>,
  filepath: string,
  minChunkSize: number,
  imports: string[],
  language: SupportedLanguage,
  fileExports?: string[],
  importedSymbols?: Record<string, string[]>,
  fileHasNoTopLevelChunks = false,
): ASTChunk[] {
  const uncoveredRanges = findUncoveredRanges(coveredRanges, lines.length);

  const hasExports = fileExports && fileExports.length > 0;
  const skipMinSize = hasExports || fileHasNoTopLevelChunks;

  return uncoveredRanges
    .map(range =>
      createChunkFromRange(range, lines, filepath, language, imports, fileExports, importedSymbols),
    )
    .filter(chunk => (skipMinSize ? chunk.content.length > 0 : isValidChunk(chunk, minChunkSize)));
}

/**
 * Check if AST chunking should be used for a file
 */
export function shouldUseAST(filepath: string): boolean {
  return isASTSupported(filepath);
}
