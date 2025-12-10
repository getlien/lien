import type { CodeChunk } from './types.js';

/**
 * Liquid-specific chunking for Shopify themes
 * 
 * Uses regex to identify special Liquid blocks (schema, style, javascript)
 * and keeps them as single semantic units
 */

interface LiquidBlock {
  type: 'schema' | 'style' | 'javascript';
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
 * Returns: 'My "Special" Section' (with literal quotes, unescaped)
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

/** Parameters for chunking operations */
interface ChunkParams {
  filepath: string;
  chunkSize: number;
  chunkOverlap: number;
}

/** Context for processing a file - computed once and reused */
interface ChunkContext {
  lines: string[];
  linesWithoutComments: string[];
  params: ChunkParams;
}

/**
 * Create a CodeChunk with consistent structure
 */
function createCodeChunk(
  content: string,
  startLine: number,
  endLine: number,
  filepath: string,
  type: 'block' | 'template',
  options: {
    symbolName?: string;
    symbolType?: LiquidBlock['type'];
    imports?: string[];
  } = {}
): CodeChunk {
  return {
    content,
    metadata: {
      file: filepath,
      startLine,
      endLine,
      language: 'liquid',
      type,
      symbolName: options.symbolName,
      symbolType: options.symbolType,
      imports: options.imports?.length ? options.imports : undefined,
    },
  };
}

/**
 * Split a large block into multiple chunks with overlap
 */
function splitLargeBlock(
  block: LiquidBlock,
  ctx: ChunkContext,
  symbolName: string | undefined,
  imports: string[]
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const blockLines = block.content.split('\n');
  const { chunkSize, chunkOverlap, filepath } = ctx.params;

  for (let offset = 0; offset < blockLines.length; offset += chunkSize - chunkOverlap) {
    const endOffset = Math.min(offset + chunkSize, blockLines.length);
    const chunkContent = blockLines.slice(offset, endOffset).join('\n');

    if (chunkContent.trim().length > 0) {
      chunks.push(createCodeChunk(
        chunkContent,
        block.startLine + offset + 1,
        block.startLine + endOffset,
        filepath,
        'block',
        { symbolName, symbolType: block.type, imports }
      ));
    }

    if (endOffset >= blockLines.length) break;
  }

  return chunks;
}

/**
 * Create chunks from a special Liquid block (schema, style, javascript)
 * Returns the chunks and marks covered lines
 */
function processSpecialBlock(
  block: LiquidBlock,
  ctx: ChunkContext,
  coveredLines: Set<number>
): CodeChunk[] {
  // Mark lines as covered
  for (let i = block.startLine; i <= block.endLine; i++) {
    coveredLines.add(i);
  }

  // Extract metadata
  const symbolName = block.type === 'schema' ? extractSchemaName(block.content) : undefined;

  // Extract imports from cleaned content
  const blockContentWithoutComments = ctx.linesWithoutComments
    .slice(block.startLine, block.endLine + 1)
    .join('\n');
  const imports = extractRenderTags(blockContentWithoutComments);

  const blockLineCount = block.endLine - block.startLine + 1;
  const maxBlockSize = ctx.params.chunkSize * 3;

  // Keep small blocks as single chunk, split large ones
  if (blockLineCount <= maxBlockSize) {
    return [createCodeChunk(
      block.content,
      block.startLine + 1,
      block.endLine + 1,
      ctx.params.filepath,
      'block',
      { symbolName, symbolType: block.type, imports }
    )];
  }

  return splitLargeBlock(block, ctx, symbolName, imports);
}

/**
 * Create a template chunk from accumulated lines
 */
function flushTemplateChunk(
  currentChunk: string[],
  chunkStartLine: number,
  endLine: number,
  ctx: ChunkContext
): CodeChunk | null {
  if (currentChunk.length === 0) return null;

  const chunkContent = currentChunk.join('\n');
  if (chunkContent.trim().length === 0) return null;

  const cleanedChunk = ctx.linesWithoutComments.slice(chunkStartLine, endLine).join('\n');
  const imports = extractRenderTags(cleanedChunk);

  return createCodeChunk(
    chunkContent,
    chunkStartLine + 1,
    endLine,
    ctx.params.filepath,
    'template',
    { imports }
  );
}

/**
 * Process uncovered template content into chunks
 */
function processTemplateContent(
  ctx: ChunkContext,
  coveredLines: Set<number>
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const { lines, params } = ctx;
  const { chunkSize, chunkOverlap } = params;

  let currentChunk: string[] = [];
  let chunkStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    // Skip lines covered by special blocks
    if (coveredLines.has(i)) {
      const chunk = flushTemplateChunk(currentChunk, chunkStartLine, i, ctx);
      if (chunk) chunks.push(chunk);
      currentChunk = [];
      continue;
    }

    // Start new chunk if needed
    if (currentChunk.length === 0) {
      chunkStartLine = i;
    }

    currentChunk.push(lines[i]);

    // Flush if chunk is full
    if (currentChunk.length >= chunkSize) {
      const chunk = flushTemplateChunk(currentChunk, chunkStartLine, i + 1, ctx);
      if (chunk) chunks.push(chunk);

      // Add overlap for next chunk
      currentChunk = currentChunk.slice(-chunkOverlap);
      chunkStartLine = Math.max(0, i + 1 - chunkOverlap);
    }
  }

  // Flush remaining chunk
  const finalChunk = flushTemplateChunk(currentChunk, chunkStartLine, lines.length, ctx);
  if (finalChunk) chunks.push(finalChunk);

  return chunks;
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
  // Build context once for reuse across helpers
  const contentWithoutComments = removeComments(content);
  const ctx: ChunkContext = {
    lines: content.split('\n'),
    linesWithoutComments: contentWithoutComments.split('\n'),
    params: { filepath, chunkSize, chunkOverlap },
  };

  // Find special blocks and track covered lines
  const blocks = findLiquidBlocks(content);
  const coveredLines = new Set<number>();

  // Process special blocks
  const blockChunks = blocks.flatMap(block => processSpecialBlock(block, ctx, coveredLines));

  // Process uncovered template content
  const templateChunks = processTemplateContent(ctx, coveredLines);

  // Combine and sort by line number
  return [...blockChunks, ...templateChunks].sort((a, b) => a.metadata.startLine - b.metadata.startLine);
}

