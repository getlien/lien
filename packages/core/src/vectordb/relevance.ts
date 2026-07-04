/**
 * Relevance category for a search result.
 *
 * With lexical FTS5 search this is derived from BM25 rank banding
 * (see fts-search.ts `toRelevance`); scroll/scan operations that do no
 * scoring report 'not_relevant'.
 */
export type RelevanceCategory = 'highly_relevant' | 'relevant' | 'loosely_related' | 'not_relevant';
