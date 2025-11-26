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
 * 
 * Extracts the "name" field from Shopify schema JSON.
 * Uses JSON.parse to properly handle escaped quotes and other JSON edge cases.
 * 
 * Example:
 * {% schema %}
 * {
 *   "name": "My \"Special\" Section",
 *   "settings": []
 * }
 * {% endschema %}
 * 
 * Returns: "My \"Special\" Section" (with quotes preserved)
 */
function extractSchemaName(schemaContent: string): string | undefined {
  try {
    // Remove Liquid tags to isolate JSON content
    // Replace {% schema %} and {% endschema %} (with optional whitespace control)
    let jsonContent = schemaContent
      .replace(/\{%-?\s*schema\s*-?%\}/g, '')
      .replace(/\{%-?\s*endschema\s*-?%\}/g, '')
      .trim();
    
    // Parse the JSON
    const schema = JSON.parse(jsonContent);
    // Ensure name is a string before returning
    return typeof schema.name === 'string' ? schema.name : undefined;
  } catch (error) {
    // Invalid JSON - return undefined
    // This is acceptable: schema blocks with invalid JSON won't have names extracted
  }
  return undefined;
}

/**
 * Remove Liquid comment blocks from content to avoid extracting tags from comments
 * 
 * Example:
 * {% comment %}Don't use {% render 'old-snippet' %}{% endcomment %}
 * → (removed)
 */
function removeComments(content: string): string {
  // Remove {% comment %}...{% endcomment %} blocks (with optional whitespace control)
  return content.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
}

/**
 * Extract dependencies from {% render %}, {% include %}, and {% section %} tags
 * 
 * Examples:
 * - {% render 'product-card' %} → 'product-card'
 * - {% render "cart-item", product: product %} → 'cart-item'
 * - {% include 'snippets/header' %} → 'snippets/header'
 * - {% section 'announcement-bar' %} → 'announcement-bar'
 * 
 * Limitations:
 * - Does not handle escaped quotes in snippet names (e.g., {% render 'name\'s' %})
 * - This is acceptable because Shopify snippet names map to filenames, and
 *   filesystem restrictions prevent quotes in filenames (snippets/name's.liquid is invalid)
 * - In practice, Shopify snippet names use only alphanumeric, dash, and underscore
 * 
 * Note: Expects content with comments already removed for performance
 * 
 * @param contentWithoutComments - Content with Liquid comments already removed
 */
function extractRenderTags(contentWithoutComments: string): string[] {
  const dependencies = new Set<string>();
  
  // Match {% render 'snippet-name' %} or {% render "snippet-name" %}
  // Note: Does not handle escaped quotes - see function docs for rationale
  const renderPattern = /\{%-?\s*render\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = renderPattern.exec(contentWithoutComments)) !== null) {
    dependencies.add(match[1]);
  }
  
  // Match {% include 'snippet-name' %} or {% include "snippet-name" %}
  const includePattern = /\{%-?\s*include\s+['"]([^'"]+)['"]/g;
  
  while ((match = includePattern.exec(contentWithoutComments)) !== null) {
    dependencies.add(match[1]);
  }
  
  // Match {% section 'section-name' %} or {% section "section-name" %}
  const sectionPattern = /\{%-?\s*section\s+['"]([^'"]+)['"]/g;
  
  while ((match = sectionPattern.exec(contentWithoutComments)) !== null) {
    dependencies.add(match[1]);
  }
  
  return Array.from(dependencies);
}

/**
 * Find all special Liquid blocks in the template
 * 
 * Limitation: Does not support nested blocks of the same type.
 * - Matches first start tag with first end tag
 * - This is acceptable because Shopify Liquid does not allow nested blocks
 * - Example invalid: {% schema %}...{% schema %}...{% endschema %} (Shopify rejects this)
 * - If malformed input contains nested blocks, only outermost block is extracted
 */
function findLiquidBlocks(content: string): LiquidBlock[] {
  const lines = content.split('\n');
  const blocks: LiquidBlock[] = [];
  
  // Regex patterns for Liquid blocks
  // Note: Matches first start → first end (no nesting support, which is correct for Shopify)
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
      
      // Find end tag (allow same line for single-line blocks)
      const endIdx = lines.findIndex((line, idx) => 
        idx >= startIdx && pattern.end.test(line)
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
 * - {% render %}, {% include %}, and {% section %} tags (tracked as imports)
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
  
  // Remove comments once for performance (avoids repeated regex operations)
  const contentWithoutComments = removeComments(content);
  const linesWithoutComments = contentWithoutComments.split('\n');
  
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
    
    // Extract render/include tags from cleaned content (comments already removed)
    const blockContentWithoutComments = linesWithoutComments
      .slice(block.startLine, block.endLine + 1)
      .join('\n');
    const imports = extractRenderTags(blockContentWithoutComments);
    
    const blockLineCount = block.endLine - block.startLine + 1;
    const maxBlockSize = chunkSize * 3; // Allow blocks up to 3x chunk size before splitting
    
    // If block is reasonably sized, keep it as one chunk
    if (blockLineCount <= maxBlockSize) {
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
    } else {
      // Block is too large - split it into multiple chunks with overlap
      const blockLines = block.content.split('\n');
      
      for (let offset = 0; offset < blockLines.length; offset += chunkSize - chunkOverlap) {
        const endOffset = Math.min(offset + chunkSize, blockLines.length);
        const chunkContent = blockLines.slice(offset, endOffset).join('\n');
        
        if (chunkContent.trim().length > 0) {
          chunks.push({
            content: chunkContent,
            metadata: {
              file: filepath,
              startLine: block.startLine + offset + 1, // 1-indexed
              endLine: block.startLine + endOffset, // 1-indexed (endOffset already accounts for exclusivity)
              language: 'liquid',
              type: 'block',
              symbolName, // Preserve symbol name for all split chunks
              symbolType: block.type,
              imports: imports.length > 0 ? imports : undefined,
            },
          });
        }
        
        if (endOffset >= blockLines.length) break;
      }
    }
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
        
        // Only push non-empty chunks
        if (chunkContent.trim().length > 0) {
          // Extract from cleaned content (comments already removed)
          const cleanedChunk = linesWithoutComments.slice(chunkStartLine, i).join('\n');
          const imports = extractRenderTags(cleanedChunk);
          
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
        }
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
      
      // Only push non-empty chunks
      if (chunkContent.trim().length > 0) {
        // Extract from cleaned content (comments already removed)
        const cleanedChunk = linesWithoutComments.slice(chunkStartLine, i + 1).join('\n');
        const imports = extractRenderTags(cleanedChunk);
        
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
      }
      
      // Add overlap for next chunk
      currentChunk = currentChunk.slice(-chunkOverlap);
      chunkStartLine = Math.max(0, i + 1 - chunkOverlap);
    }
  }
  
  // Flush remaining chunk
  if (currentChunk.length > 0) {
    const chunkContent = currentChunk.join('\n');
    
    // Skip empty or whitespace-only chunks
    if (chunkContent.trim().length === 0) {
      return chunks.sort((a, b) => a.metadata.startLine - b.metadata.startLine);
    }
    
    // Extract from cleaned content (comments already removed)
    const cleanedChunk = linesWithoutComments.slice(chunkStartLine, lines.length).join('\n');
    const imports = extractRenderTags(cleanedChunk);
    
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

