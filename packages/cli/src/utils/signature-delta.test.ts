import { describe, it, expect } from 'vitest';
import { computeExportedSignatureDelta } from './signature-delta.js';

describe('computeExportedSignatureDelta — signature-changed', () => {
  it('flags an exported top-level function whose signature changed', () => {
    const before = 'export function formatUser(user) { return user.name; }';
    const after = 'export function formatUser(user, opts) { return user.name; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });

    expect(result.filepath).toBe('a.ts');
    expect(result.changes).toEqual([
      expect.objectContaining({
        symbol: 'formatUser',
        symbolName: 'formatUser',
        kind: 'signature-changed',
        beforeSignature: expect.stringContaining('formatUser(user)'),
        afterSignature: expect.stringContaining('formatUser(user, opts)'),
      }),
    ]);
  });

  it('flags an exported class method whose signature changed, qualified by parentClass', () => {
    const before = 'export class Widget { render(x) { return x; } }';
    const after = 'export class Widget { render(x, y) { return x; } }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({
        symbol: 'Widget.render',
        symbolName: 'render',
        parentClass: 'Widget',
        kind: 'signature-changed',
      }),
    ]);
  });

  it('does not flag a body-only edit that leaves the signature unchanged', () => {
    const before = 'export function formatUser(user) { return user.name; }';
    const after = 'export function formatUser(user) { return user.name.trim(); }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });

  it('does not flag a single-to-multi-line param reflow with a trailing comma (whitespace/format-only)', () => {
    const before = 'export function foo(a, b) { return a + b; }';
    const after = ['export function foo(', '  a,', '  b,', ') {', '  return a + b;', '}'].join(
      '\n',
    );
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });

  it('does not flag a trailing-comma-only addition (whitespace/format-only)', () => {
    const before = 'export function foo(a, b) { return a + b; }';
    const after = 'export function foo(a, b,) { return a + b; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });

  it('does not flag a comma-spacing change, f(a,b) -> f(a, b) (whitespace/format-only)', () => {
    const before = 'export function foo(a,b) { return a + b; }';
    const after = 'export function foo(a, b) { return a + b; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });

  it('still flags a positional parameter rename, f(a) -> f(input) (a real API-surface change, not noise)', () => {
    const before = 'export function foo(a) { return a; }';
    const after = 'export function foo(input) { return input; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'foo', kind: 'signature-changed' }),
    ]);
  });

  it('does not flag a non-exported function whose signature changed', () => {
    const before = 'function helper(x) { return x; }';
    const after = 'function helper(x, y) { return x; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });

  it('does not flag a newly-exported function (adding an export breaks no existing caller)', () => {
    const before = 'function helper(x) { return x; }';
    const after = 'export function helper(x) { return x; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });
});

describe('computeExportedSignatureDelta — removed', () => {
  it('flags an exported function whose export was dropped, even though it still exists', () => {
    const before = 'export function formatUser(user) { return user.name; }';
    const after = 'function formatUser(user) { return user.name; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });

    expect(result.changes).toEqual([
      { symbol: 'formatUser', symbolName: 'formatUser', parentClass: undefined, kind: 'removed' },
    ]);
  });

  it('flags an exported function that was deleted entirely', () => {
    const before = 'export function formatUser(user) { return user.name; } function other() {}';
    const after = 'function other() {}';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'formatUser', kind: 'removed' }),
    ]);
  });

  it('flags every previously-exported symbol as removed when the whole file is deleted', () => {
    const before =
      'export function formatUser(user) { return user.name; } export class Widget { render() {} }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after: null });

    const symbols = result.changes.map(c => c.symbol).sort();
    expect(symbols).toEqual(['Widget.render', 'formatUser']);
    expect(result.changes.every(c => c.kind === 'removed')).toBe(true);
  });

  it('flags a class method as removed when the class itself loses its export', () => {
    const before = 'export class Widget { render(x) { return x; } }';
    const after = 'class Widget { render(x) { return x; } }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'Widget.render', kind: 'removed' }),
    ]);
  });
});

