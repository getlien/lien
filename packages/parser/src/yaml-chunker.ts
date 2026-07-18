import type { CodeChunk } from './types.js';

/**
 * YAML-specific chunking
 *
 * Splits YAML files by top-level mapping key instead of the generic
 * fixed-size line window, so `search_code` can retrieve a coherent config
 * section (e.g. a GitHub Actions `jobs.review` block) rather than an
 * arbitrary 75-line slice.
 *
 * This is PURE LINE HEURISTICS -- no real YAML parser is ever invoked, so the
 * chunker can never throw on malformed, partial, or templated (Helm/Jinja)
 * input. A "top-level key" is any indent-0 line matching a mapping-key shape;
 * because block-scalar bodies and nested content are always indented at
 * least one column, they can never be mistaken for a section boundary.
 *
 * Rules:
 * - The file is split into documents at column-0 `---` (doc-start) or `...`
 *   (doc-end) markers. A leading `---` on line 0 never produces an empty
 *   leading document. When more than one document is found, every chunk's
 *   breadcrumb is prefixed with `doc[N] ` (1-based); a single document gets
 *   no prefix.
 * - Within a document, sections are a preamble (content before the first
 *   top-level key, no breadcrumb) plus one section per top-level key,
 *   running until the next top-level key or the end of the document.
 * - `metadata.symbolName` carries a dotted key-path breadcrumb built from an
 *   indentation ancestor stack (analogous to markdown-chunker's heading
 *   stack), e.g. "jobs.review.env".
 * - Sections larger than `chunkSize * 3` lines are split into overlapping
 *   line-window sub-chunks (mirrors markdown-chunker's splitLargeSection);
 *   each window's breadcrumb is the key-path open at its first line, falling
 *   back to the section's top-level key when that line has no path of its
 *   own.
 * - A document with zero top-level keys (templated YAML, a top-level
 *   sequence, a bare scalar) degrades to a single whole-document section
 *   with no breadcrumb, window-split if oversized.
 */

/** One entry in the indentation ancestor stack: how deep, and the key name. */
interface KeyStackEntry {
  indent: number;
  key: string;
}

/** A contiguous line range (0-based, `endLine` exclusive) for one YAML document. */
interface DocRange {
  startLine: number;
  endLine: number;
}

/** A contiguous line range (0-based, `endLine` exclusive) with its key-path breadcrumb. */
interface Section {
  startLine: number;
  endLine: number;
  breadcrumb: string | undefined;
}

