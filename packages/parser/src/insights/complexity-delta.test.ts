import { describe, it, expect } from 'vitest';
import {
  computeComplexityDelta,
  computeFileComplexityDelta,
  resolveComplexityDeltaThresholds,
  hasRegressions,
  DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
  type ComplexityDeltaThresholds,
  type FunctionComplexityDelta,
  type MetricComplexityDelta,
} from './complexity-delta.js';

// Fixture bodies with known metrics (measured against the real chunker):
//   trivial   cyclo 1  cog 0
//   oneIf     cyclo 2  cog 1
//   twoNest   cyclo 3  cog 3
//   threeNest cyclo 4  cog 6
//   deep      cyclo 6  cog 15
const BODY = {
  trivial: 'function target(x){ return x+1; }',
  oneIf: 'function target(x){ if(x){return 1;} return 2; }',
  twoNest: 'function target(x){ if(x){ if(x>1){ return 1; } } return 2; }',
  threeNest: 'function target(x){ if(x){ if(x>1){ if(x>2){ return 1; } } } return 2; }',
  deep: 'function target(x){ if(x){ for(const i of x){ if(i){ while(i){ i--; if(i>5){break;} } } } } return 0; }',
} as const;

// Isolate the cognitive metric: only `mentalLoad` is small enough to be crossed;
// the other metrics stay far below their thresholds so they never gate.
const COG_ONLY: ComplexityDeltaThresholds = {
  testPaths: 1000,
  mentalLoad: 5,
  timeToUnderstandMinutes: 100000,
  estimatedBugs: 1000,
};

function fnByName(
  functions: FunctionComplexityDelta[],
  name: string,
): FunctionComplexityDelta | undefined {
  return functions.find(f => f.symbolName === name);
}

function cognitive(fn: FunctionComplexityDelta): MetricComplexityDelta {
  const m = fn.metrics.find(x => x.metricType === 'cognitive');
  if (!m) throw new Error('no cognitive metric on function delta');
  return m;
}

describe('computeFileComplexityDelta — verdict matrix (cognitive-isolated)', () => {
  it('crossed: under-threshold → over-threshold fails the gate', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: BODY.twoNest, after: BODY.threeNest },
      COG_ONLY,
    );
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('crossed');
    expect(fn.isRegression).toBe(true);
    const cog = cognitive(fn);
    expect(cog.before).toBe(3);
    expect(cog.after).toBe(6);
    expect(cog.threshold).toBe(5);
    expect(cog.verdict).toBe('crossed');
  });

  it('worsened: increased but still under threshold does not fail', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: BODY.oneIf, after: BODY.twoNest },
      COG_ONLY,
    );
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('worsened');
    expect(fn.isRegression).toBe(false);
    expect(cognitive(fn).verdict).toBe('worsened');
  });

  it('improved: decreased complexity does not fail', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: BODY.threeNest, after: BODY.oneIf },
      COG_ONLY,
    );
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('improved');
    expect(fn.isRegression).toBe(false);
    // dropped from over-threshold (6) back under (1) — still classified improved
    expect(cognitive(fn).verdict).toBe('improved');
  });

  it('pre-existing: worsening an already-over-threshold function does not fail', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: BODY.threeNest, after: BODY.deep },
      COG_ONLY,
    );
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('pre-existing');
    expect(fn.isRegression).toBe(false);
    const cog = cognitive(fn);
    expect(cog.before).toBe(6);
    expect(cog.after).toBe(15);
    expect(cog.verdict).toBe('pre-existing');
  });

  it('unchanged functions are omitted from the file result', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: BODY.twoNest, after: BODY.twoNest },
      COG_ONLY,
    );
    expect(file.functions).toHaveLength(0);
    expect(file.status).toBe('modified');
  });

  it('added file: new function over threshold → new-over-threshold (fails)', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: null, after: BODY.deep },
      COG_ONLY,
    );
    expect(file.status).toBe('added');
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('new-over-threshold');
    expect(fn.isRegression).toBe(true);
    const cog = cognitive(fn);
    expect(cog.before).toBeNull();
    expect(cog.after).toBe(15);
  });

  it('added file: new function under threshold → new-under-threshold (advisory)', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: null, after: BODY.oneIf },
      COG_ONLY,
    );
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('new-under-threshold');
    expect(fn.isRegression).toBe(false);
  });

  it('deleted file: functions are marked removed (advisory)', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'a.ts', before: BODY.deep, after: null },
      COG_ONLY,
    );
    expect(file.status).toBe('deleted');
    const fn = fnByName(file.functions, 'target')!;
    expect(fn.verdict).toBe('removed');
    expect(fn.isRegression).toBe(false);
    expect(cognitive(fn).after).toBeNull();
  });
});

describe('computeFileComplexityDelta — renames', () => {
  it('renamed file with an unchanged function body produces no noise', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'new/path.ts', oldPath: 'old/path.ts', before: BODY.deep, after: BODY.deep },
      COG_ONLY,
    );
    expect(file.status).toBe('renamed');
    expect(file.oldPath).toBe('old/path.ts');
    expect(file.functions).toHaveLength(0);
  });

  it('renamed file where a function crosses is reported', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'new.ts', oldPath: 'old.ts', before: BODY.twoNest, after: BODY.threeNest },
      COG_ONLY,
    );
    expect(file.status).toBe('renamed');
    expect(fnByName(file.functions, 'target')!.verdict).toBe('crossed');
  });

  it('documented limit: renaming a function identifier reads as remove + add', () => {
    // `target` (deep, over threshold) renamed to `renamed` (same body).
    const before = BODY.deep;
    const after = BODY.deep.replace(/target/g, 'renamed');
    const file = computeFileComplexityDelta({ filepath: 'a.ts', before, after }, COG_ONLY);

    const removed = fnByName(file.functions, 'target')!;
    const added = fnByName(file.functions, 'renamed')!;
    expect(removed.verdict).toBe('removed');
    expect(added.verdict).toBe('new-over-threshold');
    expect(added.isRegression).toBe(true);
  });
});

