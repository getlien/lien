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
});