// Document markers, matched at column 0 only.
const DOC_START_RE = /^---\s*(#.*)?$/;
const DOC_END_RE = /^\.\.\.\s*$/;

// A YAML mapping key: a non-space start, up to a colon, then EOL or a value.
const KEY_LINE_RE = /^(\S[^:#]*):(\s.*)?$/;
// A sequence item indicator ("- foo" or a bare "-"), never a mapping key.
const SEQUENCE_ITEM_RE = /^-(\s|$)/;
// A block-scalar value indicator ("key: |", "key: >-", "key: |2 # comment").
const BLOCK_SCALAR_RE = /:\s*[|>][+-]?\d*\s*(#.*)?$/;

/** Count of leading space characters (YAML indentation is never meaningfully tab-based). */
function leadingSpaces(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

/**
 * Parse a line (already known to start at `indent`) as a mapping key, or
 * return null if it's a comment, a sequence item, or not key-shaped.
 */
function parseKeyLine(line: string, indent: number): { key: string } | null {
  const trimmed = line.slice(indent);
  if (trimmed.length === 0 || trimmed.startsWith('#') || SEQUENCE_ITEM_RE.test(trimmed)) {
    return null;
  }
  const match = KEY_LINE_RE.exec(trimmed);
  return match ? { key: match[1].trim() } : null;
}

/** Whether a line is an indent-0 mapping key -- i.e. a section boundary. */
function isTopLevelKeyLine(line: string): boolean {
  return leadingSpaces(line) === 0 && parseKeyLine(line, 0) !== null;
}

/**
 * Split the file into YAML documents at column-0 `---`/`...` markers. The
 * markers themselves are excluded from every document; a marker at line 0
 * never produces an empty leading document.
 */
function splitDocuments(lines: string[]): DocRange[] {
  const docs: DocRange[] = [];
  let docStart = 0;

  lines.forEach((line, i) => {
    if (!DOC_START_RE.test(line) && !DOC_END_RE.test(line)) return;
    if (i > docStart) docs.push({ startLine: docStart, endLine: i });
    docStart = i + 1;
  });

  if (docStart < lines.length) docs.push({ startLine: docStart, endLine: lines.length });

  return docs;
}

/** Join the ancestor stack into a dotted key-path, or undefined if empty. */
function stackPath(stack: KeyStackEntry[]): string | undefined {
  return stack.length > 0 ? stack.map(entry => entry.key).join('.') : undefined;
}

/** Pop every ancestor at or deeper than `indent` (a sibling or dedent closes them). */
function popStackTo(stack: KeyStackEntry[], indent: number): void {
  while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
    stack.pop();
  }
}

/** Whether `line` is still inside a block-scalar body opened at `blockScalarIndent`. */
function isBlockScalarContinuation(
  line: string,
  indent: number,
  blockScalarIndent: number,
): boolean {
  return line.trim().length === 0 || indent > blockScalarIndent;
}

/** Mutable per-document scan state threaded through {@link scanLine}. */
interface ScanState {
  stack: KeyStackEntry[];
  blockScalarIndent: number | null;
}

/**
 * Advance the ancestor-stack scan by one line, mutating `state` in place, and
 * return the key-path open once this line has been processed. Lines inside a
 * block-scalar body are never parsed as keys -- they just inherit the path.
 */
function scanLine(state: ScanState, line: string): string | undefined {
  const indent = leadingSpaces(line);

  if (state.blockScalarIndent !== null) {
    if (isBlockScalarContinuation(line, indent, state.blockScalarIndent)) {
      return stackPath(state.stack);
    }
    state.blockScalarIndent = null; // block-scalar body ended
  }

  const parsed = parseKeyLine(line, indent);
  if (parsed) {
    popStackTo(state.stack, indent);
    state.stack.push({ indent, key: parsed.key });
    if (BLOCK_SCALAR_RE.test(line.slice(indent))) {
      state.blockScalarIndent = indent;
    }
  }

  return stackPath(state.stack);
}

/**
 * Compute, for every line in every document, the dotted key-path of the
 * indentation ancestor stack open at that line (undefined outside any key).
 * Non-key lines (values, list items, block-scalar bodies) inherit the
 * current stack path. Resets independently per document.
 */
function computeLinePaths(lines: string[], docs: readonly DocRange[]): Array<string | undefined> {
  const paths: Array<string | undefined> = new Array(lines.length).fill(undefined);

  docs.forEach(doc => {
    const state: ScanState = { stack: [], blockScalarIndent: null };
    lines.slice(doc.startLine, doc.endLine).forEach((line, offset) => {
      paths[doc.startLine + offset] = scanLine(state, line);
    });
  });

  return paths;
}

/**
 * Build the section boundaries for one document: a preamble (if any content
 * precedes the first top-level key) plus one section per top-level key, each
 * running until the next top-level key or the document end. A document with
 * zero top-level keys (templated YAML, a top-level sequence/scalar) becomes
 * one whole-document section with no breadcrumb.
 */
function findDocSections(
  lines: string[],
  doc: DocRange,
  linePaths: Array<string | undefined>,
): Section[] {
  const topLevelKeyLines: number[] = [];
  lines.slice(doc.startLine, doc.endLine).forEach((line, offset) => {
    if (isTopLevelKeyLine(line)) topLevelKeyLines.push(doc.startLine + offset);
  });

  if (topLevelKeyLines.length === 0) {
    return [{ startLine: doc.startLine, endLine: doc.endLine, breadcrumb: undefined }];
  }

  const sections: Section[] = [];
  if (topLevelKeyLines[0] > doc.startLine) {
    sections.push({
      startLine: doc.startLine,
      endLine: topLevelKeyLines[0],
      breadcrumb: undefined,
    });
  }

  topLevelKeyLines.forEach((lineIdx, idx) => {
    const nextLine = idx + 1 < topLevelKeyLines.length ? topLevelKeyLines[idx + 1] : doc.endLine;
    sections.push({ startLine: lineIdx, endLine: nextLine, breadcrumb: linePaths[lineIdx] });
  });

  return sections;
}

/** Prefix a breadcrumb with `doc[N] ` when the file has more than one document. */
function withDocPrefix(
  breadcrumb: string | undefined,
  docCount: number,
  docNumber: number,
): string | undefined {
  if (docCount <= 1) return breadcrumb;
  return breadcrumb ? `doc[${docNumber}] ${breadcrumb}` : `doc[${docNumber}]`;
}

/**
 * Create a YAML 'config' chunk with consistent metadata.
 */
function createConfigChunk(
  content: string,
  startLine: number,
  endLine: number,
  filepath: string,
  symbolName: string | undefined,
): CodeChunk {
  return {
    content,
    metadata: {
      file: filepath,
      startLine,
      endLine,
      language: 'yaml',
      type: 'config',
      symbolName,
    },
  };
}

/**
 * Split an oversized section into overlapping line-window sub-chunks so no
 * single chunk is unbounded. Mirrors markdown-chunker's splitLargeSection;
 * each window's breadcrumb is the key-path open at its first line, falling
 * back to the section's own breadcrumb (its top-level key) when undefined.
 */
function splitLargeSection(
  lines: string[],
  section: Section,
  filepath: string,
  chunkSize: number,
  chunkOverlap: number,
  linePaths: Array<string | undefined>,
  docCount: number,
  docNumber: number,
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const sectionLines = lines.slice(section.startLine, section.endLine);
  const step = Math.max(1, chunkSize - chunkOverlap);

  for (let offset = 0; offset < sectionLines.length; offset += step) {
    const endOffset = Math.min(offset + chunkSize, sectionLines.length);
    const chunkContent = sectionLines.slice(offset, endOffset).join('\n');

    if (chunkContent.trim().length > 0) {
      const windowStartLine = section.startLine + offset;
      const breadcrumb = linePaths[windowStartLine] ?? section.breadcrumb;
      chunks.push(
        createConfigChunk(
          chunkContent,
          windowStartLine + 1,
          section.startLine + endOffset,
          filepath,
          withDocPrefix(breadcrumb, docCount, docNumber),
        ),
      );
    }

    if (endOffset >= sectionLines.length) break;
  }

  return chunks;
}

/**
 * Chunk a YAML file by top-level mapping key.
 *
 * @param filepath - File path, used as chunk metadata.
 * @param content - Raw file content.
 * @param chunkSize - Max lines per chunk before an oversized section is split
 *   into windows; also the window size used when splitting (default 75).
 * @param chunkOverlap - Line overlap between windows when splitting an
 *   oversized section (default 10).
 */
export function chunkYamlFile(
  filepath: string,
  content: string,
  chunkSize: number = 75,
  chunkOverlap: number = 10,
): CodeChunk[] {
  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
    return [];
  }

  const docs = splitDocuments(lines);
  const docCount = docs.length;
  const linePaths = computeLinePaths(lines, docs);
  const maxSectionSize = chunkSize * 3;

  return docs.flatMap((doc, docIdx) => {
    const docNumber = docIdx + 1;
    const sections = findDocSections(lines, doc, linePaths);

    return sections.flatMap(section => {
      const sectionLineCount = section.endLine - section.startLine;
      const sectionContent = lines.slice(section.startLine, section.endLine).join('\n');

      if (sectionContent.trim().length === 0) return [];

      if (sectionLineCount <= maxSectionSize) {
        return [
          createConfigChunk(
            sectionContent,
            section.startLine + 1,
            section.endLine,
            filepath,
            withDocPrefix(section.breadcrumb, docCount, docNumber),
          ),
        ];
      }

      return splitLargeSection(
        lines,
        section,
        filepath,
        chunkSize,
        chunkOverlap,
        linePaths,
        docCount,
        docNumber,
      );
    });
  });
}
