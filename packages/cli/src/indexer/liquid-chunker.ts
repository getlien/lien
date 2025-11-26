import type { CodeChunk } from './types.js';

/**
 * Liquid-specific chunking for Shopify themes
 * 
 * Uses regex to identify special Liquid blocks (schema, style, javascript)
 * and keeps them as single semantic units
 */

interface LiquidBlock {
  type: 'schema' | 'style' | 'javascript' | 'template';
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Extract schema name from JSON content
 */
function extractSchemaName(schemaContent: string): string | undefined {
  const nameMatch = schemaContent.match(/"name"\s*:\s*"([^"]+)"/);
  return nameMatch ? nameMatch[1] : undefined;
}

/**
 * Extract snippet/partial names from {% render %} and {% include %} tags
 * 
 * Examples:
 * - {% render 'product-card' %} → 'product-card'
 * - {% render "cart-item", product: product %} → 'cart-item'
 * - {% include 'snippets/header' %} → 'snippets/header'
 */
function extractRenderTags(content: string): string[] {
  const snippets = new Set<string>();
  
  // Match {% render 'snippet-name' %} or {% render "snippet-name" %}
  const renderPattern = /\{%-?\s*render\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = renderPattern.exec(content)) !== null) {
    snippets.add(match[1]);
  }
  
  // Match {% include 'snippet-name' %} or {% include "snippet-name" %}
  const includePattern = /\{%-?\s*include\s+['"]([^'"]+)['"]/g;
  
  while ((match = includePattern.exec(content)) !== null) {
    snippets.add(match[1]);
  }
  
  return Array.from(snippets);
}

/**
 * Find all special Liquid blocks in the template
 */
function findLiquidBlocks(content: string): LiquidBlock[] {
  const lines = content.split('\n');
  const blocks: LiquidBlock[] = [];
  
  // Regex patterns for Liquid blocks
  const blockPatterns = [
    { type: 'schema' as const, start: /\{%-?\s*schema\s*-?%\}/, end: /\{%-?\s*endschema\s*-?%\}/ },
    { type: 'style' as const, start: /\{%-?\s*style\s*-?%\}/, end: /\{%-?\s*endstyle\s*-?%\}/ },
    { type: 'javascript' as const, start: /\{%-?\s*javascript\s*-?%\}/, end: /\{%-?\s*endjavascript\s*-?%\}/ },
  ];
  
  for (const pattern of blockPatterns) {
    let searchStart = 0;
    
    while (searchStart < lines.length) {
      // Find start tag
      const startIdx = lines.findIndex((line, idx) => 
        idx >= searchStart && pattern.start.test(line)
      );
      
      if (startIdx === -1) break;
      
      // Find end tag
      const endIdx = lines.findIndex((line, idx) => 
        idx > startIdx && pattern.end.test(line)
      );
      
      if (endIdx === -1) {
        // No end tag found, treat rest as template
        break;
      }
      
      // Extract block content
      const blockContent = lines.slice(startIdx, endIdx + 1).join('\n');
      
      blocks.push({
        type: pattern.type,
        startLine: startIdx,
        endLine: endIdx,
        content: blockContent,
      });
      
      searchStart = endIdx + 1;
    }
  }
  
  return blocks.sort((a, b) => a.startLine - b.startLine);
}

/**
 * Chunk a Liquid template file
 * 
 * Special handling for:
 * - {% schema %} blocks (kept together, extract section name)
 * - {% style %} blocks (kept together)  
 * - {% javascript %} blocks (kept together)
 * - {% render %} and {% include %} tags (tracked as imports)
 * - Regular template content (chunked by lines)
 */
export function chunkLiquidFile(
  filepath: string,
  content: string,
  chunkSize: number = 75,
  chunkOverlap: number = 10
): CodeChunk[] {
  const lines = content.split('\n');
  const blocks = findLiquidBlocks(content);
  const chunks: CodeChunk[] = [];
  
  // Track which lines are covered by special blocks
  const coveredLines = new Set<number>();
  
  // Create chunks for special blocks
  for (const block of blocks) {
    // Mark lines as covered
    for (let i = block.startLine; i <= block.endLine; i++) {
      coveredLines.add(i);
    }
    
    // Extract metadata
    let symbolName: string | undefined;
    if (block.type === 'schema') {
      symbolName = extractSchemaName(block.content);
    }
    
    // Extract render/include tags
    const imports = extractRenderTags(block.content);
    
    chunks.push({
      content: block.content,
      metadata: {
        file: filepath,
        startLine: block.startLine + 1, // 1-indexed
        endLine: block.endLine + 1,
        language: 'liquid',
        type: 'block',
        symbolName,
        symbolType: block.type,
        imports: imports.length > 0 ? imports : undefined,
      },
    });
  }
  
  // Chunk uncovered template content
  let currentChunk: string[] = [];
  let chunkStartLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    // Skip lines covered by special blocks
    if (coveredLines.has(i)) {
      // Flush current chunk if any
      if (currentChunk.length > 0) {
        const chunkContent = currentChunk.join('\n');
        const imports = extractRenderTags(chunkContent);
        
        chunks.push({
          content: chunkContent,
          metadata: {
            file: filepath,
            startLine: chunkStartLine + 1,
            endLine: i,
            language: 'liquid',
            type: 'template',
            imports: imports.length > 0 ? imports : undefined,
          },
        });
        currentChunk = [];
      }
      continue;
    }
    
    // Start new chunk if needed
    if (currentChunk.length === 0) {
      chunkStartLine = i;
    }
    
    currentChunk.push(lines[i]);
    
    // Flush if chunk is full
    if (currentChunk.length >= chunkSize) {
      const chunkContent = currentChunk.join('\n');
      const imports = extractRenderTags(chunkContent);
      
      chunks.push({
        content: chunkContent,
        metadata: {
          file: filepath,
          startLine: chunkStartLine + 1,
          endLine: i + 1,
          language: 'liquid',
          type: 'template',
          imports: imports.length > 0 ? imports : undefined,
        },
      });
      
      // Add overlap for next chunk
      currentChunk = currentChunk.slice(-chunkOverlap);
      chunkStartLine = i + 1 - chunkOverlap;
    }
  }
  
  // Flush remaining chunk
  if (currentChunk.length > 0) {
    const chunkContent = currentChunk.join('\n');
    const imports = extractRenderTags(chunkContent);
    
    chunks.push({
      content: chunkContent,
      metadata: {
        file: filepath,
        startLine: chunkStartLine + 1,
        endLine: lines.length,
        language: 'liquid',
        type: 'template',
        imports: imports.length > 0 ? imports : undefined,
      },
    });
  }
  
  // Sort by line number
  return chunks.sort((a, b) => a.metadata.startLine - b.metadata.startLine);
}

