import { describe, it, expect } from 'vitest';
import { chunkMarkdownFile } from './markdown-chunker.js';

describe('chunkMarkdownFile', () => {
  it('splits into one chunk per heading section with a breadcrumb per chunk', () => {
    const content = ['# Title', 'intro text', '', '## Section A', 'content A'].join('\n');

    const chunks = chunkMarkdownFile('README.md', content);

    expect(chunks).toHaveLength(2);

    expect(chunks[0].metadata.symbolName).toBe('Title');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(3);
    expect(chunks[0].content).toBe('# Title\nintro text\n');
    expect(chunks[0].metadata.type).toBe('doc');
    expect(chunks[0].metadata.language).toBe('markdown');

    expect(chunks[1].metadata.symbolName).toBe('Title > Section A');
    expect(chunks[1].metadata.startLine).toBe(4);
    expect(chunks[1].metadata.endLine).toBe(5);
    expect(chunks[1].content).toBe('## Section A\ncontent A');
  });

  it('builds a full ancestor breadcrumb across three heading levels', () => {
    const content = ['# Docs', '', '## Install', '', '### Requirements', 'content'].join('\n');

    const chunks = chunkMarkdownFile('docs/install.md', content);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].metadata.symbolName).toBe('Docs');
    expect(chunks[1].metadata.symbolName).toBe('Docs > Install');
    expect(chunks[2].metadata.symbolName).toBe('Docs > Install > Requirements');
    expect(chunks[2].metadata.startLine).toBe(5);
    expect(chunks[2].metadata.endLine).toBe(6);
  });

  it('does not pop ancestors past a sibling heading of the same level', () => {
    const content = ['# Docs', '## A', 'a content', '## B', 'b content'].join('\n');

    const chunks = chunkMarkdownFile('docs/sib.md', content);

    expect(chunks.map(c => c.metadata.symbolName)).toEqual(['Docs', 'Docs > A', 'Docs > B']);
  });

  it('does not treat a "#" line inside a fenced code block as a heading', () => {
    const content = ['# Title', '', '```js', '# not a heading', '```', '', 'more text'].join('\n');

    const chunks = chunkMarkdownFile('README.md', content);

    // Whole file stays one section under "Title" -- the fenced "#" never
    // starts a new section.
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('Title');
    expect(chunks[0].content).toContain('# not a heading');
    expect(chunks[0].metadata.endLine).toBe(7);
  });

  it('treats tilde fences the same as backtick fences', () => {
    const content = ['# Title', '~~~', '# not a heading', '~~~', 'tail'].join('\n');

    const chunks = chunkMarkdownFile('README.md', content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('Title');
  });

  it('skips YAML front-matter, folding it into the preamble with no breadcrumb', () => {
    const content = [
      '---',
      'title: Test',
      '# not a heading',
      '---',
      '# Heading',
      'content here',
    ].join('\n');

    const chunks = chunkMarkdownFile('post.md', content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.symbolName).toBeUndefined();
    expect(chunks[0].content).toContain('# not a heading');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(4);

    expect(chunks[1].metadata.symbolName).toBe('Heading');
    expect(chunks[1].content).toBe('# Heading\ncontent here');
  });

  it('creates a preamble chunk for content before the first heading', () => {
    const content = ['Some intro paragraph.', '', '# First Heading', 'body'].join('\n');

    const chunks = chunkMarkdownFile('README.md', content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.symbolName).toBeUndefined();
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(2);
    expect(chunks[0].content).toBe('Some intro paragraph.\n');
  });

  it('splits an oversized section into overlapping line-window sub-chunks', () => {
    const bodyLines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    const content = ['# Section', ...bodyLines].join('\n');

    const chunks = chunkMarkdownFile('big.md', content, 10, 2);

    // 41 total lines > chunkSize*3 (30) -> must be split.
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => expect(c.metadata.symbolName).toBe('Section'));

    expect(chunks[0].metadata.startLine).toBe(1);
    // Overlap: second chunk starts before the first chunk ends.
    expect(chunks[1].metadata.startLine).toBeLessThan(chunks[0].metadata.endLine);
    // Last chunk reaches the end of the file (41 lines total).
    expect(chunks[chunks.length - 1].metadata.endLine).toBe(41);
  });

  it('returns a single chunk for a file with no headings', () => {
    const content = ['Hello', 'World', 'no headings here'].join('\n');

    const chunks = chunkMarkdownFile('plain.md', content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBeUndefined();
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(3);
    expect(chunks[0].content).toBe(content);
  });

  it('returns an empty array for an empty file', () => {
    expect(chunkMarkdownFile('empty.md', '')).toEqual([]);
  });

  it('passes through repoId/orgId tenant context', () => {
    const chunks = chunkMarkdownFile('README.md', '# Title\ncontent', 75, 10, {
      repoId: 'repo-1',
      orgId: 'org-1',
    });

    expect(chunks[0].metadata.repoId).toBe('repo-1');
    expect(chunks[0].metadata.orgId).toBe('org-1');
  });
});
