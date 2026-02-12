/**
 * Qdrant filter types for stronger type-safety when constructing filters.
 */
interface QdrantMatch {
  value?: string | number | boolean;
  text?: string;
  any?: string[];
}

interface QdrantCondition {
  key: string;
  match: QdrantMatch;
}

interface QdrantFilter {
  must: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

/**
 * Builder class for constructing Qdrant filters.
 * Simplifies filter construction and reduces complexity.
 */
export class QdrantFilterBuilder {
  private filter: QdrantFilter;

  constructor(orgId: string) {
    this.filter = {
      must: [{ key: 'orgId', match: { value: orgId } }],
    };
  }

  addRepoContext(repoId: string, branch: string, commitSha: string): this {
    this.filter.must.push(
      { key: 'repoId', match: { value: repoId } },
      { key: 'branch', match: { value: branch } },
      { key: 'commitSha', match: { value: commitSha } },
    );
    return this;
  }

  addRepoIds(repoIds: string[]): this {
    const cleanedRepoIds = repoIds.map(id => id.trim()).filter(id => id.length > 0);

    // If caller passed repoIds but all were empty/invalid after cleaning,
    // fail fast instead of silently dropping the repoId filter (which would
    // otherwise widen the query to all repos in the org).
    if (repoIds.length > 0 && cleanedRepoIds.length === 0) {
      throw new Error(
        'Invalid repoIds: all provided repoIds are empty or whitespace. ' +
          'Provide at least one non-empty repoId or omit repoIds entirely.',
      );
    }

    if (cleanedRepoIds.length > 0) {
      this.filter.must.push({
        key: 'repoId',
        match: { any: cleanedRepoIds },
      });
    }
    return this;
  }

  addLanguage(language: string): this {
    const cleanedLanguage = language.trim();
    if (cleanedLanguage.length === 0) {
      throw new Error('Invalid language: language must be a non-empty, non-whitespace string.');
    }
    this.filter.must.push({ key: 'language', match: { value: cleanedLanguage } });
    return this;
  }

  addSymbolType(symbolType: string): this {
    const cleanedSymbolType = symbolType.trim();
    if (cleanedSymbolType.length === 0) {
      throw new Error('Invalid symbolType: symbolType must be a non-empty, non-whitespace string.');
    }
    this.filter.must.push({ key: 'symbolType', match: { value: cleanedSymbolType } });
    return this;
  }

  addSymbolTypes(symbolTypes: string[]): this {
    const cleaned = symbolTypes.map(s => s.trim()).filter(s => s.length > 0);
    if (cleaned.length === 0) {
      throw new Error(
        'Invalid symbolTypes: at least one non-empty, non-whitespace string is required.',
      );
    }
    this.filter.must.push({ key: 'symbolType', match: { any: cleaned } });
    return this;
  }

  /**
   * Add symbol type filter with backward-compatible semantics.
   * 'function' matches both 'function' and 'method' records because
   * pre-AST indices stored methods under the 'function' type.
   */
  addSymbolTypeFilter(symbolType: 'function' | 'method' | 'class' | 'interface'): this {
    if (symbolType === 'function') {
      return this.addSymbolTypes(['function', 'method']);
    }
    return this.addSymbolType(symbolType);
  }

  addFileFilter(file: string | string[]): this {
    if (typeof file === 'string') {
      const cleaned = file.trim();
      if (cleaned.length === 0) {
        throw new Error('Invalid file filter: file path must contain non-whitespace characters.');
      }
      this.filter.must.push({ key: 'file', match: { value: cleaned } });
    } else {
      const cleaned = file.map(f => f.trim()).filter(f => f.length > 0);
      if (cleaned.length === 0) {
        throw new Error(
          'Invalid file filter: at least one file path must contain non-whitespace characters.',
        );
      }
      this.filter.must.push({ key: 'file', match: { any: cleaned } });
    }
    return this;
  }

  addPattern(pattern: string, key: 'file' | 'symbolName' = 'file'): this {
    const cleanedPattern = pattern.trim();
    if (cleanedPattern.length === 0) {
      throw new Error('Invalid pattern: pattern must be a non-empty, non-whitespace string.');
    }
    this.filter.must.push({ key, match: { text: cleanedPattern } });
    return this;
  }

  addBranch(branch: string): this {
    const cleanedBranch = branch.trim();
    // Prevent constructing a filter for an empty/whitespace-only branch,
    // which would search for `branch == ""` and almost certainly return no results.
    if (cleanedBranch.length === 0) {
      throw new Error('Invalid branch: branch must be a non-empty, non-whitespace string.');
    }
    this.filter.must.push({ key: 'branch', match: { value: cleanedBranch } });
    return this;
  }

  build(): QdrantFilter {
    return this.filter;
  }
}

/**
 * Validate filter options for buildBaseFilter.
 *
 * This is a separate function to enable unit testing of validation logic.
 * The validations ensure that conflicting options are not used together.
 *
 * @param options - Filter options to validate
 * @throws Error if conflicting options are detected
 */
export function validateFilterOptions(options: {
  repoIds?: string[];
  branch?: string;
  includeCurrentRepo?: boolean;
}): void {
  // Validate: includeCurrentRepo and repoIds are mutually exclusive
  // Note: `includeCurrentRepo !== false` treats undefined as "enabled" (default behavior).
  // Callers must explicitly pass includeCurrentRepo=false when using repoIds for cross-repo queries.
  if (options.includeCurrentRepo !== false && options.repoIds && options.repoIds.length > 0) {
    throw new Error(
      'Cannot use repoIds when includeCurrentRepo is enabled (the default). ' +
        'These options are mutually exclusive. Set includeCurrentRepo=false to perform cross-repo queries with repoIds.',
    );
  }

  // Validate: branch parameter should only be used when includeCurrentRepo is false.
  // As above, `includeCurrentRepo !== false` treats both undefined and true as "enabled"
  // for the current repo context, so callers must explicitly pass false for cross-repo.
  if (options.branch && options.includeCurrentRepo !== false) {
    throw new Error(
      'Cannot use branch parameter when includeCurrentRepo is enabled (the default). ' +
        'Branch is automatically included via the current repo context. Set includeCurrentRepo=false to specify a branch explicitly.',
    );
  }
}
