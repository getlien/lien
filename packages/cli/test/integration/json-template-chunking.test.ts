import { describe, it, expect } from 'vitest';
import { chunkFile } from '../../src/indexer/chunker.js';

describe('Shopify JSON Template Chunking', () => {
  it('should extract section references from JSON template', () => {
    const content = `{
  "sections": {
    "main": {
      "type": "main-product",
      "settings": {
        "padding_top": 36
      }
    },
    "recommendations": {
      "type": "product-recommendations",
      "settings": {}
    }
  },
  "order": ["main", "recommendations"]
}`;
    
    const chunks = chunkFile('templates/product.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.language).toBe('json');
    expect(chunks[0].metadata.type).toBe('template');
    expect(chunks[0].metadata.symbolType).toBe('template');
    expect(chunks[0].metadata.imports).toBeDefined();
    expect(chunks[0].metadata.imports).toContain('main-product');
    expect(chunks[0].metadata.imports).toContain('product-recommendations');
  });

  it('should extract template name from filepath', () => {
    const content = `{
  "sections": {
    "main": { "type": "main-account", "settings": {} }
  },
  "order": ["main"]
}`;
    
    const chunks = chunkFile('templates/customers/account.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('customers/account');
  });

  it('should handle empty sections object', () => {
    const content = `{
  "sections": {},
  "order": []
}`;
    
    const chunks = chunkFile('templates/page.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.imports).toBeUndefined();
  });

  it('should handle JSON template without sections field', () => {
    const content = `{
  "order": []
}`;
    
    const chunks = chunkFile('templates/minimal.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.imports).toBeUndefined();
  });

  it('should handle invalid JSON gracefully', () => {
    const content = `{
  "sections": {
    invalid json here
  }
}`;
    
    const chunks = chunkFile('templates/broken.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.imports).toBeUndefined(); // No imports extracted from invalid JSON
  });

  it('should handle empty JSON template files', () => {
    const chunks = chunkFile('templates/empty.json', '');
    
    expect(chunks).toHaveLength(0);
  });

  it('should handle whitespace-only JSON files', () => {
    const chunks = chunkFile('templates/whitespace.json', '   \n\n   ');
    
    expect(chunks).toHaveLength(0);
  });

  it('should handle multiple section references', () => {
    const content = `{
  "sections": {
    "announcement": { "type": "announcement-bar", "settings": {} },
    "header": { "type": "header", "settings": {} },
    "main": { "type": "main-collection", "settings": {} },
    "filters": { "type": "collection-filters", "settings": {} },
    "footer": { "type": "footer", "settings": {} }
  },
  "order": ["announcement", "header", "main", "filters", "footer"]
}`;
    
    const chunks = chunkFile('templates/collection.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.imports).toHaveLength(5);
    expect(chunks[0].metadata.imports).toContain('announcement-bar');
    expect(chunks[0].metadata.imports).toContain('header');
    expect(chunks[0].metadata.imports).toContain('main-collection');
    expect(chunks[0].metadata.imports).toContain('collection-filters');
    expect(chunks[0].metadata.imports).toContain('footer');
  });

  it('should deduplicate section references', () => {
    const content = `{
  "sections": {
    "header1": { "type": "header", "settings": {} },
    "header2": { "type": "header", "settings": {} },
    "main": { "type": "main-page", "settings": {} }
  },
  "order": ["header1", "header2", "main"]
}`;
    
    const chunks = chunkFile('templates/page.json', content);
    
    expect(chunks).toHaveLength(1);
    // Should have only 2 unique section types
    expect(chunks[0].metadata.imports).toHaveLength(2);
    expect(chunks[0].metadata.imports).toContain('header');
    expect(chunks[0].metadata.imports).toContain('main-page');
  });

  it('should only process JSON files in templates directory', () => {
    // Other JSON files (config, locales) should use regular chunking
    const content = `{
  "theme_name": "My Theme",
  "sections": {
    "main": { "type": "should-not-extract" }
  }
}`;
    
    const chunks = chunkFile('config/settings_schema.json', content);
    
    // Should NOT extract section references (not a template file)
    expect(chunks[0].metadata.imports).toBeUndefined();
  });

  it('should handle templates directory with framework path prefix', () => {
    // When framework.path !== '.', files have prefix like 'shopify-theme/templates/...'
    const content = `{
  "sections": {
    "main": { "type": "main-product", "settings": {} }
  },
  "order": ["main"]
}`;
    
    const chunks = chunkFile('shopify-theme/templates/product.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('product');
    expect(chunks[0].metadata.imports).toContain('main-product');
  });

  it('should NOT match templates substring in other directory names', () => {
    // Should not match 'my-templates', 'templates-backup', etc.
    const content = `{
  "sections": {
    "main": { "type": "should-not-extract" }
  }
}`;
    
    const chunks = chunkFile('my-templates/product.json', content);
    
    // Should use regular JSON chunking (no section extraction)
    expect(chunks[0].metadata.imports).toBeUndefined();
  });

  it('should handle nested template paths', () => {
    const content = `{
  "sections": {
    "main": { "type": "main-login", "settings": {} }
  },
  "order": ["main"]
}`;
    
    const chunks = chunkFile('templates/customers/login.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('customers/login');
    expect(chunks[0].metadata.imports).toContain('main-login');
  });

  it('should handle real-world Shopify template structure', () => {
    const content = `{
  "sections": {
    "main": {
      "type": "main-product",
      "blocks": {
        "vendor": { "type": "text", "settings": { "text": "{{ product.vendor }}" } },
        "title": { "type": "title", "settings": {} },
        "price": { "type": "price", "settings": {} }
      },
      "block_order": ["vendor", "title", "price"],
      "settings": {
        "enable_sticky_info": true,
        "media_size": "medium"
      }
    },
    "related-products": {
      "type": "related-products",
      "settings": {
        "heading": "You may also like",
        "products_to_show": 4
      }
    }
  },
  "order": ["main", "related-products"]
}`;
    
    const chunks = chunkFile('templates/product.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('product');
    expect(chunks[0].metadata.imports).toContain('main-product');
    expect(chunks[0].metadata.imports).toContain('related-products');
    expect(chunks[0].metadata.imports).toHaveLength(2);
  });

  it('should handle sections with complex settings objects', () => {
    const content = `{
  "sections": {
    "hero": {
      "type": "image-banner",
      "settings": {
        "image": "shopify://shop_images/hero.jpg",
        "image_overlay_opacity": 40,
        "image_height": "medium",
        "desktop_content_position": "middle-center",
        "show_text_box": false,
        "desktop_content_alignment": "center",
        "color_scheme": "background-1",
        "mobile_content_alignment": "center",
        "stack_images_on_mobile": true,
        "show_text_below": true
      }
    }
  },
  "order": ["hero"]
}`;
    
    const chunks = chunkFile('templates/index.json', content);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.imports).toEqual(['image-banner']);
  });

  it('should handle malformed type values (non-string)', () => {
    const content = `{
  "sections": {
    "valid": { "type": "main-product", "settings": {} },
    "invalid_number": { "type": 123, "settings": {} },
    "invalid_null": { "type": null, "settings": {} },
    "invalid_array": { "type": ["array"], "settings": {} },
    "another_valid": { "type": "product-recommendations", "settings": {} }
  },
  "order": ["valid", "invalid_number", "invalid_null", "invalid_array", "another_valid"]
}`;
    
    const chunks = chunkFile('templates/malformed.json', content);
    
    expect(chunks).toHaveLength(1);
    // Should only extract valid string types, ignoring malformed ones
    expect(chunks[0].metadata.imports).toHaveLength(2);
    expect(chunks[0].metadata.imports).toContain('main-product');
    expect(chunks[0].metadata.imports).toContain('product-recommendations');
    // Should NOT contain non-string types
    expect(chunks[0].metadata.imports).not.toContain(123);
    expect(chunks[0].metadata.imports).not.toContain(null);
  });
});

