<!-- f563cb93-bf0c-483d-a152-341c0ee11b7b d9e40e55-022f-4f9c-95f7-8d8e68bf2f0e -->
# Fix list_functions Tool - Two Phase Approach

## Phase 1: v0.4.1 Hotfix (Quick SQL-Based Filtering)

### 1. Add scanWithFilter Method to VectorDB

**File**: `packages/cli/src/vectordb/types.ts`

Add to interface:

```typescript
export interface VectorDBInterface {
  // ... existing methods ...
  scanWithFilter(options: {
    language?: string;
    pattern?: string;
    limit?: number;
  }): Promise<SearchResult[]>;
}
```

**File**: `packages/cli/src/vectordb/lancedb.ts`

Add method after `search()`:

```typescript
async scanWithFilter(options: {
  language?: string;
  pattern?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  if (!this.table) {
    throw new Error('Vector database not initialized');
  }
  
  const { language, pattern, limit = 100 } = options;
  
  try {
    let query = this.table.query();
    
    // Filter by language using SQL where clause
    if (language) {
      query = query.where(`language = "${language}"`);
    }
    
    // Exclude schema rows and empty content
    query = query.where('content != "__SCHEMA_ROW__"');
    query = query.where('file != ""');
    
    const results = await query.limit(limit * 2).execute();
    
    // Apply regex pattern filtering in JavaScript
    let filtered = results.filter((r: any) => 
      r.content && r.content.trim().length > 0
    );
    
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      filtered = filtered.filter((r: any) =>
        regex.test(r.content) || regex.test(r.file)
      );
    }
    
    return filtered.slice(0, limit).map((r: any) => ({
      content: r.content,
      metadata: {
        file: r.file,
        startLine: r.startLine,
        endLine: r.endLine,
        type: r.type,
        language: r.language,
        isTest: r.isTest,
        relatedTests: r.relatedTests,
        relatedSources: r.relatedSources,
        testFramework: r.testFramework,
        detectionMethod: r.detectionMethod,
      },
      score: 0,
    }));
  } catch (error) {
    throw new Error(`Failed to scan with filter: ${error}`);
  }
}
```

### 2. Update list_functions Implementation

**File**: `packages/cli/src/mcp/server.ts`

Replace the `list_functions` case (lines 283-340):

```typescript
case 'list_functions': {
  const pattern = args.pattern as string | undefined;
  const language = args.language as string | undefined;
  
  log('Listing functions...');
  
  // Check if index has been updated and reconnect if needed
  await checkAndReconnect();
  
  // Use direct scanning instead of semantic search
  const results = await vectorDB.scanWithFilter({
    language,
    pattern,
    limit: 50,
  });
  
  log(`Found ${results.length} matching chunks`);
  
  const response = {
    indexInfo: getIndexMetadata(),
    results,
  };
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
```

### 3. Update Tool Description

**File**: `packages/cli/src/mcp/tools.ts`

Update description to reflect beta status:

```typescript
{
  name: 'list_functions',
  description: 'List indexed code chunks filtered by language and/or regex pattern (Beta: searches content, not extracted symbols)',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Optional regex pattern to filter content (e.g., ".*Service$", "class.*Controller")',
      },
      language: {
        type: 'string',
        description: 'Optional language filter (e.g., "typescript", "python", "php")',
      },
    },
  },
},
```

### 4. Add Tests for Phase 1

