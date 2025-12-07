# Configuration

Lien is configured via a `.lien.config.json` file in your project root. This file is created automatically when you run `lien init`.

## Configuration Structure

```json
{
  "version": "0.3.0",
  "frameworks": [
    {
      "name": "nodejs",
      "path": ".",
      "config": {
        "indexing": {
          "exclude": ["node_modules/**", "dist/**"],
          "include": ["**/*.ts", "**/*.js"],
          "chunkSize": 75,
          "chunkOverlap": 10
        }
      }
    }
  ],
  "indexing": {
    "concurrency": 4,
    "embeddingBatchSize": 50,
    "indexTests": true,
    "useImportAnalysis": true
  },
  "mcp": {
    "port": 7133,
    "transport": "stdio"
  },
  "complexity": {
    "enabled": true,
    "thresholds": {
      "method": 15,
      "cognitive": 15
    }
  }
}
```

## Framework Configuration

### Multiple Frameworks

For monorepos with multiple frameworks:

```json
{
  "frameworks": [
    {
      "name": "nodejs",
      "path": ".",
      "config": { /* Node.js config */ }
    },
    {
      "name": "laravel",
      "path": "backend",
      "config": { /* Laravel config */ }
    }
  ]
}
```

### Supported Frameworks

#### Node.js/TypeScript

Automatically detected via `package.json`:

```json
{
  "name": "nodejs",
  "path": ".",
  "config": {
    "indexing": {
      "include": [
        "**/*.ts", "**/*.tsx",
        "**/*.js", "**/*.jsx"
      ],
      "exclude": [
        "node_modules/**",
        "dist/**",
        "build/**",
        "coverage/**"
      ]
    },
    "testPatterns": {
      "testFiles": [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**/*.ts"
      ]
    }
  }
}
```

#### Laravel/PHP

Automatically detected via `composer.json`:

```json
{
  "name": "laravel",
  "path": ".",
  "config": {
    "indexing": {
      "include": [
        "app/**/*.php",
        "routes/**/*.php",
        "config/**/*.php",
        "resources/js/**/*.{js,ts,jsx,tsx,vue}"
      ],
      "exclude": [
        "vendor/**",
        "storage/**",
        "bootstrap/cache/**"
      ]
    },
    "testPatterns": {
      "testFiles": [
        "tests/**/*Test.php"
      ]
    }
  }
}
```

#### Shopify (Liquid)

Automatically detected via `config/settings_schema.json`:

```json
{
  "name": "shopify",
  "path": ".",
  "config": {
    "indexing": {
      "include": [
        "layout/**/*.liquid",
        "sections/**/*.liquid",
        "snippets/**/*.liquid",
        "templates/**/*.liquid",
        "blocks/**/*.liquid",
        "assets/**/*.{js,css,scss}.liquid",
        "config/*.json"
      ],
      "exclude": [
        "node_modules/**",
        "dist/**",
        "__generated__/**"
      ]
    }
  }
}
```

**Hybrid Shopify + Node.js themes**: Modern Shopify themes often include a Vue.js or React frontend alongside Liquid templates. Lien automatically detects and indexes both frameworks when they coexist:

```json
{
  "frameworks": [
    {
      "name": "shopify",
      "path": ".",
      "config": { /* Liquid templates */ }
    },
    {
      "name": "nodejs",
      "path": ".",
      "config": { /* Vue/React frontend */ }
    }
  ]
}
```

## Indexing Options

### Global Settings

These apply to all frameworks:

```json
{
  "indexing": {
    "concurrency": 4,
    "embeddingBatchSize": 50,
    "indexTests": true,
    "useImportAnalysis": true
  }
}
```

#### `concurrency`
- **Type**: `number`
- **Default**: `4`
- **Description**: Number of files processed in parallel
- **Recommendation**: 
  - 4-8 cores: use 4-6
  - 8+ cores: use 6-8
  - 2-4 cores: use 2-3

#### `embeddingBatchSize`
- **Type**: `number`
- **Default**: `50`
- **Description**: Number of chunks processed per embedding batch
- **Recommendation**:
  - 16GB+ RAM: 50-100
  - 8-16GB RAM: 25-50
  - <8GB RAM: 10-25

#### `indexTests`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Whether to index test files and detect test associations

#### `useImportAnalysis`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable import-based test detection (more accurate)

### Per-Framework Settings

These apply to individual frameworks:

#### `include`
- **Type**: `string[]`
- **Description**: Glob patterns for files to index
- **Example**: `["**/*.ts", "**/*.js"]`

#### `exclude`
- **Type**: `string[]`
- **Description**: Glob patterns for files to exclude
- **Example**: `["node_modules/**", "dist/**"]`

#### `chunkSize`
- **Type**: `number`
- **Default**: `75`
- **Description**: Number of lines per code chunk
- **Note**: Larger chunks = more context but slower indexing

#### `chunkOverlap`
- **Type**: `number`
- **Default**: `10`
- **Description**: Overlapping lines between chunks for continuity