describe('computeExportedSignatureDelta — hard-private methods are never flagged', () => {
  it('ignores a #-prefixed private method even though its class is exported', () => {
    const before = 'export class Widget { #helper(x) { return x; } }';
    const after = 'export class Widget { #helper(x, y) { return x; } }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });

  it('does not flag a private method even when removed', () => {
    const before = 'export class Widget { #helper(x) { return x; } }';
    const after = 'export class Widget { }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });
    expect(result.changes).toEqual([]);
  });
});

describe('computeExportedSignatureDelta — brand new file', () => {
  it('never flags anything for a newly-added file (nothing to compare against)', () => {
    const after = 'export function formatUser(user) { return user.name; }';
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before: null, after });
    expect(result.changes).toEqual([]);
  });
});

describe('computeExportedSignatureDelta — C# properties (#871)', () => {
  it('flags a removed expression-bodied C# property as removed (AutoMapper-like Features.Count)', () => {
    const before = `public class Features {
    private readonly System.Collections.Generic.List<string> _features;
    public int Count => _features?.Count ?? 0;
}`;
    const after = `public class Features {
    private readonly System.Collections.Generic.List<string> _features;
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Features.cs', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'Features.Count', symbolName: 'Count', kind: 'removed' }),
    ]);
  });

  it('flags a C# property type change as signature-changed', () => {
    const before = `public class Features {
    public int Count => _features?.Count ?? 0;
}`;
    const after = `public class Features {
    public long Count => _features?.Count ?? 0;
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Features.cs', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({
        symbol: 'Features.Count',
        symbolName: 'Count',
        kind: 'signature-changed',
      }),
    ]);
  });

  it('does not flag an expression-bodied property whose expression changed but type did not', () => {
    const before = `public class Features {
    public int Count => _features?.Count ?? 0;
}`;
    const after = `public class Features {
    public int Count => _features?.Count ?? 1;
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Features.cs', before, after });
    expect(result.changes).toEqual([]);
  });

  it('flags a removed accessor-list C# property (auto-property) as removed', () => {
    const before = `public class Person {
    public string Name { get; set; }
}`;
    const after = `public class Person {
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Person.cs', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'Person.Name', kind: 'removed' }),
    ]);
  });

  it('flags an accessor-list C# property that lost its setter as signature-changed', () => {
    const before = `public class Person {
    public string Name { get; set; }
}`;
    const after = `public class Person {
    public string Name { get; }
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Person.cs', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'Person.Name', kind: 'signature-changed' }),
    ]);
  });

  it('does not flag a C# property on a non-exported (internal) class', () => {
    const before = `internal class Internal {
    public int Count => 0;
}`;
    const after = `internal class Internal {
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Internal.cs', before, after });
    expect(result.changes).toEqual([]);
  });

  it('still flags a C# method signature change alongside an untouched property (methods keep working)', () => {
    const before = `public class Mapper {
    public string Name { get; set; }
    public void Map(int x) { }
}`;
    const after = `public class Mapper {
    public string Name { get; set; }
    public void Map(int x, int y) { }
}`;
    const result = computeExportedSignatureDelta({ filepath: 'Mapper.cs', before, after });

    expect(result.changes).toEqual([
      expect.objectContaining({ symbol: 'Mapper.Map', kind: 'signature-changed' }),
    ]);
  });
});

describe('computeExportedSignatureDelta — sort order (worst-first)', () => {
  it('sorts removed before signature-changed', () => {
    const before = [
      'export function alpha(x) { return x; }',
      'export function zeta(x) { return x; }',
    ].join('\n');
    const after = [
      'export function alpha(x, y) { return x; }', // signature-changed
      'function zeta(x) { return x; }', // removed
    ].join('\n');
    const result = computeExportedSignatureDelta({ filepath: 'a.ts', before, after });

    expect(result.changes.map(c => c.symbol)).toEqual(['zeta', 'alpha']);
    expect(result.changes[0].kind).toBe('removed');
    expect(result.changes[1].kind).toBe('signature-changed');
  });
});
