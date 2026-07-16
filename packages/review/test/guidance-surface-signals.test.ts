import { describe, it, expect } from 'vitest';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  isGuidanceSurface,
  collectGuidanceSurfaceChanges,
  renderGuidanceSurfaceChanges,
  renderGuidanceSurfaceSection,
  type GuidanceSurfaceChange,
} from '../src/guidance-surface-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

function ctxWithPatches(patches?: Map<string, string>): ReviewContext {
  return {
    pr: patches ? { patches } : undefined,
    changedFiles: patches ? [...patches.keys()] : [],
    chunks: [],
  } as unknown as ReviewContext;
}

// Mirrors the PR #658 miss: a hook whose guidance text calls a keyword search
// "meaning-based discovery".
const HOOK_PATCH =
  '@@ -10,3 +10,3 @@\n' +
  ' # Suggest the right tool for exploration\n' +
  '-echo "Use search_code for meaning-based discovery of relevant code"\n' +
  '+echo "Use search_code for meaning-based discovery of relevant code (renamed)"\n' +
  ' exit 0';

const CLAUDE_MD_PATCH =
  '@@ -1,2 +1,2 @@\n' +
  ' ## Search\n' +
  '-Semantic search finds code by meaning.\n' +
  '+Semantic search finds code by meaning (via embeddings).';

// A design doc / ADR whose mechanism claim can drift from the code.
const ADR_PATCH =
  '@@ -1,3 +1,3 @@\n' +
  ' # ADR-0011: Remove embeddings\n' +
  '-search_code performs semantic (embedding-based) ranking.\n' +
  '+search_code performs lexical BM25 keyword ranking.';

// A changeset whose prose claims a public-API change.
const CHANGESET_PATCH =
  '@@ -0,0 +1,5 @@\n' +
  '+---\n' +
  "+'@liendev/core': minor\n" +
  '+---\n' +
  '+\n' +
  '+Add `createVectorDB()` to the public API.';

// A user-guide page under the docs site.
const SITE_GUIDE_PATCH =
  '@@ -1,2 +1,2 @@\n' +
  ' ## search_code\n' +
  '-Finds code by meaning using embeddings.\n' +
  '+Finds code by keyword using BM25.';

// ---------------------------------------------------------------------------
// isGuidanceSurface
// ---------------------------------------------------------------------------

