import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import type { ReviewRule, ResolvedRules } from '../src/plugins/agent/types.js';
import {
  computeAddedVariants,
  resolveFamilyExisting,
  computeVariantSweepContexts,
  renderVariantSweepCandidates,
  renderVariantSweepSection,
} from '../src/variant-sweep-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(file: string, startLine: number, content: string): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'block',
      language: 'typescript',
    },
  } as unknown as CodeChunk;
}

function makeContext(opts: {
  patches?: Map<string, string>;
  chunks?: CodeChunk[];
  repoChunks?: CodeChunk[];
}): ReviewContext {
  const pr = opts.patches ? { patches: opts.patches } : undefined;
  return {
    pr,
    chunks: opts.chunks ?? [],
    repoChunks: opts.repoChunks,
    changedFiles: [],
  } as unknown as ReviewContext;
}

function patch(...lines: string[]): string {
  return lines.join('\n');
}

function incompleteHandlingRule(): ReviewRule {
  return {
    id: 'incomplete-handling',
    name: 'Incomplete Interface/Type Handling',
    description: 'test rule',
    prompt: 'test prompt',
    triggers: { always: true },
    severity: 'error',
    category: 'logic_error',
    enabled: true,
    source: 'builtin',
  };
}

function resolvedRulesWith(...ids: string[]): ResolvedRules {
  return {
    active: ids.map(id => ({ ...incompleteHandlingRule(), id })),
    skipped: [],
  };
}

// ---------------------------------------------------------------------------
// Fixtures reused across tests
// ---------------------------------------------------------------------------

const COLOR_ENUM = ['export enum Color {', '  Red,', '  Blue,', '  Green,', '}'].join('\n');

const COLOR_ENUM_PATCH = patch(
  '@@ -1,4 +1,5 @@',
  ' export enum Color {',
  '   Red,',
  '   Blue,',
  '+  Green,',
  ' }',
);

const EDITOR_ID_UNION = [
  'export type EditorId =',
  "  | 'cursor'",
  "  | 'claude-code'",
  "  | 'windsurf'",
  "  | 'zed';",
].join('\n');

// The old file's 'windsurf' arm carried the terminating `;`; the new file
// moves it to the new 'zed' arm — a realistic Prettier-style multi-line
// union reformat. 'windsurf' reappears on an added line too, but its
// identifier also appears in the removed line, so `isGenuinelyNew` correctly
// excludes it — only 'zed' is a genuine addition.
const EDITOR_ID_UNION_PATCH = patch(
  '@@ -1,4 +1,5 @@',
  ' export type EditorId =',
  "   | 'cursor'",
  "   | 'claude-code'",
  "-  | 'windsurf';",
  "+  | 'windsurf'",
  "+  | 'zed';",
);