**File**: `packages/cli/src/vectordb/lancedb.test.ts` (create if doesn't exist)

Add test:

```typescript
describe('scanWithFilter', () => {
  it('should filter by language', async () => {
    // Test implementation
  });
  
  it('should filter by pattern', async () => {
    // Test implementation
  });
  
  it('should combine language and pattern filters', async () => {
    // Test implementation
  });
});
```

### 5. Update CHANGELOG for v0.4.1

**File**: `CHANGELOG.md`

Add entry:

```markdown
## [0.4.1] - 2025-11-14

### Fixed
- **list_functions tool now works correctly**
  - Replaced broken semantic search approach with SQL-based filtering
  - Now properly filters by language and regex pattern
  - Note: Still searches content, not extracted symbols (proper fix coming in v0.5.0)
```

---

## Phase 2: v0.5.0 Comprehensive Solution (Metadata Extraction)

### 6. Add Symbol Extraction to Chunker

**File**: `packages/cli/src/indexer/types.ts`

Add to ChunkMetadata:

```typescript
export interface ChunkMetadata {
  file: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'interface' | 'block' | 'file';
  language: string;
  // Test associations
  isTest: boolean;
  relatedTests: string[];
  relatedSources: string[];
  testFramework: string;
  detectionMethod: 'convention' | 'import';
  // NEW: Extracted symbols
  symbols?: {
    functions: string[];
    classes: string[];
    interfaces: string[];
  };
}
```

### 7. Create Symbol Extractor Utility

**File**: `packages/cli/src/indexer/symbol-extractor.ts` (new)

```typescript
export interface ExtractedSymbols {
  functions: string[];
  classes: string[];
  interfaces: string[];
}

export function extractSymbols(
  content: string,
  language: string
): ExtractedSymbols {
  const symbols: ExtractedSymbols = {
    functions: [],
    classes: [],
    interfaces: [],
  };
  
  switch (language) {
    case 'typescript':
    case 'javascript':
      symbols.functions = extractJSFunctions(content);
      symbols.classes = extractJSClasses(content);
      symbols.interfaces = extractTSInterfaces(content);
      break;
    
    case 'python':
      symbols.functions = extractPythonFunctions(content);
      symbols.classes = extractPythonClasses(content);
      break;
    
    case 'php':
      symbols.functions = extractPHPFunctions(content);
      symbols.classes = extractPHPClasses(content);
      symbols.interfaces = extractPHPInterfaces(content);
      break;
    
    case 'go':
      symbols.functions = extractGoFunctions(content);
      symbols.interfaces = extractGoInterfaces(content);
      break;
    
    // Add more languages as needed
  }
  
  return symbols;
}

function extractPHPClasses(content: string): string[] {
  const matches = content.matchAll(/class\s+(\w+)/g);
  return Array.from(matches, m => m[1]);
}

function extractPHPFunctions(content: string): string[] {
  const matches = content.matchAll(/function\s+(\w+)/g);
  return Array.from(matches, m => m[1]);
}

function extractPHPInterfaces(content: string): string[] {
  const matches = content.matchAll(/interface\s+(\w+)/g);
  return Array.from(matches, m => m[1]);
}

// Similar functions for other languages...
```

### 8. Update Chunker to Extract Symbols

**File**: `packages/cli/src/indexer/chunker.ts`

Import and use symbol extractor:

```typescript
import { extractSymbols } from './symbol-extractor.js';

export function chunkFile(/* ... */): CodeChunk[] {
  // ... existing chunking logic ...
  
  return chunks.map(chunk => {
    const symbols = extractSymbols(chunk.content, language);
    
    return {
      content: chunk.content,
      metadata: {
        // ... existing metadata ...
        symbols,
      },
    };
  });
}
```

### 9. Update VectorDB Schema

**File**: `packages/cli/src/vectordb/lancedb.ts`

Update schema in initialize():

```typescript
const schema = [
  {
    vector: Array(EMBEDDING_DIMENSION).fill(0),
    content: '__SCHEMA_ROW__',
    file: '',
    startLine: 0,
    endLine: 0,
    type: '',
    language: '',
    isTest: false,
    relatedTests: [''],
    relatedSources: [''],
    testFramework: '',
    detectionMethod: '',
    // NEW fields
    functionNames: [''],
    classNames: [''],
    interfaceNames: [''],
  },
];
```

Update insertBatch to include symbols:

```typescript
const records = vectors.map((vector, i) => ({
  vector: Array.from(vector),
  content: contents[i],
  // ... existing fields ...
  functionNames: metadatas[i].symbols?.functions || [],
  classNames: metadatas[i].symbols?.classes || [],
  interfaceNames: metadatas[i].symbols?.interfaces || [],
}));
```

### 10. Add Symbol Query Method

**File**: `packages/cli/src/vectordb/lancedb.ts`

Add new method:

```typescript
async querySymbols(options: {
  language?: string;
  pattern?: string;
  symbolType?: 'function' | 'class' | 'interface';
  limit?: number;
}): Promise<SearchResult[]> {
  if (!this.table) {
    throw new Error('Vector database not initialized');
  }
  
  const { language, pattern, symbolType, limit = 50 } = options;
  
  try {
    let query = this.table.query();
    
    if (language) {
      query = query.where(`language = "${language}"`);
    }
    
    const results = await query.limit(limit * 2).execute();
    
    let filtered = results.filter((r: any) => {
      const symbols = symbolType === 'function' ? r.functionNames :
                     symbolType === 'class' ? r.classNames :
                     symbolType === 'interface' ? r.interfaceNames :
                     [...r.functionNames, ...r.classNames, ...r.interfaceNames];
      
      if (!pattern) return symbols.length > 0;
      
      const regex = new RegExp(pattern, 'i');
      return symbols.some((s: string) => regex.test(s));
    });
    
    return filtered.slice(0, limit).map((r: any) => ({
      content: r.content,
      metadata: {
        file: r.file,
        startLine: r.startLine,
        endLine: r.endLine,
        type: r.type,
        language: r.language,
        isTest: r.isTest,
        relatedTests: r.relatedTests,
        relatedSources: r.relatedSources,
        testFramework: r.testFramework,
        detectionMethod: r.detectionMethod,
        symbols: {
          functions: r.functionNames || [],
          classes: r.classNames || [],
          interfaces: r.interfaceNames || [],
        },
      },
      score: 0,
    }));
  } catch (error) {
    throw new Error(`Failed to query symbols: ${error}`);
  }
}
```

### 11. Update list_functions to Use Symbols

**File**: `packages/cli/src/mcp/server.ts`

Update list_functions case:

```typescript
case 'list_functions': {
  const pattern = args.pattern as string | undefined;
  const language = args.language as string | undefined;
  
  log('Listing functions with symbol metadata...');
  
  await checkAndReconnect();
  
  // Use symbol-based query
  const results = await vectorDB.querySymbols({
    language,
    pattern,
    limit: 50,
  });
  
  log(`Found ${results.length} matches`);
  
  const response = {
    indexInfo: getIndexMetadata(),
    results,
  };
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
```

### 12. Update Tool Description for v0.5.0

**File**: `packages/cli/src/mcp/tools.ts`

```typescript
{
  name: 'list_functions',
  description: 'List functions, classes, and interfaces by name pattern and language',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to match symbol names (e.g., ".*Service$", "handle.*")',
      },
      language: {
        type: 'string',
        description: 'Language filter (e.g., "typescript", "python", "php")',
      },
    },
  },
},
```

### 13. Add Comprehensive Tests

**File**: `packages/cli/src/indexer/symbol-extractor.test.ts` (new)

Test symbol extraction for all languages.

**File**: `packages/cli/test/integration/list-functions.test.ts` (new)

End-to-end test of list_functions tool.

### 14. Update Documentation

**File**: `README.md`

Update list_functions section to reflect new capabilities.

**File**: `CHANGELOG.md`

```markdown
## [0.5.0] - 2025-11-XX

### Added
- **Symbol-aware list_functions tool**
  - Extracts and indexes function/class/interface names during indexing
  - Direct symbol name matching (no semantic search needed)
  - Much faster and more accurate than previous implementation
  - Supports TypeScript, JavaScript, Python, PHP, Go, and more

### Changed
- **BREAKING**: Requires reindexing to use new list_functions features
  - Run `lien reindex` after upgrading
  - Old indices still work but list_functions falls back to content search
```

### 15. Migration Strategy

Add version detection in list_functions:

- If index has symbol metadata: use querySymbols()
- If index lacks symbols: fall back to scanWithFilter()
- Log warning suggesting reindex for better results

---

## Testing Checklist

Phase 1:

- [ ] scanWithFilter works with language filter
- [ ] scanWithFilter works with pattern filter  
- [ ] scanWithFilter works with both filters combined
- [ ] list_functions returns results for PHP with `.*Service$` pattern

Phase 2:

- [ ] Symbol extraction works for TypeScript/JavaScript
- [ ] Symbol extraction works for Python
- [ ] Symbol extraction works for PHP
- [ ] Symbol extraction works for Go
- [ ] querySymbols returns accurate matches
- [ ] list_functions uses symbols when available
- [ ] Backward compatibility with old indices

## Release Strategy

1. Ship v0.4.1 immediately (hotfix)
2. Develop v0.5.0 over 1-2 weeks
3. Release v0.5.0 with clear migration guide

### To-dos

- [ ] Add scanWithFilter method to VectorDB interface and implementation
- [ ] Replace broken list_functions implementation with SQL-based filtering
- [ ] Update tool description and mark as beta, add CHANGELOG entry for v0.4.1
- [ ] Add tests for scanWithFilter method
- [ ] Release v0.4.1 hotfix
- [ ] Add symbols field to ChunkMetadata interface
- [ ] Create symbol-extractor.ts with extraction functions for all languages
- [ ] Update chunker to extract and include symbols in metadata
- [ ] Update VectorDB schema to store function/class/interface names
- [ ] Add querySymbols method to VectorDB for symbol-based queries
- [ ] Update list_functions to use querySymbols with fallback to scanWithFilter
- [ ] Add comprehensive tests for symbol extraction and querying
- [ ] Update README and CHANGELOG for v0.5.0
- [ ] Release v0.5.0 with migration guide