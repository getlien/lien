import { CodeChunk } from './types.js';
import { detectFileType } from './scanner.js';
import { extractSymbols } from './symbol-extractor.js';
import { shouldUseAST, chunkByAST } from './ast/chunker.js';
import { chunkLiquidFile } from './liquid-chunker.js';
import { chunkJSONTemplate } from './json-template-chunker.js';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  useAST?: boolean; // Flag to enable AST-based chunking
  astFallback?: 'line-based' | 'error'; // How to handle AST parsing errors
  // Multi-tenant fields (optional for backward compatibility)
  repoId?: string; // Repository identifier for multi-tenant scenarios
  orgId?: string;  // Organization identifier for multi-tenant scenarios
}

export function chunkFile(
  filepath: string,
  content: string,
  options: ChunkOptions = {}
): CodeChunk[] {
  const { chunkSize = 75, chunkOverlap = 10, useAST = true, astFallback = 'line-based', repoId, orgId } = options;
  
  // Special handling for Liquid files
  if (filepath.endsWith('.liquid')) {
    return chunkLiquidFile(filepath, content, chunkSize, chunkOverlap, { repoId, orgId });
  }
  
  // Special handling for Shopify JSON template files (templates/**/*.json)
  // Use regex to ensure 'templates/' is a path segment, not part of another name
  // Matches: templates/product.json OR some-path/templates/customers/account.json
  // Rejects: my-templates/config.json OR node_modules/pkg/templates/file.json (filtered by scanner)
  if (filepath.endsWith('.json') && /(?:^|\/)templates\//.test(filepath)) {
    return chunkJSONTemplate(filepath, content, { repoId, orgId });
  }
  
  // Try AST-based chunking for supported languages
  if (useAST && shouldUseAST(filepath)) {
    try {
      return chunkByAST(filepath, content, {
        minChunkSize: Math.floor(chunkSize / 10),
        repoId,
        orgId,
      });
    } catch (error) {
      // Handle AST errors based on configuration
      if (astFallback === 'error') {
        // Throw error if user wants strict AST-only behavior
        throw new Error(`AST chunking failed for ${filepath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Otherwise fallback to line-based chunking
      console.warn(`AST chunking failed for ${filepath}, falling back to line-based:`, error);
    }
  }
  
  // Line-based chunking (original implementation)
  return chunkByLines(filepath, content, chunkSize, chunkOverlap, { repoId, orgId });
}

/**
 * Original line-based chunking implementation
 */
function chunkByLines(
  filepath: string,
  content: string,
  chunkSize: number,
  chunkOverlap: number,
  tenantContext?: { repoId?: string; orgId?: string }
): CodeChunk[] {
  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];
  const fileType = detectFileType(filepath);

  // Handle empty files
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
    return chunks;
  }

  // Chunk by lines with overlap
  for (let i = 0; i < lines.length; i += chunkSize - chunkOverlap) {
    const endLine = Math.min(i + chunkSize, lines.length);
    const chunkLines = lines.slice(i, endLine);
    const chunkContent = chunkLines.join('\n');

    // Skip empty chunks
    if (chunkContent.trim().length === 0) {
      continue;
    }

    // Extract symbols from the chunk
    const symbols = extractSymbols(chunkContent, fileType);

    chunks.push({
      content: chunkContent,
      metadata: {
        file: filepath,
        startLine: i + 1,
        endLine: endLine,
        type: 'block', // MVP: all chunks are 'block' type
        language: fileType,
        symbols,
        ...(tenantContext?.repoId && { repoId: tenantContext.repoId }),
        ...(tenantContext?.orgId && { orgId: tenantContext.orgId }),
      },
    });
    
    // If we've reached the end, break
    if (endLine >= lines.length) {
      break;
    }
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

