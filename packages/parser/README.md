# @liendev/parser

AST parsing, complexity analysis, and semantic chunking for [Lien](https://lien.dev).

This package provides the core parsing and analysis capabilities used by Lien's semantic code search. It is extracted from `@liendev/core` to enable lightweight consumers (like `@liendev/review`) that need parsing without embeddings or vector DB dependencies.

## Features

- **AST Parsing** — Tree-sitter-based parsing for TypeScript, JavaScript, Python, PHP, and Rust
- **Semantic Chunking** — Split code into meaningful chunks respecting function/class boundaries
- **Complexity Analysis** — Cyclomatic, cognitive, and Halstead complexity metrics
- **Dependency Analysis** — Import/export tracking with transitive dependent resolution
- **Symbol Extraction** — Extract functions, classes, interfaces, and call sites from AST
- **Test Association Detection** — Convention-based and import-based test file detection
- **Codebase Scanning** — File discovery with gitignore support and ecosystem presets

## Supported Languages

| Language | AST Parsing | Complexity Metrics | Import/Export Tracking |
|----------|:-----------:|:------------------:|:---------------------:|
| TypeScript | Yes | Yes | Yes |
| JavaScript | Yes | Yes | Yes |
| Python | Yes | Yes | Yes |
| PHP | Yes | Yes | Yes |
| Rust | Yes | Yes | Yes |

Line-based chunking and symbol extraction are available for additional languages including Go, Java, C#, Ruby, and Vue.

## Usage

```typescript
import {
  parseAST,
  chunkByAST,
  detectLanguage,
  analyzeComplexityFromChunks,
  scanCodebase,
  chunkFile,
} from '@liendev/parser';

// Parse a file into an AST
const language = detectLanguage('example.ts');
const result = parseAST(sourceCode, language);

// Chunk a file using AST-aware boundaries
const chunks = await chunkByAST('src/auth.ts', sourceCode, {
  chunkSize: 75,
  chunkOverlap: 10,
});

// Analyze complexity from chunks
const report = analyzeComplexityFromChunks(chunks, files, {
  cyclomatic: 15,
  cognitive: 15,
  halstead_effort: 60,
  halstead_bugs: 1.5,
});
```

## Architecture

This package is part of the [Lien](https://github.com/getlien/lien) monorepo:

```
@liendev/parser   ← AST, complexity, chunking, scanning (this package)
@liendev/core     ← embeddings, vector DB, search (depends on parser)
@liendev/lien     ← CLI and MCP server (depends on both)
@liendev/review   ← PR review (depends on parser only)
```

## License

AGPL-3.0 — see [LICENSE](https://github.com/getlien/lien/blob/main/LICENSE) for details.
