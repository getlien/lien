import { CodeChunk } from './types.js';
import { detectLanguage } from './scanner.js';
import { extractSymbols } from './symbol-extractor.js';
import { shouldUseAST, chunkByAST } from './ast/chunker.js';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  useAST?: boolean; // Flag to enable AST-based chunking
}

export function chunkFile(
  filepath: string,
  content: string,
  options: ChunkOptions = {}
): CodeChunk[] {
  const { chunkSize = 75, chunkOverlap = 10, useAST = true } = options;
  
  // Try AST-based chunking for supported languages
  if (useAST && shouldUseAST(filepath)) {
    try {
      return chunkByAST(filepath, content, {
        minChunkSize: Math.floor(chunkSize / 10),
      });
    } catch (error) {
      // Fallback to line-based chunking on AST errors
      console.warn(`AST chunking failed for ${filepath}, falling back to line-based:`, error);
    }
  }
  
  // Line-based chunking (original implementation)
  return chunkByLines(filepath, content, chunkSize, chunkOverlap);
}

/**
 * Original line-based chunking implementation
 */
function chunkByLines(
  filepath: string,
  content: string,
  chunkSize: number,
  chunkOverlap: number
): CodeChunk[] {
  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];
  const language = detectLanguage(filepath);
  
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
    const symbols = extractSymbols(chunkContent, language);
    
    chunks.push({
      content: chunkContent,
      metadata: {
        file: filepath,
        startLine: i + 1,
        endLine: endLine,
        type: 'block', // MVP: all chunks are 'block' type
        language,
        symbols,
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