## MCP Configuration

```json
{
  "mcp": {
    "port": 7133,
    "transport": "stdio"
  }
}
```

#### `port`
- **Type**: `number`
- **Default**: `7133`
- **Description**: Port number for MCP server (L=7, I=1, E=3, N=3)

#### `transport`
- **Type**: `string`
- **Default**: `"stdio"`
- **Description**: MCP transport protocol (currently only "stdio" supported)

## Complexity Analysis

Configure complexity analysis for the `lien complexity` command and `get_complexity` MCP tool. Lien tracks **four metrics**:

- **Cyclomatic Complexity**: Number of independent paths through code (decision points)
- **Cognitive Complexity**: Mental effort to understand code (penalizes nesting depth)
- **Halstead Effort**: Mental effort based on operators and operands
- **Halstead Difficulty**: Error-proneness based on program vocabulary

```json
{
  "complexity": {
    "enabled": true,
    "thresholds": {
      "method": 15,
      "cognitive": 15,
      "halsteadEffort": 300000,
      "halsteadDifficulty": 30,
      "file": 50,
      "average": 6
    },
    "severity": {
      "warning": 1.0,
      "error": 2.0
    }
  }
}
```

#### Thresholds

| Threshold | Default | Description |
|-----------|---------|-------------|
| `method` | 15 | Cyclomatic complexity threshold per function |
| `cognitive` | 15 | Cognitive complexity threshold per function |
| `halsteadEffort` | 300000 | Halstead effort threshold (P99 - top 1%) |
| `halsteadDifficulty` | 30 | Halstead difficulty threshold (P90 - top 10%) |
| `file` | 50 | Maximum total complexity per file |
| `average` | 6 | Maximum average complexity per file |

::: tip Halstead Metrics
Halstead metrics are based on counts of operators (keywords, symbols) and operands (variables, literals):
- **Volume**: Size of implementation (N × log₂(n))
- **Difficulty**: Error-proneness ((n1/2) × (N2/n2))
- **Effort**: Mental effort required (D × V)
- **Bugs**: Estimated delivered bugs (V / 3000)
:::

#### Severity Multipliers

| Multiplier | Default | Meaning |
|------------|---------|---------|
| `warning` | 1.0 | Violations at or above `threshold × 1.0` are warnings |
| `error` | 2.0 | Violations at or above `threshold × 2.0` are errors |

With default threshold of 15 (cyclomatic/cognitive):
- **Warning**: complexity ≥ 15
- **Error**: complexity ≥ 30

## Performance Tuning

### For Large Codebases

```json
{
  "indexing": {
    "concurrency": 8,
    "embeddingBatchSize": 100,
    "chunkSize": 100
  }
}
```

### For Limited Resources

```json
{
  "indexing": {
    "concurrency": 2,
    "embeddingBatchSize": 25,
    "chunkSize": 50
  }
}
```

### For SSD Storage

```json
{
  "indexing": {
    "concurrency": 6,
    "embeddingBatchSize": 75
  }
}
```

## Test Association

Lien automatically detects relationships between source files and tests:

```json
{
  "indexing": {
    "indexTests": true,
    "useImportAnalysis": true
  }
}
```

### Test Patterns

Each framework defines test patterns:

```json
{
  "testPatterns": {
    "testFiles": [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/__tests__/**/*.ts"
    ]
  }
}
```

## Configuration Tips

1. **Start with defaults**: The generated config works well for most projects
2. **Exclude build artifacts**: Always exclude `node_modules`, `dist`, `build`
3. **Adjust for hardware**: Tune concurrency and batch size based on your machine
4. **Re-index after changes**: Run `lien index --force` after updating the config
5. **Test patterns matter**: Include all test file patterns your project uses

## Example Configurations

### TypeScript Monorepo

```json
{
  "frameworks": [
    {
      "name": "nodejs",
      "path": "packages/frontend",
      "config": {
        "indexing": {
          "include": ["**/*.tsx", "**/*.ts"],
          "exclude": ["dist/**", "node_modules/**"]
        }
      }
    },
    {
      "name": "nodejs",
      "path": "packages/backend",
      "config": {
        "indexing": {
          "include": ["**/*.ts"],
          "exclude": ["dist/**", "node_modules/**"]
        }
      }
    }
  ],
  "indexing": {
    "concurrency": 6,
    "embeddingBatchSize": 50
  }
}
```

### Full-Stack Laravel + Vue

```json
{
  "frameworks": [
    {
      "name": "laravel",
      "path": ".",
      "config": {
        "indexing": {
          "include": [
            "app/**/*.php",
            "routes/**/*.php",
            "resources/js/**/*.vue",
            "resources/js/**/*.ts"
          ]
        }
      }
    }
  ]
}
```

## Upgrading Configuration

When upgrading Lien, your config may need migration:

```bash
# Automatic migration
lien init --upgrade

# Or run any command
lien index
```

Your old config is backed up to `.lien.config.json.vX.X.X.backup`.