function colorSwitchConsumer(withGreen = false): string {
  const greenCase = withGreen ? "\n    case Color.Green:\n      return 'green';" : '';
  return [
    'function label(c: Color): string {',
    '  switch (c) {',
    '    case Color.Red:',
    "      return 'red';",
    '    case Color.Blue:',
    "      return 'blue';" + greenCase,
    '    default:',
    "      return 'unknown';",
    '  }',
    '}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// computeAddedVariants
// ---------------------------------------------------------------------------

describe('computeAddedVariants', () => {
  it('detects a new enum member added to an existing enum', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const added = computeAddedVariants(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Color', variant: 'Green', file: 'src/color.ts', kind: 'enum' },
    ]);
  });

  it('does not flag a brand-new enum (no prior consumers could exist)', () => {
    const patches = new Map([
      [
        'src/new-enum.ts',
        patch('@@ -0,0 +1,4 @@', '+export enum Status {', '+  Active,', '+  Inactive,', '+}'),
      ],
    ]);
    const chunks = [
      makeChunk('src/new-enum.ts', 1, 'export enum Status {\n  Active,\n  Inactive,\n}'),
    ];
    expect(computeAddedVariants(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('does not treat a same-identifier value edit as an addition', () => {
    const content = ['export enum Color {', "  Red = 'crimson',", '  Blue,', '}'].join('\n');
    const patches = new Map([
      [
        'src/color.ts',
        patch(
          '@@ -1,4 +1,4 @@',
          ' export enum Color {',
          "-  Red = 'red',",
          "+  Red = 'crimson',",
          '   Blue,',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/color.ts', 1, content)];
    expect(computeAddedVariants(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('treats a renamed member as an addition (overlap with rename-sweep is accepted)', () => {
    const content = ['export enum Color {', '  Red,', '  Cyan,', '}'].join('\n');
    const patches = new Map([
      [
        'src/color.ts',
        patch('@@ -1,3 +1,3 @@', ' export enum Color {', '   Red,', '-  Blue,', '+  Cyan,'),
      ],
    ]);
    const chunks = [makeChunk('src/color.ts', 1, content)];
    const added = computeAddedVariants(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Color', variant: 'Cyan', file: 'src/color.ts', kind: 'enum' },
    ]);
  });

  it('detects a new arm added to a single-line union type', () => {
    const content = "export type FailOn = 'error' | 'never' | 'any';";
    const patches = new Map([
      [
        'src/inputs.ts',
        patch(
          '@@ -1,1 +1,1 @@',
          "-export type FailOn = 'error' | 'never';",
          "+export type FailOn = 'error' | 'never' | 'any';",
        ),
      ],
    ]);
    const chunks = [makeChunk('src/inputs.ts', 1, content)];
    const added = computeAddedVariants(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'FailOn', variant: 'any', file: 'src/inputs.ts', kind: 'union' },
    ]);
  });

  it('detects a new arm added to a multi-line pipe-style union (EditorId shape)', () => {
    const content = EDITOR_ID_UNION;
    const patches = new Map([['src/init.ts', EDITOR_ID_UNION_PATCH]]);
    const chunks = [makeChunk('src/init.ts', 1, content)];
    const added = computeAddedVariants(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'EditorId', variant: 'zed', file: 'src/init.ts', kind: 'union' },
    ]);
  });

  it('detects a new key added to a const-object-as-const value map', () => {
    const content = [
      'export const Editors = {',
      "  cursor: 'Cursor',",
      "  windsurf: 'Windsurf',",
      "  zed: 'Zed',",
      '} as const;',
    ].join('\n');
    const patches = new Map([
      [
        'src/editors.ts',
        patch(
          '@@ -1,4 +1,5 @@',
          ' export const Editors = {',
          "   cursor: 'Cursor',",
          "   windsurf: 'Windsurf',",
          "+  zed: 'Zed',",
          ' } as const;',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/editors.ts', 1, content)];
    const added = computeAddedVariants(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Editors', variant: 'zed', file: 'src/editors.ts', kind: 'const-object' },
    ]);
  });

  it('does not treat a plain object literal (no `as const`) as a variant family', () => {
    const content = ['export const CONFIG = {', '  a: 1,', '  b: 2,', '  c: 3,', '};'].join('\n');
    const patches = new Map([
      [
        'src/config.ts',
        patch(
          '@@ -1,3 +1,4 @@',
          ' export const CONFIG = {',
          '   a: 1,',
          '   b: 2,',
          '+  c: 3,',
          ' };',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/config.ts', 1, content)];
    expect(computeAddedVariants(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('returns [] when there is no diff or no chunks', () => {
    expect(computeAddedVariants(makeContext({}))).toEqual([]);
    expect(
      computeAddedVariants(makeContext({ patches: new Map([['a.ts', 'x']]), chunks: [] })),
    ).toEqual([]);
  });

  it('ignores non-TS/JS files', () => {
    const patches = new Map([['src/color.rs', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.rs', 1, COLOR_ENUM)];
    expect(computeAddedVariants(makeContext({ patches, chunks }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveFamilyExisting
// ---------------------------------------------------------------------------

describe('resolveFamilyExisting', () => {
  it('returns existing members minus the added ones', () => {
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const context = makeContext({ chunks });
    const family = resolveFamilyExisting(
      context,
      'src/color.ts',
      'enum',
      'Color',
      new Set(['Green']),
    );
    expect(family?.existingVariants).toEqual(['Red', 'Blue']);
  });

  it('returns null when the declaration cannot be found', () => {
    const context = makeContext({ chunks: [] });
    expect(resolveFamilyExisting(context, 'src/color.ts', 'enum', 'Color', new Set())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeVariantSweepContexts
// ---------------------------------------------------------------------------

describe('computeVariantSweepContexts', () => {
  it('flags a stale switch that handles >= 2 existing variants but omits the new one', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const repoChunks = [makeChunk('src/consumer.ts', 1, colorSwitchConsumer(false))];
    const contexts = computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ typeName: 'Color', variant: 'Green', kind: 'enum' });
    expect(contexts[0].consumers).toHaveLength(1);
    expect(contexts[0].consumers[0].file).toBe('src/consumer.ts');
    expect(contexts[0].consumers[0].handledVariants.sort()).toEqual(['Blue', 'Red']);
  });

  it('does not flag a consumer already updated in the same diff (new variant present in head)', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const repoChunks = [makeChunk('src/consumer.ts', 1, colorSwitchConsumer(true))];
    expect(computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }))).toEqual([]);
  });

  it('does not flag a consumer with only a default case (no variant enumerated)', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const defaultOnly = [
      'function label(c: Color): string {',
      '  switch (c) {',
      '    default:',
      "      return 'unknown';",
      '  }',
      '}',
    ].join('\n');
    const repoChunks = [makeChunk('src/consumer.ts', 1, defaultOnly)];
    expect(computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }))).toEqual([]);
  });

  it('does not flag a consumer referencing only a single existing variant', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const single = 'function isRed(c: Color): boolean {\n  return c === Color.Red;\n}';
    const repoChunks = [makeChunk('src/consumer.ts', 1, single)];
    expect(computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }))).toEqual([]);
  });

  it('does not flag when the added variant is already handled elsewhere', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    // Two consumers: one stale (should be flagged), one that already handles Green.
    const stale = colorSwitchConsumer(false);
    const handled = colorSwitchConsumer(true);
    const repoChunks = [
      makeChunk('src/consumer-a.ts', 1, stale),
      makeChunk('src/consumer-b.ts', 1, handled),
    ];
    const contexts = computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }));
    expect(contexts).toHaveLength(1);
    expect(contexts[0].consumers.map(c => c.file)).toEqual(['src/consumer-a.ts']);
  });

  it('does not flag a non-enum object literal with coincidentally-matching bare keys', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    // Bare (non-computed) keys named after the enum members — NOT a `[Color.X]:`
    // computed reference, so this must not match the enum's qualified token form.
    const unrelated = 'const paintCosts = {\n  Red: 10,\n  Blue: 12,\n};';
    const repoChunks = [makeChunk('src/paint.ts', 1, unrelated)];
    expect(computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }))).toEqual([]);
  });

  it('flags a mapping table keyed by computed enum references', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const mapping = [
      'const HEX: Record<Color, string> = {',
      '  [Color.Red]: "#f00",',
      '  [Color.Blue]: "#00f",',
      '};',
    ].join('\n');
    const repoChunks = [makeChunk('src/hex.ts', 1, mapping)];
    const contexts = computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }));
    expect(contexts).toHaveLength(1);
    expect(contexts[0].consumers[0].handledVariants.sort()).toEqual(['Blue', 'Red']);
  });

  it('flags a mapping table keyed by quoted union-string literals (EditorId/EDITORS shape)', () => {
    const patches = new Map([['src/init.ts', EDITOR_ID_UNION_PATCH]]);
    const chunks = [makeChunk('src/init.ts', 1, EDITOR_ID_UNION)];
    const editors = [
      'const EDITORS: Record<EditorId, EditorDefinition> = {',
      "  cursor: { name: 'Cursor' },",
      "  'claude-code': { name: 'Claude Code' },",
      "  windsurf: { name: 'Windsurf' },",
      '};',
    ].join('\n');
    // Realistic placement: EDITORS lives further down the SAME file as
    // EditorId, at a line range that does not overlap the union declaration.
    const repoChunks = [makeChunk('src/init.ts', 20, editors)];
    const contexts = computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }));
    expect(contexts).toHaveLength(1);
    expect(contexts[0].typeName).toBe('EditorId');
    expect(contexts[0].variant).toBe('zed');
    expect(contexts[0].consumers[0].handledVariants.sort()).toEqual([
      'claude-code',
      'cursor',
      'windsurf',
    ]);
  });

  it('handles multiple independent families in the same PR without crosstalk', () => {
    const sizeContent = "export type Size = 'small' | 'medium' | 'large' | 'xlarge';";
    const patches = new Map([
      ['src/color.ts', COLOR_ENUM_PATCH],
      [
        'src/size.ts',
        patch(
          '@@ -1,1 +1,1 @@',
          "-export type Size = 'small' | 'medium' | 'large';",
          "+export type Size = 'small' | 'medium' | 'large' | 'xlarge';",
        ),
      ],
    ]);
    const chunks = [
      makeChunk('src/color.ts', 1, COLOR_ENUM),
      makeChunk('src/size.ts', 1, sizeContent),
    ];
    const sizeConsumer = [
      'function px(s: Size): number {',
      "  if (s === 'small') return 8;",
      "  if (s === 'medium') return 12;",
      "  if (s === 'large') return 16;",
      '  return 12;',
      '}',
    ].join('\n');
    const repoChunks = [
      makeChunk('src/consumer.ts', 1, colorSwitchConsumer(false)),
      makeChunk('src/size-consumer.ts', 1, sizeConsumer),
    ];
    const contexts = computeVariantSweepContexts(makeContext({ patches, chunks, repoChunks }));
    const byType = Object.fromEntries(contexts.map(c => [c.typeName, c]));
    expect(byType.Color.variant).toBe('Green');
    expect(byType.Size.variant).toBe('xlarge');
    expect(byType.Color.consumers[0].file).toBe('src/consumer.ts');
    expect(byType.Size.consumers[0].file).toBe('src/size-consumer.ts');
  });

  it('returns [] when there are no added variants or no repo index', () => {
    expect(computeVariantSweepContexts(makeContext({}))).toEqual([]);
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    expect(computeVariantSweepContexts(makeContext({ patches, chunks }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderVariantSweepCandidates
// ---------------------------------------------------------------------------

describe('renderVariantSweepCandidates', () => {
  it('returns "" for no contexts', () => {
    expect(renderVariantSweepCandidates([])).toBe('');
  });

  it('renders the block naming the type/variant/file and consumer sites', () => {
    const md = renderVariantSweepCandidates([
      {
        typeName: 'Color',
        variant: 'Green',
        file: 'src/color.ts',
        kind: 'enum',
        consumers: [{ file: 'src/consumer.ts', line: 3, handledVariants: ['Blue', 'Red'] }],
      },
    ]);
    expect(md).toContain('<variant_sweep_candidates>');
    expect(md).toContain('</variant_sweep_candidates>');
    expect(md).toContain('Color.Green (added in src/color.ts)');
    expect(md).toContain('src/consumer.ts:3 (handles: Blue, Red)');
  });

  it('caps at MAX_ENTRIES (12) with an explicit omission note — never truncates silently', () => {
    const contexts = Array.from({ length: 15 }, (_, i) => ({
      typeName: `Type${i}`,
      variant: 'New',
      file: 'src/a.ts',
      kind: 'enum' as const,
      consumers: [{ file: 'src/b.ts', line: 1, handledVariants: ['X', 'Y'] }],
    }));
    const md = renderVariantSweepCandidates(contexts);
    expect(md).toContain('more added variant(s) omitted');
    expect(md).toContain('+3 more');
  });

  it('omits the truncation note when under the cap', () => {
    const md = renderVariantSweepCandidates([
      {
        typeName: 'Color',
        variant: 'Green',
        file: 'src/color.ts',
        kind: 'enum',
        consumers: [{ file: 'src/consumer.ts', line: 3, handledVariants: ['Blue', 'Red'] }],
      },
    ]);
    expect(md).not.toContain('omitted');
  });
});

// ---------------------------------------------------------------------------
// renderVariantSweepSection
// ---------------------------------------------------------------------------

describe('renderVariantSweepSection', () => {
  it("returns '' when the PR adds no variant with a stale consumer", () => {
    expect(renderVariantSweepSection(makeContext({}))).toBe('');
  });

  it('renders candidates found from context', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const repoChunks = [makeChunk('src/consumer.ts', 1, colorSwitchConsumer(false))];
    const section = renderVariantSweepSection(makeContext({ patches, chunks, repoChunks }));
    expect(section).toContain('<variant_sweep_candidates>');
    expect(section).toContain('Color.Green');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage injection (rule-gated, mirrors catch-discrimination)
// ---------------------------------------------------------------------------

describe('buildInitialMessage injection (rule-gated)', () => {
  function contextWithStaleSwitch(): ReviewContext {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const repoChunks = [makeChunk('src/consumer.ts', 1, colorSwitchConsumer(false))];
    return {
      ...makeContext({ patches, chunks, repoChunks }),
      changedFiles: ['src/color.ts'],
    } as ReviewContext;
  }

  it('includes the block when incomplete-handling is active and candidates exist', () => {
    const message = buildInitialMessage(contextWithStaleSwitch(), {
      blastRadius: null,
      rules: resolvedRulesWith('incomplete-handling'),
    });
    expect(message).toContain('<variant_sweep_candidates>');
    expect(message).toContain('Color.Green');
  });

  it('omits the block when rules are not provided at all', () => {
    const message = buildInitialMessage(contextWithStaleSwitch(), { blastRadius: null });
    expect(message).not.toContain('<variant_sweep_candidates>');
  });

  it('omits the block when incomplete-handling is not among the active rules', () => {
    const message = buildInitialMessage(contextWithStaleSwitch(), {
      blastRadius: null,
      rules: resolvedRulesWith('error-swallowing'),
    });
    expect(message).not.toContain('<variant_sweep_candidates>');
  });

  it('omits the block when the rule is active but no candidates are found', () => {
    const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
    const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
    const context = {
      ...makeContext({ patches, chunks, repoChunks: [] }),
      changedFiles: ['src/color.ts'],
    } as ReviewContext;
    const message = buildInitialMessage(context, {
      blastRadius: null,
      rules: resolvedRulesWith('incomplete-handling'),
    });
    expect(message).not.toContain('<variant_sweep_candidates>');
  });
});
