import { describe, it, expect } from 'vitest';
import type { CodeChunk } from './types.js';
import {
  wordBoundaryRe,
  isDistinctiveToken,
  isUnambiguousIdentifierShape,
} from './doc-reference-matching.js';

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

  it('treats an occurrence inside a fenced code block as code context even without an adjacent backtick/slash (real false negative found dogfooding: a bare lowercase token in a README usage example)', () => {
    const docChunks = [
      makeChunk(
        'packages/core/README.md',
        [
          '## Usage',
          '',
          '```typescript',
          "import { zznovelfence } from '@liendev/core';",
          '',
          "const db = await zznovelfence('./my-project');",
          '```',
        ].join('\n'),
      ),
    ];
    // A bare lowercase token (no uppercase/underscore) still goes through the
    // strict corpus-driven gate — this isolates the FENCE fix specifically,
    // independent of the identifier-shape exemption tested below.
    expect(isUnambiguousIdentifierShape('zznovelfence')).toBe(false);
    expect(isDistinctiveToken('zznovelfence', docChunks)).toBe(true);
  });

  it('still suppresses a bare lowercase token on a prose hit OUTSIDE any fence, even alongside fenced code elsewhere', () => {
    const docChunks = [
      makeChunk(
        'docs/guide.md',
        [
          'The zznovelfence helper is handy.',
          '```typescript',
          "const db = await zznovelfence('./my-project');",
          '```',
        ].join('\n'),
      ),
    ];
    expect(isDistinctiveToken('zznovelfence', docChunks)).toBe(false);
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

// ---------------------------------------------------------------------------
// isUnambiguousIdentifierShape + the exemption it grants in isDistinctiveToken
// ---------------------------------------------------------------------------

describe('isUnambiguousIdentifierShape', () => {
  it('is true for camelCase (internal capital)', () => {
    expect(isUnambiguousIdentifierShape('createVectorDB')).toBe(true);
    expect(isUnambiguousIdentifierShape('authToken')).toBe(true);
  });

  it('is true for PascalCase', () => {
    expect(isUnambiguousIdentifierShape('MyClass')).toBe(true);
  });

  it('is true for a single Capitalized word (a proper-noun-style class/type name)', () => {
    expect(isUnambiguousIdentifierShape('Widget')).toBe(true);
  });

  it('is true for a token containing an underscore', () => {
    expect(isUnambiguousIdentifierShape('my_helper')).toBe(true);
  });

  it('is false for a bare all-lowercase word', () => {
    expect(isUnambiguousIdentifierShape('index')).toBe(false);
    expect(isUnambiguousIdentifierShape('config')).toBe(false);
    expect(isUnambiguousIdentifierShape('platform')).toBe(false);
  });
});

describe('isDistinctiveToken — identifier-shape exemption (reviewer repros)', () => {
  it('createVectorDB fires even with plain, un-backticked prose mentions present (the flagship dogfood case)', () => {
    const docChunks = [
      makeChunk(
        'docs/architecture/blast-radius-nudge.md',
        'Callers will break — check get_dependents. 9 docs reference createVectorDB: CLAUDE.md, docs/guide.md.',
      ),
      makeChunk(
        'CLAUDE.md',
        'This module also mentions createVectorDB in passing, with no backticks at all.',
      ),
    ];
    expect(isDistinctiveToken('createVectorDB', docChunks)).toBe(true);
  });

  it("Widget's possessive in plain prose still fires (a Capitalized class name, not a common English word)", () => {
    const docChunks = [
      makeChunk('docs/guide.md', "The Widget's constructor accepts an options object."),
    ];
    expect(isDistinctiveToken('Widget', docChunks)).toBe(true);
  });

  it('authToken in YAML front-matter prose still fires', () => {
    const docChunks = [
      makeChunk(
        'docs/guide.md',
        ['---', 'summary: explains how authToken is issued and rotated', '---', '# Auth'].join(
          '\n',
        ),
      ),
    ];
    expect(isDistinctiveToken('authToken', docChunks)).toBe(true);
  });

  it('MyClass named in a heading (not backticked) still fires', () => {
    const docChunks = [makeChunk('docs/guide.md', '## MyClass overview')];
    expect(isDistinctiveToken('MyClass', docChunks)).toBe(true);
  });

  it('a bare lowercase common word (index/config/platform) in prose is still suppressed', () => {
    const indexDocs = [makeChunk('docs/guide.md', 'See the index below for a full list.')];
    const configDocs = [makeChunk('docs/guide.md', 'Edit the config to change defaults.')];
    const platformDocs = [
      makeChunk('docs/guide.md', 'Design identity for all Lien properties (platform app).'),
    ];
    expect(isDistinctiveToken('index', indexDocs)).toBe(false);
    expect(isDistinctiveToken('config', configDocs)).toBe(false);
    expect(isDistinctiveToken('platform', platformDocs)).toBe(false);
  });
});