describe('thresholds', () => {
  it('resolveComplexityDeltaThresholds fills defaults and applies overrides', () => {
    expect(resolveComplexityDeltaThresholds()).toEqual(DEFAULT_COMPLEXITY_DELTA_THRESHOLDS);
    expect(resolveComplexityDeltaThresholds({ mentalLoad: 3 })).toEqual({
      ...DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
      mentalLoad: 3,
    });
  });

  it('default thresholds gate cognitive at 15 (the motivating incident)', () => {
    // deep has cognitive 15 == default mentalLoad 15 → over threshold.
    const file = computeFileComplexityDelta({ filepath: 'a.ts', before: null, after: BODY.deep });
    const fn = fnByName(file.functions, 'target')!;
    expect(cognitive(fn).threshold).toBe(15);
    expect(fn.verdict).toBe('new-over-threshold');
  });

  it('a lower threshold turns a previously-passing change into a crossing', () => {
    const change = { filepath: 'a.ts', before: BODY.oneIf, after: BODY.twoNest };
    // cognitive 1 → 3
    expect(computeFileComplexityDelta(change, COG_ONLY).functions[0].verdict).toBe('worsened');
    expect(
      computeFileComplexityDelta(change, { ...COG_ONLY, mentalLoad: 3 }).functions[0].verdict,
    ).toBe('crossed');
  });
});

describe('methods and multiple functions', () => {
  it('matches methods by parentClass::name and only reports the changed one', () => {
    const before = `
class Svc {
  keep(x){ if(x){ if(x>1){ return 1; } } return 2; }
  edit(x){ if(x){ return 1; } return 2; }
}`;
    const after = `
class Svc {
  keep(x){ if(x){ if(x>1){ return 1; } } return 2; }
  edit(x){ if(x){ if(x>1){ if(x>2){ return 1; } } } return 2; }
}`;
    const file = computeFileComplexityDelta({ filepath: 'svc.ts', before, after }, COG_ONLY);
    // keep unchanged (hidden); edit worsened cognitive 1 → 6, crosses threshold 5
    expect(fnByName(file.functions, 'keep')).toBeUndefined();
    const edit = fnByName(file.functions, 'edit')!;
    expect(edit.parentClass).toBe('Svc');
    expect(edit.key).toBe('Svc::edit');
    expect(edit.verdict).toBe('crossed');
  });
});

describe('files with no analyzable functions', () => {
  it('produces an empty function list for content without functions', () => {
    const file = computeFileComplexityDelta(
      { filepath: 'notes.md', before: '# hello', after: '# hello world' },
      COG_ONLY,
    );
    expect(file.functions).toHaveLength(0);
  });
});

describe('computeComplexityDelta — aggregation', () => {
  it('summarizes crossings, new-over, worsened and improved across files', () => {
    const result = computeComplexityDelta(
      [
        { filepath: 'crossed.ts', before: BODY.twoNest, after: BODY.threeNest }, // crossed
        { filepath: 'newover.ts', before: null, after: BODY.deep }, // new-over-threshold
        { filepath: 'worse.ts', before: BODY.oneIf, after: BODY.twoNest }, // worsened
        { filepath: 'better.ts', before: BODY.threeNest, after: BODY.oneIf }, // improved
        { filepath: 'same.ts', before: BODY.twoNest, after: BODY.twoNest }, // unchanged (hidden)
      ],
      COG_ONLY,
    );

    expect(result.summary.filesChanged).toBe(5);
    expect(result.summary.crossed).toBe(1);
    expect(result.summary.newOverThreshold).toBe(1);
    expect(result.summary.worsened).toBe(1);
    expect(result.summary.improved).toBe(1);
    expect(result.summary.regressions).toBe(2);
    expect(result.regressions).toHaveLength(2);
    expect(result.regressions.map(r => r.verdict).sort()).toEqual([
      'crossed',
      'new-over-threshold',
    ]);
    expect(hasRegressions(result)).toBe(true);
    expect(result.thresholds).toEqual(COG_ONLY);
  });

  it('reports no regressions for an all-improved / unchanged changeset', () => {
    const result = computeComplexityDelta(
      [
        { filepath: 'better.ts', before: BODY.threeNest, after: BODY.oneIf },
        { filepath: 'same.ts', before: BODY.twoNest, after: BODY.twoNest },
      ],
      COG_ONLY,
    );
    expect(result.summary.regressions).toBe(0);
    expect(hasRegressions(result)).toBe(false);
  });

  it('functions within a file are sorted worst-first', () => {
    const before = `
function a(x){ if(x){ if(x>1){ return 1; } } return 2; }
function b(x){ if(x){ return 1; } return 2; }`;
    const after = `
function a(x){ if(x){ if(x>1){ if(x>2){ return 1; } } } return 2; }
function b(x){ if(x){ if(x>1){ return 1; } } return 2; }`;
    // a: cog 3 → 6 crossed; b: cog 1 → 3 worsened
    const file = computeFileComplexityDelta({ filepath: 'm.ts', before, after }, COG_ONLY);
    expect(file.functions.map(f => f.verdict)).toEqual(['crossed', 'worsened']);
  });
});
