import type { CodeChunk } from './types.js';

/**
 * Shopify JSON template chunking
 *
 * JSON template files define which sections appear on a template page.
 * We extract section references to track dependencies.
 *
 * Example structure:
 * {
 *   "sections": {
 *     "main": { "type": "main-product", "settings": {...} },
 *     "recommendations": { "type": "product-recommendations", "settings": {...} }
 *   },
 *   "order": ["main", "recommendations"]
 * }
 */

/**
 * Extract section types from a Shopify JSON template
 *
 * These are the actual section file names (e.g., "main-product" → sections/main-product.liquid)
 */
function extractSectionReferences(jsonContent: string): string[] {
  try {
    const template = JSON.parse(jsonContent);
    const sectionTypes = new Set<string>();

    // Extract from sections object
    if (template.sections && typeof template.sections === 'object') {
      for (const section of Object.values(template.sections)) {
        if (
          typeof section === 'object' &&
          section !== null &&
          'type' in section &&
          typeof section.type === 'string'
        ) {
          sectionTypes.add(section.type);
        }
      }
    }

    return Array.from(sectionTypes);
  } catch (error) {
    // Invalid JSON - return empty array
    console.warn(
      `[Lien] Failed to parse JSON template: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Extract the template name from the filepath
 *
 * templates/customers/account.json → "customers/account"
 * templates/product.json → "product"
 */
function extractTemplateName(filepath: string): string | undefined {
  // Match everything after templates/ up to .json
  const match = filepath.match(/templates\/(.+)\.json$/);
  return match ? match[1] : undefined;
}

/**
 * Chunk a Shopify JSON template file
 *
 * JSON templates are typically small (define section layout),
 * so we keep them as a single chunk and extract section references.
 */
export function chunkJSONTemplate(
  filepath: string,
  content: string,
  tenantContext?: { repoId?: string; orgId?: string },
): CodeChunk[] {
  // Skip empty files
  if (content.trim().length === 0) {
    return [];
  }

  const lines = content.split('\n');
  const templateName = extractTemplateName(filepath);
  const sectionReferences = extractSectionReferences(content);

  return [
    {
      content,
      metadata: {
        file: filepath,
        startLine: 1,
        endLine: lines.length,
        language: 'json',
        type: 'template',
        symbolName: templateName,
        symbolType: 'template',
        imports: sectionReferences.length > 0 ? sectionReferences : undefined,
        ...(tenantContext?.repoId && { repoId: tenantContext.repoId }),
        ...(tenantContext?.orgId && { orgId: tenantContext.orgId }),
      },
    },
  ];
}
