import { describe, it, expect, vi } from 'vitest';
import { LogicPlugin } from '../src/plugins/logic.js';
import { ArchitecturalPlugin } from '../src/plugins/architectural.js';
import { createTestReport, silentLogger } from '../src/test-helpers.js';
import type { ReviewFinding, PresentContext } from '../src/plugin-types.js';

function makeLogicFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'logic',
    filepath: 'src/foo.ts',
    line: 10,
    severity: 'warning',
    category: 'breaking_change',
    message: 'Breaking change detected',
    ...overrides,
  };
}

function makeArchFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'architectural',
    filepath: 'src/foo.ts',
    line: 0,
    severity: 'info',
    category: 'architectural',
    message: 'DRY violation',
    evidence: 'Duplicate logic in src/foo.ts and src/bar.ts',
    suggestion: 'Extract shared logic into a utility',
    ...overrides,
  };
}

function makePresentContext(overrides?: Partial<PresentContext>): PresentContext {
  return {
    complexityReport: createTestReport(),
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    logger: silentLogger,
    addAnnotations: vi.fn(),
    appendSummary: vi.fn(),
    ...overrides,
  } as PresentContext;
}

// ---------------------------------------------------------------------------
// LogicPlugin.present()
// ---------------------------------------------------------------------------

describe('LogicPlugin.present()', () => {
  it('returns early when postInlineComments is not available (CLI mode)', async () => {
    const plugin = new LogicPlugin();
    const ctx = makePresentContext(); // no postInlineComments

    // Should not throw
    await plugin.present([makeLogicFinding()], ctx);
  });

  it('returns early when there are no logic findings', async () => {
    const plugin = new LogicPlugin();
    const postInlineComments = vi.fn().mockResolvedValue({ posted: 0, skipped: 0 });
    const ctx = makePresentContext({ postInlineComments });

    // Only a complexity finding — should be filtered out
    const findings = [makeLogicFinding({ pluginId: 'complexity' })];
    await plugin.present(findings, ctx);

    expect(postInlineComments).not.toHaveBeenCalled();
  });

  it('calls postInlineComments with only logic findings', async () => {
    const plugin = new LogicPlugin();
    const postInlineComments = vi.fn().mockResolvedValue({ posted: 1, skipped: 0 });
    const ctx = makePresentContext({ postInlineComments });

    const logicFinding = makeLogicFinding();
    const otherFinding = makeLogicFinding({ pluginId: 'complexity' });
    await plugin.present([logicFinding, otherFinding], ctx);

    expect(postInlineComments).toHaveBeenCalledTimes(1);
    expect(postInlineComments).toHaveBeenCalledWith([logicFinding], expect.any(String));
  });

  it('logs posted/skipped count after posting', async () => {
    const plugin = new LogicPlugin();
    const infos: string[] = [];
    const logger = { ...silentLogger, info: (msg: string) => infos.push(msg) };
    const postInlineComments = vi.fn().mockResolvedValue({ posted: 2, skipped: 1 });
    const ctx = makePresentContext({ postInlineComments, logger });

    await plugin.present([makeLogicFinding(), makeLogicFinding()], ctx);

    expect(infos.some(m => m === 'Logic: 2 posted, 1 skipped')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ArchitecturalPlugin.present()
// ---------------------------------------------------------------------------

describe('ArchitecturalPlugin.present()', () => {
  it('returns early when there are no architectural findings', async () => {
    const plugin = new ArchitecturalPlugin();
    const appendSummary = vi.fn();
    const ctx = makePresentContext({ appendSummary });

    // Only logic and complexity findings
    const findings = [
      makeLogicFinding({ pluginId: 'logic' }),
      makeLogicFinding({ pluginId: 'complexity' }),
    ];
    await plugin.present(findings, ctx);

    expect(appendSummary).not.toHaveBeenCalled();
  });

  it('appends formatted observations section to summary', async () => {
    const plugin = new ArchitecturalPlugin();
    const appendSummary = vi.fn();
    const ctx = makePresentContext({ appendSummary });

    await plugin.present([makeArchFinding()], ctx);

    expect(appendSummary).toHaveBeenCalledTimes(1);
    const summary: string = appendSummary.mock.calls[0][0];
    expect(summary).toContain('### Architectural observations');
    expect(summary).toContain('DRY violation');
    expect(summary).toContain('Duplicate logic in src/foo.ts and src/bar.ts');
    expect(summary).toContain('Extract shared logic into a utility');
  });

  it('filters to only architectural findings', async () => {
    const plugin = new ArchitecturalPlugin();
    const appendSummary = vi.fn();
    const ctx = makePresentContext({ appendSummary });

    const archFinding = makeArchFinding({ message: 'Arch issue' });
    const logicFinding = makeLogicFinding({ pluginId: 'logic', message: 'Logic issue' });
    await plugin.present([archFinding, logicFinding], ctx);

    const summary: string = appendSummary.mock.calls[0][0];
    expect(summary).toContain('Arch issue');
    expect(summary).not.toContain('Logic issue');
  });

  it('handles findings with missing evidence and suggestion gracefully', async () => {
    const plugin = new ArchitecturalPlugin();
    const appendSummary = vi.fn();
    const ctx = makePresentContext({ appendSummary });

    const finding = makeArchFinding({ evidence: undefined, suggestion: undefined });
    await plugin.present([finding], ctx);

    // Should not throw; evidence/suggestion render as empty string
    expect(appendSummary).toHaveBeenCalledTimes(1);
    const summary: string = appendSummary.mock.calls[0][0];
    expect(summary).toContain('DRY violation');
  });
});
