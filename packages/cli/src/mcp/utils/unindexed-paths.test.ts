import { describe, it, expect, vi } from 'vitest';
import {
  findUnindexedPaths,
  formatUnindexedPathsNote,
  formatNoIndexNote,
} from './unindexed-paths.js';
import type { VectorDBInterface } from '@liendev/core';

const getIndexedFilesMock = vi.fn<() => Promise<string[]>>();

vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual('@liendev/core');
  return {
    ...actual,
    ManifestManager: class {
      getIndexedFiles = getIndexedFilesMock;
    },
  };
});

function makeVectorDB(dbPath = '/fake/index/path'): VectorDBInterface {
  return { dbPath } as unknown as VectorDBInterface;
}

describe('findUnindexedPaths', () => {
  it('returns nothing when every requested path is in the manifest', async () => {
    getIndexedFilesMock.mockResolvedValue(['Command/Command.php', 'Application.php']);
    const result = await findUnindexedPaths(makeVectorDB(), ['Command/Command.php'], '/workspace');
    expect(result).toEqual([]);
  });

  it('reports a filepath with no manifest entry at all', async () => {
    getIndexedFilesMock.mockResolvedValue(['Command/Command.php']);
    const result = await findUnindexedPaths(
      makeVectorDB(),
      ['src/Command/Command.php'],
      '/workspace',
    );
    expect(result).toEqual(['src/Command/Command.php']);
  });

  it('in a mixed batch, reports only the unindexed entries — a good path never masks a bad one', async () => {
    getIndexedFilesMock.mockResolvedValue(['Command/Command.php']);
    const result = await findUnindexedPaths(
      makeVectorDB(),
      ['Command/Command.php', 'does/not/exist.php'],
      '/workspace',
    );
    expect(result).toEqual(['does/not/exist.php']);
  });

  it('canonicalizes against the workspace root before comparing', async () => {
    getIndexedFilesMock.mockResolvedValue(['Command/Command.php']);
    const result = await findUnindexedPaths(
      makeVectorDB(),
      ['/workspace/Command/Command.php'],
      '/workspace',
    );
    expect(result).toEqual([]);
  });

  it('fails open (reports nothing unindexed) when the manifest read throws', async () => {
    getIndexedFilesMock.mockRejectedValue(new Error('disk on fire'));
    const result = await findUnindexedPaths(makeVectorDB(), ['Command/Command.php'], '/workspace');
    expect(result).toEqual([]);
  });

  it('fails open when dbPath is missing (e.g. a test mock that never set one)', async () => {
    // ManifestManager's real constructor throws synchronously on a non-string
    // indexPath; the mock above doesn't reproduce that, so drive it through
    // the real class for this one case.
    vi.doUnmock('@liendev/core');
    const realModule = (await vi.importActual('./unindexed-paths.js')) as {
      findUnindexedPaths: typeof findUnindexedPaths;
    };
    const realFindUnindexedPaths = realModule.findUnindexedPaths;
    const result = await realFindUnindexedPaths(
      makeVectorDB(undefined as unknown as string),
      ['Command/Command.php'],
      '/workspace',
    );
    expect(result).toEqual([]);
  });
});

describe('formatUnindexedPathsNote', () => {
  it('returns undefined when nothing is unindexed', () => {
    expect(formatUnindexedPathsNote([])).toBeUndefined();
  });

  it('names every unindexed path and is unmissable (⚠ Lien: prefix)', () => {
    const note = formatUnindexedPathsNote(['src/Command/Command.php', 'does/not/exist.php']);
    expect(note).toContain('⚠ Lien:');
    expect(note).toContain('"src/Command/Command.php"');
    expect(note).toContain('"does/not/exist.php"');
  });
});

describe('formatNoIndexNote', () => {
  it('is unmissable (⚠ Lien: prefix) and states "no data" as an established fact, not a guess', () => {
    const note = formatNoIndexNote();
    expect(note).toContain('⚠ Lien:');
    expect(note).toContain('no data');
  });

  it('frames "lien index" as a correctness prerequisite, not a speed optimization', () => {
    const note = formatNoIndexNote();
    expect(note).toContain('lien index');
    expect(note).toContain('correctness prerequisite');
    expect(note).not.toContain('faster');
  });

  it('does not assert the symbol/pattern is absent from the code', () => {
    const note = formatNoIndexNote();
    expect(note).toMatch(/do not conclude/i);
  });
});
