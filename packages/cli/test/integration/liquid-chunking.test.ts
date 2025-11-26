import { describe, it, expect } from 'vitest';
import { chunkFile } from '../../src/indexer/chunker.js';

describe('Liquid Chunking (Regex-based)', () => {
  it('should keep schema blocks together as single chunk', () => {
    const content = `
<div class="container">
  {{ product.title }}
</div>

{% schema %}
{
  "name": "USPS Multicolumn",
  "settings": [
    {
      "type": "text",
      "id": "title"
    }
  ],
  "blocks": []
}
{% endschema %}

<div>More template</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    // Should have at least 2 chunks: template before schema, schema block, template after
    expect(chunks.length).toBeGreaterThan(0);
    
    // Find the schema chunk
    const schemaChunk = chunks.find(c => c.content.includes('{% schema %}'));
    expect(schemaChunk).toBeDefined();
    expect(schemaChunk?.metadata.symbolType).toBe('schema');
    expect(schemaChunk?.metadata.symbolName).toBe('USPS Multicolumn');
    
    // Schema block should be a single chunk
    expect(schemaChunk?.content).toContain('{% schema %}');
    expect(schemaChunk?.content).toContain('{% endschema %}');
  });
  
  it('should keep style blocks together', () => {
    const content = `
<div>Content</div>

{% style %}
.container {
  background: red;
  padding: 20px;
}
{% endstyle %}

<div>More content</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const styleChunk = chunks.find(c => c.content.includes('{% style %}'));
    expect(styleChunk).toBeDefined();
    expect(styleChunk?.metadata.symbolType).toBe('style');
    expect(styleChunk?.content).toContain('.container');
  });
  
  it('should keep javascript blocks together', () => {
    const content = `
<div>Content</div>

{% javascript %}
function init() {
  console.log('Section initialized');
  setupEventListeners();
}
{% endjavascript %}

<div>More content</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const jsChunk = chunks.find(c => c.content.includes('{% javascript %}'));
    expect(jsChunk).toBeDefined();
    expect(jsChunk?.metadata.symbolType).toBe('javascript');
    expect(jsChunk?.content).toContain('console.log');
  });
  
  it('should chunk template content normally', () => {
    const content = `
<div>{{ product.title }}</div>
{% if product.available %}
  <span>Available</span>
{% endif %}
{{ product.description }}
`.trim();
    
    const chunks = chunkFile('snippets/test.liquid', content);
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('liquid');
    expect(chunks[0].metadata.type).toBe('template');
  });
  
  it('should handle multiple schema and style blocks', () => {
    const content = `
{% schema %}
{"name": "Header"}
{% endschema %}

<div>Template</div>

{% style %}
.header { color: blue; }
{% endstyle %}

<div>More template</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const schemaChunks = chunks.filter(c => c.metadata.symbolType === 'schema');
    const styleChunks = chunks.filter(c => c.metadata.symbolType === 'style');
    
    expect(schemaChunks.length).toBe(1);
    expect(styleChunks.length).toBe(1);
  });

  it('should handle schema without name field', () => {
    const content = `
{% schema %}
{
  "settings": [],
  "blocks": []
}
{% endschema %}
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const schemaChunk = chunks.find(c => c.metadata.symbolType === 'schema');
    expect(schemaChunk).toBeDefined();
    expect(schemaChunk?.metadata.symbolName).toBeUndefined();
  });

  it('should handle schema with invalid JSON gracefully', () => {
    const content = `
{% schema %}
{
  "name": "Test Section
  invalid json here
}
{% endschema %}
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const schemaChunk = chunks.find(c => c.metadata.symbolType === 'schema');
    expect(schemaChunk).toBeDefined();
    expect(schemaChunk?.metadata.symbolName).toBeUndefined(); // Should not crash
  });

  it('should handle all three special blocks in one file', () => {
    const content = `
<div>Header template</div>

{% schema %}
{
  "name": "Complex Section",
  "settings": []
}
{% endschema %}

<div>Middle template</div>

{% style %}
.section { padding: 20px; }
{% endstyle %}

<div>More template</div>

{% javascript %}
console.log('loaded');
{% endjavascript %}

<div>Footer template</div>
`.trim();
    
    const chunks = chunkFile('sections/complex.liquid', content);
    
    expect(chunks.length).toBeGreaterThan(3); // At least the 3 special blocks + template chunks
    
    const schemaChunk = chunks.find(c => c.metadata.symbolType === 'schema');
    const styleChunk = chunks.find(c => c.metadata.symbolType === 'style');
    const jsChunk = chunks.find(c => c.metadata.symbolType === 'javascript');
    
    expect(schemaChunk).toBeDefined();
    expect(styleChunk).toBeDefined();
    expect(jsChunk).toBeDefined();
    
    // Verify they're in order
    const schemaIdx = chunks.indexOf(schemaChunk!);
    const styleIdx = chunks.indexOf(styleChunk!);
    const jsIdx = chunks.indexOf(jsChunk!);
    
    expect(schemaIdx).toBeLessThan(styleIdx);
    expect(styleIdx).toBeLessThan(jsIdx);
  });

  it('should handle snippets without special blocks', () => {
    const content = `
{% comment %}
  Snippet: product-card
  Usage: {% render 'product-card', product: product %}
{% endcomment %}

<div class="product-card">
  <h3>{{ product.title }}</h3>
  <p>{{ product.price }}</p>
  {% if product.available %}
    <button>Add to Cart</button>
  {% endif %}
</div>
`.trim();
    
    const chunks = chunkFile('snippets/product-card.liquid', content);
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.metadata.language === 'liquid')).toBe(true);
    expect(chunks.every(c => c.metadata.type === 'template')).toBe(true);
    
    // Should not have any special block types
    expect(chunks.some(c => c.metadata.symbolType === 'schema')).toBe(false);
    expect(chunks.some(c => c.metadata.symbolType === 'style')).toBe(false);
    expect(chunks.some(c => c.metadata.symbolType === 'javascript')).toBe(false);
  });

  it('should respect line numbers correctly', () => {
    const content = `Line 1
Line 2
{% schema %}
Line 4
Line 5
{% endschema %}
Line 7`;
    
    const chunks = chunkFile('test.liquid', content);
    
    const schemaChunk = chunks.find(c => c.metadata.symbolType === 'schema');
    expect(schemaChunk?.metadata.startLine).toBe(3);
    expect(schemaChunk?.metadata.endLine).toBe(6);
  });

  it('should track {% render %} tags as imports', () => {
    const content = `
<div class="header">
  {% render 'logo' %}
  {% render "navigation", menu: main_menu %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/header.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toBeDefined();
    expect(templateChunk?.metadata.imports).toContain('logo');
    expect(templateChunk?.metadata.imports).toContain('navigation');
  });

  it('should track {% include %} tags as imports', () => {
    const content = `
<div class="product">
  {% include 'product-price' %}
  {% include "product-availability", product: product %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/product.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toBeDefined();
    expect(templateChunk?.metadata.imports).toContain('product-price');
    expect(templateChunk?.metadata.imports).toContain('product-availability');
  });

  it('should track both render and include tags together', () => {
    const content = `
<div class="cart">
  {% render 'cart-item', item: item %}
  {% include 'cart-total' %}
</div>
`.trim();
    
    const chunks = chunkFile('snippets/cart.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('cart-item');
    expect(templateChunk?.metadata.imports).toContain('cart-total');
    expect(templateChunk?.metadata.imports?.length).toBe(2);
  });

  it('should deduplicate repeated render tags', () => {
    const content = `
<div>
  {% render 'icon', name: 'cart' %}
  {% render 'icon', name: 'heart' %}
  {% render 'icon', name: 'search' %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/header.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toEqual(['icon']);
  });

  it('should handle render tags with whitespace control', () => {
    const content = `
<div>
  {%- render 'product-card' -%}
  {%- render "featured-product", product: product -%}
</div>
`.trim();
    
    const chunks = chunkFile('sections/collection.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('product-card');
    expect(templateChunk?.metadata.imports).toContain('featured-product');
  });

  it('should not include imports field when no render tags present', () => {
    const content = `
<div>
  {{ product.title }}
  {% if product.available %}
    <span>Available</span>
  {% endif %}
</div>
`.trim();
    
    const chunks = chunkFile('snippets/simple.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toBeUndefined();
  });

  it('should track render tags in schema blocks', () => {
    const content = `
{% schema %}
{
  "name": "Test",
  "presets": [
    {
      "name": "Default",
      "blocks": [
        {
          "type": "heading"
        }
      ]
    }
  ]
}
{% endschema %}

{% render 'product-card' %}
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const schemaChunk = chunks.find(c => c.metadata.symbolType === 'schema');
    // Schema should not have render tags (they're JSON)
    expect(schemaChunk?.metadata.imports).toBeUndefined();
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('product-card');
  });

  it('should track {% section %} tags as imports', () => {
    const content = `
<!doctype html>
<html>
<body>
  {% section 'header' %}
  <main>{{ content_for_layout }}</main>
  {% section 'footer' %}
</body>
</html>
`.trim();
    
    const chunks = chunkFile('layout/theme.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toBeDefined();
    expect(templateChunk?.metadata.imports).toContain('header');
    expect(templateChunk?.metadata.imports).toContain('footer');
  });

  it('should track mixed render, include, and section tags', () => {
    const content = `
<div class="layout">
  {% section 'announcement-bar' %}
  {% render 'header-logo' %}
  {% include 'navigation' %}
  
  <main>{{ content_for_layout }}</main>
  
  {% section 'footer' %}
</div>
`.trim();
    
    const chunks = chunkFile('layout/theme.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('announcement-bar');
    expect(templateChunk?.metadata.imports).toContain('header-logo');
    expect(templateChunk?.metadata.imports).toContain('navigation');
    expect(templateChunk?.metadata.imports).toContain('footer');
    expect(templateChunk?.metadata.imports?.length).toBe(4);
  });

  it('should handle section tags with whitespace control', () => {
    const content = `
<body>
  {%- section 'header' -%}
  {{ content_for_layout }}
  {%- section 'footer' -%}
</body>
`.trim();
    
    const chunks = chunkFile('layout/minimal.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('header');
    expect(templateChunk?.metadata.imports).toContain('footer');
  });

  it('should ignore render tags inside comment blocks', () => {
    const content = `
<div>
  {% comment %}
    Old code - don't use anymore:
    {% render 'old-snippet' %}
    {% render 'deprecated-component' %}
  {% endcomment %}
  
  {% render 'current-snippet' %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toBeDefined();
    expect(templateChunk?.metadata.imports).toContain('current-snippet');
    expect(templateChunk?.metadata.imports).not.toContain('old-snippet');
    expect(templateChunk?.metadata.imports).not.toContain('deprecated-component');
    expect(templateChunk?.metadata.imports?.length).toBe(1);
  });

  it('should ignore include tags inside comment blocks', () => {
    const content = `
<div>
  {% comment %}Don't use {% include 'legacy-include' %}{% endcomment %}
  {% include 'current-include' %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toEqual(['current-include']);
  });

  it('should ignore section tags inside comment blocks', () => {
    const content = `
<body>
  {% comment %}
    Old layout structure:
    {% section 'old-header' %}
  {% endcomment %}
  
  {% section 'header' %}
  {{ content_for_layout }}
  {% section 'footer' %}
</body>
`.trim();
    
    const chunks = chunkFile('layout/theme.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('header');
    expect(templateChunk?.metadata.imports).toContain('footer');
    expect(templateChunk?.metadata.imports).not.toContain('old-header');
    expect(templateChunk?.metadata.imports?.length).toBe(2);
  });

  it('should handle comments with whitespace control', () => {
    const content = `
<div>
  {%- comment -%}
    {% render 'commented-snippet' %}
  {%- endcomment -%}
  {% render 'active-snippet' %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toEqual(['active-snippet']);
  });

  it('should handle multiple comment blocks correctly', () => {
    const content = `
<div>
  {% comment %}Block 1: {% render 'old-1' %}{% endcomment %}
  {% render 'active-1' %}
  {% comment %}Block 2: {% render 'old-2' %}{% endcomment %}
  {% render 'active-2' %}
  {% comment %}
    Block 3:
    {% render 'old-3' %}
    {% include 'old-4' %}
  {% endcomment %}
  {% include 'active-3' %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toContain('active-1');
    expect(templateChunk?.metadata.imports).toContain('active-2');
    expect(templateChunk?.metadata.imports).toContain('active-3');
    expect(templateChunk?.metadata.imports).not.toContain('old-1');
    expect(templateChunk?.metadata.imports).not.toContain('old-2');
    expect(templateChunk?.metadata.imports).not.toContain('old-3');
    expect(templateChunk?.metadata.imports).not.toContain('old-4');
    expect(templateChunk?.metadata.imports?.length).toBe(3);
  });

  it('should handle nested comment syntax edge cases', () => {
    const content = `
<div>
  {% comment %}
    Documentation about {% render %} syntax:
    Use {% render 'snippet-name' %} to include snippets.
    Old: {% include 'legacy' %}
  {% endcomment %}
  
  {% render 'actual-snippet' %}
</div>
`.trim();
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    const templateChunk = chunks.find(c => c.metadata.type === 'template');
    expect(templateChunk?.metadata.imports).toEqual(['actual-snippet']);
  });

  it('should handle empty liquid files', () => {
    const chunks = chunkFile('empty.liquid', '');
    expect(chunks).toHaveLength(0);
  });

  it('should handle whitespace-only liquid files', () => {
    const chunks = chunkFile('whitespace.liquid', '   \n\n  \t  \n   ');
    expect(chunks).toHaveLength(0);
  });

  it('should handle file with only comments', () => {
    const content = `
{% comment %}
  This file is deprecated.
  Use the new version instead.
{% endcomment %}
`.trim();
    
    const chunks = chunkFile('deprecated.liquid', content);
    
    // Comments are valid template content and should be preserved in chunks
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.type).toBe('template');
    expect(chunks[0].content).toContain('{% comment %}');
    expect(chunks[0].metadata.imports).toBeUndefined(); // No imports in comments
  });

  it('should handle schema block only files', () => {
    const content = `
{% schema %}
{
  "name": "Schema Only Section"
}
{% endschema %}
`.trim();
    
    const chunks = chunkFile('sections/schema-only.liquid', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolType).toBe('schema');
    expect(chunks[0].metadata.symbolName).toBe('Schema Only Section');
  });

  it('should handle very large schema blocks', () => {
    // Simulate a large schema with many settings
    const settings = Array.from({ length: 50 }, (_, i) => ({
      type: 'text',
      id: `setting_${i}`,
      label: `Setting ${i}`,
      default: `Default ${i}`,
    }));
    
    const content = `
{% schema %}
{
  "name": "Large Schema Section",
  "settings": ${JSON.stringify(settings, null, 2)}
}
{% endschema %}
`.trim();
    
    const chunks = chunkFile('sections/large-schema.liquid', content);
    
    expect(chunks).toHaveLength(1);
    const schemaChunk = chunks[0];
    expect(schemaChunk.metadata.symbolType).toBe('schema');
    expect(schemaChunk.metadata.symbolName).toBe('Large Schema Section');
    expect(schemaChunk.content).toContain('setting_0');
    expect(schemaChunk.content).toContain('setting_49');
  });

  it('should handle unclosed schema blocks gracefully', () => {
    const content = `
<div>Template content</div>
{% schema %}
{
  "name": "Unclosed Schema"
`.trim();
    
    const chunks = chunkFile('sections/broken.liquid', content);
    
    // Should treat everything as template since schema is never closed
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.metadata.type === 'template')).toBe(true);
    // Explicitly verify no schema chunk was created
    expect(chunks.every(c => c.metadata.symbolType !== 'schema')).toBe(true);
    expect(chunks.some(c => c.content.includes('{% schema %}'))).toBe(true);
  });

  it('should handle unclosed style blocks gracefully', () => {
    const content = `
<div>Template</div>
{% style %}
.unclosed {
  color: red;
<div>More content</div>
`.trim();
    
    const chunks = chunkFile('sections/broken-style.liquid', content);
    
    // Should treat everything as template since style is never closed
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.metadata.type === 'template')).toBe(true);
    expect(chunks.every(c => c.metadata.symbolType !== 'style')).toBe(true);
  });

  it('should handle unclosed javascript blocks gracefully', () => {
    const content = `
<div>Template</div>
{% javascript %}
console.log("unclosed");
<div>More content</div>
`.trim();
    
    const chunks = chunkFile('sections/broken-js.liquid', content);
    
    // Should treat everything as template since javascript is never closed
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.metadata.type === 'template')).toBe(true);
    expect(chunks.every(c => c.metadata.symbolType !== 'javascript')).toBe(true);
  });

  it('should handle partial end tags correctly', () => {
    const content = `
<div>Template</div>
{% schema %}
{
  "name": "Test"
}
{% endstyle %}
<div>More content</div>
`.trim();
    
    const chunks = chunkFile('sections/wrong-end-tag.liquid', content);
    
    // Schema has wrong end tag (endstyle instead of endschema), should be treated as template
    expect(chunks.every(c => c.metadata.symbolType !== 'schema')).toBe(true);
    expect(chunks.every(c => c.metadata.type === 'template')).toBe(true);
  });

  it('should handle single line liquid file', () => {
    const content = '{{ product.title }}';
    
    const chunks = chunkFile('snippets/single-line.liquid', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.type).toBe('template');
    expect(chunks[0].content).toBe(content);
  });

  it('should handle single-line schema blocks', () => {
    const content = '{% schema %}{"name": "Compact Section", "settings": []}{% endschema %}';
    
    const chunks = chunkFile('sections/compact.liquid', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolType).toBe('schema');
    expect(chunks[0].metadata.symbolName).toBe('Compact Section');
    expect(chunks[0].metadata.type).toBe('block');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(1);
  });

  it('should handle single-line style blocks', () => {
    const content = '{% style %}.compact { color: red; }{% endstyle %}';
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolType).toBe('style');
    expect(chunks[0].metadata.type).toBe('block');
    expect(chunks[0].content).toBe(content);
  });

  it('should handle single-line javascript blocks', () => {
    const content = '{% javascript %}console.log("compact");{% endjavascript %}';
    
    const chunks = chunkFile('sections/test.liquid', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolType).toBe('javascript');
    expect(chunks[0].metadata.type).toBe('block');
    expect(chunks[0].content).toBe(content);
  });

  it('should handle mix of single-line and multi-line blocks', () => {
    const content = `
<div>Template</div>
{% schema %}{"name": "Mixed"}{% endschema %}
{% style %}
.multi-line {
  color: blue;
}
{% endstyle %}
{% javascript %}console.log("single");{% endjavascript %}
<div>More template</div>
`.trim();
    
    const chunks = chunkFile('sections/mixed.liquid', content);
    
    const schemaChunk = chunks.find(c => c.metadata.symbolType === 'schema');
    const styleChunk = chunks.find(c => c.metadata.symbolType === 'style');
    const jsChunk = chunks.find(c => c.metadata.symbolType === 'javascript');
    
    expect(schemaChunk).toBeDefined();
    expect(schemaChunk?.metadata.symbolName).toBe('Mixed');
    expect(schemaChunk?.metadata.startLine).toBe(schemaChunk?.metadata.endLine); // Single line
    
    expect(styleChunk).toBeDefined();
    expect(styleChunk?.metadata.endLine).toBeGreaterThan(styleChunk!.metadata.startLine); // Multi-line
    
    expect(jsChunk).toBeDefined();
    expect(jsChunk?.metadata.startLine).toBe(jsChunk?.metadata.endLine); // Single line
  });

  it('should handle single-line blocks with whitespace control', () => {
    const content = '{%- schema -%}{"name": "Compact"}{%- endschema -%}';
    
    const chunks = chunkFile('sections/compact-ws.liquid', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolType).toBe('schema');
    expect(chunks[0].metadata.symbolName).toBe('Compact');
  });
});
