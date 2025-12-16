# @liendev/lien

## 0.20.0

### Minor Changes

- 3ff7a26: Extract core indexing and analysis into `@liendev/core` package

  **New: @liendev/core**

  - Standalone package for indexing, embeddings, vector search, and complexity analysis
  - Programmatic API for third-party integrations
  - Can be used by cloud workers with warm embeddings

  **CLI**

  - Now imports from `@liendev/core` instead of bundled modules
  - Thinner package, shared dependency on core

  **Action (Breaking)**

  - No longer requires `npm install -g @liendev/lien`
  - Simplified setup: just `uses: getlien/lien-action@v1`
  - Automatic delta tracking with `enable_delta_tracking: true`

### Patch Changes

- Updated dependencies [3ff7a26]
  - @liendev/core@0.20.0