describe('isGuidanceSurface', () => {
  it('matches CLAUDE.md at the root and at any depth', () => {
    expect(isGuidanceSurface('CLAUDE.md')).toBe(true);
    expect(isGuidanceSurface('packages/core/CLAUDE.md')).toBe(true);
  });

  it('matches shell hooks and .mdc rules under plugins/ and .cursor/', () => {
    expect(isGuidanceSurface('plugins/claude/hooks/augment-explore-task.sh')).toBe(true);
    expect(isGuidanceSurface('plugins/claude/rules/foo.mdc')).toBe(true);
    expect(isGuidanceSurface('.cursor/rules/lien.mdc')).toBe(true);
    expect(isGuidanceSurface('.cursor/hooks/setup.sh')).toBe(true);
  });

  it('matches project documentation surfaces (ADRs, docs tree, site guides, changesets)', () => {
    // Architecture decisions / design docs under the top-level docs/ tree.
    expect(isGuidanceSurface('docs/architecture/decisions/0009-extract-parser-package.md')).toBe(
      true,
    );
    expect(isGuidanceSurface('docs/architecture/worktree-aware-indexing.md')).toBe(true);
    expect(isGuidanceSurface('docs/guide.md')).toBe(true);
    // The published user-guide site.
    expect(isGuidanceSurface('packages/site/docs/guide/search.md')).toBe(true);
    // Changeset entries make public-API claims.
    expect(isGuidanceSurface('.changeset/brave-otters-add.md')).toBe(true);
  });

  it('does NOT match ordinary code, config, or out-of-scope docs/markdown', () => {
    // Parser-analyzable source is reviewed the normal way, not passed through.
    expect(isGuidanceSurface('packages/core/src/config/schema.ts')).toBe(false);
    // No blanket **/*.md: the root README, CHANGELOG, and source-tree markdown stay out.
    expect(isGuidanceSurface('README.md')).toBe(false);
    expect(isGuidanceSurface('CHANGELOG.md')).toBe(false);
    expect(isGuidanceSurface('packages/core/src/notes.md')).toBe(false);
    // Doc roots are anchored: only the top-level docs/ and packages/site/docs/.
    expect(isGuidanceSurface('packages/parser/docs/internal.md')).toBe(false);
    // .changeset is a flat dir of *.md — nested paths don't match.
    expect(isGuidanceSurface('.changeset/nested/foo.md')).toBe(false);
    // .sh/.mdc only under the two agent-guidance roots.
    expect(isGuidanceSurface('package.json')).toBe(false);
    expect(isGuidanceSurface('scripts/build.sh')).toBe(false);
    expect(isGuidanceSurface('src/rules/foo.mdc')).toBe(false);
    // Must be the full basename, not a suffix.
    expect(isGuidanceSurface('NOTCLAUDE.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectGuidanceSurfaceChanges
// ---------------------------------------------------------------------------

describe('collectGuidanceSurfaceChanges', () => {
  it('keeps guidance and doc surfaces (dropping code/README), smallest hunk first', () => {
    const patches = new Map<string, string>([
      ['packages/core/src/config/schema.ts', '@@ -1 +1 @@\n-a\n+b'],
      ['plugins/claude/hooks/augment-explore-task.sh', HOOK_PATCH],
      ['README.md', '@@ -1 +1 @@\n-x\n+y'],
      ['docs/architecture/decisions/0011-remove-embeddings.md', ADR_PATCH],
      ['.changeset/brave-otters-add.md', CHANGESET_PATCH],
      ['CLAUDE.md', CLAUDE_MD_PATCH],
    ]);
    const changes = collectGuidanceSurfaceChanges(patches);
    // Budget fairness: ordered by ascending hunk size so compact claim-dense
    // files can't be evicted by one voluminous prose file (PR #687 shape).
    const kept = [
      'plugins/claude/hooks/augment-explore-task.sh',
      'docs/architecture/decisions/0011-remove-embeddings.md',
      '.changeset/brave-otters-add.md',
      'CLAUDE.md',
    ];
    expect(changes.map(c => c.file).sort()).toEqual([...kept].sort());
    const sizes = changes.map(c => c.patch.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it('returns [] when no changed file is a guidance or doc surface', () => {
    const patches = new Map<string, string>([['src/index.ts', '@@ -1 +1 @@\n-a\n+b']]);
    expect(collectGuidanceSurfaceChanges(patches)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderGuidanceSurfaceChanges
// ---------------------------------------------------------------------------

describe('renderGuidanceSurfaceChanges', () => {
  it('returns "" for no changes', () => {
    expect(renderGuidanceSurfaceChanges([])).toBe('');
  });

  it('renders a labeled, fenced block with the raw hunk and the doc-truth framing', () => {
    const md = renderGuidanceSurfaceChanges([
      { file: 'plugins/claude/hooks/augment-explore-task.sh', patch: HOOK_PATCH },
    ]);
    expect(md).toContain('<guidance_surface_changes>');
    expect(md).toContain('</guidance_surface_changes>');
    expect(md).toContain(
      'plugins/claude/hooks/augment-explore-task.sh (guidance-surface change — not code-analyzed)',
    );
    expect(md).toContain('```diff');
    expect(md).toContain('meaning-based discovery');
    expect(md).toContain('doc-truth');
  });

  it('header does not let a raw hunk substitute for verifying code outside the diff', () => {
    const md = renderGuidanceSurfaceChanges([
      { file: 'plugins/claude/hooks/augment-explore-task.sh', patch: HOOK_PATCH },
    ]);
    expect(md).toContain(
      'call get_files_context (or read_file) on the described symbol to check, per the doc-truth protocol',
    );
  });

  it('passes through doc/ADR/changeset hunks and frames both kinds of surface', () => {
    const md = renderGuidanceSurfaceChanges([
      { file: 'docs/architecture/decisions/0011-remove-embeddings.md', patch: ADR_PATCH },
      { file: '.changeset/brave-otters-add.md', patch: CHANGESET_PATCH },
      { file: 'packages/site/docs/guide/search.md', patch: SITE_GUIDE_PATCH },
    ]);
    // Every doc surface is rendered as a labeled diff block with its hunk.
    expect(md).toContain('docs/architecture/decisions/0011-remove-embeddings.md');
    expect(md).toContain('.changeset/brave-otters-add.md');
    expect(md).toContain('packages/site/docs/guide/search.md');
    expect(md).toContain('createVectorDB');
    // The blurb frames agent-guidance AND project docs for the doc-truth check.
    expect(md).toContain('doc-truth');
    expect(md).toContain('.changeset');
    expect(md).toContain('packages/site/docs');
  });

  it('caps each file so one huge doc cannot evict the others', () => {
    const big = 'x'.repeat(5_000);
    const changes: GuidanceSurfaceChange[] = [
      { file: 'docs/a.md', patch: `@@ -1 +1 @@\n+${big}` },
      { file: 'docs/b.md', patch: `@@ -1 +1 @@\n+${big}` },
      { file: 'docs/c.md', patch: `@@ -1 +1 @@\n+${big}` },
    ];
    const md = renderGuidanceSurfaceChanges(changes);
    // Per-file cap (~3 KB) means all three still appear — the first doc does
    // not consume the whole budget and starve the rest.
    expect(md).toContain('docs/a.md');
    expect(md).toContain('docs/b.md');
    expect(md).toContain('docs/c.md');
    // Each oversized hunk is truncated in place, never silently dropped.
    expect(md).toMatch(/hunk truncated to respect the input budget/);
    // Nothing omitted at this size — no eviction.
    expect(md).not.toMatch(/more changed guidance-surface file\(s\) omitted/);
  });

  it('omits overflow files with an explicit count once the total budget is spent', () => {
    const big = 'x'.repeat(5_000);
    const changes: GuidanceSurfaceChange[] = Array.from({ length: 10 }, (_, i) => ({
      file: `docs/page-${i}.md`,
      patch: `@@ -1 +1 @@\n+${big}`,
    }));
    const md = renderGuidanceSurfaceChanges(changes);
    // The earliest files are shown (truncated); later ones are omitted LOUDLY.
    expect(md).toContain('docs/page-0.md');
    expect(md).toMatch(/hunk truncated to respect the input budget/);
    expect(md).toMatch(/\+\d+ more changed guidance-surface file\(s\) omitted/);
    // Bounded near the total budget (12 KB) plus fixed framing — not runaway
    // (all ten 5 KB hunks would be ~50 KB uncapped).
    expect(md.length).toBeLessThan(15_000);
  });
});

// ---------------------------------------------------------------------------
// renderGuidanceSurfaceSection
// ---------------------------------------------------------------------------

describe('renderGuidanceSurfaceSection', () => {
  it('returns "" when there is no diff', () => {
    expect(renderGuidanceSurfaceSection(ctxWithPatches())).toBe('');
  });

  it('renders the block from context patches, skipping non-guidance files', () => {
    const section = renderGuidanceSurfaceSection(
      ctxWithPatches(
        new Map([
          ['src/index.ts', '@@ -1 +1 @@\n-a\n+b'],
          ['docs/architecture/decisions/0011-remove-embeddings.md', ADR_PATCH],
          ['plugins/claude/hooks/augment-explore-task.sh', HOOK_PATCH],
        ]),
      ),
    );
    expect(section).toContain('<guidance_surface_changes>');
    expect(section).toContain('docs/architecture/decisions/0011-remove-embeddings.md');
    expect(section).toContain('plugins/claude/hooks/augment-explore-task.sh');
    expect(section).not.toContain('src/index.ts');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring
// ---------------------------------------------------------------------------

describe('buildInitialMessage guidance-surface injection', () => {
  it('includes the <guidance_surface_changes> block when a guidance surface changed', () => {
    const ctx = ctxWithPatches(
      new Map([['plugins/claude/hooks/augment-explore-task.sh', HOOK_PATCH]]),
    );
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).toContain('<guidance_surface_changes>');
    expect(message).toContain('plugins/claude/hooks/augment-explore-task.sh');
  });

  it('includes the block when only a project doc changed', () => {
    const ctx = ctxWithPatches(
      new Map([['docs/architecture/decisions/0011-remove-embeddings.md', ADR_PATCH]]),
    );
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).toContain('<guidance_surface_changes>');
    expect(message).toContain('docs/architecture/decisions/0011-remove-embeddings.md');
  });

  it('omits the block when no guidance surface changed', () => {
    const ctx = ctxWithPatches(new Map([['src/index.ts', '@@ -1 +1 @@\n-a\n+b']]));
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).not.toContain('<guidance_surface_changes>');
  });
});
