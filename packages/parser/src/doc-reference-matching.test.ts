import { describe, it, expect } from 'vitest';
import type { CodeChunk } from './types.js';
import { wordBoundaryRe, isDistinctiveToken } from './doc-reference-matching.js';

function makeChunk(file: string, content: string): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine: 1,
      endLine: content.split('\n').length,
      type: 'doc',
      language: 'markdown',
    },
  } as CodeChunk;
}

// ---------------------------------------------------------------------------
// wordBoundaryRe
// ---------------------------------------------------------------------------

describe('wordBoundaryRe', () => {
  it('does not match a token as a prefix of a hyphen-suffixed longer identifier', () => {
    expect(wordBoundaryRe('runner').test('packages/runner-hosted')).toBe(false);
  });

  it('does not match a token as a suffix of a hyphen-prefixed longer identifier', () => {
    expect(wordBoundaryRe('packages/runner').test('sub-packages/runner')).toBe(false);
  });

  it('matches when followed by / (a legitimate sub-path reference)', () => {
    expect(wordBoundaryRe('packages/runner').test('packages/runner/README.md')).toBe(true);
  });

  it('does not match adjacent to a hyphen (a different identifier)', () => {
    expect(wordBoundaryRe('fetchUser').test('the my-fetchUser helper')).toBe(false);
  });

  it('does not match adjacent to a period (a different identifier)', () => {
    expect(wordBoundaryRe('fetchUser').test('the fetchUser.old helper')).toBe(false);
  });

  it('matches the exact token surrounded by plain prose/punctuation', () => {
    expect(wordBoundaryRe('fetchUser').test('the `fetchUser` helper requires a config')).toBe(true);
  });

  it('escapes regex-special characters in the token', () => {
    expect(wordBoundaryRe('a.b(c)').test('call a.b(c) here')).toBe(true);
    expect(wordBoundaryRe('a.b(c)').test('no match here')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDistinctiveToken
// ---------------------------------------------------------------------------

describe('isDistinctiveToken', () => {
  it('is false when the token also reads as ordinary prose elsewhere in the corpus (#593 platform case)', () => {
    const docChunks = [
      makeChunk(
        'CLAUDE.md',
        '- `platform/` and `packages/runner` — hosted-platform remnants (see ' +
          '[ADR-012](docs/architecture/decisions/0012-self-hostable-review-action.md)); safe to ignore.',
      ),
      makeChunk(
        'STYLE_GUIDE.md',
        'Design identity for all Lien properties (documentation site, platform app).',
      ),
    ];
    expect(isDistinctiveToken('platform', docChunks)).toBe(false);
  });

  it('is false on a single prose hit even when every OTHER occurrence is path/code-context', () => {
    const docChunks = [
      makeChunk('CLAUDE.md', '- `platform/` — hosted-platform remnants; safe to ignore.'),
      makeChunk(
        'packages/review/test/harness/README.md',
        '# One-time setup (or use the existing platform .env)',
      ),
    ];
    expect(isDistinctiveToken('platform', docChunks)).toBe(false);
  });

  it('is false for a common short symbol name used as ordinary prose (index/config spam case)', () => {
    const docChunks = [
      makeChunk('CLAUDE.md', 'The `index` function builds the search index.'),
      makeChunk('docs/guide.md', 'See the index below for a full list of commands.'),
    ];
    expect(isDistinctiveToken('index', docChunks)).toBe(false);
  });

  it('is true (distinctive counter-example) when every occurrence sits in code/path context', () => {
    const docChunks = [
      makeChunk('CLAUDE.md', '- `zznovelplatform/` — internal tooling, safe to ignore.'),
      makeChunk('docs/guide.md', 'See `zznovelplatform/README.md` for the deprecation notice.'),
    ];
    expect(isDistinctiveToken('zznovelplatform', docChunks)).toBe(true);
  });

  it('is true for a distinctive symbol name backtick-quoted every time it appears', () => {
    const docChunks = [
      makeChunk('CLAUDE.md', 'The `createVectorDB` factory resolves worktree mode.'),
      makeChunk('docs/guide.md', 'See `createVectorDB(projectRoot)` for the entry point.'),
    ];
    expect(isDistinctiveToken('createVectorDB', docChunks)).toBe(true);
  });

  it('treats an occurrence inside a fenced code block as code context even without an adjacent backtick/slash (real false negative found dogfooding: createVectorDB in a README usage example)', () => {
    const docChunks = [
      makeChunk(
        'packages/core/README.md',
        [
          '## Usage',
          '',
          '```typescript',
          "import { createVectorDB } from '@liendev/core';",
          '',
          "const db = await createVectorDB('./my-project');",
          '```',
        ].join('\n'),
      ),
    ];
    expect(isDistinctiveToken('createVectorDB', docChunks)).toBe(true);
  });

  it('still suppresses a prose hit that sits OUTSIDE any fence, even alongside fenced code elsewhere', () => {
    const docChunks = [
      makeChunk(
        'docs/guide.md',
        [
          'The createVectorDB helper is handy.',
          '```typescript',
          "const db = await createVectorDB('./my-project');",
          '```',
        ].join('\n'),
      ),
    ];
    expect(isDistinctiveToken('createVectorDB', docChunks)).toBe(false);
  });

  it('is true (vacuously) when the token never appears in the corpus at all', () => {
    expect(isDistinctiveToken('somewordneverpresent', [])).toBe(true);
  });

  it('accepts a pre-narrowed corpus (chunks not containing the token trivially pass)', () => {
    const onlyMatching = [
      makeChunk('CLAUDE.md', '- `zznovelplatform/` — internal tooling, safe to ignore.'),
    ];
    const withUnrelatedChunk = [
      ...onlyMatching,
      makeChunk('docs/other.md', 'Nothing to do with the token at all.'),
    ];
    expect(isDistinctiveToken('zznovelplatform', onlyMatching)).toBe(
      isDistinctiveToken('zznovelplatform', withUnrelatedChunk),
    );
  });
});
