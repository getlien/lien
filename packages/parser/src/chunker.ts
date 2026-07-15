import type { CodeChunk } from './types.js';
import { detectFileType } from './scanner.js';
import { extractSymbols } from './symbol-extractor.js';
import { shouldUseAST, chunkByAST } from './ast/chunker.js';
import { NativeBindingLoadError } from './ast/parser.js';
import { chunkLiquidFile } from './liquid-chunker.js';
import { chunkJSONTemplate } from './json-template-chunker.js';
import { chunkMarkdownFile } from './markdown-chunker.js';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  useAST?: boolean; // Flag to enable AST-based chunking
  astFallback?: 'line-based' | 'error'; // How to handle per-file AST parsing errors.
  // Does NOT govern a NativeBindingLoadError (missing/unloadable native
  // parser binding) -- that is a systemic, process-wide failure and always
  // propagates regardless of this setting; see ast/parser.ts.
  /**
   * Absolute path to the workspace/monorepo root. Enables cross-package
   * import resolution for JS/TS monorepos — see `ASTChunkOptions.workspaceRoot`.
   * Optional; omit for non-monorepo projects (zero behavior change).
   */
  workspaceRoot?: string;
}

/**
 * Route to a format-specific chunker for special-cased file types (Liquid,
 * Shopify JSON templates, Markdown/MDX). Returns undefined when none apply,
 * so the caller falls through to AST/line-based chunking.
 */
function chunkSpecialCase(
  filepath: string,
  content: string,
  chunkSize: number,
  chunkOverlap: number,
): CodeChunk[] | undefined {
  // Liquid files
  if (filepath.endsWith('.liquid')) {
    return chunkLiquidFile(filepath, content, chunkSize, chunkOverlap);
  }

  // Shopify JSON template files (templates/**/*.json). Regex ensures
  // 'templates/' is a path segment, not part of another name.
  // Matches: templates/product.json OR some-path/templates/customers/account.json
  // Rejects: my-templates/config.json OR node_modules/pkg/templates/file.json (filtered by scanner)
  if (filepath.endsWith('.json') && /(?:^|\/)templates\//.test(filepath)) {
    return chunkJSONTemplate(filepath, content);
  }

  // Markdown/MDX — chunk by heading section instead of a fixed-size line
  // window, so search_code retrieves a coherent section (e.g. README
  // "Install") rather than an arbitrary slice.
  if (/\.(md|mdx|markdown)$/i.test(filepath)) {
    return chunkMarkdownFile(filepath, content, chunkSize, chunkOverlap);
  }

  return undefined;
}

export function chunkFile(
  filepath: string,
  content: string,
  options: ChunkOptions = {},
): CodeChunk[] {
  const {
    chunkSize = 75,
    chunkOverlap = 10,
    useAST = true,
    astFallback = 'line-based',
    workspaceRoot,
  } = options;

  const specialCaseChunks = chunkSpecialCase(filepath, content, chunkSize, chunkOverlap);
  if (specialCaseChunks) return specialCaseChunks;

  // Try AST-based chunking for supported languages
  if (useAST && shouldUseAST(filepath)) {
    try {
      return chunkByAST(filepath, content, {
        minChunkSize: Math.floor(chunkSize / 10),
        workspaceRoot,
      });
    } catch (error) {
      // A missing/failed native parser binding is a systemic, process-wide
      // failure (ADR-013 Phase 4-B removed the legacy fallback backend),
      // not a per-file parse problem -- it must propagate regardless of
      // astFallback, or a scan on an unsupported platform would silently
      // degrade every file to a symbol-less line-based index instead of
      // failing loudly. See NativeBindingLoadError in ast/parser.ts.
      if (error instanceof NativeBindingLoadError) {
        throw error;
      }

      // Handle AST errors based on configuration
      if (astFallback === 'error') {
        // Throw error if user wants strict AST-only behavior
        throw new Error(
          `AST chunking failed for ${filepath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Otherwise fallback to line-based chunking
      console.warn(`AST chunking failed for ${filepath}, falling back to line-based:`, error);
    }
  }

  // Line-based chunking (original implementation)
  return chunkByLines(filepath, content, chunkSize, chunkOverlap);
}

/**
 * Build a single line-based code chunk with metadata
 */
function buildLineChunk(
  chunkContent: string,
  filepath: string,
  startLine: number,
  endLine: number,
  fileType: string,
): CodeChunk {
  return {
    content: chunkContent,
    metadata: {
      file: filepath,
      startLine,
      endLine,
      type: 'block',
      language: fileType,
      symbols: extractSymbols(chunkContent, fileType),
    },
  };
}

/**
 * Original line-based chunking implementation
 */
function chunkByLines(
  filepath: string,
  content: string,
  chunkSize: number,
  chunkOverlap: number,
): CodeChunk[] {
  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
    return [];
  }

  const chunks: CodeChunk[] = [];
  const fileType = detectFileType(filepath);
  const step = chunkSize - chunkOverlap;

  for (let i = 0; i < lines.length; i += step) {
    const endLine = Math.min(i + chunkSize, lines.length);
    const chunkContent = lines.slice(i, endLine).join('\n');

    if (chunkContent.trim().length > 0) {
      chunks.push(buildLineChunk(chunkContent, filepath, i + 1, endLine, fileType));
    }

    if (endLine >= lines.length) break;
  }

  return chunks;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { chunkSize = 75, chunkOverlap = 10 } = options;

  const lines = text.split('\n');
  const chunks: string[] = [];

  for (let i = 0; i < lines.length; i += chunkSize - chunkOverlap) {
    const endLine = Math.min(i + chunkSize, lines.length);
    const chunkLines = lines.slice(i, endLine);
    const chunkContent = chunkLines.join('\n');

    if (chunkContent.trim().length > 0) {
      chunks.push(chunkContent);
    }

    if (endLine >= lines.length) {
      break;
    }
  }

  return chunks;
}
