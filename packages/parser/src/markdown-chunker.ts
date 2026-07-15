import type { CodeChunk } from './types.js';

/**
 * Markdown-specific chunking
 *
 * Splits Markdown/MDX files by ATX heading section (`#`..`######`) instead of
 * the generic fixed-size line window, so `search_code` can retrieve a
 * coherent section (e.g. a README's "Install" instructions) rather than an
 * arbitrary 75-line slice.
 *
 * Rules:
 * - Each ATX heading starts a new section that runs until the next heading of
 *   ANY level (or EOF).
 * - Lines inside fenced code blocks (``` or ~~~) are never treated as
 *   headings, even if they start with `#`.
 * - A leading YAML front-matter block (`---` ... `---`) is skipped for
 *   heading detection and folded into the preamble.
 * - Content before the first heading (including front-matter) becomes its
 *   own "preamble" chunk with no breadcrumb.
 * - `metadata.symbolName` carries the heading breadcrumb built from the full
 *   ancestor chain, e.g. "Docs > Install > Requirements".
 * - Sections larger than `chunkSize * 3` lines are split into overlapping
 *   line-window sub-chunks (mirrors liquid-chunker's splitLargeBlock),
 *   preserving the breadcrumb on every piece.
 */

interface HeadingMatch {
  level: number;
  text: string;
}

/** A contiguous line range (0-based, `endLine` exclusive) with its heading breadcrumb. */
interface Section {
  startLine: number;
  endLine: number;
  breadcrumb: string | undefined;
}

// Fence delimiter: up to 3 leading spaces, then 3+ backticks or 3+ tildes.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
// ATX heading: up to 3 leading spaces, 1-6 '#', then whitespace + text (or end of line).
const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*))?$/;

/** Parse a single line as an ATX heading, or return null if it isn't one. */
function parseHeading(line: string): HeadingMatch | null {
  const match = ATX_HEADING_RE.exec(line);
  if (!match) return null;

  const level = match[1].length;
  // Strip an optional closing hash sequence, e.g. "## Title ##" -> "Title".
  const text = (match[2] ?? '').trim().replace(/\s+#+\s*$/, '');
  return { level, text };
}

/**
 * Compute, for each line, whether it falls inside a fenced code block
 * (including the fence delimiter lines themselves).
 */
function computeFenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  let fenceChar: string | null = null;
  let fenceLen = 0;

  lines.forEach((line, i) => {
    const match = FENCE_RE.exec(line);

    if (fenceChar) {
      mask[i] = true;
      if (match && match[1][0] === fenceChar && match[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      return;
    }

    if (match) {
      fenceChar = match[1][0];
      fenceLen = match[1].length;
      mask[i] = true;
    }
  });

  return mask;
}

/**
 * Find the end (0-based, exclusive) of a leading YAML front-matter block, or
 * 0 if the file has none (or the block is unterminated).
 */
function frontMatterEnd(lines: string[]): number {
  if (lines.length === 0 || lines[0].trim() !== '---') return 0;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 1;
  }

  return 0;
}

/** A heading found outside front-matter and fenced code, with its line number. */
interface HeadingLine {
  line: number;
  heading: HeadingMatch;
}

/**
 * Find every real ATX heading in the file: skips lines inside the leading
 * front-matter block and lines inside fenced code blocks.
 */
function extractHeadingLines(lines: string[], fenceMask: boolean[], fmEnd: number): HeadingLine[] {
  const headingLines: HeadingLine[] = [];
  lines.forEach((line, i) => {
    if (i < fmEnd || fenceMask[i]) return;
    const heading = parseHeading(line);
    if (heading) headingLines.push({ line: i, heading });
  });
  return headingLines;
}

/**
 * Turn the flat list of headings into sections, tracking an ancestor stack
 * so each section's breadcrumb includes every enclosing heading level.
 */
function buildHeadingSections(lines: string[], headingLines: HeadingLine[]): Section[] {
  const stack: HeadingMatch[] = [];

  return headingLines.map(({ line, heading }, idx) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);

    const nextLine = idx + 1 < headingLines.length ? headingLines[idx + 1].line : lines.length;
    const breadcrumb = stack
      .map(h => h.text)
      .filter(Boolean)
      .join(' > ');

    return {
      startLine: line,
      endLine: nextLine,
      breadcrumb: breadcrumb.length > 0 ? breadcrumb : undefined,
    };
  });
}

/**
 * Build the section boundaries for a markdown file: a preamble (if any
 * content precedes the first heading) plus one section per heading, each
 * running until the next heading of any level.
 */
function findSections(lines: string[]): Section[] {
  const fenceMask = computeFenceMask(lines);
  const fmEnd = frontMatterEnd(lines);
  const headingLines = extractHeadingLines(lines, fenceMask, fmEnd);

  const sections: Section[] = [];

  // Preamble: everything before the first heading (front-matter included).
  const firstHeadingLine = headingLines.length > 0 ? headingLines[0].line : lines.length;
  if (firstHeadingLine > 0) {
    sections.push({ startLine: 0, endLine: firstHeadingLine, breadcrumb: undefined });
  }

  sections.push(...buildHeadingSections(lines, headingLines));

  return sections;
}

/**
 * Create a markdown 'doc' chunk with consistent metadata.
 */
function createDocChunk(
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
      language: 'markdown',
      type: 'doc',
      symbolName,
    },
  };
}

/**
 * Split an oversized section into overlapping line-window sub-chunks so no
 * single chunk is unbounded. Mirrors liquid-chunker's splitLargeBlock, and
 * preserves the section's breadcrumb across every piece.
 */
function splitLargeSection(
  lines: string[],
  section: Section,
  filepath: string,
  chunkSize: number,
  chunkOverlap: number,
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const sectionLines = lines.slice(section.startLine, section.endLine);
  const step = Math.max(1, chunkSize - chunkOverlap);

  for (let offset = 0; offset < sectionLines.length; offset += step) {
    const endOffset = Math.min(offset + chunkSize, sectionLines.length);
    const chunkContent = sectionLines.slice(offset, endOffset).join('\n');

    if (chunkContent.trim().length > 0) {
      chunks.push(
        createDocChunk(
          chunkContent,
          section.startLine + offset + 1,
          section.startLine + endOffset,
          filepath,
          section.breadcrumb,
        ),
      );
    }

    if (endOffset >= sectionLines.length) break;
  }

  return chunks;
}

/**
 * Chunk a Markdown/MDX file by heading section.
 *
 * @param filepath - File path, used as chunk metadata and for symbol context.
 * @param content - Raw file content.
 * @param chunkSize - Max lines per chunk before an oversized section is split
 *   into windows; also the window size used when splitting (default 75).
 * @param chunkOverlap - Line overlap between windows when splitting an
 *   oversized section (default 10).
 */
export function chunkMarkdownFile(
  filepath: string,
  content: string,
  chunkSize: number = 75,
  chunkOverlap: number = 10,
): CodeChunk[] {
  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
    return [];
  }

  const sections = findSections(lines);
  const maxSectionSize = chunkSize * 3;

  return sections.flatMap(section => {
    const sectionLineCount = section.endLine - section.startLine;
    const sectionContent = lines.slice(section.startLine, section.endLine).join('\n');

    if (sectionContent.trim().length === 0) return [];

    if (sectionLineCount <= maxSectionSize) {
      return [
        createDocChunk(
          sectionContent,
          section.startLine + 1,
          section.endLine,
          filepath,
          section.breadcrumb,
        ),
      ];
    }

    return splitLargeSection(lines, section, filepath, chunkSize, chunkOverlap);
  });
}
