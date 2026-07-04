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

  it('does NOT match ordinary code, docs, config, or out-of-scope .sh/.mdc', () => {
    // Parser-analyzable source is reviewed the normal way, not passed through.
    expect(isGuidanceSurface('packages/core/src/config/schema.ts')).toBe(false);
    // Tight scope: not every markdown/json, and .sh/.mdc only under the two roots.
    expect(isGuidanceSurface('README.md')).toBe(false);
    expect(isGuidanceSurface('docs/guide.md')).toBe(false);
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
  it('keeps only guidance surfaces and preserves patch order', () => {
    const patches = new Map<string, string>([
      ['packages/core/src/config/schema.ts', '@@ -1 +1 @@\n-a\n+b'],
      ['plugins/claude/hooks/augment-explore-task.sh', HOOK_PATCH],
      ['README.md', '@@ -1 +1 @@\n-x\n+y'],
      ['CLAUDE.md', CLAUDE_MD_PATCH],
    ]);
    const changes = collectGuidanceSurfaceChanges(patches);
    expect(changes.map(c => c.file)).toEqual([
      'plugins/claude/hooks/augment-explore-task.sh',
      'CLAUDE.md',
    ]);
    expect(changes[0].patch).toBe(HOOK_PATCH);
  });

  it('returns [] when no changed file is a guidance surface', () => {
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

  it('caps total bytes and notes the omitted files rather than dropping silently', () => {
    const big = 'x'.repeat(5_000);
    const changes: GuidanceSurfaceChange[] = [
      { file: 'plugins/a/hooks/one.sh', patch: `@@ -1 +1 @@\n+${big}` },
      { file: 'plugins/a/hooks/two.sh', patch: `@@ -1 +1 @@\n+${big}` },
      { file: 'plugins/a/hooks/three.sh', patch: `@@ -1 +1 @@\n+${big}` },
    ];
    const md = renderGuidanceSurfaceChanges(changes);
    expect(md).toContain('plugins/a/hooks/one.sh');
    // Budget (6000) fits the first file whole; the second overflows and is
    // truncated in place; the third is omitted with an explicit note.
    expect(md).toMatch(/hunk truncated to respect the input budget/);
    expect(md).toMatch(/\+1 more changed guidance-surface file\(s\) omitted/);
    // Passed-through hunk content stays within budget; only the fixed framing
    // (header + notes + closing tag) sits on top. Bounded, not runaway
    // (all three 5 KB hunks would be ~15 KB uncapped).
    expect(md.length).toBeLessThan(6_000 + 2_000);
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
          ['plugins/claude/hooks/augment-explore-task.sh', HOOK_PATCH],
        ]),
      ),
    );
    expect(section).toContain('<guidance_surface_changes>');
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

  it('omits the block when no guidance surface changed', () => {
    const ctx = ctxWithPatches(new Map([['src/index.ts', '@@ -1 +1 @@\n-a\n+b']]));
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).not.toContain('<guidance_surface_changes>');
  });
});
