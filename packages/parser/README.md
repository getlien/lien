# @liendev/parser

AST parsing, complexity analysis, and semantic chunking for [Lien](https://lien.dev).

This package provides the core parsing and analysis capabilities used by Lien's lexical code search. It is extracted from `@liendev/core` to enable lightweight consumers (like `@liendev/review`) that need parsing without embeddings or vector DB dependencies.

## Features

- **AST parsing**: Tree-sitter-based parsing for TypeScript, JavaScript, Python, PHP, Rust, Go, Java, C#, Ruby, Kotlin, and Swift
- **Semantic chunking**: split code into meaningful chunks respecting function/class boundaries
- **Complexity analysis**: cyclomatic, cognitive, and Halstead complexity metrics
- **Dependency analysis**: import/export tracking with transitive dependent resolution
- **Symbol extraction**: extract functions, classes, interfaces, and call sites from AST
- **Test association detection**: convention-based and import-based test file detection
- **Codebase scanning**: file discovery with gitignore support and ecosystem presets

## Supported languages

| Language | AST Parsing | Complexity Metrics | Import/Export Tracking |
|----------|:-----------:|:------------------:|:---------------------:|
| TypeScript | Yes | Yes | Yes |
| JavaScript | Yes | Yes | Yes |
| Python | Yes | Yes | Yes |
| PHP | Yes | Yes | Yes |
| Rust | Yes | Yes | Yes |
| Go | Yes | Yes | Yes |
| Java | Yes | Yes | Yes |
| C# | Yes | Yes | Yes |
| Ruby | Yes | Yes | Yes |
| Kotlin | Yes | Yes | Yes |
| Swift | Yes | Yes | Yes |

Line-based chunking and symbol extraction are available for additional languages including Vue, Liquid, C/C++, Scala, and Markdown.

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

This package is part of the [Lien](https://github.com/getlien/lien) monorepo.
See [CLAUDE.md](https://github.com/getlien/lien/blob/main/CLAUDE.md)
for the current package dependency chain.

## License

AGPL-3.0. See [LICENSE](https://github.com/getlien/lien/blob/main/LICENSE) for details.
